import React from 'react';
import { Network, Activity, Globe, BookOpen, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export type MobileView = 'graph' | 'health' | 'domain' | 'architecture' | 'learn' | 'treemap' | 'matrix';

const NAV_ITEMS: Array<{ id: MobileView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'domain', label: 'Domains', icon: Globe },
  { id: 'architecture', label: 'Arch', icon: Layers },
  { id: 'learn', label: 'Learn', icon: BookOpen },
];

interface MobileBottomNavProps {
  activeView: MobileView;
  onChange: (view: MobileView) => void;
}

export function MobileBottomNav({ activeView, onChange }: MobileBottomNavProps) {
  return (
    <nav className="flex items-stretch bg-surface-900 border-t border-surface-800 safe-area-pb flex-shrink-0 md:hidden">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = activeView === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
              active ? 'text-sprang-400' : 'text-surface-500 hover:text-surface-300'
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
            {active && (
              <motion.div
                layoutId="mobile-nav-indicator"
                className="absolute top-0 w-8 h-0.5 bg-sprang-400 rounded-full"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

interface MobileLayoutProps {
  activeView: MobileView;
  onViewChange: (view: MobileView) => void;
  children: React.ReactNode;
}

export function MobileLayout({ activeView, onViewChange, children }: MobileLayoutProps) {
  return (
    <div className="h-full flex flex-col md:hidden">
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            className="absolute inset-0"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.15 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
      <MobileBottomNav activeView={activeView} onChange={onViewChange} />
    </div>
  );
}
