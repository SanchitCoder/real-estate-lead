import type { Metadata, Viewport } from 'next';
import { Fraunces, Instrument_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap', axes: ['opsz'] });
const instrument = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument', display: 'swap' });
const plex = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plexmono', display: 'swap' });

export const metadata: Metadata = { title: 'Lead Command Center', description: 'Every lead, every minute, every rupee: one calm view for the brokerage.' };
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f6f2ea' }, { media: '(prefers-color-scheme: dark)', color: '#12110d' }], width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning className={`${fraunces.variable} ${instrument.variable} ${plex.variable}`}>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-ink">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
