import type { LeaderboardRow, SourceRoiResponse, SpeedResponse, StaleLead } from '@contracts/realestate-api';
import { SOURCE_LABEL, inr, minutesHuman } from './format';

export interface Digest { date_label: string; wa_leads: string; wa_stale: string; wa_agents: string; wa_cost: string; email_subject: string }

/** Same wording as the "Reports | Build Digest" node, so the System page previews what the owner actually receives. */
export function buildDigest(i: { dateLabel: string; leadsBySource: { source: string; leads: number }[]; stale: StaleLead[]; speed: SpeedResponse; leaderboard: LeaderboardRow[]; roi?: SourceRoiResponse }): Digest {
  const total = i.leadsBySource.reduce((a, s) => a + s.leads, 0);
  const bySource = [...i.leadsBySource].sort((a, b) => b.leads - a.leads);
  const wa_leads = `${total} new lead${total === 1 ? '' : 's'}${bySource.length ? ` (${bySource.map((s) => `${SOURCE_LABEL[s.source] ?? s.source} ${s.leads}`).join(', ')})` : ''}`;
  const wa_stale = `${i.stale.length} stale, ${i.speed.overall.breaches} past the response SLA, median response ${i.speed.overall.median_min == null ? 'n/a' : minutesHuman(i.speed.overall.median_min)}`;
  const ranked = [...i.leaderboard].sort((a, b) => a.rank - b.rank);
  const top = ranked[0];
  const bottom = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const t = (a: LeaderboardRow) => `${a.name} (${a.conversions} won, ${a.visits_booked} visits booked, ${a.follow_ups_done} follow-ups)`;
  const wa_agents = top ? `Top: ${t(top)}${bottom ? `. Lowest: ${t(bottom)}` : ''}` : 'No agent activity yet';
  const paid = (i.roi?.rows ?? []).filter((r) => r.cost_inr > 0);
  const wa_cost = paid.length ? paid.map((p) => `${SOURCE_LABEL[p.source]} ${p.cost_per_site_visit == null ? 'no site visits yet' : `${inr(p.cost_per_site_visit)}/visit`}`).join(', ') : 'No source costs entered this month';
  return { date_label: i.dateLabel, wa_leads, wa_stale, wa_agents, wa_cost, email_subject: `Daily digest: ${wa_leads.split(' (')[0]}, ${i.stale.length} stale` };
}
