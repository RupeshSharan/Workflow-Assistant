import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import type { TenantContext } from "../domain/types.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";

type FieldType = "text" | "number" | "date" | "select" | "multi_select" | "boolean" | "user";

interface FieldRow {
  id: string;
  name: string;
  fieldType: FieldType;
  isRequired: boolean;
  options: string[];
  value: unknown;
}

interface NormalizedValue {
  valueText: string | null;
  valueNumber: number | null;
  valueJson: unknown | null;
  historyValue: unknown | null;
}

const valuesSchema = z
  .object({
    values: z
      .array(
        z.object({
          customFieldId: z.string().uuid(),
          value: z.unknown()
        })
      )
      .min(1)
      .max(100)
  })
  .superRefine((input, context) => {
    const ids = new Set<string>();
    for (const [index, field] of input.values.entries()) {
      if (ids.has(field.customFieldId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["values", index, "customFieldId"],
          message: "A custom field can only be submitted once."
        });
      }
      ids.add(field.customFieldId);
    }
  });

async function getItemType(itemId: string, tenant: TenantContext): Promise<string> {
  const item = await query<{ type_id: string }>(
    `SELECT type_id
       FROM work_items
      WHERE id = $1
        AND org_id = $2
        AND workspace_id = $3
        AND deleted_at IS NULL`,
    [itemId, tenant.orgId, tenant.workspaceId]
  );
  if (!item.rowCount) {
    throw new HttpError(404, "Work item was not found.");
  }
  return item.rows[0]!.type_id;
}

async function listItemFields(itemId: string, tenant: TenantContext, typeId: string): Promise<FieldRow[]> {
  const fields = await query<FieldRow>(
    `SELECT cf.id,
            cf.name,
            cf.field_type AS "fieldType",
            cf.is_required AS "isRequired",
            cf.options_json AS options,
            CASE
              WHEN cf.field_type = 'number' THEN TO_JSONB(value.value_number)
              WHEN cf.field_type IN ('text', 'date', 'select', 'user') THEN TO_JSONB(value.value_text)
              ELSE value.value_json
            END AS value
       FROM custom_fields cf
       LEFT JOIN work_item_custom_field_values value
         ON value.custom_field_id = cf.id
        AND value.work_item_id = $1
      WHERE cf.org_id = $2
        AND cf.workspace_id = $3
        AND cf.deleted_at IS NULL
        AND (cf.applies_to_type_id IS NULL OR cf.applies_to_type_id = $4)
      ORDER BY cf.name`,
    [itemId, tenant.orgId, tenant.workspaceId, typeId]
  );
  return fields.rows;
}

function normalizeValue(field: FieldRow, value: unknown): NormalizedValue {
  if (value === null || value === undefined || value === "") {
    if (field.isRequired) {
      throw new HttpError(400, `${field.name} is required.`);
    }
    return { valueText: null, valueNumber: null, valueJson: null, historyValue: null };
  }

  if (field.fieldType === "text") {
    if (typeof value !== "string" || value.length > 5000) {
      throw new HttpError(400, `${field.name} must be text.`);
    }
    return { valueText: value, valueNumber: null, valueJson: null, historyValue: value };
  }
  if (field.fieldType === "date") {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new HttpError(400, `${field.name} must be a valid date.`);
    }
    return { valueText: value, valueNumber: null, valueJson: null, historyValue: value };
  }
  if (field.fieldType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new HttpError(400, `${field.name} must be a number.`);
    }
    return { valueText: null, valueNumber: value, valueJson: null, historyValue: value };
  }
  if (field.fieldType === "boolean") {
    if (typeof value !== "boolean") {
      throw new HttpError(400, `${field.name} must be true or false.`);
    }
    return { valueText: null, valueNumber: null, valueJson: value, historyValue: value };
  }
  if (field.fieldType === "select") {
    if (typeof value !== "string" || !field.options.includes(value)) {
      throw new HttpError(400, `${field.name} must match an available option.`);
    }
    return { valueText: value, valueNumber: null, valueJson: null, historyValue: value };
  }
  if (field.fieldType === "multi_select") {
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === "string" && field.options.includes(entry))
    ) {
      throw new HttpError(400, `${field.name} must contain only available options.`);
    }
    return { valueText: null, valueNumber: null, valueJson: value, historyValue: value };
  }
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) {
    throw new HttpError(400, `${field.name} must identify a workspace member.`);
  }
  return { valueText: value, valueNumber: null, valueJson: null, historyValue: value };
}

async function assertUserValueMembership(
  client: PoolClient,
  field: FieldRow,
  normalized: NormalizedValue,
  tenant: TenantContext
): Promise<void> {
  if (field.fieldType !== "user" || !normalized.valueText) {
    return;
  }
  const member = await client.query(
    `SELECT id
       FROM memberships
      WHERE org_id = $1 AND workspace_id = $2 AND user_id = $3`,
    [tenant.orgId, tenant.workspaceId, normalized.valueText]
  );
  if (!member.rowCount) {
    throw new HttpError(400, `${field.name} must identify a workspace member.`);
  }
}

export const workItemFieldRouter = Router();

workItemFieldRouter.use(authenticate, requireWorkspaceContext);

workItemFieldRouter.get(
  "/:id/custom-fields",
  asyncHandler(async (request, response) => {
    const itemId = z.string().uuid().parse(request.params.id);
    const tenant = request.tenant!;
    const typeId = await getItemType(itemId, tenant);
    response.json({ fields: await listItemFields(itemId, tenant, typeId) });
  })
);

workItemFieldRouter.put(
  "/:id/custom-fields",
  requireRoles("owner", "admin", "manager", "member"),
  asyncHandler(async (request, response) => {
    const itemId = z.string().uuid().parse(request.params.id);
    const tenant = request.tenant!;
    const input = valuesSchema.parse(request.body);

    const typeId = await getItemType(itemId, tenant);
    const availableFields = await listItemFields(itemId, tenant, typeId);
    const fieldsById = new Map(availableFields.map((field) => [field.id, field]));

    await withTransaction(async (client) => {
      for (const submitted of input.values) {
        const field = fieldsById.get(submitted.customFieldId);
        if (!field) {
          throw new HttpError(400, "A custom field is not available for this work item.");
        }
        const normalized = normalizeValue(field, submitted.value);
        await assertUserValueMembership(client, field, normalized, tenant);

        await client.query(
          `INSERT INTO work_item_custom_field_values
             (work_item_id, custom_field_id, value_text, value_number, value_json)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (work_item_id, custom_field_id)
           DO UPDATE SET
             value_text = EXCLUDED.value_text,
             value_number = EXCLUDED.value_number,
             value_json = EXCLUDED.value_json,
             updated_at = NOW()`,
          [
            itemId,
            field.id,
            normalized.valueText,
            normalized.valueNumber,
            normalized.valueJson === null ? null : JSON.stringify(normalized.valueJson)
          ]
        );
        await client.query(
          `INSERT INTO work_item_history
             (work_item_id, changed_by, field_name, old_value, new_value)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            itemId,
            request.auth!.id,
            `custom_field:${field.id}`,
            field.value === null ? null : JSON.stringify(field.value),
            normalized.historyValue === null ? null : JSON.stringify(normalized.historyValue)
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'work_item.custom_fields.updated', 'work_item', $4, $5::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          itemId,
          JSON.stringify({ fieldIds: input.values.map((field) => field.customFieldId) })
        ]
      );
    });

    response.json({ fields: await listItemFields(itemId, tenant, typeId) });
  })
);
