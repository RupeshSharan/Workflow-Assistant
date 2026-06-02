import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";

const fieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "boolean",
  "user"
]);

const createFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    fieldType: fieldTypeSchema,
    isRequired: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    appliesToTypeId: z.string().uuid().nullable().optional()
  })
  .superRefine((field, context) => {
    if (["select", "multi_select"].includes(field.fieldType) && field.options.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Select fields require at least one option."
      });
    }
  });

interface CustomFieldRow {
  id: string;
  name: string;
  fieldType: string;
  isRequired: boolean;
  options: string[];
  appliesToTypeId: string | null;
  appliesToTypeName: string | null;
}

export const customFieldRouter = Router();

customFieldRouter.use(authenticate, requireWorkspaceContext);

customFieldRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const result = await query<CustomFieldRow>(
      `SELECT cf.id,
              cf.name,
              cf.field_type AS "fieldType",
              cf.is_required AS "isRequired",
              cf.options_json AS options,
              cf.applies_to_type_id AS "appliesToTypeId",
              wit.name AS "appliesToTypeName"
         FROM custom_fields cf
         LEFT JOIN work_item_types wit ON wit.id = cf.applies_to_type_id
        WHERE cf.org_id = $1
          AND cf.workspace_id = $2
          AND cf.deleted_at IS NULL
        ORDER BY cf.name`,
      [tenant.orgId, tenant.workspaceId]
    );
    response.json({ fields: result.rows });
  })
);

customFieldRouter.post(
  "/",
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = createFieldSchema.parse(request.body);

    if (input.appliesToTypeId) {
      const type = await query(
        `SELECT id FROM work_item_types
          WHERE id = $1 AND org_id = $2 AND workspace_id = $3`,
        [input.appliesToTypeId, tenant.orgId, tenant.workspaceId]
      );
      if (!type.rowCount) {
        throw new HttpError(400, "Selected work item type is not in this workspace.");
      }
    }

    const field = await withTransaction(async (client) => {
      const inserted = await client.query<CustomFieldRow>(
        `INSERT INTO custom_fields
           (org_id, workspace_id, name, field_type, is_required, options_json, applies_to_type_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING id,
                   name,
                   field_type AS "fieldType",
                   is_required AS "isRequired",
                   options_json AS options,
                   applies_to_type_id AS "appliesToTypeId",
                   NULL::TEXT AS "appliesToTypeName"`,
        [
          tenant.orgId,
          tenant.workspaceId,
          input.name,
          input.fieldType,
          input.isRequired,
          JSON.stringify(input.options),
          input.appliesToTypeId ?? null
        ]
      );
      const created = inserted.rows[0]!;
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'custom_field.created', 'custom_field', $4, $5::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          created.id,
          JSON.stringify({ name: input.name, fieldType: input.fieldType })
        ]
      );
      return created;
    });

    response.status(201).json({ field });
  })
);

customFieldRouter.delete(
  "/:id",
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const fieldId = z.string().uuid().parse(request.params.id);
    const deleted = await withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE custom_fields
            SET deleted_at = NOW()
          WHERE id = $1
            AND org_id = $2
            AND workspace_id = $3
            AND deleted_at IS NULL
          RETURNING id`,
        [fieldId, tenant.orgId, tenant.workspaceId]
      );
      if (!result.rowCount) {
        return false;
      }
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id)
         VALUES ($1, $2, $3, 'custom_field.deleted', 'custom_field', $4)`,
        [tenant.orgId, tenant.workspaceId, request.auth!.id, fieldId]
      );
      return true;
    });
    if (!deleted) {
      throw new HttpError(404, "Custom field was not found.");
    }
    response.status(204).send();
  })
);
