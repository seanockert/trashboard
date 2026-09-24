-- One row for each regulatory change or enforcement record.
CREATE TABLE items (
  id              TEXT PRIMARY KEY,          -- "<source_id>:<external id>"
  source_id       TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('regulatory', 'enforcement')),
  jurisdiction    TEXT NOT NULL,             -- CTH, QLD, NSW, VIC, SA, WA, TAS, NT, ACT
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  published_at    TEXT,                      -- ISO date from the source
  body            TEXT NOT NULL DEFAULT '',  -- source text, truncated
  detail_url      TEXT,                      -- a page with the full text, fetched after insert
  detail_fetched_at TEXT,
  party           TEXT,                      -- enforcement: the company named in the record
  party_group     TEXT,                      -- known group from the alias list, else NULL. Enforcement: the party. Regulatory: a group that the text names
  group_version   INTEGER,                   -- the alias list version that gave party_group
  action          TEXT,                      -- enforcement: penalty notice, prosecution, order and so on
  location        TEXT,                      -- enforcement: site or suburb
  penalty_source_aud   REAL,                 -- enforcement: the amount that the source columns state
  penalty_selected_aud REAL,                 -- enforcement: the amount that Jev selected from the text. NULL until tags or after a text change
  penalty_aud     REAL GENERATED ALWAYS AS (COALESCE(penalty_source_aud, penalty_selected_aud)) VIRTUAL,
  waste_activity  INTEGER NOT NULL DEFAULT 0, -- enforcement: the source states a waste activity
  content_hash    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  tag_version     INTEGER,                   -- NULL until Jev tags the item
  tagged_at       TEXT,
  answers         TEXT,                      -- JSON: raw Jev answers, keyed by question id
  summary         TEXT,                      -- JSON: AI card summary { what, points }. NULL until made or after a text change
  summary_version INTEGER,                   -- NULL until the summary step runs
  closes_on       TEXT,                      -- regulatory: the last day for submissions. NULL when the text states no such date
  starts_on       TEXT                       -- regulatory: the day the rule starts to apply. NULL when the text states no such date
);

CREATE INDEX items_kind_date ON items (kind, published_at DESC);
CREATE INDEX items_untagged ON items (tag_version) WHERE tag_version IS NULL;
CREATE INDEX items_party_group ON items (party_group) WHERE party_group IS NOT NULL;
CREATE INDEX items_source ON items (source_id);
CREATE INDEX items_closes_on ON items (closes_on) WHERE closes_on IS NOT NULL;
CREATE INDEX items_starts_on ON items (starts_on) WHERE starts_on IS NOT NULL;

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

-- What each source last saw, so that a run fetches only what changed.
CREATE TABLE source_state (
  source_id       TEXT PRIMARY KEY,
  cursor          TEXT,                      -- ETag, Last-Modified, CKAN metadata_modified or a date
  last_ok_at      TEXT
);

CREATE TABLE source_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  first_page      INTEGER NOT NULL,          -- 1 for the first page of a run, 0 for the pages after it
  status          TEXT NOT NULL CHECK (status IN ('ok', 'unchanged', 'error')),
  items_seen      INTEGER NOT NULL DEFAULT 0,
  items_new       INTEGER NOT NULL DEFAULT 0,
  items_dropped   INTEGER NOT NULL DEFAULT 0, -- enforcement rows with no company marker
  error           TEXT
);

CREATE INDEX source_runs_recent ON source_runs (source_id, started_at DESC);

-- The triage state of an item. No row: the item is new. Tags and text can change; the row stays.
-- "acting" and "done" mark an item as useful, "dismissed" as not useful. These are the labels that measure the priority.
CREATE TABLE triage (
  item_id    TEXT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('acting', 'done', 'dismissed')),
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
