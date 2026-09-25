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
