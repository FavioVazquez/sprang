import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Search, Activity, BookOpen, Map, ArrowRight, X } from 'lucide-react';

const STORAGE_KEY = 'sprang:onboarded';

const STEPS = [
  {
    icon: Search,
    title: 'Search any node',
    description: 'Press Cmd+K to search files, functions, classes by name or semantic content.',
  },
  {
    icon: Activity,
    title: 'Check health',
    description: 'The Health view shows risk distribution, code smells, and orphan nodes at a glance.',
  },
  {
    icon: Map,
    title: 'Explore domains',
    description: 'Domains view maps code to business processes. See which files own each flow.',
  },
  {
    icon: BookOpen,
    title: 'Take the tour',
    description: 'The Learn tab walks you through the codebase step by step — adapted to your persona.',
  },
];

interface OnboardingOverlayProps {
  onDone: () => void;
}

export function OnboardingOverlay({ onDone }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0);

  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    onDone();
  };

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step]!;
  const Icon = current.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl p-8 w-96 relative"
      >
        <button
          type="button"
          onClick={finish}
          className="absolute top-4 right-4 p-1 rounded text-surface-600 hover:text-surface-300 transition-colors"
          title="Skip"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-xl bg-sprang-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-sprang-400" />
          </div>
          <span className="text-sm font-bold text-surface-300 tracking-tight">sprang</span>
          <span className="ml-auto text-xs text-surface-600">{step + 1} / {STEPS.length}</span>
        </div>

        {/* Step icon */}
        <div className="w-12 h-12 rounded-2xl bg-surface-800 flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-sprang-400" />
        </div>

        <h2 className="text-base font-bold text-surface-100 mb-2">{current.title}</h2>
        <p className="text-sm text-surface-400 leading-relaxed mb-6">{current.description}</p>

        {/* Step dots */}
        <div className="flex items-center gap-1.5 mb-5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === step ? 'w-4 bg-sprang-400' : 'w-1.5 bg-surface-700'
              }`}
            />
          ))}
        </div>

        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 py-2 rounded-lg text-sm text-surface-400 hover:text-surface-200 border border-surface-700 hover:border-surface-600 transition-colors"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={isLast ? finish : () => setStep((s) => s + 1)}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-sprang-500/20 text-sprang-300 hover:bg-sprang-500/30 border border-sprang-500/40 transition-colors flex items-center justify-center gap-1.5"
          >
            {isLast ? 'Get started' : 'Next'}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function useOnboarding() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch { /* ignore */ }
  }, []);
  return [show, () => setShow(false)] as const;
}
