import React from 'react';
import { Tooltip } from './ui/Tooltip';
import { Badge } from './ui/Badge';
import type { StructuralWarning, SmellCategory } from '../types';

interface SmellBadgeProps {
  warning: StructuralWarning;
  compact?: boolean;
}

const SMELL_LABELS: Record<SmellCategory, string> = {
  god_node: 'God Node',
  circular_dependency: 'Circular Dep',
  unstable_interface: 'Unstable Interface',
  unclear_coupling: 'Unclear Coupling',
  over_connected: 'Over-connected',
  duplicate_logic: 'Duplicate Logic',
  orphan_node: 'Orphan',
  low_cohesion: 'Low Cohesion',
};

const SMELL_VARIANT: Record<SmellCategory, 'risk-high' | 'risk-medium' | 'info'> = {
  god_node: 'risk-high',
  circular_dependency: 'risk-high',
  unstable_interface: 'risk-high',
  unclear_coupling: 'risk-medium',
  over_connected: 'risk-medium',
  duplicate_logic: 'risk-medium',
  orphan_node: 'info',
  low_cohesion: 'info',
};

export function SmellBadge({ warning, compact = false }: SmellBadgeProps) {
  const label = SMELL_LABELS[warning.category] ?? warning.category;
  const variant = SMELL_VARIANT[warning.category] ?? 'info';

  const tooltipContent = (
    <div className="space-y-1.5">
      <p className="font-semibold text-surface-100">{label}</p>
      <p className="text-surface-300 text-xs leading-relaxed">{warning.description}</p>
      <p className="text-surface-400 text-xs font-mono bg-surface-900 px-1.5 py-0.5 rounded">
        {warning.heuristic}
      </p>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} side="top">
      <Badge variant={variant} className="cursor-default">
        {!compact && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor:
                variant === 'risk-high'
                  ? '#ef4444'
                  : variant === 'risk-medium'
                  ? '#f59e0b'
                  : '#3b82f6',
            }}
          />
        )}
        {label}
      </Badge>
    </Tooltip>
  );
}
