BEGIN;

CREATE TABLE workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'manager', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (LOWER(email));
CREATE INDEX workspace_invitations_token_idx ON workspace_invitations (token);

ALTER TABLE work_items 
  ADD COLUMN last_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN last_sla_warning_sent_at TIMESTAMPTZ;

INSERT INTO schema_migrations (filename)
VALUES ('0003_invitations_and_scheduled_jobs.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
