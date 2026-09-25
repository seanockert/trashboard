CREATE TABLE items (
  id              TEXT PRIMARY KEY,          -- "<source_id>:<external id>"
  source_id       TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('regulatory', 'enforcement')),
  jurisdiction    TEXT NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  published_at    TEXT,
  body            TEXT NOT NULL DEFAULT '',
  detail_url      TEXT,
  detail_fetched_at TEXT,
  party           TEXT,
  party_group     TEXT,
  group_version   INTEGER,
  action          TEXT,
  location        TEXT,
  penalty_source_aud   REAL,
  penalty_selected_aud REAL,
  penalty_aud     REAL GENERATED ALWAYS AS (COALESCE(penalty_source_aud, penalty_selected_aud)) VIRTUAL,
  waste_activity  INTEGER NOT NULL DEFAULT 0,
  content_hash    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  tag_version     INTEGER,
  tagged_at       TEXT,
  answers         TEXT,                      -- JSON: raw Jev answers by question id
  summary         TEXT,                      -- JSON: { what, points }
  summary_version INTEGER,
  closes_on       TEXT,
  starts_on       TEXT,
  day             TEXT GENERATED ALWAYS AS (COALESCE(published_at, substr(first_seen_at, 1, 10))) VIRTUAL -- see DAY_SQL in src/db.ts
);

CREATE INDEX items_party_group ON items (party_group) WHERE party_group IS NOT NULL;
CREATE INDEX items_source ON items (source_id);
CREATE INDEX items_closes_on ON items (closes_on) WHERE closes_on IS NOT NULL;
CREATE INDEX items_starts_on ON items (starts_on) WHERE starts_on IS NOT NULL;
CREATE INDEX items_day ON items (day);           -- date filters read only their period

CREATE VIRTUAL TABLE items_fts USING fts5(
  title, body, party,
  content = 'items', content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, title, body, party) VALUES (new.rowid, new.title, new.body, new.party);
END;
CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, body, party) VALUES ('delete', old.rowid, old.title, old.body, old.party);
END;
CREATE TRIGGER items_au AFTER UPDATE OF title, body, party ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, body, party) VALUES ('delete', old.rowid, old.title, old.body, old.party);
  INSERT INTO items_fts (rowid, title, body, party) VALUES (new.rowid, new.title, new.body, new.party);
END;

CREATE TABLE source_state (
  source_id       TEXT PRIMARY KEY,
  cursor          TEXT,                      -- ETag, Last-Modified, CKAN metadata_modified or date
  last_ok_at      TEXT,
  purge_version   INTEGER                    -- rule version of last person-record purge. See deleteParties in src/db.ts
);

CREATE TABLE source_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  first_page      INTEGER NOT NULL,          -- 1 = first page of run
  status          TEXT NOT NULL CHECK (status IN ('ok', 'unchanged', 'error')),
  items_seen      INTEGER NOT NULL DEFAULT 0,
  items_new       INTEGER NOT NULL DEFAULT 0,
  items_dropped   INTEGER NOT NULL DEFAULT 0, -- enforcement rows with no company marker
  error           TEXT
);

CREATE INDEX source_runs_recent ON source_runs (source_id, started_at DESC);

-- No row = new. acting/done = useful, dismissed = not useful (priority labels).
CREATE TABLE triage (
  item_id    TEXT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('acting', 'done', 'dismissed')),
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
