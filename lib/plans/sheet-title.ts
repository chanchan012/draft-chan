import { paperSize } from "./drawing-documents";
import type { Sheet } from "./model";
import type { DrawingPrimitive } from "./sheet-drawing";

export function paperTitleBlock(
  sheet: Sheet,
  project: string,
  revisionLabel: string,
): DrawingPrimitive[] {
  const { width, height } = paperSize(sheet);
  const left = 6;
  const right = width - 6;
  const top = height - 24;
  const bottom = height - 6;
  const widthOfNumberCell = 37;
  const division = right - widthOfNumberCell;
  return [
    {
      kind: "path",
      closed: true,
      weight: 0.25,
      points: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    },
    {
      kind: "path",
      weight: 0.25,
      points: [
        { x: division, y: top },
        { x: division, y: bottom },
      ],
    },
    {
      kind: "text",
      size: 2.6,
      at: { x: left + 3, y: top + 4.5 },
      text: sheet.project ?? project,
    },
    {
      kind: "text",
      size: 3.6,
      at: { x: left + 3, y: top + 10.5 },
      text: sheet.name,
    },
    {
      kind: "text",
      size: 2.5,
      at: { x: left + 3, y: top + 15.5 },
      text: [revisionLabel, sheet.drawnBy].filter(Boolean).join("  |  "),
    },
    {
      kind: "text",
      size: 4.1,
      at: { x: right - 3, y: top + 8 },
      text: sheet.number,
      align: "end",
    },
    {
      kind: "text",
      size: 2.5,
      at: { x: right - 3, y: top + 14 },
      text: sheet.size + "  |  mm",
      align: "end",
    },
  ];
}
