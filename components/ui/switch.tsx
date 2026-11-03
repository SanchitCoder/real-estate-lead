'use client';
import * as S from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';
export function Switch({ className, ...p }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root className={cn('relative h-7 w-12 shrink-0 rounded-full bg-line-strong transition data-[state=checked]:bg-brand', className)} {...p}>
      <S.Thumb className="block size-5 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
    </S.Root>
  );
}
