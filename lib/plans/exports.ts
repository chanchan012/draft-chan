import { z } from "zod";

export const blueprintFormat = z.enum(["dxf", "svg"]);
export const exportRevision = z.int().nonnegative().max(2_147_483_647);
export const requestBlueprintSchema = z.strictObject({
  format: blueprintFormat,
  revision: exportRevision,
});
export const blueprintStatuses = ["pending", "ready", "failed"] as const;
export const blueprintSchema = requestBlueprintSchema.extend({
  id: z.uuid(),
  status: z.enum(blueprintStatuses),
});
export type Blueprint = z.infer<typeof blueprintSchema>;
export type BlueprintFormat = z.infer<typeof blueprintFormat>;
export type BlueprintRequest = z.infer<typeof requestBlueprintSchema>;

export function exportFilename(
  name: string,
  revision: number,
  format: BlueprintFormat | "csv",
) {
  const stem =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 64)
      .replace(/^-+|-+$/g, "") || "floorplan";
  const kind = format === "csv" ? "-bom" : "";
  return `${stem}-r${revision}${kind}.${format}`;
}
