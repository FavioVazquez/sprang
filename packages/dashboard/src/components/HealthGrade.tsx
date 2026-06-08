import React from 'react';
import { motion } from 'framer-motion';

interface HealthGradeProps {
  grade: string;
  score: number;
  breakdown?: {
    dead_code_penalty: number;
    circular_penalty: number;
    god_node_penalty: number;
    coupling_penalty: number;
    security_penalty: number;
  };
  size?: 'sm' | 'md' | 'lg';
}

const GRADE_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  A: { bg: 'bg-green-950', border: 'border-green-700', text: 'text-green-300', glow: 'shadow-green-900' },
  B: { bg: 'bg-lime-950', border: 'border-lime-700', text: 'text-lime-300', glow: 'shadow-lime-900' },
  C: { bg: 'bg-amber-950', border: 'border-amber-700', text: 'text-amber-300', glow: 'shadow-amber-900' },
  D: { bg: 'bg-orange-950', border: 'border-orange-700', text: 'text-orange-300', glow: 'shadow-orange-900' },
  F: { bg: 'bg-red-950', border: 'border-red-800', text: 'text-red-300', glow: 'shadow-red-900' },
};

const SIZE_CLASSES = {
  sm: { outer: 'w-10 h-10', letter: 'text-xl', score: 'text-[10px]' },
  md: { outer: 'w-16 h-16', letter: 'text-3xl', score: 'text-xs' },
  lg: { outer: 'w-24 h-24', letter: 'text-5xl', score: 'text-sm' },
};

export function HealthGrade({ grade, score, breakdown, size = 'md' }: HealthGradeProps) {
  const colors = GRADE_COLORS[grade] ?? GRADE_COLORS['F']!;
  const sizes = SIZE_CLASSES[size];

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={`flex flex-col items-center justify-center rounded-2xl border-2 shadow-lg ${colors.bg} ${colors.border} ${colors.glow} ${sizes.outer}`}
      title={breakdown ? `Penalties: dead code=${breakdown.dead_code_penalty}, circular=${breakdown.circular_penalty}, god nodes=${breakdown.god_node_penalty}, coupling=${breakdown.coupling_penalty}, security=${breakdown.security_penalty}` : undefined}
    >
      <span className={`font-black leading-none ${colors.text} ${sizes.letter}`}>{grade}</span>
      <span className={`font-medium ${colors.text} opacity-70 ${sizes.score} tabular-nums`}>{score}/100</span>
    </motion.div>
  );
}
