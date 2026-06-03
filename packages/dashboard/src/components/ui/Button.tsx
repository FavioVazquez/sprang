import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium',
    'transition-colors duration-150 select-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprang-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950',
    'disabled:pointer-events-none disabled:opacity-40',
    'active:scale-[0.97]',
  ],
  {
    variants: {
      variant: {
        default: [
          'bg-sprang-500 text-surface-50',
          'hover:bg-sprang-600 shadow-sm shadow-sprang-900/50',
        ],
        outline: [
          'border border-surface-700 text-surface-300 bg-transparent',
          'hover:bg-surface-800 hover:text-surface-50 hover:border-surface-600',
        ],
        ghost: [
          'text-surface-400 bg-transparent',
          'hover:bg-surface-800 hover:text-surface-50',
        ],
        danger: [
          'bg-risk-high text-surface-50',
          'hover:bg-red-600 shadow-sm shadow-red-900/50',
        ],
        subtle: [
          'bg-surface-800 text-surface-300',
          'hover:bg-surface-700 hover:text-surface-50',
        ],
      },
      size: {
        xs: 'h-6 px-2 text-xs rounded',
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={twMerge(clsx(buttonVariants({ variant, size }), className))}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { buttonVariants };
