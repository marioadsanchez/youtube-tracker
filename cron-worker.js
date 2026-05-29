// YouTube Tracker — Cron Worker
// Roda todo dia às 06:00 UTC via wrangler-cron.toml
// Para cada canal com refresh_token: busca YouTube Data API + Analytics API e salva snapshot.

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

  if (channels.length === 0) {
    console.log('[cron] No channels with OAuth connected. Skipping.');
    return;
  }

  const results = await Promise.allSettled(
    channels.map(ch => syncChannel(ch, today, env))
  );

  for (const [i, r] of results.entries()) {
    const name = channels[i].client_name;
    if (r.status === 'fulfilled') {
      console.log(`[cron] ✅ ${name}: synced`);
    } else {
      console.error(`[cron] ❌ ${name}: ${r.reason?.message || r.reason}`);
    }
  }
}

async function syncChannel(channel, today, env) {
  const accessToken = await getAccessToken(channel, env);

  // 1. YouTube Data API — métricas públicas do canal
  const dataResp = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!dataResp.ok) throw new Error(`Data API ${dataResp.status}: ${await dataResp.text()}`);
  const dataJson = await dataResp.json();
  const stats = dataJson.items?.[0]?.statistics || {};

  const subscribers  = parseInt(stats.subscriberCount || '0', 10);
  const total_views  = parseInt(stats.viewCount       || '0', 10);
  const video_count  = parseInt(stats.videoCount      || '0', 10);
  const comment_count = parseInt(stats.commentCount   || '0', 10);

  // 2. YouTube Analytics API — CTR, impressões, watch time
  let impressions = 0, ctr = 0, watch_time_hours = 0;
  try {
    const analyticsResp = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel==MINE` +
      `&startDate=${today}&endDate=${today}` +
      `&metrics=impressions,impressionClickThroughRate,estimatedMinutesWatched`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (analyticsResp.ok) {
      const analyticsJson = await analyticsResp.json();
      const row = analyticsJson.rows?.[0];
      if (row) {
        impressions       = parseInt(row[0] || 0, 10);
        ctr               = parseFloat(row[1] || 0);
        watch_time_hours  = parseFloat((row[2] || 0) / 60);
      }
    }
  } catch (e) {
    console.warn(`[cron] Analytics API failed for ${channel.client_name}:`, e.message);
  }

  // 3. Salvar snapshot no D1
  await env.DB.prepare(`
    INSERT INTO channel_stats (
      channel_id, date,
      subscribers, total_views, video_count, comment_count,
      impressions, ctr, watch_time_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, date) DO UPDATE SET
      subscribers      = excluded.subscribers,
      total_views      = excluded.total_views,
      video_count      = excluded.video_count,
      comment_count    = excluded.comment_count,
      impressions      = excluded.impressions,
      ctr              = excluded.ctr,
      watch_time_hours = excluded.watch_time_hours,
      snapshot_at      = unixepoch()
  `).bind(
    channel.channel_id, today,
    subscribers, total_views, video_count, comment_count,
    impressions, ctr, watch_time_hours
  ).run();
}

// Retorna access_token válido, renovando via refresh_token se necessário.
async function getAccessToken(channel, env) {
  const now = Math.floor(Date.now() / 1000);

  if (channel.access_token && channel.token_expiry && channel.token_expiry > now + 60) {
    return channel.access_token;
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: channel.refresh_token,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });

  if (!resp.ok) throw new Error(`Token refresh failed ${resp.status}: ${await resp.text()}`);

  const data = await resp.json();
  const newToken  = data.access_token;
  const newExpiry = now + (data.expires_in || 3600) - 60;

  await env.DB.prepare(
    'UPDATE channels SET access_token = ?, token_expiry = ? WHERE channel_id = ?'
  ).bind(newToken, newExpiry, channel.channel_id).run();

  return newToken;
}

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
