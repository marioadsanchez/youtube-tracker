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

    // Teste 1: watch time channel-level
    const r1 = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${from30}&endDate=${today}&metrics=estimatedMinutesWatched,averageViewDuration`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const watchTimeChannel = { status: r1.status, body: await r1.json().catch(() => r1.text()) };

    // Teste 2: watch time per-video
    const r2 = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${from30}&endDate=${today}&dimensions=video&metrics=views,estimatedMinutesWatched,averageViewDuration&maxResults=5&sort=-views`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const watchTimeVideo = { status: r2.status, body: await r2.json().catch(() => r2.text()) };

    // Teste 3: subscribers gained/lost
    const r3 = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${from30}&endDate=${today}&metrics=subscribersGained,subscribersLost`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const subscribers = { status: r3.status, body: await r3.json().catch(() => r3.text()) };

    return json({ watchTimeChannel, watchTimeVideo, subscribers });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
