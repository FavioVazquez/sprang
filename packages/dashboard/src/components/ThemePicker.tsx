import { useEffect, useState } from 'react';
import { Sun, Moon, Contrast } from 'lucide-react';

export type Theme = 'dark' | 'light' | 'high-contrast';

const STORAGE_KEY = 'sprang:theme';

const THEMES: Array<{ id: Theme; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'high-contrast', label: 'High contrast', icon: Contrast },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  if (theme !== 'dark') root.setAttribute('data-theme', theme);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  return [theme, setThemeState];
}

interface ThemePickerProps {
  theme: Theme;
  onChange: (t: Theme) => void;
}

export function ThemePicker({ theme, onChange }: ThemePickerProps) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-800 border border-surface-700">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          onClick={() => onChange(id)}
          className={`p-1.5 rounded transition-colors ${
            theme === id
              ? 'bg-surface-600 text-surface-100'
              : 'text-surface-500 hover:text-surface-300 hover:bg-surface-700/50'
          }`}
        >
          <Icon className="w-3 h-3" />
        </button>
      ))}
    </div>
  );
}
