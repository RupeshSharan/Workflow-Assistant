BEGIN;

CREATE TABLE webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret_token TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);

CREATE INDEX webhook_subscriptions_workspace_idx ON webhook_subscriptions (workspace_id);

INSERT INTO schema_migrations (filename)
VALUES ('0005_webhook_subscriptions.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
