// GET /api/stats?key=...&channel_id=UC...&days=30
// Retorna série temporal de snapshots para um canal.

import { guardKey, json, clampInt } from './_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const url = new URL(request.url);
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) return json({ error: 'Missing channel_id' }, 400);

  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);

  try {
    const [channelRow, statsRows] = await Promise.all([
      env.DB.prepare('SELECT client_name, handle FROM channels WHERE channel_id = ?')
        .bind(channelId).first(),

      env.DB.prepare(`
        SELECT date, subscribers, total_views, video_count, comment_count,
               impressions, ctr, watch_time_hours
        FROM channel_stats
        WHERE channel_id = ?
          AND date >= date('now', ? || ' days')
        ORDER BY date ASC
      `).bind(channelId, `-${days}`).all(),
    ]);

    if (!channelRow) return json({ error: 'Channel not found' }, 404);

    const rows = statsRows.results || [];

    // Calcular deltas (primeiro vs último snapshot do período)
    const first = rows[0];
    const last  = rows[rows.length - 1];
    const delta = first && last ? {
      subscribers:   (last.subscribers  || 0) - (first.subscribers  || 0),
      total_views:   (last.total_views   || 0) - (first.total_views   || 0),
      video_count:   (last.video_count   || 0) - (first.video_count   || 0),
      comment_count: (last.comment_count || 0) - (first.comment_count || 0),
    } : null;

    return json({
      channel_id:  channelId,
      client_name: channelRow.client_name,
      handle:      channelRow.handle,
      days,
      delta,
      rows,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
