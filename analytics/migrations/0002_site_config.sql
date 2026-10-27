CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO site_content(id) VALUES (1);
CREATE TABLE IF NOT EXISTS site_admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT,
  password_salt TEXT,
  auth_version INTEGER NOT NULL DEFAULT 1,
  setup_hash TEXT,
  setup_expires INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS admin_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) WITHOUT ROWID;
