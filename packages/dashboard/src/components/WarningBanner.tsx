import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface WarningBannerProps {
  errors: string[];
}

export function WarningBanner({ errors }: WarningBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || errors.length === 0) return null;

  return (
    <div className="bg-amber-950/80 border-b border-amber-800/60 px-4 py-2 flex items-start gap-2.5 shrink-0">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-300 leading-snug">
          Schema warnings ({errors.length})
        </p>
        <ul className="mt-0.5 space-y-0.5">
          {errors.slice(0, 3).map((err, i) => (
            <li key={i} className="text-[11px] text-amber-400/80 truncate">{err}</li>
          ))}
          {errors.length > 3 && (
            <li className="text-[11px] text-amber-500">+{errors.length - 3} more</li>
          )}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 p-0.5 rounded text-amber-500 hover:text-amber-300 transition-colors"
        title="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
