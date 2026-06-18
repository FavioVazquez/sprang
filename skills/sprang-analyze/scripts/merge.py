#!/usr/bin/env python3
"""
sprang merge — assemble intermediate chunk files into a valid knowledge-graph.json

Usage:
    PROJECT_ROOT=/path/to/project python3 merge.py

Reads from $PROJECT_ROOT/.sprang/intermediate/:
    final-nodes-chunk-*.json   — node arrays (max 50 per file)
    final-edges.json           — edge array
    final-layers.json          — layer array (strings or objects)
    final-tours.json           — tour array (also accepts final-tour.json)
    final-domains.json         — domain array (also accepts domains.json)
    risk-scores.json           — per-node risk_score / risk_factors / decision_context / structural_warnings
    assembled-graph.json       — metadata (project_name, description, languages, frameworks)

Writes:
    $PROJECT_ROOT/.sprang/knowledge-graph.json

Defensively NORMALISES all common agent mistakes so the output always validates
against @sprang/core's knowledgeGraphSchema (Zod). An agent driving a long
multi-phase analysis will inevitably drift from the exact field names/enums in
the templates; merge.py is the deterministic chokepoint that coerces whatever
it produced into the canonical shape. Handled automatically:
    - dicts-as-arrays for any field
    - layers written as plain strings / missing id|name|node_ids
    - tours written as a flat step array, or steps using title/description
      instead of step_title/explanation; tours clamped to 1..15 steps
    - domains using `name` instead of `label`, or flat (node_ids with no flows);
      flows/steps backfilled with required id/label/node_ids/weight
    - node decision_context with missing fields or string change_frequency
    - node structural_warnings written as bare strings or with invalid category
    - node risk_factors containing values outside the canonical enum
    - smell_summary / security_summary recomputed from normalised node warnings
    - duplicate edges (deduped by source::target::type)
    - both final-tours.json and final-tour.json filenames
"""
import json
import glob
import os
import subprocess
import sys
from datetime import datetime, timezone

# ── Canonical vocabularies (must mirror packages/core/src/schema/validators.ts) ──
VALID_SMELL_CATEGORIES = {
    'duplicate_logic', 'unclear_coupling', 'low_cohesion', 'god_node',
    'unstable_interface', 'orphan_node', 'circular_dependency', 'over_connected',
    'name_duplicate', 'layer_violation',
}
VALID_SECURITY_CATEGORIES = {
    'hardcoded_secret', 'sql_injection', 'xss_risk', 'unsafe_eval',
    'unsafe_exec', 'unsafe_deserialization', 'path_traversal', 'weak_crypto',
}
VALID_RISK_FACTORS = {
    'high_coupling', 'no_test_coverage', 'frequent_changes', 'large_blast_radius',
    'critical_path', 'single_author', 'recent_churn', 'has_structural_warnings',
}
VALID_SEVERITIES = {'low', 'medium', 'high'}
VALID_COMPLEXITY = {'simple', 'moderate', 'complex'}


def to_array(val):
    if not val:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, dict):
        return list(val.values())
    return []


def _str(v, default=''):
    return v if isinstance(v, str) else (str(v) if v is not None else default)


def _str_list(v):
    return [_str(x) for x in to_array(v) if x is not None]


def _slug(s, fallback):
    s = _str(s).strip().lower()
    out = ''.join(c if c.isalnum() else '-' for c in s).strip('-')
    return out or fallback


def _to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _clamp01(v, default=0.5):
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return default


# ── Node sub-field normalisers ──────────────────────────────────────────────
def normalize_commit(c):
    if not isinstance(c, dict) or not c.get('sha'):
        return None
    out = {
        'sha': _str(c.get('sha')),
        'date': _str(c.get('date')),
        'message': _str(c.get('message')),
        'author': _str(c.get('author')),
    }
    if c.get('diff_summary'):
        out['diff_summary'] = _str(c.get('diff_summary'))
    return out


def normalize_decision_context(dc):
    """Return a schema-complete decision_context, or None to drop it entirely."""
    if not isinstance(dc, dict):
        return None
    commits = [c for c in (normalize_commit(x) for x in to_array(dc.get('commits'))) if c]
    return {
        'commits': commits,
        'primary_authors': _str_list(dc.get('primary_authors')),
        'last_changed': _str(dc.get('last_changed')),
        'change_frequency': _to_int(dc.get('change_frequency'), 0),
        'rationale_snippets': _str_list(dc.get('rationale_snippets')),
        'pr_references': _str_list(dc.get('pr_references')),
        'changelog_entries': _str_list(dc.get('changelog_entries')),
    }


def normalize_structural_warning(w):
    """Drop bare strings / invalid categories; coerce valid objects."""
    if not isinstance(w, dict):
        return None
    cat = w.get('category')
    if cat not in VALID_SMELL_CATEGORIES:
        return None
    sev = w.get('severity')
    return {
        'category': cat,
        'severity': sev if sev in VALID_SEVERITIES else 'medium',
        'description': _str(w.get('description')),
        'related_node_ids': _str_list(w.get('related_node_ids')),
        'heuristic': _str(w.get('heuristic')),
    }


def normalize_security_warning(w):
    if not isinstance(w, dict):
        return None
    cat = w.get('category')
    if cat not in VALID_SECURITY_CATEGORIES:
        return None
    sev = w.get('severity')
    out = {
        'category': cat,
        'severity': sev if sev in VALID_SEVERITIES else 'medium',
        'description': _str(w.get('description')),
        'pattern': _str(w.get('pattern')),
    }
    if isinstance(w.get('line'), int):
        out['line'] = w['line']
    if w.get('snippet'):
        out['snippet'] = _str(w.get('snippet'))
    return out


def normalize_node(n):
    if not isinstance(n, dict) or not n.get('id'):
        return None
    n = dict(n)
    if not n.get('label'):
        n['label'] = n.get('name') or str(n['id']).split(':')[-1] or str(n['id'])
    if n.get('complexity') not in VALID_COMPLEXITY:
        n.pop('complexity', None)

    if 'decision_context' in n:
        dc = normalize_decision_context(n['decision_context'])
        if dc:
            n['decision_context'] = dc
        else:
            n.pop('decision_context', None)

    if 'structural_warnings' in n:
        ws = [x for x in (normalize_structural_warning(w) for w in to_array(n['structural_warnings'])) if x]
        if ws:
            n['structural_warnings'] = ws
        else:
            n.pop('structural_warnings', None)

    if 'security_warnings' in n:
        sw = [x for x in (normalize_security_warning(w) for w in to_array(n['security_warnings'])) if x]
        if sw:
            n['security_warnings'] = sw
        else:
            n.pop('security_warnings', None)

    if 'risk_factors' in n:
        rf = [f for f in to_array(n['risk_factors']) if f in VALID_RISK_FACTORS]
        if rf:
            n['risk_factors'] = rf
        else:
            n.pop('risk_factors', None)

    if 'risk_score' in n:
        if isinstance(n['risk_score'], (int, float)):
            n['risk_score'] = max(0.0, min(1.0, float(n['risk_score'])))
        else:
            n.pop('risk_score', None)

    return n


# ── Layer / Tour / Domain normalisers ───────────────────────────────────────
def normalize_layer(l, idx):
    if isinstance(l, str):
        return {'id': _slug(l, f'layer-{idx}'), 'name': l, 'node_ids': []}
    if not isinstance(l, dict):
        return None
    name = _str(l.get('name') or l.get('label') or l.get('id') or f'Layer {idx}')
    out = {
        'id': _str(l.get('id') or _slug(name, f'layer-{idx}')),
        'name': name,
        'node_ids': _str_list(l.get('node_ids')),
    }
    if l.get('description'):
        out['description'] = _str(l.get('description'))
    return out


def normalize_tour_step(st):
    if not isinstance(st, dict):
        return None
    title = st.get('step_title') or st.get('title') or st.get('label')
    expl = st.get('explanation') or st.get('description') or st.get('summary')
    if not (title or expl or st.get('node_id') or st.get('node_ids')):
        return None
    out = {'step_title': _str(title) or 'Step', 'explanation': _str(expl)}
    if st.get('node_id'):
        out['node_id'] = _str(st.get('node_id'))
    if st.get('node_ids'):
        out['node_ids'] = _str_list(st.get('node_ids'))
    if st.get('language_lesson'):
        out['language_lesson'] = _str(st.get('language_lesson'))
    if isinstance(st.get('highlight'), bool):
        out['highlight'] = st['highlight']
    return out


def normalize_tour(t, idx):
    if not isinstance(t, dict):
        return None
    steps = [s for s in (normalize_tour_step(x) for x in to_array(t.get('steps'))) if s]
    steps = steps[:15]
    if not steps:
        return None
    out = {
        'id': _str(t.get('id') or f'tour-{idx}'),
        'title': _str(t.get('title') or t.get('name') or 'Architecture Tour'),
        'description': _str(t.get('description') or t.get('summary') or 'Guided walkthrough of the codebase'),
        'steps': steps,
    }
    if t.get('entry_point'):
        out['entry_point'] = _str(t.get('entry_point'))
    return out


def normalize_domain_step(st, fid, idx):
    if not isinstance(st, dict):
        if st:
            return {'id': f'{fid}-step-{idx}', 'label': _str(st), 'node_ids': [], 'weight': 0.5}
        return None
    sid = _str(st.get('id') or f'{fid}-step-{idx}')
    out = {
        'id': sid,
        'label': _str(st.get('label') or st.get('name') or sid),
        'node_ids': _str_list(st.get('node_ids')),
        'weight': _clamp01(st.get('weight'), 0.5),
    }
    if st.get('summary'):
        out['summary'] = _str(st.get('summary'))
    return out


def normalize_domain_flow(fl, did, idx):
    if not isinstance(fl, dict):
        return None
    fid = _str(fl.get('id') or f'{did}-flow-{idx}')
    label = _str(fl.get('label') or fl.get('name') or fid)
    steps = [s for s in (normalize_domain_step(x, fid, i) for i, x in enumerate(to_array(fl.get('steps')))) if s]
    if not steps:
        steps = [{'id': f'{fid}-step', 'label': label, 'node_ids': _str_list(fl.get('node_ids')), 'weight': 1.0}]
    out = {'id': fid, 'label': label, 'steps': steps}
    if fl.get('summary'):
        out['summary'] = _str(fl.get('summary'))
    if fl.get('entry_points'):
        out['entry_points'] = _str_list(fl.get('entry_points'))
    if fl.get('business_rules'):
        out['business_rules'] = _str_list(fl.get('business_rules'))
    return out


def normalize_domain(d, idx):
    if not isinstance(d, dict):
        return None
    label = _str(d.get('label') or d.get('name') or f'Domain {idx}')
    did = _str(d.get('id') or _slug(label, f'domain-{idx}'))
    flows = [f for f in (normalize_domain_flow(x, did, i) for i, x in enumerate(to_array(d.get('flows')))) if f]
    if not flows:
        # Flat domain (node_ids but no flows) → wrap in a single default flow/step.
        node_ids = _str_list(d.get('node_ids'))
        flows = [{
            'id': f'{did}-flow',
            'label': label,
            'steps': [{'id': f'{did}-step', 'label': label, 'node_ids': node_ids, 'weight': 1.0}],
        }]
    out = {'id': did, 'label': label, 'flows': flows}
    if d.get('summary') or d.get('description'):
        out['summary'] = _str(d.get('summary') or d.get('description'))
    if d.get('entities'):
        out['entities'] = _str_list(d.get('entities'))
    return out


def main():
    root = os.environ.get("PROJECT_ROOT", os.getcwd())
    inter = os.path.join(root, ".sprang", "intermediate")

    if not os.path.isdir(inter):
        print(f"ERROR: intermediate directory not found: {inter}", file=sys.stderr)
        sys.exit(1)

    # ── Nodes ──────────────────────────────────────────────────────────────────
    nodes = []
    chunk_files = sorted(glob.glob(os.path.join(inter, "final-nodes-chunk-*.json")))
    if not chunk_files:
        print("ERROR: No final-nodes-chunk-*.json files found in intermediate/", file=sys.stderr)
        sys.exit(1)
    for f in chunk_files:
        try:
            nodes.extend(to_array(json.load(open(f))))
        except Exception as e:
            print(f"Warning: skipping {f}: {e}", file=sys.stderr)
    if not nodes:
        print("ERROR: No nodes found after loading chunk files.", file=sys.stderr)
        sys.exit(1)

    # ── Edges (deduplicate) ────────────────────────────────────────────────────
    edges_path = os.path.join(inter, "final-edges.json")
    raw_edges = to_array(json.load(open(edges_path))) if os.path.exists(edges_path) else []
    edge_set = {}
    for e in raw_edges:
        key = f"{e.get('source')}::{e.get('target')}::{e.get('type')}"
        edge_set[key] = e
    edges = list(edge_set.values())

    # ── Layers (normalise strings → objects) ──────────────────────────────────
    layers_path = os.path.join(inter, "final-layers.json")
    raw_layers = to_array(json.load(open(layers_path))) if os.path.exists(layers_path) else []
    layers = [l for l in (normalize_layer(x, i) for i, x in enumerate(raw_layers)) if l]

    # ── Tours (try both filenames) ─────────────────────────────────────────────
    raw_tours = []
    for fname in ["final-tours.json", "final-tour.json"]:
        p = os.path.join(inter, fname)
        if os.path.exists(p):
            raw_tours = to_array(json.load(open(p)))
            break
    # Wrap a flat step array into a single Tour object before normalising.
    if raw_tours and isinstance(raw_tours[0], dict) and 'steps' not in raw_tours[0]:
        entry = raw_tours[0].get('node_ids', [None])[0] if raw_tours else None
        raw_tours = [{
            "id": "tour-main",
            "title": "Architecture Tour",
            "description": "Guided walkthrough from entry point through all layers",
            "entry_point": entry,
            "steps": raw_tours,
        }]
    tours = [t for t in (normalize_tour(x, i) for i, x in enumerate(raw_tours)) if t]

    # ── Domains (try final-domains.json) ──────────────────────────────────────
    domains_from_file = []
    for fname in ["final-domains.json", "domains.json"]:
        p = os.path.join(inter, fname)
        if os.path.exists(p):
            domains_from_file = to_array(json.load(open(p)))
            break

    # ── Metadata ──────────────────────────────────────────────────────────────
    meta_path = os.path.join(inter, "assembled-graph.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}

    # ── Git hash ──────────────────────────────────────────────────────────────
    try:
        git_hash = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        git_hash = ""

    # ── Apply risk scores + decision_context from risk-scores.json ───────────
    risk_path = os.path.join(inter, "risk-scores.json")
    if os.path.exists(risk_path):
        try:
            risk_data = json.load(open(risk_path))
            if isinstance(risk_data, dict):
                node_map_tmp = {n['id']: n for n in nodes if isinstance(n, dict) and 'id' in n}
                for node_id, risk_info in risk_data.items():
                    if node_id in node_map_tmp:
                        node = node_map_tmp[node_id]
                        if risk_info.get('risk_score') is not None:
                            node['risk_score'] = risk_info['risk_score']
                        if risk_info.get('risk_factors'):
                            node['risk_factors'] = risk_info['risk_factors']
                        if risk_info.get('decision_context'):
                            node['decision_context'] = risk_info['decision_context']
                        if risk_info.get('structural_warnings'):
                            node['structural_warnings'] = risk_info['structural_warnings']
                        if risk_info.get('security_warnings'):
                            node['security_warnings'] = risk_info['security_warnings']
                nodes = list(node_map_tmp.values())
        except Exception as e:
            print(f"Warning: could not load risk-scores.json: {e}", file=sys.stderr)

    # ── Backfill layer onto nodes (GraphCanvas reads node.layer for color) ─────
    node_map = {n['id']: n for n in nodes if isinstance(n, dict) and 'id' in n}
    for layer in layers:
        for nid in layer.get('node_ids', []):
            if nid in node_map and not node_map[nid].get('layer'):
                node_map[nid]['layer'] = layer['id']
    nodes = list(node_map.values())

    # ── Normalise every node to the canonical schema ──────────────────────────
    nodes = [n for n in (normalize_node(x) for x in nodes) if n]

    # ── Normalise domains (after node normalisation so ids are stable) ─────────
    raw_domains = domains_from_file or to_array(meta.get("domains"))
    domains = [d for d in (normalize_domain(x, i) for i, x in enumerate(raw_domains)) if d]

    # ── Recompute smell + security summaries from normalised node warnings ─────
    smell_summary = {}
    sec_by_sev = {'high': 0, 'medium': 0, 'low': 0}
    sec_by_cat = {}
    sec_total = 0
    for n in nodes:
        for w in n.get('structural_warnings', []):
            smell_summary[w['category']] = smell_summary.get(w['category'], 0) + 1
        for w in n.get('security_warnings', []):
            sec_total += 1
            sec_by_sev[w['severity']] = sec_by_sev.get(w['severity'], 0) + 1
            sec_by_cat[w['category']] = sec_by_cat.get(w['category'], 0) + 1
    if not smell_summary and isinstance(meta.get('smell_summary'), dict):
        # Fall back to meta, keeping only canonical categories with int counts.
        smell_summary = {
            k: int(v) for k, v in meta['smell_summary'].items()
            if k in VALID_SMELL_CATEGORIES and isinstance(v, (int, float))
        }
    security_summary = (
        {'total': sec_total, 'by_severity': sec_by_sev, 'by_category': sec_by_cat}
        if sec_total else None
    )

    # ── Risk summary ──────────────────────────────────────────────────────────
    risk = {"high": 0, "medium": 0, "low": 0}
    for n in nodes:
        r = n.get("risk_score", 0) if isinstance(n, dict) else 0
        if r and r >= 0.7:
            risk["high"] += 1
        elif r and r >= 0.4:
            risk["medium"] += 1
        else:
            risk["low"] += 1

    now = datetime.now(timezone.utc).isoformat()
    project_name = meta.get("project_name") or os.path.basename(os.path.abspath(root))

    # phase2_completed_at — use phase6-done.json timestamp if present (enrichment done)
    phase2_completed_at = None
    for marker in ["phase6-done.json", "phase5-done.json"]:
        p = os.path.join(inter, marker)
        if os.path.exists(p):
            try:
                phase2_completed_at = json.load(open(p)).get("timestamp")
            except Exception:
                pass
            if phase2_completed_at:
                break

    # ── Assemble envelope ──────────────────────────────────────────────────────
    stats = {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "risk_summary": risk,
        "smell_summary": smell_summary,
        "generated_at": now,
        "gitCommitHash": git_hash,
    }
    if security_summary:
        stats["security_summary"] = security_summary
    if phase2_completed_at:
        stats["phase2_completed_at"] = phase2_completed_at

    graph = {
        "version": "0.2.0",
        "kind": "codebase",
        "generated_at": now,
        "project_root": os.path.abspath(root),
        "project_name": project_name,
        "description": meta.get("description", ""),
        "languages": meta.get("languages", []),
        "frameworks": meta.get("frameworks", []),
        "phase": "complete",
        "stats": stats,
        "nodes": nodes,
        "edges": edges,
        "layers": layers,
        "tours": tours,
        "domains": domains,
        "annotations": [],
        "health": meta.get("health", {}),
    }

    # ── Write ──────────────────────────────────────────────────────────────────
    out_path = os.path.join(root, ".sprang", "knowledge-graph.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)

    print(f"OK: {len(nodes)} nodes, {len(edges)} edges, {len(layers)} layers, "
          f"{len(tours)} tours, {len(domains)} domains")
    print(f"Written: {out_path}")


if __name__ == "__main__":
    main()
