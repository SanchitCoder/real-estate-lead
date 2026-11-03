'use client';
import * as T from '@radix-ui/react-tooltip';
import * as React from 'react';
import { cn } from '@/lib/utils';
export const TooltipProvider = T.Provider;
export function Tip({ children, content, side = 'top', className }: { children: React.ReactNode; content: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className={cn('z-[70] max-w-xs rounded-lg bg-ink px-3 py-2 text-[13px] leading-snug text-bg shadow-lg', className)}>
          {content}
          <T.Arrow className="fill-ink" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
