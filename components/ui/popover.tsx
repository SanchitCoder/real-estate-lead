'use client';
import * as P from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, ...p }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={8} align="start" className={cn('z-[60] w-72 rounded-2xl border border-line bg-surface p-4 text-ink shadow-xl', className)} {...p} />
    </P.Portal>
  );
}
