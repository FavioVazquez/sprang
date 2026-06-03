import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
    'leading-tight whitespace-nowrap select-none',
  ],
  {
    variants: {
      variant: {
        default: 'bg-surface-800 text-surface-300 border border-surface-700',
        'risk-low': 'bg-green-950 text-green-400 border border-green-900',
        'risk-medium': 'bg-amber-950 text-amber-400 border border-amber-900',
        'risk-high': 'bg-red-950 text-red-400 border border-red-900',
        warning: 'bg-amber-950 text-amber-300 border border-amber-800',
        info: 'bg-blue-950 text-blue-300 border border-blue-800',
        accent: 'bg-sprang-900 text-sprang-300 border border-sprang-800',
        outline: 'bg-transparent text-surface-400 border border-surface-700',
        layer: 'bg-surface-700 text-surface-200 border border-surface-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={twMerge(clsx(badgeVariants({ variant }), className))}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';

export { badgeVariants };
