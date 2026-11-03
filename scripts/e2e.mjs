import { chromium } from 'playwright';
const base = 'http://localhost:3100';
const routes = ['/', '/leads', '/speed', '/funnel', '/roi', '/leaderboard', '/inventory', '/agents', '/system'];
const browser = await chromium.launch();
async function session(role, viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errs.push(`http ${r.status()} ${r.url().replace(base, '')}`); });
  await page.goto(base + '/login');
  if (role === 'agent') { await page.getByRole('tab', { name: 'Agent' }).click(); await page.getByLabel('Your mobile number').fill('9811100001'); await page.getByLabel('Password').fill('agent1230001'); }
  else await page.getByLabel('Password').fill('owner123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(base + '/', { timeout: 15000 });
  for (const r of (role === 'agent' ? ['/', '/leads', '/speed', '/funnel', '/leaderboard', '/inventory'] : routes)) {
    await page.goto(base + r);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `shots/${tag}-${r === '/' ? 'home' : r.slice(1)}.png`, fullPage: false });
  }
  console.log(tag, errs.length ? errs.join('\n  ') : 'no console/page/API errors');
  return { ctx, page };
}
const o = await session('owner', { width: 1360, height: 900 }, 'owner-desktop');
// interactions as owner
const p = o.page;
await p.goto(base + '/leads'); await p.waitForLoadState('networkidle');
await p.locator('tbody tr').first().click();
await p.waitForTimeout(900); await p.screenshot({ path: 'shots/owner-drawer.png' });
await p.keyboard.press('Escape');
await p.keyboard.press('Control+k'); await p.waitForTimeout(300);
await p.keyboard.type('gomti'); await p.waitForTimeout(1200); await p.screenshot({ path: 'shots/owner-palette.png' });
await o.ctx.close();
await session('owner', { width: 390, height: 844 }, 'owner-mobile');
await session('agent', { width: 390, height: 844 }, 'agent-mobile');
await browser.close();
