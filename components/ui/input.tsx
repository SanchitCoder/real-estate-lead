import * as React from 'react';
import { cn } from '@/lib/utils';

const field = 'w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/80 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 aria-[invalid=true]:border-bad';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, 'h-11', className)} {...p} />);
Input.displayName = 'Input';
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'min-h-24 py-2.5', className)} {...p} />);
Textarea.displayName = 'Textarea';
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(field, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>{children}</select>
));
Select.displayName = 'Select';
export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-[13px] font-medium text-ink-2', className)} {...p} />;
}
export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  const descId = `${id}-d`;
  let done = false;
  const wire = (n: React.ReactNode): React.ReactNode =>
    React.Children.map(n, (c) => {
      if (done || !React.isValidElement(c)) return c;
      done = true;
      return React.cloneElement(c as React.ReactElement<Record<string, unknown>>, { id, 'aria-describedby': error || hint ? descId : undefined, 'aria-invalid': error ? true : undefined });
    });
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {wire(children)}
      {error ? <p id={descId} role="alert" className="mt-1.5 text-[13px] text-bad">{error}</p> : hint ? <p id={descId} className="mt-1.5 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}
