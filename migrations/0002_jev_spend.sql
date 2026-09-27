-- Jev input tokens for each Brisbane day. Tagging and search together.
CREATE TABLE jev_spend (
  day          TEXT PRIMARY KEY,           -- "YYYY-MM-DD", Australia/Brisbane
  input_tokens INTEGER NOT NULL DEFAULT 0
);
