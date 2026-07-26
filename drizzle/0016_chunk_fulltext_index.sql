-- Hybrid retrieval runs a full-text query alongside the vector search. Without
-- this index that's a sequential scan over every chunk in the deployment.
CREATE INDEX IF NOT EXISTS document_chunks_content_fts_idx
  ON document_chunks USING gin (to_tsvector('english', content));
