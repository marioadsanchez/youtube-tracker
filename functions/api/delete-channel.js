// DELETE /api/delete-channel?key=...&channel_id=UC...
// Remove canal e todos os seus snapshots do D1.

import { guardKey, json } from './_helpers.js';

export async function onRequestDelete(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const url = new URL(request.url);
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) return json({ error: 'Missing channel_id' }, 400);

  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM channel_stats WHERE channel_id = ?').bind(channelId),
      env.DB.prepare('DELETE FROM channels WHERE channel_id = ?').bind(channelId),
    ]);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
