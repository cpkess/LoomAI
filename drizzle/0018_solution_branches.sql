-- Rounds become a tree: a steer can fork from any round, and a comparison round
-- has several parents rather than one. parent_solution_id stays the primary
-- lineage link; merged_from lists every round a comparison weighs.
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS merged_from jsonb;
