import * as React from 'react';
import { cn } from '@/lib/utils';
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow)]', className)} {...p} />;
}
export function CardHeader({ title, caption, action, className }: { title: React.ReactNode; caption?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[19px] leading-tight text-ink">{title}</h2>
        {caption && <p className="mt-1 text-[13px] leading-snug text-muted">{caption}</p>}
      </div>
      {action}
    </div>
  );
}
