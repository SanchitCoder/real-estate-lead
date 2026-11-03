'use client';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, side }: { className?: string; children: React.ReactNode; title: string; description?: string; side?: 'right' | 'center' }) {
  const sheet = side === 'right';
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <D.Content
        aria-describedby={description ? undefined : undefined}
        className={cn(
          'fixed z-50 flex flex-col bg-surface text-ink shadow-2xl focus-visible:outline-none',
          sheet
            ? 'inset-y-0 right-0 w-full max-w-[560px] border-l border-line'
            : 'left-1/2 top-1/2 max-h-[92dvh] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <D.Title className="font-display text-xl leading-tight">{title}</D.Title>
            {description && <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description>}
          </div>
          <D.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 -mt-1 size-10 shrink-0"><X className="size-5" /></Button>
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
export const DialogBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('scroll-thin flex-1 overflow-y-auto px-5 py-4', className)} {...p} />;
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end', className)} {...p} />;

/** Confirmation before anything that changes backend state. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', tone = 'primary', loading, onConfirm, children,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel?: string; tone?: 'primary' | 'danger'; loading?: boolean; onConfirm: () => void; children?: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {children && <DialogBody>{children}</DialogBody>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
