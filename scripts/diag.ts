import { buildSeed } from '../lib/mock/seed';
import * as M from '../lib/metrics';
const ds = buildSeed(new Date());
const now = new Date(ds.anchor);
const real = ds.leads.filter(l => !l.is_test);
console.log('leads', real.length, 'events', ds.events.length, 'listings', ds.listings.length, 'matches', ds.matches.length);
const cnt = (f:(l:any)=>string)=>{const m:Record<string,number>={};real.forEach(l=>{const k=f(l);m[k]=(m[k]??0)+1});return m};
console.log('score', cnt(l=>l.score), 'stage', cnt(l=>l.stage), 'source', cnt(l=>l.source));
const p = { from: M.addDays(M.istDate(now), -89), to: M.istDate(now) };
const f = M.computeFunnel(ds, p, now);
console.log(f.stages.map(s=>`${s.stage}:${s.reached}(${s.conv_from_top_pct}%)`).join(' '), JSON.stringify(f.totals));
const sp = M.computeSpeed(ds, p, now, ds.cfg);
console.log('speed', JSON.stringify(sp.overall), 'esc', JSON.stringify(sp.escalation));
const stale = M.computeStale(ds, now, ds.cfg); console.log('stale', stale.length, stale.map(s=>s.level+':'+s.agent_name).join(', '));
for (const m of ['-3','-2','-1']) { const r = M.computeSourceRoi(ds, M.addMonths(M.monthOf(M.istDate(now)), Number(m)), now, ds.cfg); console.log(r.month, r.rows.map(x=>`${x.source} c${x.cost_inr} l${x.leads} v${x.site_visits} cpsv${x.cost_per_site_visit}${x.consider_cut?' CUT':''}`).join(' | ')); }
console.log('LB', M.computeLeaderboard(ds, p, now).map(r=>`${r.rank}.${r.name} conv${r.conversions} vb${r.visits_booked} fu${r.follow_ups_done} avg${r.avg_first_response_min} open${r.open_leads} stale${r.stale_count} asg${r.leads_assigned}`).join('\n   '));
console.log('listings', ds.listings.map(l=>l.id+':'+ds.matches.filter(m=>m.listing_id===l.id).length).join(' '));
const bad = ds.agents.map(a=>a.name+' open '+real.filter(l=>l.assigned_agent_id===a.id && M.isOpen(l.stage)).length+'/'+a.max_open_leads); console.log(bad.join(', '));
const resp = real.map(M.responseMinutes).filter((x):x is number=>x!=null); console.log('resp <=40:', resp.filter(r=>r<=40).length/resp.length, '>120:', resp.filter(r=>r>120).length/resp.length, 'median', M.median(resp));
