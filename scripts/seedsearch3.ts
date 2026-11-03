import { buildSeed } from '../lib/mock/seed';
import * as M from '../lib/metrics';
const base = new Date();
const offs = [0, 0.3, 1, 3, 8, 15, 21];
const good: string[] = [];
for (let seed = 1; seed <= 40; seed++) {
  let bad = 0;
  for (const off of offs) {
    const ds = buildSeed(new Date(base.getTime() + off * 86400000), seed); const now = new Date(ds.anchor);
    const lb = M.computeLeaderboard(ds, M.defaultPeriod(now, 30), now);
    if (lb[0].name !== 'Rohan Mishra') bad++;
    const cm = M.monthOf(M.istDate(now));
    for (const k of [1,2,3]) { const c = M.computeSourceRoi(ds, M.addMonths(cm,-k), now, ds.cfg).rows.filter(r=>r.consider_cut).map(r=>r.source).join('+'); if (c !== 'magicbricks') bad++; }
  }
  if (bad === 0) good.push(String(seed)); else if (bad <= 1) good.push(seed + '(~1)');
}
console.log('seeds', good.join(' '));
