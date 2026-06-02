BEGIN;

CREATE TABLE ai_command_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  preview_run_id UUID NOT NULL UNIQUE REFERENCES ai_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed')),
  result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT ai_command_executions_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE
);

CREATE INDEX ai_command_executions_workspace_created_idx
  ON ai_command_executions (org_id, workspace_id, created_at DESC);

INSERT INTO schema_migrations (filename)
VALUES ('0002_ai_command_executions.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
