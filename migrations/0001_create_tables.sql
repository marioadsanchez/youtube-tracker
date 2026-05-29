-- YouTube Tracker — schema inicial
-- Canais registrados + OAuth tokens por cliente

CREATE TABLE IF NOT EXISTS channels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name   TEXT NOT NULL,
  channel_id    TEXT NOT NULL UNIQUE,   -- UCxxxxxx (YouTube channel ID)
  handle        TEXT,                    -- @handle para exibição
  refresh_token TEXT,                    -- OAuth refresh_token (permanente)
  access_token  TEXT,                    -- cache do access_token atual
  token_expiry  INTEGER,                 -- unix timestamp de expiração
  connected_at  INTEGER,                 -- quando foi autorizado pela primeira vez
  created_at    INTEGER DEFAULT (unixepoch())
);

-- Snapshot diário por canal
CREATE TABLE IF NOT EXISTS channel_stats (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id       TEXT NOT NULL REFERENCES channels(channel_id),
  date             TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  subscribers      INTEGER DEFAULT 0,
  total_views      INTEGER DEFAULT 0,
  video_count      INTEGER DEFAULT 0,
  comment_count    INTEGER DEFAULT 0,
  impressions      INTEGER DEFAULT 0,      -- YouTube Analytics API (requer OAuth)
  ctr              REAL DEFAULT 0,         -- click-through rate % (requer OAuth)
  watch_time_hours REAL DEFAULT 0,         -- horas assistidas (requer OAuth)
  snapshot_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(channel_id, date)
);

CREATE INDEX IF NOT EXISTS idx_channel_stats_channel_date ON channel_stats(channel_id, date);
