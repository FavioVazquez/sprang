import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  X,
  MapPin,
  BookOpen,
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import type { Tour, KnowledgeGraph } from '../types';

interface TourPlayerProps {
  tour: Tour;
  currentStep: number;
  onStepChange: (step: number) => void;
  onClose: () => void;
  graph: KnowledgeGraph;
}

export function TourPlayer({
  tour,
  currentStep,
  onStepChange,
  onClose,
  graph,
}: TourPlayerProps) {
  const step = tour.steps[currentStep];
  const totalSteps = tour.steps.length;
  const node = step ? graph.nodes.find((n) => n.id === step.node_id) : undefined;
  const progressPercent = ((currentStep + 1) / totalSteps) * 100;

  if (!step) return null;

  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none"
    >
      <div className="mx-auto max-w-3xl mb-4 px-4 pointer-events-auto">
        <div className="bg-surface-900/95 backdrop-blur-sm border border-surface-700 rounded-xl shadow-2xl shadow-black/60 overflow-hidden">
          {/* Progress bar */}
          <div className="h-0.5 bg-surface-800">
            <motion.div
              className="h-full bg-sprang-500"
              animate={{ width: `${progressPercent}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 30 }}
            />
          </div>

          <div className="px-5 py-4">
            {/* Tour header */}
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-3.5 h-3.5 text-sprang-400 flex-shrink-0" />
              <span className="text-xs font-medium text-sprang-400 truncate flex-1">
                {tour.title}
              </span>
              <span className="text-xs text-surface-500 flex-shrink-0 tabular-nums">
                Step {currentStep + 1} of {totalSteps}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close tour"
                className="flex-shrink-0 -mr-1"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Step content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-2"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-surface-50 leading-snug">
                      {step.step_title}
                    </h3>
                    <p className="text-xs text-surface-400 leading-relaxed mt-1">
                      {step.explanation}
                    </p>
                  </div>

                  {node && (
                    <div className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-700">
                      <MapPin className="w-3 h-3 text-sprang-400 flex-shrink-0" />
                      <span className="text-xs text-surface-200 font-medium max-w-[160px] truncate">
                        {node.label}
                      </span>
                      <Badge variant="accent" className="text-[10px]">
                        {node.type}
                      </Badge>
                    </div>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onStepChange(currentStep - 1)}
                disabled={currentStep === 0}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </Button>

              {/* Step dots */}
              <div className="flex-1 flex items-center justify-center gap-1">
                {tour.steps.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => onStepChange(idx)}
                    aria-label={`Go to step ${idx + 1}`}
                    className={`rounded-full transition-[width,background-color] duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sprang-500 ${
                      idx === currentStep
                        ? 'w-4 h-1.5 bg-sprang-500'
                        : 'w-1.5 h-1.5 bg-surface-700 hover:bg-surface-500'
                    }`}
                  />
                ))}
              </div>

              <Button
                variant={currentStep === totalSteps - 1 ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (currentStep < totalSteps - 1) {
                    onStepChange(currentStep + 1);
                  } else {
                    onClose();
                  }
                }}
              >
                {currentStep === totalSteps - 1 ? 'Finish' : 'Next'}
                {currentStep < totalSteps - 1 && (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
