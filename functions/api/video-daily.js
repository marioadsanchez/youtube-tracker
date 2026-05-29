// GET /api/video-daily?key=...&video_id=xxx&from=2026-01-01&to=2026-05-28
// Retorna dados diários de um vídeo específico.

import { guardKey, json } from './_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const url     = new URL(request.url);
  const videoId = url.searchParams.get('video_id');
  if (!videoId) return json({ error: 'Missing video_id' }, 400);

  const to   = url.searchParams.get('to')   || ymd(new Date());
  const from = url.searchParams.get('from') || ymd(new Date(Date.now() - 29 * 86400 * 1000));

  try {
    const [meta, rows] = await Promise.all([
      env.DB.prepare('SELECT title, thumbnail_url, published_at, duration_sec FROM videos WHERE video_id = ?')
        .bind(videoId).first(),
      env.DB.prepare(`
        SELECT date, views, watch_time_minutes, avg_view_duration_sec
        FROM video_daily
        WHERE video_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
      `).bind(videoId, from, to).all(),
    ]);

    const data   = rows.results || [];
    const totals = data.reduce((acc, r) => ({
      views:              acc.views              + (r.views || 0),
      watch_time_minutes: acc.watch_time_minutes + (r.watch_time_minutes || 0),
    }), { views: 0, watch_time_minutes: 0 });

    const avgDur = data.filter(r => r.avg_view_duration_sec > 0);
    totals.avg_view_duration_sec = avgDur.length
      ? Math.round(avgDur.reduce((s, r) => s + r.avg_view_duration_sec, 0) / avgDur.length) : 0;

    return json({ video_id: videoId, meta, from, to, totals, rows: data });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
