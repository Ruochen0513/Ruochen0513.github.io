CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ZZ',
  latitude REAL,
  longitude REAL,
  views INTEGER NOT NULL DEFAULT 1 CHECK (views > 0),
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (day, visitor)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS visits_visitor ON visits(visitor);
