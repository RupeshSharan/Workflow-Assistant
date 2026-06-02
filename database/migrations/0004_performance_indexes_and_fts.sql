BEGIN;

-- 1. Generated search vector column for full-text search on work_items
ALTER TABLE work_items 
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED;

CREATE INDEX work_items_search_idx ON work_items USING gin(search_vector);

-- 2. Generated search vector column for full-text search on documents
ALTER TABLE documents 
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_text, ''))
  ) STORED;

CREATE INDEX documents_search_idx ON documents USING gin(search_vector);

-- 3. Composite index on work_items for assignee due date and status checks (overdue queries)
CREATE INDEX work_items_assignee_due_idx ON work_items (assignee_id, due_date) WHERE closed_at IS NULL AND deleted_at IS NULL;

-- 4. Composite index on work_items for stage bottlenecks and SLA warnings
CREATE INDEX work_items_stage_bottlenecks_idx ON work_items (current_stage_id, created_at, closed_at) WHERE deleted_at IS NULL;

-- 5. Index on notifications for user and reverse creation order
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);

-- 6. Index on audit_logs for workspace specific activity timeline queries
CREATE INDEX audit_logs_workspace_created_idx ON audit_logs (workspace_id, created_at DESC);

-- Register migration
INSERT INTO schema_migrations (filename)
VALUES ('0004_performance_indexes_and_fts.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
