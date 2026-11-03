'use client';
import { Activity } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/';
  const [role, setRole] = useState<'owner' | 'agent'>('owner');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mock = process.env.NEXT_PUBLIC_DATA_MODE !== 'live';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, password, phone }) });
    const j = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setError(j?.message ?? 'Could not sign in.'); return; }
    router.replace(next.startsWith('/') ? next : '/');
    router.refresh();
  }
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand text-brand-ink"><Activity className="size-6" /></span>
          <div><h1 className="font-display text-3xl leading-none">Skyline Realty</h1><p className="mt-1 text-sm text-muted">Lead Command Center · Lucknow</p></div>
        </div>
        <form onSubmit={submit} className="space-y-5 rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow)]" noValidate>
          <Tabs value={role} onValueChange={(v) => { setRole(v as 'owner' | 'agent'); setError(''); }}>
            <TabsList className="w-full"><TabsTrigger value="owner" className="flex-1">Owner</TabsTrigger><TabsTrigger value="agent" className="flex-1">Agent</TabsTrigger></TabsList>
          </Tabs>
          {role === 'agent' && <Field label="Your mobile number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="username" placeholder="98111 00001" /></Field>}
          <Field label="Password" error={error}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-invalid={!!error} /></Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
          {mock && (
            <p className="rounded-xl bg-warn-soft p-3 text-[13px] leading-relaxed text-warn">
              <strong>Sample data mode.</strong> Owner password is <code>OWNER_PASSWORD</code> from <code>.env.local</code>. An agent signs in with their mobile (try 98111 00001) and <code>AGENT_LOGIN_SEED</code> followed by the last 4 digits of that mobile.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
export default function Page() { return <Suspense><LoginForm /></Suspense>; }
