-- Dados diários incrementais por canal (da Analytics API com dimensions=day)
CREATE TABLE IF NOT EXISTS channel_daily (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id            TEXT NOT NULL,
  date                  TEXT NOT NULL,   -- YYYY-MM-DD
  views                 INTEGER DEFAULT 0,
  watch_time_minutes    INTEGER DEFAULT 0,
  subscribers_gained    INTEGER DEFAULT 0,
  subscribers_lost      INTEGER DEFAULT 0,
  impressions           INTEGER DEFAULT 0,
  ctr                   REAL    DEFAULT 0,
  UNIQUE(channel_id, date)
);
CREATE INDEX IF NOT EXISTS idx_channel_daily_channel_date ON channel_daily(channel_id, date);

-- Dados diários incrementais por vídeo (Analytics API dimensions=video,day)
CREATE TABLE IF NOT EXISTS video_daily (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id              TEXT NOT NULL,
  channel_id            TEXT NOT NULL,
  date                  TEXT NOT NULL,   -- YYYY-MM-DD
  views                 INTEGER DEFAULT 0,
  watch_time_minutes    INTEGER DEFAULT 0,
  avg_view_duration_sec INTEGER DEFAULT 0,
  UNIQUE(video_id, date)
);
CREATE INDEX IF NOT EXISTS idx_video_daily_channel_date ON video_daily(channel_id, date);
CREATE INDEX IF NOT EXISTS idx_video_daily_video_date   ON video_daily(video_id, date);
