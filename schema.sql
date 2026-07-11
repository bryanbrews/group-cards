-- Group greeting cards schema
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,                 -- 10-char base36
  admin_token TEXT NOT NULL UNIQUE,    -- 32-hex via crypto.getRandomValues
  sign_token  TEXT NOT NULL UNIQUE,    -- legacy name; sign/view are both "share" tokens now
  view_token  TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  cover_image TEXT,                    -- data URL, <= 1.2M chars (~900KB)
  cover_thumb TEXT,                    -- small data URL for the gallery (<= 80K chars)
  is_private INTEGER NOT NULL DEFAULT 0, -- 1 = hidden from the gallery (link-only)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS card_entries (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  font TEXT NOT NULL DEFAULT 'caveat',   -- server allowlist
  color TEXT NOT NULL DEFAULT 'ink',     -- server allowlist
  media_type TEXT,                       -- 'photo'|'doodle'|'gif'|NULL
  media_data TEXT,                       -- data URL (photo/doodle)
  gif_url TEXT,                          -- allowlisted https URL (gif)
  edit_token TEXT NOT NULL,              -- returned once to author
  position INTEGER NOT NULL DEFAULT 0,   -- legacy V1 ordering only
  kind TEXT,                             -- 'text'|'photo'|'gif'|'doodle'; NULL = legacy V1 bundled note
  page INTEGER,                          -- 0-based inside-page index
  slot INTEGER,                          -- 0-3 in the page's 2x2 grid (0 TL, 1 TR, 2 BL, 3 BR)
  size INTEGER,                          -- 1|2|4 page fraction for media kinds; NULL = 1 (quarter)
  created_at INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE INDEX IF NOT EXISTS idx_card_entries_card ON card_entries(card_id, position, created_at);
-- one item per spot; legacy NULL pages don't collide (SQLite treats NULLs as distinct)
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_entries_slot ON card_entries(card_id, page, slot);
