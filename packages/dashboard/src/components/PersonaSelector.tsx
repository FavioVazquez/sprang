import { useDashboardStore } from '../store';
import type { Persona } from '../types';

const PERSONAS: { id: Persona; label: string; description: string }[] = [
  {
    id: 'non-technical',
    label: 'Business',
    description: 'Entry-points and domains only — for executives and business stakeholders who want the big picture without code details',
  },
  {
    id: 'pm',
    label: 'Product',
    description: 'Domain and service nodes — for product managers focused on business processes and feature areas',
  },
  {
    id: 'junior',
    label: 'Learn',
    description: 'All steps with language lessons — ideal for developers who are new to this codebase',
  },
  {
    id: 'senior',
    label: 'Deep Dive',
    description: 'Technical details, trade-offs, and architectural decisions — skips intro steps for experienced engineers',
  },
];

export function PersonaSelector() {
  const { persona, setPersona } = useDashboardStore();

  return (
    <div className="flex items-center gap-0.5 bg-surface-800 rounded-lg p-0.5 border border-surface-700">
      {PERSONAS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setPersona(p.id)}
          title={p.description}
          className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
            persona === p.id
              ? 'bg-sprang-500/20 text-sprang-300 shadow-sm'
              : 'text-surface-500 hover:text-surface-300 hover:bg-surface-700/60'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
