import { buildSeed } from '../lib/mock/seed';
import * as M from '../lib/metrics';
const base = new Date();
for (const off of [0, 0.3, 3, 8, 15, 21]) {
  const anchor = new Date(base.getTime() + off * 86400000);
  const ds = buildSeed(anchor); const now = new Date(ds.anchor);
  const lb = M.computeLeaderboard(ds, M.defaultPeriod(now, 30), now);
  const cm = M.monthOf(M.istDate(now));
  const cuts = [1,2,3].map(k => M.computeSourceRoi(ds, M.addMonths(cm,-k), now, ds.cfg).rows.filter(r=>r.consider_cut).map(r=>r.source).join('+'));
  const st = M.computeStale(ds, now, ds.cfg);
  console.log(off, 'top', lb[0].name, lb.map(r=>r.conversions).join('/'), 'cuts', cuts.join(' | '), 'stale', st.length, new Set(st.map(s=>s.level)).size);
}
