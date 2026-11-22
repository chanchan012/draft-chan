export const interchangeFormats = ["typed-dxf", "ifc"] as const;
export type InterchangeFormat = (typeof interchangeFormats)[number];

export function interchangeDownloadPath(
  planId: string,
  revision: number,
  format: InterchangeFormat,
  storeyId?: string,
) {
  const query = new URLSearchParams({ format, revision: String(revision) });
  if (storeyId && format === "typed-dxf") query.set("storeyId", storeyId);
  return (
    "/api/floorplans/" + encodeURIComponent(planId) + "/interchange?" + query
  );
}
