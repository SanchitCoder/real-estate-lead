'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { MotionConfig } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={qc}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        </MotionConfig>
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ classNames: { toast: 'font-sans' } }} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
