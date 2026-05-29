// Sync core — usado pelo cron, pelo /api/sync e pelo /auth/callback.
// Coleta channel stats + vídeos públicos + video stats para um canal.

export async function syncChannel(channel, env, options = {}) {
  const {
    startDate = null,  // YYYY-MM-DD — null = só hoje
    endDate   = null,  // YYYY-MM-DD — null = hoje
  } = options;

  const today     = ymd(new Date());
  const dateFrom  = startDate || today;
  const dateTo    = endDate   || today;

  const accessToken = await getAccessToken(channel, env);

  await Promise.all([
    syncChannelStats(channel, accessToken, dateFrom, dateTo, env),
    syncVideos(channel, accessToken, dateFrom, dateTo, env),
  ]);
}

// ── Channel-level daily stats ─────────────────────────────────────────────

async function syncChannelStats(channel, accessToken, dateFrom, dateTo, env) {
  // Gera lista de datas no intervalo
  const dates = dateRange(dateFrom, dateTo);

  for (const date of dates) {
    // Subscriber count vem do Data API (snapshot atual, não histórico)
    // Analytics API dá impressions/CTR/watch time por dia
    const [dataStats, analyticsRow] = await Promise.all([
      fetchChannelDataStats(accessToken),
      fetchChannelAnalytics(accessToken, date, date),
    ]);

    await env.DB.prepare(`
      INSERT INTO channel_stats (
        channel_id, date, subscribers, total_views, video_count, comment_count,
        impressions, ctr, watch_time_hours
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, date) DO UPDATE SET
        subscribers      = excluded.subscribers,
        total_views      = excluded.total_views,
        video_count      = excluded.video_count,
        comment_count    = excluded.comment_count,
        impressions      = excluded.impressions,
        ctr              = excluded.ctr,
        watch_time_hours = excluded.watch_time_hours,
        snapshot_at      = unixepoch()
    `).bind(
      channel.channel_id, date,
      dataStats.subscribers, dataStats.total_views, dataStats.video_count, dataStats.comment_count,
      analyticsRow.impressions, analyticsRow.ctr, analyticsRow.watch_time_hours
    ).run();
  }
}

async function fetchChannelDataStats(accessToken) {
  const resp = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) throw new Error(`Data API ${resp.status}`);
  const json = await resp.json();
  const s = json.items?.[0]?.statistics || {};
  return {
    subscribers:   parseInt(s.subscriberCount || '0', 10),
    total_views:   parseInt(s.viewCount        || '0', 10),
    video_count:   parseInt(s.videoCount       || '0', 10),
    comment_count: parseInt(s.commentCount     || '0', 10),
  };
}

async function fetchChannelAnalytics(accessToken, startDate, endDate) {
  try {
    const resp = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}` +
      `&metrics=impressions,impressionClickThroughRate,estimatedMinutesWatched`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!resp.ok) return { impressions: 0, ctr: 0, watch_time_hours: 0 };
    const json = await resp.json();
    const row  = json.rows?.[0];
    if (!row) return { impressions: 0, ctr: 0, watch_time_hours: 0 };
    return {
      impressions:      parseInt(row[0] || 0, 10),
      ctr:              parseFloat(row[1] || 0),
      watch_time_hours: parseFloat((row[2] || 0) / 60),
    };
  } catch (_) {
    return { impressions: 0, ctr: 0, watch_time_hours: 0 };
  }
}

// ── Videos + per-video analytics ─────────────────────────────────────────

async function syncVideos(channel, accessToken, dateFrom, dateTo, env) {
  // 1. Buscar todos os vídeos públicos do canal via uploadsPlaylist
  const channelResp = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!channelResp.ok) return;
  const channelJson  = await channelResp.json();
  const uploadsId    = channelJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return;

  const videoIds = await fetchAllPublicVideoIds(accessToken, uploadsId);
  if (!videoIds.length) return;

  // 2. Buscar metadados em lotes de 50
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    await upsertVideoMetadata(accessToken, batch, channel.channel_id, env);
  }

  // 3. Buscar métricas por vídeo via Analytics API (agregado para o período)
  await syncVideoAnalytics(accessToken, channel.channel_id, dateFrom, dateTo, env);
}

async function fetchAllPublicVideoIds(accessToken, uploadsPlaylistId) {
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
      // Filtro: só vídeos públicos
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
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,contentDetails,statistics&id=${videoIds.join(',')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) return;
  const json = await resp.json();
  const today = ymd(new Date());

  const metaStmts  = [];
  const statsStmts = [];

  for (const v of json.items || []) {
    const thumb = v.snippet?.thumbnails?.medium?.url
               || v.snippet?.thumbnails?.default?.url
               || '';
    const durationSec = iso8601DurationToSeconds(v.contentDetails?.duration || '');
    const views    = parseInt(v.statistics?.viewCount    || '0', 10);
    const likes    = parseInt(v.statistics?.likeCount    || '0', 10);
    const comments = parseInt(v.statistics?.commentCount || '0', 10);

    // Metadados do vídeo
    metaStmts.push(env.DB.prepare(`
      INSERT INTO videos (video_id, channel_id, title, thumbnail_url, published_at, duration_sec)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        title         = excluded.title,
        thumbnail_url = excluded.thumbnail_url,
        duration_sec  = excluded.duration_sec,
        updated_at    = unixepoch()
    `).bind(v.id, channelId, v.snippet?.title || '', thumb, v.snippet?.publishedAt || '', durationSec));

    // Métricas básicas da Data API (views, likes, comentários) — sempre disponíveis
    statsStmts.push(env.DB.prepare(`
      INSERT INTO video_stats (video_id, channel_id, date, views, likes, comments)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id, date) DO UPDATE SET
        views    = excluded.views,
        likes    = excluded.likes,
        comments = excluded.comments
    `).bind(v.id, channelId, today, views, likes, comments));
  }

  if (metaStmts.length)  await env.DB.batch(metaStmts);
  if (statsStmts.length) await env.DB.batch(statsStmts);
}

async function syncVideoAnalytics(accessToken, channelId, startDate, endDate, env) {
  // Analytics API com dimensions=video retorna métricas agregadas no período por vídeo
  let pageToken = '';
  do {
    const url = `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel==MINE` +
      `&startDate=${startDate}&endDate=${endDate}` +
      `&dimensions=video` +
      `&metrics=views,likes,comments,impressions,impressionClickThroughRate,estimatedMinutesWatched,averageViewDuration` +
      `&maxResults=200` +
      `&sort=-views` +
      (pageToken ? `&pageToken=${pageToken}` : '');

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      console.warn(`[sync] Analytics API (video) ${resp.status}:`, await resp.text().catch(() => ''));
      break;
    }
    const json = await resp.json();

    const rows  = json.rows || [];
    const today = ymd(new Date());

    const stmts = rows.map(row => {
      const [videoId, views, likes, comments, impressions, ctr, watchMin, avgDurSec] = row;
      return env.DB.prepare(`
        INSERT INTO video_stats (
          video_id, channel_id, date,
          views, likes, comments, impressions, ctr,
          avg_view_duration_sec, watch_time_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id, date) DO UPDATE SET
          views                 = excluded.views,
          likes                 = excluded.likes,
          comments              = excluded.comments,
          impressions           = excluded.impressions,
          ctr                   = excluded.ctr,
          avg_view_duration_sec = excluded.avg_view_duration_sec,
          watch_time_minutes    = excluded.watch_time_minutes
      `).bind(
        videoId, channelId, today,
        parseInt(views || 0), parseInt(likes || 0), parseInt(comments || 0),
        parseInt(impressions || 0), parseFloat(ctr || 0),
        parseInt(avgDurSec || 0), parseInt(watchMin || 0)
      );
    });

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

function dateRange(from, to) {
  const dates = [];
  const cur   = new Date(from + 'T00:00:00Z');
  const end   = new Date(to   + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function iso8601DurationToSeconds(duration) {
  if (!duration) return 0;
  const m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}
