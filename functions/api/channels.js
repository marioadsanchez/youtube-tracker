// GET /api/channels?key=...
// Retorna todos os canais cadastrados com o último snapshot e status OAuth.

import { guardKey, json } from './_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  try {
    const channels = await env.DB.prepare(`
      SELECT
        c.id, c.client_name, c.channel_id, c.handle,
        c.connected_at,
        CASE WHEN c.refresh_token IS NOT NULL THEN 1 ELSE 0 END AS oauth_connected,
        s.date        AS last_date,
        s.subscribers AS last_subscribers,
        s.total_views AS last_total_views,
        s.video_count AS last_video_count,
        s.comment_count AS last_comment_count,
        s.ctr         AS last_ctr,
        s.impressions AS last_impressions
      FROM channels c
      LEFT JOIN channel_stats s ON s.channel_id = c.channel_id
        AND s.date = (
          SELECT MAX(date) FROM channel_stats WHERE channel_id = c.channel_id
        )
      ORDER BY c.client_name ASC
    `).all();

    return json({ channels: channels.results || [] });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
