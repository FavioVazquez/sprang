import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame } from 'lucide-react';
import { Button } from './ui/Button';
import type { GraphStats } from '../types';

interface RiskOverlayProps {
  enabled: boolean;
  onToggle: () => void;
  stats: GraphStats;
}

const DOT_COLORS = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

export function RiskOverlay({ enabled, onToggle, stats }: RiskOverlayProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant={enabled ? 'default' : 'outline'}
        size="sm"
        onClick={onToggle}
        className={
          enabled
            ? 'bg-risk-high hover:bg-red-600 shadow-sm shadow-red-900/40 border-0'
            : ''
        }
        aria-pressed={enabled}
        aria-label="Toggle risk heatmap"
      >
        <Flame className="w-3.5 h-3.5" />
        Risk Heatmap
      </Button>

      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, x: -8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-surface-800 border border-surface-700"
          >
            {(
              [
                { key: 'low' as const, label: 'Low', range: '< 0.4' },
                { key: 'medium' as const, label: 'Medium', range: '0.4–0.7' },
                { key: 'high' as const, label: 'High', range: '> 0.7' },
              ] as const
            ).map(({ key, label, range }) => (
              <div key={key} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: DOT_COLORS[key] }}
                />
                <span className="text-xs text-surface-300 leading-none">
                  {label}
                </span>
                <span className="text-[10px] text-surface-500 leading-none">
                  {range}
                </span>
                <span className="text-[10px] font-bold text-surface-400 leading-none ml-0.5">
                  ({stats.risk_summary[key]})
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
