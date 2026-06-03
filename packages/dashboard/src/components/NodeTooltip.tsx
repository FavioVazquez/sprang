import { motion, AnimatePresence } from 'framer-motion';
import { useDashboardStore } from '../store';

interface NodeTooltipProps {
  nodeId: string | null;
  x: number;
  y: number;
}

const RISK_COLORS: Record<string, string> = {
  high: 'text-risk-high',
  medium: 'text-risk-medium',
  low: 'text-risk-low',
};

export function NodeTooltip({ nodeId, x, y }: NodeTooltipProps) {
  const { nodesById } = useDashboardStore();
  const node = nodeId ? nodesById.get(nodeId) : null;

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key={node.id}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          className="fixed z-50 pointer-events-none"
          style={{ left: x + 12, top: y - 8 }}
        >
          <div className="bg-surface-900 border border-surface-700 rounded-lg shadow-xl px-3 py-2 max-w-[240px]">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] text-surface-500 font-mono">{node.type}</span>
              {node.risk_score !== undefined && (
                <span className={`text-[10px] font-semibold ml-auto ${
                  node.risk_score >= 0.7 ? RISK_COLORS.high :
                  node.risk_score >= 0.4 ? RISK_COLORS.medium : RISK_COLORS.low
                }`}>
                  {Math.round(node.risk_score * 100)}%
                </span>
              )}
            </div>
            <p className="text-xs font-semibold text-surface-100 leading-snug">{node.label}</p>
            {node.summary && (
              <p className="text-[11px] text-surface-400 mt-1 leading-relaxed line-clamp-2">{node.summary}</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
