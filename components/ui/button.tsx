import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[background,color,box-shadow,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-ink shadow-sm hover:bg-brand-2',
        secondary: 'bg-surface-2 text-ink hover:bg-line',
        outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
        ghost: 'text-ink-2 hover:bg-surface-2',
        danger: 'bg-bad text-white hover:opacity-90',
        soft: 'bg-brand-soft text-brand hover:opacity-90',
      },
      size: { sm: 'h-9 px-3', md: 'h-11 px-4', lg: 'h-12 px-5 text-base', icon: 'h-11 w-11' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, disabled, ...p }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp ref={ref} className={cn(button({ variant, size }), className)} disabled={disabled || loading} {...p}>
      {asChild ? children : (<>{loading && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}</>)}
    </Comp>
  );
});
Button.displayName = 'Button';
