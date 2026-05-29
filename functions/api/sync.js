// POST /api/sync?key=...&days=365
// Dispara coleta manual. days=1 (padrão) = só hoje. days=365 = histórico completo.

import { guardKey, json, clampInt } from './_helpers.js';
import { syncChannel } from '../_sync.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const err = guardKey(request, env);
  if (err) return err;

  const url  = new URL(request.url);
  const days = clampInt(url.searchParams.get('days'), 1, 1, 3650);

  const today    = ymd(new Date());
  const dateFrom = ymd(new Date(Date.now() - (days - 1) * 86400 * 1000));

  let channels;
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM channels WHERE refresh_token IS NOT NULL'
    ).all();
    channels = result.results || [];
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  if (!channels.length) return json({ ok: true, synced: 0, message: 'No connected channels' });

  const results = await Promise.allSettled(
    channels.map(ch => syncChannel(ch, env, { startDate: dateFrom, endDate: today }))
  );

  const summary = results.map((r, i) => ({
    client: channels[i].client_name,
    ok:     r.status === 'fulfilled',
    error:  r.status === 'rejected' ? r.reason?.message : null,
  }));

  return json({ ok: true, dateFrom, dateTo: today, synced: summary.filter(s => s.ok).length, summary });
}

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
