BEGIN;

-- AI Decision Log: records every AI recommendation and its outcome
CREATE TABLE ai_decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  ai_run_id UUID REFERENCES ai_runs(id),
  recommendation TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'chat',
  sources TEXT[] NOT NULL DEFAULT '{}',
  outcome TEXT CHECK (outcome IN ('accepted', 'rejected', 'pending', 'helpful', 'not_helpful')),
  outcome_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT ai_decision_log_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_ai_decision_log_workspace ON ai_decision_log (workspace_id, org_id);
CREATE INDEX idx_ai_decision_log_created ON ai_decision_log (created_at DESC);

-- Goals: workspace goals with deadlines and AI tracking
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT goals_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_goals_workspace ON goals (workspace_id, org_id);

INSERT INTO schema_migrations (filename)
VALUES ('0006_goals_and_decision_log.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
