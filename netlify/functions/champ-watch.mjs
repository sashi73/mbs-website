// GKH Project Champ: 🩺 Champ's morning watch. Every day at 7:00 am Sydney time (6:00 am in winter) Netlify runs this:
// it checks every open project with the health rules, notes what changed since yesterday and sends the alerts, then asks
// the background function (up to 15 minutes) to write Champ's view of the red and amber projects whose numbers changed.
import * as A from '../lib/admin-lib.mjs';
import { sydToday } from '../lib/ai.mjs';

export default async () => {
  try {
    await A.ensureSecret();
    const W = await import('../lib/watch.mjs'), r = await W.sweep({ ai: false });
    const site = String(process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/+$/, '');
    if (site) await fetch(site + '/.netlify/functions/planai-background', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Cron': A.cronToken(sydToday()) }, body: JSON.stringify({ mode: 'watchCron', id: 'cron' + Date.now() }) }).catch(() => {});
    console.log(`Champ watch: ${r.items.length} projects (red ${r.counts.red}, amber ${r.counts.amber}, green ${r.counts.green}), ${(r.alerts || []).length} alerts`);
  } catch (e) { console.error('Champ watch: ' + e.message); }
  return new Response('ok');
};
export const config = { schedule: '0 20 * * *' };   // 20:00 UTC: 7:00 am AEDT, 6:00 am AEST
