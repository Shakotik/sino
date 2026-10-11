-- Personal collections are independent from the public HSK and BKRS catalogs.
-- Until password/OAuth login is added, ownership is proven by a random browser
-- capability. Only its SHA-256 hash is stored; a supplied profile ID is never trusted.
CREATE SCHEMA IF NOT EXISTS personal;

CREATE TABLE IF NOT EXISTS personal.accounts (
  id uuid PRIMARY KEY,
  capability_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personal.cards (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES personal.accounts(id) ON DELETE CASCADE,
  hanzi varchar(64) NOT NULL,
  pinyin varchar(160) NOT NULL DEFAULT '',
  translation_ru varchar(1000) NOT NULL,
  notes varchar(2000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, hanzi),
  UNIQUE (id, owner_id)
);

CREATE TABLE IF NOT EXISTS personal.card_progress (
  card_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  known boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  correct_answers integer NOT NULL DEFAULT 0 CHECK (correct_answers >= 0 AND correct_answers <= attempts),
  repetitions integer NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  interval_days integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  due_at timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  FOREIGN KEY (card_id, owner_id) REFERENCES personal.cards(id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS personal_cards_owner_updated_idx ON personal.cards (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS personal_progress_owner_due_idx ON personal.card_progress (owner_id, due_at);

-- A retried request after a lost connection must not count the same answer twice.
CREATE TABLE IF NOT EXISTS personal.review_receipts (
  request_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  card_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id),
  FOREIGN KEY (card_id, owner_id) REFERENCES personal.cards(id, owner_id) ON DELETE CASCADE
);
