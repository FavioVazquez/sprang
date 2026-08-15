import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Link2, AlertTriangle } from 'lucide-react';
import { useDashboardStore } from '../store';
import { NoBehavioralData } from '../components/NoBehavioralData';
import {
  loadCoupling,
  deriveCouplingFromLastChange,
  buildCouplingModel,
  arcStrokeWidth,
  ARC_COLORS,
  type CouplingPair,
  type CouplingSource,
} from '../utils/coupling';
import type { KnowledgeGraph } from '../types';

interface CouplingViewProps {
  graph: KnowledgeGraph;
  onNodeSelect: (nodeId: string) => void;
  /** Injectable for tests; defaults to the real `/coupling.json` fetch. */
  loadPairs?: typeof loadCoupling;
}

const MARGIN = { top: 24, bottom: 120, left: 24, right: 24 };

export function CouplingView({ graph, onNodeSelect, loadPairs = loadCoupling }: CouplingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 960, height: 560 });
  const [pairs, setPairs] = useState<CouplingPair[] | null>(null);
  const [source, setSource] = useState<CouplingSource>('none');
  const [loading, setLoading] = useState(true);
  const [onlyHidden, setOnlyHidden] = useState(false);
  const [hoveredArc, setHoveredArc] = useState<number | null>(null);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e && e.contentRect.width > 0) {
        setDims({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setDims({ width: rect.width, height: rect.height });
    return () => ro.disconnect();
  }, []);

  // Real co-change first; fall back to last_change proximity and say so.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const payload = await loadPairs();
      if (cancelled) return;
      if (payload && payload.pairs.length > 0) {
        setPairs(payload.pairs);
        setSource('git');
      } else {
        const derived = deriveCouplingFromLastChange(graph);
        setPairs(derived);
        setSource(derived.length > 0 ? 'derived' : 'none');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [graph, loadPairs]);

  const model = useMemo(
    () => buildCouplingModel(graph, pairs ?? []),
    [graph, pairs],
  );

  const visibleArcs = useMemo(
    () => (onlyHidden ? model.arcs.filter((a) => a.hidden) : model.arcs),
    [model.arcs, onlyHidden],
  );

  const xByPath = useMemo(() => {
    const map = new Map<string, number>();
    const n = model.files.length;
    const usable = Math.max(1, dims.width - MARGIN.left - MARGIN.right);
    const step = n > 1 ? usable / (n - 1) : 0;
    model.files.forEach((f, i) => map.set(f.path, MARGIN.left + step * i));
    return map;
  }, [model.files, dims.width]);

  const baseline = Math.max(60, dims.height - MARGIN.bottom);

  const activate = useCallback((nodeId: string | null) => {
    if (nodeId) onNodeSelect(nodeId);
  }, [onNodeSelect]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, nodeId: string | null) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(nodeId);
      }
    },
    [activate],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-950 text-surface-500 text-sm" role="status">
        Reading co-change history…
      </div>
    );
  }

  if (model.arcs.length === 0) {
    return (
      <NoBehavioralData
        what="temporal coupling view"
        icon={Link2}
        detail="No co-change pairs were found in .sprang/intermediate, and no last_change dates to approximate them from."
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-950 overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2 bg-surface-900/80 border-b border-surface-800 flex-shrink-0 z-10">
        <Link2 className="w-4 h-4 text-sprang-400" />
        <span className="text-sm font-semibold text-surface-100">Temporal coupling</span>
        <span className="text-xs text-surface-500">
          {model.totalCount} pairs · {model.hiddenCount} hidden
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-surface-400 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyHidden}
            onChange={(e) => setOnlyHidden(e.target.checked)}
            className="accent-sprang-500"
            aria-label="Show only hidden couplings"
          />
          Only hidden couplings
        </label>
      </header>

      {/* Provenance — the derived variant is a much weaker signal and must
          never be mistaken for measured co-change. */}
      {source === 'derived' ? (
        <div
          className="flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-200"
          role="note"
          data-testid="coupling-provenance"
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span>
            <strong className="font-semibold">Approximated, not measured.</strong> Real
            co-change data was not reachable at{' '}
            <code className="font-mono">.sprang/intermediate/</code>, so these pairs are
            inferred from files sharing a <code className="font-mono">last_change</code>{' '}
            date. That is a much weaker signal — treat it as a hint, not evidence. Run{' '}
            <code className="font-mono">sprang scan</code> from the repository root for
            true co-change.
          </span>
        </div>
      ) : (
        <div
          className="px-4 py-1.5 border-b border-surface-800 text-[11px] text-surface-500"
          role="note"
          data-testid="coupling-provenance"
        >
          Measured co-change from <code className="font-mono">.sprang/intermediate/</code>.
          Line thickness is co-change degree.
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          role="group"
          aria-label="Temporal coupling arc diagram. Arcs join files that change together; highlighted arcs have no dependency edge."
        >
          <svg width={dims.width} height={dims.height} data-testid="coupling-svg">
            {/* Arcs */}
            {visibleArcs.map((arc, i) => {
              const x1 = xByPath.get(arc.a) ?? 0;
              const x2 = xByPath.get(arc.b) ?? 0;
              const mid = (x1 + x2) / 2;
              const span = Math.abs(x2 - x1);
              const lift = Math.min(baseline - MARGIN.top, span * 0.55 + 20);
              const isHovered = hoveredArc === i;
              const touchesSelection =
                selectedNodeId !== null &&
                (arc.aNodeId === selectedNodeId || arc.bNodeId === selectedNodeId);
              return (
                <path
                  key={`${arc.a}|${arc.b}`}
                  d={`M ${x1} ${baseline} Q ${mid} ${baseline - lift * 2} ${x2} ${baseline}`}
                  fill="none"
                  stroke={arc.hidden ? ARC_COLORS.hidden : ARC_COLORS.visible}
                  strokeWidth={arcStrokeWidth(arc.degree) * (isHovered || touchesSelection ? 2 : 1)}
                  strokeOpacity={isHovered || touchesSelection ? 1 : arc.hidden ? 0.85 : 0.35}
                  strokeDasharray={arc.hidden ? '5 3' : undefined}
                  strokeLinecap="round"
                  data-testid={`coupling-arc-${arc.a}|${arc.b}`}
                  data-hidden-coupling={arc.hidden ? 'true' : 'false'}
                  data-degree={arc.degree}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    `${arc.a} and ${arc.b} change together, degree ${arc.degree}` +
                    (arc.hidden
                      ? ' — hidden coupling: no dependency edge connects them'
                      : ' — they also have a dependency edge')
                  }
                  cursor="pointer"
                  onClick={() => activate(arc.aNodeId)}
                  onKeyDown={(e) => onKeyDown(e, arc.aNodeId)}
                  onFocus={() => setHoveredArc(i)}
                  onBlur={() => setHoveredArc(null)}
                  onMouseEnter={() => setHoveredArc(i)}
                  onMouseLeave={() => setHoveredArc(null)}
                />
              );
            })}

            {/* Baseline + file ticks */}
            <line
              x1={MARGIN.left}
              y1={baseline}
              x2={dims.width - MARGIN.right}
              y2={baseline}
              stroke="rgba(255,255,255,0.12)"
            />
            {model.files.map((f) => {
              const x = xByPath.get(f.path) ?? 0;
              const isSelected = f.nodeId === selectedNodeId;
              return (
                <g
                  key={f.path}
                  role="button"
                  tabIndex={0}
                  aria-label={`${f.path} — ${f.hiddenCount} hidden couplings`}
                  aria-pressed={isSelected}
                  data-testid={`coupling-file-${f.path}`}
                  cursor="pointer"
                  onClick={() => activate(f.nodeId)}
                  onKeyDown={(e) => onKeyDown(e, f.nodeId)}
                >
                  <circle
                    cx={x}
                    cy={baseline}
                    r={isSelected ? 4 : 2.5}
                    fill={
                      isSelected
                        ? '#d946ef'
                        : f.hiddenCount > 0
                          ? ARC_COLORS.hidden
                          : '#a1a1aa'
                    }
                  />
                  <text
                    x={x}
                    y={baseline + 8}
                    fontSize={9}
                    fontFamily="JetBrains Mono, monospace"
                    fill={isSelected ? '#f5d0fe' : 'rgba(255,255,255,0.55)'}
                    transform={`rotate(60 ${x} ${baseline + 8})`}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {f.label.length > 22 ? `${f.label.slice(0, 20)}…` : f.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="w-72 flex-shrink-0 border-l border-surface-800 bg-surface-900/40 overflow-y-auto hidden lg:block">
          <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500 border-b border-surface-800">
            Hidden couplings
          </h2>
          <p className="px-3 py-2 text-[10px] text-surface-500 leading-relaxed border-b border-surface-800">
            These files change together but nothing in the dependency graph connects
            them, so no import graph, no IDE and no compiler will point you at them.
            Dashed and bright in the diagram.
          </p>
          <ul data-testid="hidden-coupling-list">
            {model.arcs.filter((a) => a.hidden).slice(0, 30).map((arc) => (
              <li key={`${arc.a}|${arc.b}`}>
                <button
                  type="button"
                  onClick={() => activate(arc.aNodeId)}
                  className="w-full text-left px-3 py-2 border-b border-surface-800/60 hover:bg-surface-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sprang-500"
                  aria-label={`Select ${arc.a}, hidden coupling with ${arc.b}`}
                >
                  <span className="block text-[11px] font-mono text-surface-200 truncate">
                    {arc.a.split('/').pop()}
                  </span>
                  <span className="block text-[11px] font-mono text-surface-400 truncate">
                    ↔ {arc.b.split('/').pop()}
                  </span>
                  <span className="block mt-0.5 text-[10px] text-surface-500">
                    degree {arc.degree}
                    {typeof arc.support === 'number' ? ` · ${arc.support} shared commits` : ''}
                  </span>
                </button>
              </li>
            ))}
            {model.hiddenCount === 0 && (
              <li className="px-3 py-3 text-[11px] text-surface-500">
                No hidden couplings — every co-changing pair here is also connected in
                the dependency graph.
              </li>
            )}
          </ul>
        </aside>
      </div>
    </div>
  );
}
