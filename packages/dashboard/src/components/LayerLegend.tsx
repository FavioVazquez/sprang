import { useDashboardStore } from '../store';

const LAYER_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  '#f97316', '#a855f7', '#84cc16',
];

export function LayerLegend({ hoveredLayerId, onHover }: {
  hoveredLayerId: string | null;
  onHover: (id: string | null) => void;
}) {
  const { graph } = useDashboardStore();
  if (!graph || graph.layers.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 z-10 bg-surface-950/90 border border-surface-800 rounded-xl px-3 py-2.5 backdrop-blur-sm max-w-[200px]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">Layers</p>
      <div className="space-y-1">
        {graph.layers.map((layer, i) => {
          const color = LAYER_COLORS[i % LAYER_COLORS.length]!;
          const active = hoveredLayerId === layer.id;
          return (
            <button
              key={layer.id}
              type="button"
              onMouseEnter={() => onHover(layer.id)}
              onMouseLeave={() => onHover(null)}
              className={`flex items-center gap-1.5 w-full text-left rounded px-1 py-0.5 transition-colors ${
                active ? 'bg-surface-800' : 'hover:bg-surface-800/50'
              }`}
            >
              <span
                className="shrink-0 w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: color, opacity: active ? 1 : 0.7 }}
              />
              <span className={`text-[11px] truncate ${active ? 'text-surface-100' : 'text-surface-400'}`}>
                {layer.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
