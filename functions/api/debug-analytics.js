// GET /api/debug-analytics?key=...&channel_id=UC...
// Testa a YouTube Analytics API diretamente e retorna a resposta crua para diagnóstico.

import { guardKey, json } from './_helpers.js';
import { getAccessToken } from '../_sync.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const url       = new URL(request.url);
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) return json({ error: 'Missing channel_id' }, 400);

  const channel = await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first();
  if (!channel) return json({ error: 'Channel not found' }, 404);
  if (!channel.refresh_token) return json({ error: 'Channel not connected via OAuth' }, 400);

  try {
    const accessToken = await getAccessToken(channel, env);
    const today    = new Date().toISOString().slice(0, 10);
    const from30   = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

    // Teste 1: channel-level analytics (sem dimensions)
    const r1 = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${from30}&endDate=${today}&metrics=views,impressions,impressionClickThroughRate`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const channelAnalytics = { status: r1.status, body: await r1.json().catch(() => r1.text()) };

    // Teste 2: per-video analytics com dimensions=video
    const r2 = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${from30}&endDate=${today}&dimensions=video&metrics=views,impressions,impressionClickThroughRate&maxResults=5&sort=-views`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const videoAnalytics = { status: r2.status, body: await r2.json().catch(() => r2.text()) };

    return json({ channelAnalytics, videoAnalytics });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
