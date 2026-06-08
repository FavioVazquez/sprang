import { useEffect } from 'react';
import { motion, useSpring, useTransform, useReducedMotion } from 'framer-motion';

interface AnimatedCountProps {
  value: number;
  decimals?: number;
  className?: string;
}

export function AnimatedCount({ value, decimals = 0, className }: AnimatedCountProps) {
  const shouldReduce = useReducedMotion();
  const spring = useSpring(shouldReduce ? value : 0, { stiffness: 60, damping: 20 });
  const display = useTransform(spring, (v) => v.toFixed(decimals));

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span className={className}>{display}</motion.span>;
}
