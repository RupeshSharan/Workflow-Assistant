BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_lower_email_unique_idx ON users (LOWER(email));

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'organization')),
  settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (id, org_id)
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'admin', 'manager', 'member', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memberships_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX memberships_workspace_user_unique_idx
  ON memberships (workspace_id, user_id)
  WHERE workspace_id IS NOT NULL;
CREATE UNIQUE INDEX memberships_org_user_unique_idx
  ON memberships (org_id, user_id)
  WHERE workspace_id IS NULL;

CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT workflow_templates_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE,
  UNIQUE (id, org_id, workspace_id)
);

CREATE UNIQUE INDEX workflow_templates_default_category_idx
  ON workflow_templates (org_id, workspace_id, COALESCE(category, ''))
  WHERE is_default = TRUE AND deleted_at IS NULL;

CREATE TABLE workflow_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  sla_hours INTEGER CHECK (sla_hours IS NULL OR sla_hours >= 0),
  color TEXT NOT NULL DEFAULT '#64748b',
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, position),
  UNIQUE (id, template_id)
);

CREATE TABLE workflow_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  from_stage_id UUID NOT NULL,
  to_stage_id UUID NOT NULL,
  rule_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transitions_from_stage_fk
    FOREIGN KEY (from_stage_id, template_id)
    REFERENCES workflow_stages(id, template_id)
    ON DELETE CASCADE,
  CONSTRAINT transitions_to_stage_fk
    FOREIGN KEY (to_stage_id, template_id)
    REFERENCES workflow_stages(id, template_id)
    ON DELETE CASCADE,
  CHECK (from_stage_id <> to_stage_id),
  UNIQUE (template_id, from_stage_id, to_stage_id)
);

CREATE TABLE work_item_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  default_template_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT work_item_types_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT work_item_types_default_template_fk
    FOREIGN KEY (default_template_id, org_id, workspace_id)
    REFERENCES workflow_templates(id, org_id, workspace_id),
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (workspace_id, name)
);

CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  type_id UUID NOT NULL,
  template_id UUID NOT NULL,
  current_stage_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id UUID REFERENCES users(id),
  reporter_id UUID NOT NULL REFERENCES users(id),
  due_date TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT work_items_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT work_items_type_tenant_fk
    FOREIGN KEY (type_id, org_id, workspace_id)
    REFERENCES work_item_types(id, org_id, workspace_id),
  CONSTRAINT work_items_template_tenant_fk
    FOREIGN KEY (template_id, org_id, workspace_id)
    REFERENCES workflow_templates(id, org_id, workspace_id),
  CONSTRAINT work_items_current_stage_fk
    FOREIGN KEY (current_stage_id, template_id)
    REFERENCES workflow_stages(id, template_id)
);

CREATE INDEX work_items_workspace_stage_idx
  ON work_items (org_id, workspace_id, current_stage_id)
  WHERE deleted_at IS NULL;
CREATE INDEX work_items_workspace_due_idx
  ON work_items (org_id, workspace_id, due_date)
  WHERE deleted_at IS NULL;

CREATE TABLE work_item_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES users(id),
  field_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX work_item_history_item_changed_idx
  ON work_item_history (work_item_id, changed_at DESC);

CREATE TABLE custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL
    CHECK (field_type IN ('text', 'number', 'date', 'select', 'multi_select', 'boolean', 'user')),
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  options_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  applies_to_type_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT custom_fields_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT custom_fields_type_tenant_fk
    FOREIGN KEY (applies_to_type_id, org_id, workspace_id)
    REFERENCES work_item_types(id, org_id, workspace_id),
  UNIQUE (id, org_id, workspace_id)
);

CREATE TABLE work_item_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value_text TEXT,
  value_number NUMERIC,
  value_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (work_item_id, custom_field_id)
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  mentions_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  file_url TEXT,
  content_text TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'indexed', 'failed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT documents_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE,
  UNIQUE (id, org_id, workspace_id)
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  storage_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_text TEXT NOT NULL,
  embedding_vector VECTOR(768),
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding_vector vector_cosine_ops);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  context_type TEXT,
  context_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE,
  UNIQUE (id, org_id, workspace_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  tool_calls_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  model_name TEXT NOT NULL,
  task_type TEXT NOT NULL,
  input_json JSONB NOT NULL,
  output_json JSONB,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  tokens_in INTEGER CHECK (tokens_in IS NULL OR tokens_in >= 0),
  tokens_out INTEGER CHECK (tokens_out IS NULL OR tokens_out >= 0),
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_runs_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE
);

CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  condition_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  action_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_rules_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE
);

CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  provider TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integrations_workspace_org_fk
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES workspaces(id, org_id)
    ON DELETE CASCADE,
  UNIQUE (workspace_id, provider)
);

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id UUID NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  correction_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ai_run_id, user_id)
);

CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE INDEX workflow_templates_workspace_idx
  ON workflow_templates (org_id, workspace_id)
  WHERE deleted_at IS NULL;
CREATE INDEX comments_work_item_idx ON comments (work_item_id, created_at);
CREATE INDEX documents_workspace_idx
  ON documents (org_id, workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX ai_runs_workspace_idx ON ai_runs (org_id, workspace_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX audit_logs_org_created_idx ON audit_logs (org_id, created_at DESC);

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflow_templates_updated_at
  BEFORE UPDATE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflow_stages_updated_at
  BEFORE UPDATE ON workflow_stages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_item_types_updated_at
  BEFORE UPDATE ON work_item_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_items_updated_at
  BEFORE UPDATE ON work_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER custom_fields_updated_at
  BEFORE UPDATE ON custom_fields
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_item_custom_field_values_updated_at
  BEFORE UPDATE ON work_item_custom_field_values
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER automation_rules_updated_at
  BEFORE UPDATE ON automation_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO schema_migrations (filename)
VALUES ('0001_initial.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
