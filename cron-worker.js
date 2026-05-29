// YouTube Tracker — Cron Worker
// Roda todo dia às 06:00 UTC. Coleta channel stats + vídeos públicos para todos os canais conectados.

import { syncChannel } from './functions/_sync.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailySync(env));
  },
};

async function runDailySync(env) {
  const today = ymd(new Date());
  console.log(`[cron] Starting daily sync for ${today}`);

  let channels;
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM channels WHERE refresh_token IS NOT NULL'
    ).all();
    channels = result.results || [];
  } catch (e) {
    console.error('[cron] Failed to fetch channels:', e.message);
    return;
  }

  if (!channels.length) { console.log('[cron] No channels. Skipping.'); return; }

  const results = await Promise.allSettled(
    channels.map(ch => syncChannel(ch, env, { startDate: today, endDate: today }))
  );

  for (const [i, r] of results.entries()) {
    const name = channels[i].client_name;
    r.status === 'fulfilled'
      ? console.log(`[cron] ✅ ${name}`)
      : console.error(`[cron] ❌ ${name}: ${r.reason?.message}`);
  }
}

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
