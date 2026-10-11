-- БКРС и БРуКС намеренно живут отдельно от catalog.*: это справочный
-- словарь, а не набор учебных слов HSK. HSK может ссылаться на него позже,
-- но не владеет его статьями.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS dictionary;

CREATE TABLE IF NOT EXISTS dictionary.sources (
  id bigserial PRIMARY KEY,
  code varchar(60) NOT NULL UNIQUE,
  title varchar(200) NOT NULL,
  version varchar(60) NOT NULL,
  source_file_sha256 char(64) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  license_note text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS dictionary.entries (
  id bigserial PRIMARY KEY,
  source_id bigint NOT NULL REFERENCES dictionary.sources(id),
  direction varchar(10) NOT NULL CHECK (direction IN ('zh-ru', 'ru-zh')),
  headword text NOT NULL,
  headword_normalized text NOT NULL,
  pinyin text,
  pinyin_normalized text,
  article text NOT NULL,
  article_search tsvector GENERATED ALWAYS AS (to_tsvector('russian', article)) STORED,
  entry_hash char(64) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, direction, entry_hash)
);

-- First query path: exact word and prefix. It is fast for the most common
-- Chinese and Russian searches and can use a small B-tree index.
CREATE INDEX IF NOT EXISTS dictionary_entries_direction_headword_index
  ON dictionary.entries (direction, headword_normalized text_pattern_ops);

-- Second query path: pinyin without tones and partial matches inside a word.
-- GIN trigram keeps searches like "xuexi" and "учит" responsive.
CREATE INDEX IF NOT EXISTS dictionary_entries_headword_trgm_index
  ON dictionary.entries USING gin (headword_normalized gin_trgm_ops);

CREATE INDEX IF NOT EXISTS dictionary_entries_pinyin_trgm_index
  ON dictionary.entries USING gin (pinyin_normalized gin_trgm_ops)
  WHERE pinyin_normalized IS NOT NULL;

-- Russian full-text search remains available without making every request scan
-- the full multi-million-entry dictionary.
CREATE INDEX IF NOT EXISTS dictionary_entries_article_search_index
  ON dictionary.entries USING gin (article_search);

CREATE TABLE IF NOT EXISTS dictionary.import_runs (
  id bigserial PRIMARY KEY,
  source_file_name text NOT NULL,
  source_file_sha256 char(64) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  zh_ru_entries integer NOT NULL DEFAULT 0,
  ru_zh_entries integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text
);

-- Browser/API users do not receive direct database access. This future role is
-- limited to SELECT in the dictionary schema.
-- Managed hosting (Render) may forbid CREATE ROLE; the app does not need
-- this role to run, so the grant is skipped there instead of failing deploy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dictionary_api') THEN
    CREATE ROLE dictionary_api NOLOGIN;
  END IF;
  GRANT USAGE ON SCHEMA dictionary TO dictionary_api;
  GRANT SELECT ON dictionary.sources, dictionary.entries TO dictionary_api;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'dictionary_api role was not created: insufficient privilege';
END $$;
