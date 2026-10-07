-- Corner X 資料庫 schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL,              -- 'single' | 'double'
  status TEXT NOT NULL DEFAULT 'ongoing', -- 'ongoing' | 'done'
  share_slug TEXT UNIQUE,
  data TEXT NOT NULL,                -- JSON blob，見 src/bracket.js
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tournaments_workspace ON tournaments (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tournaments_slug ON tournaments (share_slug);

CREATE TABLE IF NOT EXISTS leaderboards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  share_slug TEXT UNIQUE,
  data TEXT NOT NULL,                -- JSON blob，見 src/leaderboard.js
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leaderboards_workspace ON leaderboards (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboards_slug ON leaderboards (share_slug);


-- Corner X V2：活動（Series）／多場賽事／累積積分
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  event_date TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  control_token TEXT NOT NULL UNIQUE,
  share_slug TEXT NOT NULL UNIQUE,
  point_rules TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_series_workspace ON series (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_series_share ON series (share_slug);
CREATE INDEX IF NOT EXISTS idx_series_control ON series (control_token);

CREATE TABLE IF NOT EXISTS series_participants (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(series_id, name)
);
CREATE INDEX IF NOT EXISTS idx_series_participants_series ON series_participants(series_id, sort_order);

CREATE TABLE IF NOT EXISTS series_rounds (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'single',
  status TEXT NOT NULL DEFAULT 'ongoing',
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(series_id, round_no)
);
CREATE INDEX IF NOT EXISTS idx_series_rounds_series ON series_rounds(series_id, round_no);

CREATE TABLE IF NOT EXISTS series_round_points (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  rank INTEGER,
  points INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'auto',
  locked INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(round_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_round_points_round ON series_round_points(round_id);
CREATE INDEX IF NOT EXISTS idx_round_points_participant ON series_round_points(participant_id);


CREATE TABLE IF NOT EXISTS series_round_actions (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_round_actions_round ON series_round_actions(round_id, created_at DESC);
