import { randomBytes } from "node:crypto";

export function uniqueOrganizationSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 42) || "organization";

  return `${base}-${randomBytes(3).toString("hex")}`;
}
