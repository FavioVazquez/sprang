import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SHORTCUTS = [
  { keys: ['Cmd/Ctrl', 'K'], action: 'Open node search' },
  { keys: ['Esc'], action: 'Close panel / search' },
  { keys: ['G', '1'], action: 'Graph view' },
  { keys: ['H', '2'], action: 'Health view' },
  { keys: ['D', '3'], action: 'Domains view' },
  { keys: ['L', '4'], action: 'Learn view' },
  { keys: ['R'], action: 'Toggle risk overlay' },
  { keys: ['?'], action: 'This help dialog' },
];

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsHelp({ open, onClose }: KeyboardShortcutsHelpProps) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl p-6 w-80"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <Keyboard className="w-4 h-4 text-sprang-400" />
              <h2 className="text-sm font-semibold text-surface-100">Keyboard Shortcuts</h2>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {SHORTCUTS.map(({ keys, action }) => (
                <div key={action} className="flex items-center justify-between">
                  <span className="text-xs text-surface-400">{action}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-surface-800 border border-surface-700 text-surface-300 font-mono"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
