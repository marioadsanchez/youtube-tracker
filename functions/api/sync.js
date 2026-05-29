// POST /api/sync?key=...
// Dispara coleta manual imediata para todos os canais conectados.

import { guardKey, json } from './_helpers.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const today = ymd(new Date());

  let channels;
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM channels WHERE refresh_token IS NOT NULL'
    ).all();
    channels = result.results || [];
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  if (channels.length === 0) return json({ ok: true, synced: 0, message: 'No connected channels' });

  const results = await Promise.allSettled(channels.map(ch => syncChannel(ch, today, env)));

  const summary = results.map((r, i) => ({
    client: channels[i].client_name,
    ok: r.status === 'fulfilled',
    error: r.status === 'rejected' ? r.reason?.message : null,
  }));

  return json({ ok: true, date: today, synced: summary.filter(s => s.ok).length, summary });
}

async function syncChannel(channel, today, env) {
  const accessToken = await getAccessToken(channel, env);

  const dataResp = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!dataResp.ok) throw new Error(`Data API ${dataResp.status}: ${await dataResp.text()}`);
  const dataJson = await dataResp.json();
  const stats = dataJson.items?.[0]?.statistics || {};

  const subscribers   = parseInt(stats.subscriberCount || '0', 10);
  const total_views   = parseInt(stats.viewCount       || '0', 10);
  const video_count   = parseInt(stats.videoCount      || '0', 10);
  const comment_count = parseInt(stats.commentCount    || '0', 10);

  let impressions = 0, ctr = 0, watch_time_hours = 0;
  try {
    const analyticsResp = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel==MINE&startDate=${today}&endDate=${today}` +
      `&metrics=impressions,impressionClickThroughRate,estimatedMinutesWatched`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (analyticsResp.ok) {
      const aj = await analyticsResp.json();
      const row = aj.rows?.[0];
      if (row) {
        impressions      = parseInt(row[0] || 0, 10);
        ctr              = parseFloat(row[1] || 0);
        watch_time_hours = parseFloat((row[2] || 0) / 60);
      }
    }
  } catch (_) {}

  await env.DB.prepare(`
    INSERT INTO channel_stats (
      channel_id, date, subscribers, total_views, video_count, comment_count,
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
  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const data = await resp.json();
  const newToken  = data.access_token;
  const newExpiry = now + (data.expires_in || 3600) - 60;
  await env.DB.prepare('UPDATE channels SET access_token = ?, token_expiry = ? WHERE channel_id = ?')
    .bind(newToken, newExpiry, channel.channel_id).run();
  return newToken;
}

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
