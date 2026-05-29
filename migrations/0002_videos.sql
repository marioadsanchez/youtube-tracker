-- Metadados dos vídeos públicos de cada canal
CREATE TABLE IF NOT EXISTS videos (
  video_id          TEXT PRIMARY KEY,
  channel_id        TEXT NOT NULL REFERENCES channels(channel_id),
  title             TEXT,
  thumbnail_url     TEXT,
  published_at      TEXT,  -- ISO 8601
  duration_sec      INTEGER DEFAULT 0,
  updated_at        INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);

-- Snapshot de métricas por vídeo (agregado por data de coleta)
CREATE TABLE IF NOT EXISTS video_stats (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id              TEXT NOT NULL REFERENCES videos(video_id),
  channel_id            TEXT NOT NULL,
  date                  TEXT NOT NULL,  -- YYYY-MM-DD
  views                 INTEGER DEFAULT 0,
  likes                 INTEGER DEFAULT 0,
  comments              INTEGER DEFAULT 0,
  impressions           INTEGER DEFAULT 0,
  ctr                   REAL DEFAULT 0,
  avg_view_duration_sec INTEGER DEFAULT 0,
  watch_time_minutes    INTEGER DEFAULT 0,
  UNIQUE(video_id, date)
);
CREATE INDEX IF NOT EXISTS idx_video_stats_channel_date ON video_stats(channel_id, date);
CREATE INDEX IF NOT EXISTS idx_video_stats_video_date   ON video_stats(video_id, date);
