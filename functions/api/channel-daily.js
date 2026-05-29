// GET /api/channel-daily?key=...&channel_id=UC...&from=2026-01-01&to=2026-05-28
// Retorna dados diários incrementais do canal para o período.

import { guardKey, json } from './_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const url       = new URL(request.url);
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) return json({ error: 'Missing channel_id' }, 400);

  const to   = url.searchParams.get('to')   || ymd(new Date());
  const from = url.searchParams.get('from') || ymd(new Date(Date.now() - 29 * 86400 * 1000));

  try {
    const rows = await env.DB.prepare(`
      SELECT date, views, watch_time_minutes, subscribers_gained, subscribers_lost, impressions, ctr
      FROM channel_daily
      WHERE channel_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `).bind(channelId, from, to).all();

    // Totais do período
    const data = rows.results || [];
    const totals = data.reduce((acc, r) => ({
      views:              acc.views              + (r.views || 0),
      watch_time_minutes: acc.watch_time_minutes + (r.watch_time_minutes || 0),
      subscribers_gained: acc.subscribers_gained + (r.subscribers_gained || 0),
      subscribers_lost:   acc.subscribers_lost   + (r.subscribers_lost   || 0),
      impressions:        acc.impressions        + (r.impressions || 0),
    }), { views: 0, watch_time_minutes: 0, subscribers_gained: 0, subscribers_lost: 0, impressions: 0 });

    const avgCtr = data.filter(r => r.ctr > 0);
    totals.avg_ctr = avgCtr.length ? avgCtr.reduce((s, r) => s + r.ctr, 0) / avgCtr.length : 0;

    return json({ channel_id: channelId, from, to, totals, rows: data });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
