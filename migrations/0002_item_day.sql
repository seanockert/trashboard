-- The day of an item, for the date filters. With the index, a view reads only
-- the items in its period, not all items. See DAY_SQL in src/db.ts.
ALTER TABLE items ADD COLUMN day TEXT GENERATED ALWAYS AS (COALESCE(published_at, substr(first_seen_at, 1, 10))) VIRTUAL;
CREATE INDEX items_day ON items (day);
