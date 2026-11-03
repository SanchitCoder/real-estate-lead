import { describe, expect, it } from 'vitest';
import { buildInsights } from './insights';
import { buildDigest } from './digest';

const roiRow = (o: any) => ({ source: 'meta', cost_inr: 0, leads: 10, junk: 0, qualified: 5, visits_booked: 3, site_visits: 2, closures: 0, cost_per_lead: null, cost_per_visit_booked: null, cost_per_site_visit: null, consider_cut: false, advice: '', ...o });

describe('insights', () => {
  it('writes the consider-cutting sentence with the multiple of the best source', () => {
    const roi: any = { month: '2026-10-01', rows: [roiRow({ source: 'magicbricks', cost_inr: 40000, site_visits: 6, cost_per_site_visit: 6400, consider_cut: true }), roiRow({ source: 'website', cost_inr: 8000, site_visits: 3, cost_per_site_visit: 2400 })], best_source: { source: 'website', cost_per_site_visit: 2400 }, history: [], missing_current_month: ['meta'], current_month: '2026-11-01' };
    const out = buildInsights({ role: 'owner', roi, stale: [] });
    expect(out[0].text).toBe('MagicBricks cost ₹6,400 per site visit in Oct 2026: 2.7× Website. Consider cutting.');
    expect(out.some((i) => i.id === 'missing-costs')).toBe(true);
    expect(out.some((i) => i.text.includes('No lead is waiting'))).toBe(true);
  });
  it('agents never see portal economics', () => {
    expect(buildInsights({ role: 'agent', stale: [] }).some((i) => i.id.startsWith('cut'))).toBe(false);
  });
});

describe('digest', () => {
  it('uses the same wording as the Build Digest node', () => {
    const d = buildDigest({ dateLabel: '01 Nov 2026', leadsBySource: [{ source: 'meta', leads: 9 }, { source: '99acres', leads: 4 }], stale: [{}, {}] as any, speed: { overall: { breaches: 3, median_min: 14.6 } } as any, leaderboard: [{ rank: 1, name: 'Rohan', conversions: 3, visits_booked: 9, follow_ups_done: 40 }, { rank: 2, name: 'Neha', conversions: 0, visits_booked: 2, follow_ups_done: 10 }] as any, roi: { rows: [roiRow({ source: 'magicbricks', cost_inr: 40000, cost_per_site_visit: 6667 }), roiRow({ source: '99acres', cost_inr: 45000, cost_per_site_visit: null })] } as any });
    expect(d.wa_leads).toBe('13 new leads (Meta Ads 9, 99acres 4)');
    expect(d.wa_stale).toBe('2 stale, 3 past the response SLA, median response 15 min');
    expect(d.wa_agents).toBe('Top: Rohan (3 won, 9 visits booked, 40 follow-ups). Lowest: Neha (0 won, 2 visits booked, 10 follow-ups)');
    expect(d.wa_cost).toBe('MagicBricks ₹6,667/visit, 99acres no site visits yet');
  });
});
