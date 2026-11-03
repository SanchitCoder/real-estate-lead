import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const badge = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-surface-2 text-ink-2',
      brand: 'bg-brand-soft text-brand',
      good: 'bg-good-soft text-good',
      warn: 'bg-warn-soft text-warn',
      bad: 'bg-bad-soft text-bad',
      outline: 'border border-line-strong text-ink-2',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
