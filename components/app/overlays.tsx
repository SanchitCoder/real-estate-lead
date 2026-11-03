'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AddLeadDialog } from './add-lead';
import { LeadDrawer, ReassignDialog, type ReassignTarget } from './lead-drawer';
import { CommandPalette } from './palette';

interface Ctx {
  openLead: (id: number) => void;
  openAddLead: () => void;
  openPalette: () => void;
  openReassign: (t: ReassignTarget) => void;
}
const C = createContext<Ctx | null>(null);
export const useOverlays = () => {
  const c = useContext(C);
  if (!c) throw new Error('useOverlays outside provider');
  return c;
};

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [leadId, setLeadId] = useState<number | null>(null);
  const [add, setAdd] = useState(false);
  const [palette, setPalette] = useState(false);
  const [reassign, setReassign] = useState<ReassignTarget | null>(null);
  const openLead = useCallback((id: number) => setLeadId(id), []);
  const value = useMemo(() => ({ openLead, openAddLead: () => setAdd(true), openPalette: () => setPalette(true), openReassign: (t: ReassignTarget) => setReassign(t) }), [openLead]);
  return (
    <C.Provider value={value}>
      {children}
      <LeadDrawer leadId={leadId} onClose={() => setLeadId(null)} />
      <AddLeadDialog open={add} onOpenChange={setAdd} onCreated={(id) => setLeadId(id)} />
      <ReassignDialog target={reassign} onClose={() => setReassign(null)} />
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </C.Provider>
  );
}
