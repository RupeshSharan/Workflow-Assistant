import type { PoolClient } from "pg";

export async function seedStarterWorkflow(
  client: PoolClient,
  organizationId: string,
  workspaceId: string,
  userId: string
): Promise<void> {
  const template = await client.query<{ id: string }>(
    `INSERT INTO workflow_templates
       (org_id, workspace_id, name, description, category, is_default, created_by)
     VALUES ($1, $2, 'Standard Work', 'A configurable starter workflow.', 'general', TRUE, $3)
     RETURNING id`,
    [organizationId, workspaceId, userId]
  );
  const templateId = template.rows[0]!.id;

  const stages: Array<{ name: string; color: string; terminal: boolean }> = [
    { name: "Backlog", color: "#64748b", terminal: false },
    { name: "In Progress", color: "#2563eb", terminal: false },
    { name: "Done", color: "#16a34a", terminal: true }
  ];
  const stageIds: string[] = [];

  for (const [position, stage] of stages.entries()) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO workflow_stages (template_id, name, position, color, is_terminal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [templateId, stage.name, position, stage.color, stage.terminal]
    );
    stageIds.push(inserted.rows[0]!.id);
  }

  await client.query(
    `INSERT INTO workflow_transitions (template_id, from_stage_id, to_stage_id)
     VALUES ($1, $2, $3), ($1, $3, $4), ($1, $3, $2)`,
    [templateId, stageIds[0], stageIds[1], stageIds[2]]
  );

  await client.query(
    `INSERT INTO work_item_types
       (org_id, workspace_id, name, description, icon, default_template_id)
     VALUES ($1, $2, 'Task', 'General-purpose tracked work.', 'check-square', $3)`,
    [organizationId, workspaceId, templateId]
  );
}
