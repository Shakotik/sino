-- Additive migration: existing cards and their progress are never replaced.
BEGIN;
CREATE TABLE IF NOT EXISTS personal.folders (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES personal.accounts(id) ON DELETE CASCADE,
  title varchar(80) NOT NULL CHECK (char_length(btrim(title)) >= 2),
  enrolled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS personal_folder_owner_title_idx
  ON personal.folders (owner_id, lower(title));
ALTER TABLE personal.cards ADD COLUMN IF NOT EXISTS folder_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_card_folder_owner_fk') THEN
    ALTER TABLE personal.cards ADD CONSTRAINT personal_card_folder_owner_fk
      FOREIGN KEY (folder_id, owner_id) REFERENCES personal.folders(id, owner_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS personal_card_folder_idx ON personal.cards(owner_id, folder_id);
ALTER TABLE personal.card_progress ADD COLUMN IF NOT EXISTS first_learned_at timestamptz;
-- Recover the first successful self-assessment only when a saved receipt exists.
UPDATE personal.card_progress AS progress SET first_learned_at = learned.at
FROM (SELECT card_id, min(created_at) AS at FROM personal.review_receipts
      WHERE result->>'known' = 'true' GROUP BY card_id) AS learned
WHERE progress.card_id = learned.card_id AND progress.first_learned_at IS NULL;
COMMIT;
