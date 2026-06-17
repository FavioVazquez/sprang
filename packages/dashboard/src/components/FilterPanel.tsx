import { X, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDashboardStore } from '../store';
import type { NodeCategory, EdgeCategory, Complexity } from '../types';

// ─── Category labels ──────────────────────────────────────────────────────────

const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  code: 'Code',
  config: 'Config',
  docs: 'Docs',
  infra: 'Infrastructure',
  data: 'Data',
  domain: 'Domain',
  knowledge: 'Knowledge',
};

const NODE_CATEGORY_COLORS: Record<NodeCategory, string> = {
  code: '#d946ef',
  config: '#d97706',
  docs: '#64748b',
  infra: '#3b82f6',
  data: '#f97316',
  domain: '#22c55e',
  knowledge: '#f59e0b',
};

const EDGE_CATEGORY_LABELS: Record<EdgeCategory, string> = {
  structural: 'Structural',
  behavioral: 'Behavioral',
  'data-flow': 'Data Flow',
  dependencies: 'Dependencies',
  semantic: 'Semantic',
  infrastructure: 'Infrastructure',
  domain: 'Domain',
  knowledge: 'Knowledge',
};

const COMPLEXITY_LABELS: Record<Complexity, string> = {
  simple: 'Simple',
  moderate: 'Moderate',
  complex: 'Complex',
};

const COMPLEXITY_COLORS: Record<Complexity, string> = {
  simple: '#22c55e',
  moderate: '#f97316',
  complex: '#ef4444',
};

// ─── Toggle chip ─────────────────────────────────────────────────────────────

function Chip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium border transition-all ${
        active
          ? 'border-transparent text-surface-100'
          : 'border-surface-700 text-surface-500 hover:text-surface-300 hover:border-surface-600 bg-transparent'
      }`}
      style={active && color ? { backgroundColor: color + '30', borderColor: color + '60', color } : undefined}
    >
      {color && (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: active ? color : '#71717a' }}
        />
      )}
      {label}
    </button>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">{title}</h4>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function FilterPanel() {
  const {
    filterPanelOpen,
    toggleFilterPanel,
    filters,
    setFilters,
    nodeTypeFilters,
    toggleNodeTypeFilter,
    resetFilters,
    hasActiveFilters,
  } = useDashboardStore();

  const activeFilters = hasActiveFilters();

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={toggleFilterPanel}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
          activeFilters || filterPanelOpen
            ? 'bg-sprang-500/10 border-sprang-500/40 text-sprang-300'
            : 'bg-transparent border-surface-700 text-surface-500 hover:text-surface-300 hover:border-surface-600'
        }`}
        title="Filter graph nodes and edges"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        Filters
        {activeFilters && (
          <span className="w-1.5 h-1.5 rounded-full bg-sprang-400" />
        )}
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {filterPanelOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full mt-2 right-0 z-50 w-80 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
              <span className="text-xs font-semibold text-surface-200">Filter Graph</span>
              <div className="flex items-center gap-2">
                {activeFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-sprang-300 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleFilterPanel}
                  className="p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter sections */}
            <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* Node categories */}
              <FilterSection title="Node Types">
                {(Object.keys(NODE_CATEGORY_LABELS) as NodeCategory[]).map((cat) => (
                  <Chip
                    key={cat}
                    label={NODE_CATEGORY_LABELS[cat]}
                    active={nodeTypeFilters[cat]}
                    color={NODE_CATEGORY_COLORS[cat]}
                    onClick={() => toggleNodeTypeFilter(cat)}
                  />
                ))}
              </FilterSection>

              {/* Complexity */}
              <FilterSection title="Complexity">
                {(['simple', 'moderate', 'complex'] as Complexity[]).map((c) => (
                  <Chip
                    key={c}
                    label={COMPLEXITY_LABELS[c]}
                    active={filters.complexities.has(c)}
                    color={COMPLEXITY_COLORS[c]}
                    onClick={() => {
                      const next = new Set(filters.complexities);
                      if (next.has(c)) next.delete(c);
                      else next.add(c);
                      setFilters({ complexities: next });
                    }}
                  />
                ))}
              </FilterSection>

              {/* Risk levels */}
              <FilterSection title="Risk Level">
                {(['high', 'medium', 'low'] as const).map((r) => (
                  <Chip
                    key={r}
                    label={r.charAt(0).toUpperCase() + r.slice(1)}
                    active={filters.riskLevels.has(r)}
                    color={r === 'high' ? '#ef4444' : r === 'medium' ? '#f97316' : '#22c55e'}
                    onClick={() => {
                      const next = new Set(filters.riskLevels);
                      if (next.has(r)) next.delete(r);
                      else next.add(r);
                      setFilters({ riskLevels: next });
                    }}
                  />
                ))}
              </FilterSection>

              {/* Edge categories */}
              <FilterSection title="Edge Types">
                {(Object.keys(EDGE_CATEGORY_LABELS) as EdgeCategory[]).map((cat) => (
                  <Chip
                    key={cat}
                    label={EDGE_CATEGORY_LABELS[cat]}
                    active={filters.edgeCategories.has(cat)}
                    onClick={() => {
                      const next = new Set(filters.edgeCategories);
                      if (next.has(cat)) next.delete(cat);
                      else next.add(cat);
                      setFilters({ edgeCategories: next });
                    }}
                  />
                ))}
              </FilterSection>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
