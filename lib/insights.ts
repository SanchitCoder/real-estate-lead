import type { LeaderboardRow, OverviewResponse, SourceRoiResponse, SpeedResponse, StaleLead } from '@contracts/realestate-api';
import { SOURCE_LABEL, inr, minutesHuman, monthLabel } from './format';
import { median } from './metrics';

export interface Insight { id: string; tone: 'bad' | 'warn' | 'good' | 'info'; text: string; href?: string }

/** Plain-language sentences for the Command Center strip. Pure: all numbers come from the API data. */
export function buildInsights(o: {
  overview?: OverviewResponse; roi?: SourceRoiResponse; stale?: StaleLead[]; speed?: SpeedResponse; leaderboard?: LeaderboardRow[]; role: 'owner' | 'agent'; slaMin?: number;
}): Insight[] {
  const out: Insight[] = [];
  const sla = o.slaMin ?? 120;

  if (o.role === 'owner' && o.roi) {
    const cut = o.roi.rows.filter((r) => r.consider_cut);
    const best = o.roi.best_source;
    for (const r of cut) {
      if (r.site_visits === 0) {
        out.push({ id: `cut-${r.source}`, tone: 'bad', href: '/roi', text: `${SOURCE_LABEL[r.source]} cost ${inr(r.cost_inr)} in ${monthLabel(o.roi.month)} and produced no site visits. Consider cutting.` });
      } else if (best && r.cost_per_site_visit != null) {
        const x = Math.round((r.cost_per_site_visit / best.cost_per_site_visit) * 10) / 10;
        out.push({ id: `cut-${r.source}`, tone: 'bad', href: '/roi', text: `${SOURCE_LABEL[r.source]} cost ${inr(r.cost_per_site_visit)} per site visit in ${monthLabel(o.roi.month)}: ${x}× ${SOURCE_LABEL[best.source]}. Consider cutting.` });
      }
    }
    if (best && !cut.length) out.push({ id: 'best', tone: 'good', href: '/roi', text: `${SOURCE_LABEL[best.source]} is your cheapest paid source at ${inr(best.cost_per_site_visit)} per site visit.` });
    if (o.roi.missing_current_month.length) out.push({ id: 'missing-costs', tone: 'warn', href: '/roi', text: `This month's cost for ${o.roi.missing_current_month.map((s) => SOURCE_LABEL[s]).join(', ')} is not entered yet, so spend and cost-per-visit are incomplete.` });
  }

  if (o.stale) {
    const n = o.stale.length;
    const esc = o.stale.filter((s) => s.level === 'owner_escalated' || s.level === 'auto_reassigned').length;
    if (n) out.push({ id: 'stale', tone: 'bad', text: `${n} lead${n === 1 ? '' : 's'} ${n === 1 ? 'needs' : 'need'} attention now${esc ? `, ${esc} already past the owner-escalation point` : ''}.` });
    else out.push({ id: 'stale', tone: 'good', text: 'No lead is waiting too long. Everyone is on top of their leads.' });
  }

  if (o.role === 'owner' && o.speed) {
    const agents = o.speed.by_agent.filter((a) => a.agent_id != null && a.responded >= 10 && a.avg_min != null);
    const med = median(agents.map((a) => a.avg_min!));
    const slow = [...agents].sort((a, b) => b.avg_min! - a.avg_min!)[0];
    if (slow && med != null && slow.avg_min! >= Math.max(2 * med, 45)) {
      out.push({ id: 'slow-agent', tone: 'warn', href: '/speed', text: `${slow.agent_name} takes about ${minutesHuman(slow.avg_min)} to respond, versus a typical ${minutesHuman(med)}. ${slow.breaches} of their leads missed the ${minutesHuman(sla)} target.` });
    }
  }
  if (o.role === 'agent' && o.leaderboard?.[0]) {
    const me = o.leaderboard[0];
    out.push({ id: 'me', tone: 'info', href: '/leaderboard', text: `You are ranked #${me.rank} this period with ${me.conversions} deal${me.conversions === 1 ? '' : 's'} closed and ${me.visits_booked} site visits booked.` });
  }
  if (o.overview) {
    const { totals, previous } = o.overview;
    if (totals.avg_first_response_min != null && previous.avg_first_response_min != null && totals.avg_first_response_min < previous.avg_first_response_min * 0.85) {
      out.push({ id: 'faster', tone: 'good', text: `Replies are faster: ${minutesHuman(totals.avg_first_response_min)} on average, down from ${minutesHuman(previous.avg_first_response_min)}.` });
    }
  }
  return out.slice(0, 5);
}
