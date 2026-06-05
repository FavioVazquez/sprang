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
    assembled-graph.json       — metadata (project_name, description, languages, frameworks)

Writes:
    $PROJECT_ROOT/.sprang/knowledge-graph.json

Handles all common agent mistakes automatically:
    - dicts-as-arrays for any field
    - layers written as plain strings
    - missing node_ids on layer objects
    - duplicate edges (deduped by source::target::type)
    - both final-tours.json and final-tour.json filenames
"""
import json
import glob
import os
import subprocess
import sys
from datetime import datetime, timezone


def to_array(val):
    if not val:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, dict):
        return list(val.values())
    return []


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
    layers = []
    for l in raw_layers:
        if isinstance(l, str):
            layers.append({"id": l.lower().replace(" ", "_"), "name": l, "node_ids": []})
        elif isinstance(l, dict):
            if not isinstance(l.get("node_ids"), list):
                l["node_ids"] = []
            layers.append(l)

    # ── Tours (try both filenames) ─────────────────────────────────────────────
    tours = []
    for fname in ["final-tours.json", "final-tour.json"]:
        p = os.path.join(inter, fname)
        if os.path.exists(p):
            tours = to_array(json.load(open(p)))
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

    # ── Risk summary ──────────────────────────────────────────────────────────
    risk = {"high": 0, "medium": 0, "low": 0}
    for n in nodes:
        r = n.get("risk_score", 0) if isinstance(n, dict) else 0
        if r >= 0.7:
            risk["high"] += 1
        elif r >= 0.4:
            risk["medium"] += 1
        else:
            risk["low"] += 1

    now = datetime.now(timezone.utc).isoformat()
    project_name = meta.get("project_name") or os.path.basename(os.path.abspath(root))

    # ── Wrap flat tour steps into Tour object if needed ───────────────────────
    if tours and isinstance(tours[0], dict) and 'steps' not in tours[0]:
        entry = tours[0].get('node_ids', [None])[0] if tours else None
        tours = [{
            "id": "tour-main",
            "title": "Architecture Tour",
            "description": "Guided walkthrough from entry point through all layers",
            "entry_point": entry,
            "steps": tours,
        }]

    # ── Backfill layer_id onto nodes ──────────────────────────────────────────
    node_map = {n['id']: n for n in nodes if isinstance(n, dict) and 'id' in n}
    for layer in layers:
        for nid in layer.get('node_ids', []):
            if nid in node_map and not node_map[nid].get('layer_id'):
                node_map[nid]['layer_id'] = layer['id']
    nodes = list(node_map.values())

    # ── Assemble envelope ──────────────────────────────────────────────────────
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
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "risk_summary": risk,
            "smell_summary": meta.get("smell_summary", {}),
            "generated_at": now,
            "gitCommitHash": git_hash,
        },
        "nodes": nodes,
        "edges": edges,
        "layers": layers,
        "tours": tours,
        "domains": meta.get("domains", []),
        "annotations": [],
        "health": meta.get("health", {}),
    }

    # ── Write ──────────────────────────────────────────────────────────────────
    out_path = os.path.join(root, ".sprang", "knowledge-graph.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)

    print(f"OK: {len(nodes)} nodes, {len(edges)} edges, {len(layers)} layers, {len(tours)} tours")
    print(f"Written: {out_path}")


if __name__ == "__main__":
    main()
