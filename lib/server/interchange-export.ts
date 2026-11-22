import { exportFilename } from "../plans/exports";
import type { StudioDocument } from "../plans/studio-document";
import { renderTypedDxf } from "../plans/typed-dxf";
import { renderIfc } from "./ifc-export";

import type { InterchangeFormat } from "../plans/interchange-export";

export function interchangeFile(
  document: StudioDocument,
  format: InterchangeFormat,
  storeyId?: string,
) {
  const stem = exportFilename(document.name, document.revision, "dxf").slice(
    0,
    -4,
  );
  return format === "ifc"
    ? {
        filename: stem + ".ifc",
        type: "application/x-step",
        content: renderIfc(document),
      }
    : {
        filename: stem + "-model.dxf",
        type: "application/dxf",
        content: renderTypedDxf(document.graph, storeyId),
      };
}
