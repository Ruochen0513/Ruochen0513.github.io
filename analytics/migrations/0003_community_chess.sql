CREATE TABLE IF NOT EXISTS chess_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'finished')),
  initial_fen TEXT NOT NULL,
  fen TEXT NOT NULL,
  positions TEXT NOT NULL,
  ply INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  last_player TEXT,
  last_action TEXT,
  result TEXT NOT NULL DEFAULT '*',
  ending TEXT,
  declared_move TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS chess_one_active ON chess_games(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS chess_archives ON chess_games(status, id DESC);
CREATE TABLE IF NOT EXISTS chess_moves (
  game_id INTEGER NOT NULL REFERENCES chess_games(id),
  ply INTEGER NOT NULL,
  color TEXT NOT NULL,
  move_number INTEGER NOT NULL,
  from_square TEXT NOT NULL,
  to_square TEXT NOT NULL,
  promotion TEXT,
  san TEXT NOT NULL,
  fen TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(game_id, ply)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chess_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) WITHOUT ROWID;
INSERT INTO chess_games(initial_fen, fen, positions, created_at, updated_at)
SELECT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
       '{"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -":1}',
       unixepoch(), unixepoch()
WHERE NOT EXISTS(SELECT 1 FROM chess_games);
