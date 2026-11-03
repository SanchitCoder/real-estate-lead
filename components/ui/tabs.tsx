'use client';
import * as T from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '@/lib/utils';
export const Tabs = T.Root;
export const TabsList = ({ className, ...p }: React.ComponentProps<typeof T.List>) => <T.List className={cn('inline-flex rounded-xl bg-surface-2 p-1', className)} {...p} />;
export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof T.Trigger>) => (
  <T.Trigger className={cn('h-9 rounded-lg px-3.5 text-sm font-medium text-muted transition data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm', className)} {...p} />
);
export const TabsContent = T.Content;
