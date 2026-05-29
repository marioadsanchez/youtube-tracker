// Sync core — coleta dados do YouTube para um canal.
// Chamado pelo cron, /api/sync e /auth/callback.

export async function syncChannel(channel, env, options = {}) {
  const today    = ymd(new Date());
  const dateFrom = options.startDate || today;
  const dateTo   = options.endDate   || today;

  const accessToken = await getAccessToken(channel, env);

  // Snapshots cumulativos (Data API) + dados diários (Analytics API)
  await Promise.all([
    syncCumulativeSnapshot(channel, accessToken, env),
    syncChannelDaily(channel, accessToken, dateFrom, dateTo, env),
    syncVideos(channel, accessToken, dateFrom, dateTo, env),
  ]);
}

// ── Snapshot cumulativo do canal (Data API) ───────────────────────────────
// Salva o estado atual do canal (total de inscritos, views, etc.)

async function syncCumulativeSnapshot(channel, accessToken, env) {
  const today = ymd(new Date());
  const resp  = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) return;
  const json = await resp.json();
  const s    = json.items?.[0]?.statistics || {};

  await env.DB.prepare(`
    INSERT INTO channel_stats (channel_id, date, subscribers, total_views, video_count, comment_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, date) DO UPDATE SET
      subscribers   = excluded.subscribers,
      total_views   = excluded.total_views,
      video_count   = excluded.video_count,
      comment_count = excluded.comment_count,
      snapshot_at   = unixepoch()
  `).bind(
    channel.channel_id, today,
    parseInt(s.subscriberCount || '0', 10),
    parseInt(s.viewCount       || '0', 10),
    parseInt(s.videoCount      || '0', 10),
    parseInt(s.commentCount    || '0', 10),
  ).run();
}

// ── Dados diários do canal (Analytics API com dimensions=day) ─────────────

async function syncChannelDaily(channel, accessToken, dateFrom, dateTo, env) {
  // Query 1: views, watch time, subscribers
  const r1 = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports` +
    `?ids=channel==MINE&startDate=${dateFrom}&endDate=${dateTo}` +
    `&dimensions=day&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost` +
    `&sort=day`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const rows1 = r1.ok ? (await r1.json()).rows || [] : [];

  // Query 2: impressions + CTR (query separada — falha se combinada com outros)
  const r2 = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports` +
    `?ids=channel==MINE&startDate=${dateFrom}&endDate=${dateTo}` +
    `&dimensions=day&metrics=impressions,impressionClickThroughRate` +
    `&sort=day`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // Impressions pode falhar sem YPP — aceitamos silenciosamente
  const impressionMap = {};
  if (r2.ok) {
    const rows2 = (await r2.json()).rows || [];
    for (const [date, imp, ctr] of rows2) {
      impressionMap[date] = { impressions: parseInt(imp || 0), ctr: parseFloat(ctr || 0) };
    }
  }

  if (!rows1.length) return;

  const stmts = rows1.map(([date, views, watchMin, subGained, subLost]) => {
    const imp = impressionMap[date] || { impressions: 0, ctr: 0 };
    return env.DB.prepare(`
      INSERT INTO channel_daily (
        channel_id, date, views, watch_time_minutes,
        subscribers_gained, subscribers_lost, impressions, ctr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, date) DO UPDATE SET
        views              = excluded.views,
        watch_time_minutes = excluded.watch_time_minutes,
        subscribers_gained = excluded.subscribers_gained,
        subscribers_lost   = excluded.subscribers_lost,
        impressions        = excluded.impressions,
        ctr                = excluded.ctr
    `).bind(
      channel.channel_id, date,
      parseInt(views || 0), parseInt(watchMin || 0),
      parseInt(subGained || 0), parseInt(subLost || 0),
      imp.impressions, imp.ctr
    );
  });

  await env.DB.batch(stmts);
}

// ── Vídeos: metadados + stats cumulativos + dados diários ─────────────────

async function syncVideos(channel, accessToken, dateFrom, dateTo, env) {
  // 1. Buscar playlist de uploads
  const chResp = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!chResp.ok) return;
  const chJson    = await chResp.json();
  const uploadsId = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return;

  // 2. Buscar todos os video IDs públicos
  const videoIds = await fetchPublicVideoIds(accessToken, uploadsId);
  if (!videoIds.length) return;

  // 3. Metadados + stats cumulativos em lotes de 50
  for (let i = 0; i < videoIds.length; i += 50) {
    await upsertVideoMetadata(accessToken, videoIds.slice(i, i + 50), channel.channel_id, env);
  }

  // 4. Dados diários por vídeo (Analytics API dimensions=video,day)
  await syncVideoDaily(channel, accessToken, dateFrom, dateTo, env);
}

async function fetchPublicVideoIds(accessToken, uploadsPlaylistId) {
  const ids = [];
  let pageToken = '';
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems` +
      `?part=contentDetails,status&playlistId=${uploadsPlaylistId}&maxResults=50` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) break;
    const json = await resp.json();
    for (const item of json.items || []) {
      if (item.status?.privacyStatus === 'public') {
        ids.push(item.contentDetails.videoId);
      }
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return ids;
}

async function upsertVideoMetadata(accessToken, videoIds, channelId, env) {
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoIds.join(',')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) return;
  const json  = await resp.json();
  const today = ymd(new Date());

  const metaStmts  = [];
  const statsStmts = [];

  for (const v of json.items || []) {
    const thumb = v.snippet?.thumbnails?.maxres?.url
               || v.snippet?.thumbnails?.standard?.url
               || v.snippet?.thumbnails?.medium?.url
               || v.snippet?.thumbnails?.default?.url || '';

    metaStmts.push(env.DB.prepare(`
      INSERT INTO videos (video_id, channel_id, title, thumbnail_url, published_at, duration_sec)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        title         = excluded.title,
        thumbnail_url = excluded.thumbnail_url,
        duration_sec  = excluded.duration_sec,
        updated_at    = unixepoch()
    `).bind(
      v.id, channelId,
      v.snippet?.title || '',
      thumb,
      v.snippet?.publishedAt || '',
      iso8601ToSeconds(v.contentDetails?.duration || '')
    ));

    // Stats cumulativos do vídeo (total acumulado)
    statsStmts.push(env.DB.prepare(`
      INSERT INTO video_stats (video_id, channel_id, date, views, likes, comments)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id, date) DO UPDATE SET
        views    = excluded.views,
        likes    = excluded.likes,
        comments = excluded.comments
    `).bind(
      v.id, channelId, today,
      parseInt(v.statistics?.viewCount    || '0', 10),
      parseInt(v.statistics?.likeCount    || '0', 10),
      parseInt(v.statistics?.commentCount || '0', 10),
    ));
  }

  if (metaStmts.length)  await env.DB.batch(metaStmts);
  if (statsStmts.length) await env.DB.batch(statsStmts);
}

async function syncVideoDaily(channel, accessToken, dateFrom, dateTo, env) {
  // Buscar IDs de vídeos já cadastrados para filtrar resultados da Analytics API
  const existingIds = new Set(
    (await env.DB.prepare('SELECT video_id FROM videos WHERE channel_id = ?')
      .bind(channel.channel_id).all()).results.map(r => r.video_id)
  );
  if (!existingIds.size) return;

  let pageToken = '';
  do {
    const url = `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel==MINE&startDate=${dateFrom}&endDate=${dateTo}` +
      `&dimensions=video,day` +
      `&metrics=views,estimatedMinutesWatched,averageViewDuration` +
      `&maxResults=200&sort=-views` +
      (pageToken ? `&pageToken=${pageToken}` : '');

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      console.warn(`[sync] video daily analytics ${resp.status}:`, await resp.text().catch(() => ''));
      break;
    }
    const json = await resp.json();
    const rows = json.rows || [];

    const stmts = rows
      .filter(r => existingIds.has(r[0]))
      .map(([videoId, date, views, watchMin, avgDur]) =>
        env.DB.prepare(`
          INSERT INTO video_daily (video_id, channel_id, date, views, watch_time_minutes, avg_view_duration_sec)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(video_id, date) DO UPDATE SET
            views                 = excluded.views,
            watch_time_minutes    = excluded.watch_time_minutes,
            avg_view_duration_sec = excluded.avg_view_duration_sec
        `).bind(videoId, channel.channel_id, date,
          parseInt(views || 0), parseInt(watchMin || 0), parseInt(avgDur || 0))
      );

    if (stmts.length) await env.DB.batch(stmts);
    pageToken = json.nextPageToken || '';
  } while (pageToken);
}

// ── Token management ──────────────────────────────────────────────────────

export async function getAccessToken(channel, env) {
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
  const data     = await resp.json();
  const newToken  = data.access_token;
  const newExpiry = now + (data.expires_in || 3600) - 60;
  await env.DB.prepare('UPDATE channels SET access_token = ?, token_expiry = ? WHERE channel_id = ?')
    .bind(newToken, newExpiry, channel.channel_id).run();
  return newToken;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function iso8601ToSeconds(dur) {
  if (!dur) return 0;
  const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}
