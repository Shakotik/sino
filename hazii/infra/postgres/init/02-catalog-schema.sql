-- Каталог учебных материалов. Этот файл автоматически применяется, если
-- PostgreSQL запускается на новом пустом Docker-томе.

CREATE TABLE IF NOT EXISTS catalog.hsk_levels (
  id uuid PRIMARY KEY,
  version varchar(40) NOT NULL,
  level_number smallint NOT NULL CHECK (level_number > 0),
  title varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version, level_number)
);

CREATE TABLE IF NOT EXISTS catalog.lexemes (
  id uuid PRIMARY KEY,
  hsk_level_id uuid NOT NULL REFERENCES catalog.hsk_levels(id),
  source_number integer NOT NULL CHECK (source_number > 0),
  written_form varchar(64) NOT NULL,
  pinyin varchar(128) NOT NULL,
  part_of_speech varchar(100),
  source_english_gloss text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hsk_level_id, source_number)
);

CREATE TABLE IF NOT EXISTS catalog.lexeme_senses (
  id uuid PRIMARY KEY,
  lexeme_id uuid NOT NULL REFERENCES catalog.lexemes(id) ON DELETE CASCADE,
  language varchar(10) NOT NULL,
  meaning text NOT NULL,
  position smallint NOT NULL DEFAULT 1 CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lexeme_id, language, position)
);

CREATE INDEX IF NOT EXISTS lexemes_hsk_level_id_index
  ON catalog.lexemes(hsk_level_id, source_number);

CREATE INDEX IF NOT EXISTS lexeme_senses_lexeme_id_index
  ON catalog.lexeme_senses(lexeme_id, language);
