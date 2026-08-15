import type React from 'react';
import { GitBranch } from 'lucide-react';

interface NoBehavioralDataProps {
  /** What the view would have shown, e.g. "hotspot map". */
  what: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Extra line explaining the specific gap, when there is one. */
  detail?: string;
}

/**
 * Shared empty state for the behavioural views.
 *
 * An older graph carries no `metadata.behavioral` at all. That is a normal
 * situation, not an error — say what is missing and exactly how to fix it,
 * rather than rendering an empty panel.
 */
export function NoBehavioralData({ what, icon: Icon = GitBranch, detail }: NoBehavioralDataProps) {
  return (
    <div
      className="flex-1 flex items-center justify-center bg-surface-950 text-surface-500 text-sm"
      role="status"
    >
      <div className="text-center space-y-3 max-w-md px-6">
        <Icon className="w-8 h-8 mx-auto text-surface-700" />
        <p className="text-surface-300">No behavioural data in this graph.</p>
        <p className="text-xs text-surface-500">
          The {what} is built from git history. This graph was generated before that
          pass existed, or the project is not a git repository.
        </p>
        {detail && <p className="text-xs text-surface-500">{detail}</p>}
        <p className="text-xs text-surface-400">
          Run{' '}
          <code className="px-1.5 py-0.5 rounded bg-surface-800 text-sprang-300 font-mono">
            sprang scan
          </code>{' '}
          to populate this.
        </p>
      </div>
    </div>
  );
}
