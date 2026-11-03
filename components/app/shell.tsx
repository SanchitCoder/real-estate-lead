'use client';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, Building2, CircleDollarSign, Funnel, Gauge, LayoutDashboard, LogOut, Menu, Moon, Plus, Search, Settings2, Sun, Trophy, UserCog, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog';
import { useSession } from '@/lib/client/session';
import { cn } from '@/lib/utils';
import { OverlayProvider, useOverlays } from './overlays';

const NAV = [
  { href: '/', label: 'Command Center', short: 'Home', icon: LayoutDashboard, roles: ['owner', 'agent'], mobile: true },
  { href: '/leads', label: 'Lead Feed', short: 'Leads', icon: Users, roles: ['owner', 'agent'], mobile: true },
  { href: '/speed', label: 'Speed to Lead', short: 'Speed', icon: Gauge, roles: ['owner', 'agent'], mobile: false },
  { href: '/funnel', label: 'Funnel', short: 'Funnel', icon: Funnel, roles: ['owner', 'agent'], mobile: true },
  { href: '/roi', label: 'Source ROI', short: 'ROI', icon: CircleDollarSign, roles: ['owner'], mobile: true },
  { href: '/leaderboard', label: 'Leaderboard', short: 'Ranks', icon: Trophy, roles: ['owner', 'agent'], mobile: false },
  { href: '/inventory', label: 'Inventory Matcher', short: 'Listings', icon: Building2, roles: ['owner', 'agent'], mobile: false },
  { href: '/agents', label: 'Agents', short: 'Agents', icon: UserCog, roles: ['owner'], mobile: false },
  { href: '/system', label: 'System', short: 'System', icon: Settings2, roles: ['owner'], mobile: false },
] as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
      {m && resolvedTheme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}

export function ModeBadge({ className }: { className?: string }) {
  const { data } = useSession();
  const mode = data?.mode ?? (process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'live' : 'mock');
  return mode === 'mock'
    ? <Badge tone="warn" className={cn('border border-warn/30', className)} title="Showing realistic sample data. Nothing here touches your real leads.">◐ Sample data</Badge>
    : <Badge tone="good" className={className}>● Live data</Badge>;
}

function Inner({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useSession();
  const { openPalette, openAddLead } = useOverlays();
  const [more, setMore] = useState(false);
  const role = me?.role ?? 'owner';
  const items = NAV.filter((n) => (n.roles as readonly string[]).includes(role));
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [openPalette]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    qc.clear();
    router.replace('/login');
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-[color-mix(in_oklab,var(--surface)_70%,transparent)] px-4 py-5 backdrop-blur lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink"><Activity className="size-5" /></span>
          <span className="leading-tight"><span className="font-display block text-[18px]">Skyline Realty</span><span className="text-xs text-muted">Lead Command Center</span></span>
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {items.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={cn('relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition', active(n.href) ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2')}>
              {active(n.href) && <motion.span layoutId="nav-pill" className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand" />}
              <n.icon className="size-[18px]" aria-hidden /> {role === 'agent' && n.href === '/leads' ? 'My Leads' : n.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line pt-4">
          <div className="px-2 text-sm"><p className="font-medium">{me?.name ?? '…'}</p>{me?.name?.toLowerCase() !== role && <p className="text-xs capitalize text-muted">{role}</p>}</div>
          <Button variant="ghost" className="w-full justify-start" onClick={logout}><LogOut className="size-4" /> Sign out</Button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] px-3 backdrop-blur sm:px-6">
          <Link href="/" className="mr-1 grid size-10 place-items-center rounded-xl bg-brand text-brand-ink lg:hidden" aria-label="Home"><Activity className="size-5" /></Link>
          <button onClick={openPalette} className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-left text-sm text-muted hover:border-line-strong sm:max-w-md" aria-label="Search leads, listings and agents">
            <Search className="size-4 shrink-0" /> <span className="truncate">Search leads, listings, agents</span>
            <kbd className="ml-auto hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] sm:block">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <ModeBadge className="hidden sm:inline-flex" />
            <Button onClick={openAddLead} size="md" className="hidden sm:inline-flex"><Plus className="size-4" /> Add lead</Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu" onClick={() => setMore(true)}><Menu className="size-5" /></Button>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
          <ModeBadge className="mb-4 sm:hidden" />
          {children}
        </main>
      </div>

      {/* mobile: floating add + bottom bar */}
      <Button onClick={openAddLead} size="icon" aria-label="Add lead" className="fixed bottom-[88px] right-4 z-40 size-14 rounded-full shadow-xl sm:hidden"><Plus className="size-6" /></Button>
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] backdrop-blur lg:hidden">
        {items.filter((n) => n.mobile).slice(0, 4).map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={cn('flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active(n.href) ? 'text-brand' : 'text-muted')}>
            <n.icon className="size-5" aria-hidden />{role === 'agent' && n.href === '/leads' ? 'My leads' : n.short}
          </Link>
        ))}
        <button onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted"><Menu className="size-5" aria-hidden />More</button>
      </nav>
      <Dialog open={more} onOpenChange={setMore}>
        <DialogContent title="Menu" side="right">
          <DialogBody className="space-y-1">
            {items.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMore(false)} className={cn('flex h-12 items-center gap-3 rounded-xl px-3 text-base', active(n.href) ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2')}><n.icon className="size-5" />{n.label}</Link>
            ))}
            <Button variant="outline" className="mt-4 w-full" onClick={logout}><LogOut className="size-4" /> Sign out</Button>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return <OverlayProvider><Inner>{children}</Inner></OverlayProvider>;
}
