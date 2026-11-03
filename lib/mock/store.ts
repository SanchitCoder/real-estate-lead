import { buildSeed, type Seed } from './seed';
import type { Cfg, Dataset } from '../metrics';

export interface Store extends Dataset {
  cfg: Cfg;
  configRows: Seed['configRows'];
  next: { lead: number; event: number; listing: number; match: number; cost: number; agent: number; error: number };
  startedAt: string;
}

declare global {
  var __reStore: Store | undefined;
}

export function createStore(anchor = new Date()): Store {
  const s = buildSeed(anchor);
  const max = (xs: { id: number }[]) => xs.reduce((m, x) => Math.max(m, x.id), 0);
  return {
    agents: s.agents, leads: s.leads, events: s.events, listings: s.listings, matches: s.matches, costs: s.costs, errors: s.errors,
    cfg: s.cfg, configRows: s.configRows,
    next: { lead: max(s.leads) + 1, event: max(s.events) + 1, listing: max(s.listings) + 1, match: max(s.matches) + 1, cost: max(s.costs) + 1, agent: max(s.agents) + 1, error: max(s.errors) + 1 },
    startedAt: new Date().toISOString(),
  };
}
export function getStore(): Store {
  if (!globalThis.__reStore) globalThis.__reStore = createStore();
  return globalThis.__reStore;
}
export function resetStore(): Store {
  globalThis.__reStore = createStore();
  return globalThis.__reStore;
}
