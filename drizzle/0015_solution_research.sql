-- Deep research: the record of what was researched (questions, per-question
-- coverage, rounds run, per-channel counts, and citation grounding stats).
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS research jsonb;
