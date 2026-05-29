// GET /api/videos?key=...&channel_id=UC...&days=30&sort=views
// Retorna lista de vídeos públicos com métricas do período.

import { guardKey, json, clampInt } from './_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const url       = new URL(request.url);
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) return json({ error: 'Missing channel_id' }, 400);

  const days = clampInt(url.searchParams.get('days'), 30, 1, 3650);
  const sort = ['views','likes','comments','impressions','ctr'].includes(url.searchParams.get('sort'))
    ? url.searchParams.get('sort') : 'views';

  try {
    const rows = await env.DB.prepare(`
      SELECT
        v.video_id,
        v.title,
        v.thumbnail_url,
        v.published_at,
        v.duration_sec,
        COALESCE(vs.views,    0) AS views,
        COALESCE(vs.likes,    0) AS likes,
        COALESCE(vs.comments, 0) AS comments,
        COALESCE(vs.impressions, 0) AS impressions,
        COALESCE(vs.ctr,      0) AS ctr,
        COALESCE(vs.avg_view_duration_sec, 0) AS avg_view_duration_sec,
        COALESCE(vs.watch_time_minutes, 0) AS watch_time_minutes
      FROM videos v
      LEFT JOIN video_stats vs
        ON vs.video_id = v.video_id
        AND vs.date = (
          SELECT MAX(date) FROM video_stats
          WHERE video_id = v.video_id
            AND date >= date('now', ? || ' days')
        )
      WHERE v.channel_id = ?
      ORDER BY ${sort} DESC
    `).bind(`-${days}`, channelId).all();

    return json({ channel_id: channelId, days, sort, videos: rows.results || [] });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
