import {
  PDFDocument,
  StandardFonts,
  clip,
  closePath,
  endPath,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setDashPattern,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  issueSheets,
  schedules,
  scheduleTables,
} from "../plans/construction-schedules";
import type { DraftPlanState } from "../plans/model";
import { paperDrawing, type DrawingPrimitive } from "../plans/sheet-drawing";
import { paperTitleBlock } from "../plans/sheet-title";

export const pointsPerMillimeter = 72 / 25.4;
const pt = (mm: number) => mm * pointsPerMillimeter;
const ink = rgb(0.1, 0.15, 0.13);
const sheetTextSize = 3;

function printable(text: string, font: PDFFont) {
  return [...text.normalize("NFC")]
    .map((char) => {
      try {
        font.encodeText(char);
        return char;
      } catch {
        return "?";
      }
    })
    .join("");
}

function fit(text: string, size: number, width: number, font: PDFFont) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let last = text.length - 1;
  while (
    last &&
    font.widthOfTextAtSize(text.slice(0, last) + "…", size) > width
  )
    last--;
  return text.slice(0, last) + "…";
}

function renderPrimitives(
  page: PDFPage,
  font: PDFFont,
  primitives: DrawingPrimitive[],
  limitMm?: number,
) {
  const height = page.getHeight();
  for (const item of primitives) {
    if (item.kind === "text") {
      const size = pt(item.size);
      const maximum = pt(
        limitMm ?? page.getWidth() / pointsPerMillimeter - item.at.x - 5,
      );
      const raw = printable(item.text, font);
      const text = item.align ? raw : fit(raw, size, maximum, font);
      const width = font.widthOfTextAtSize(text, size);
      const offset =
        item.align === "middle" ? width / 2 : item.align === "end" ? width : 0;
      page.drawText(text, {
        x: pt(item.at.x) - offset,
        y: height - pt(item.at.y),
        font,
        size,
        color: ink,
      });
      continue;
    }
    const [first, ...rest] = item.points;
    if (!first || !rest.length) continue;
    const fill =
      item.fill &&
      [1, 3, 5].map((i) => parseInt(item.fill!.slice(i, i + 2), 16) / 255);
    page.pushOperators(
      setStrokingRgbColor(ink.red, ink.green, ink.blue),
      setLineWidth(pt(item.weight)),
      setDashPattern((item.dash ?? []).map(pt), 0),
      ...(fill ? [setFillingRgbColor(fill[0], fill[1], fill[2])] : []),
      moveTo(pt(first.x), height - pt(first.y)),
      ...rest.map(({ x, y }) => lineTo(pt(x), height - pt(y))),
      ...(item.closed ? [closePath()] : []),
      fill ? fillAndStroke() : stroke(),
    );
  }
}

export async function renderSheetSet(
  plan: DraftPlanState,
  project: string,
  revision: number,
) {
  const sheets = issueSheets(plan);
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const title = "Source revision " + revision;
  pdf.setTitle(project + " | " + title);
  pdf.setProducer("Draft");
  for (const sheet of sheets) {
    const drawing = paperDrawing(plan, sheet);
    const page = pdf.addPage([pt(drawing.width), pt(drawing.height)]);
    for (const { viewport, primitives, name } of drawing.panels) {
      const { x, y, width, height } = viewport;
      page.pushOperators(
        pushGraphicsState(),
        rectangle(
          pt(x),
          page.getHeight() - pt(y + height),
          pt(width),
          pt(height),
        ),
        clip(),
        endPath(),
      );
      renderPrimitives(page, font, primitives);
      page.pushOperators(popGraphicsState());
      renderPrimitives(
        page,
        font,
        [
          {
            kind: "path",
            closed: true,
            points: [
              { x, y },
              { x: x + width, y },
              { x: x + width, y: y + height },
              { x, y: y + height },
            ],
            weight: 0.18,
          },
          {
            kind: "text",
            at: { x: x + 2, y: y + height - 2 },
            text: name + " | 1:" + viewport.scale,
            size: sheetTextSize,
          },
        ],
        width - 4,
      );
    }
    renderPrimitives(
      page,
      font,
      paperTitleBlock(sheet, project, title),
      drawing.width - 54,
    );
  }

  for (const table of scheduleTables(schedules(plan))) {
    if (!table.rows.length) continue;
    const perPage = 32;
    for (let i = 0; i < table.rows.length; i += perPage) {
      const page = pdf.addPage([pt(420), pt(297)]);
      const primitives: DrawingPrimitive[] = [
        { kind: "text", at: { x: 12, y: 18 }, text: table.title, size: 5 },
        {
          kind: "text",
          at: { x: 12, y: 25 },
          text: project + " | " + title,
          size: 3,
        },
        {
          kind: "text",
          at: { x: 408, y: 280 },
          text:
            i / perPage + 1 + " / " + Math.ceil(table.rows.length / perPage),
          size: 3,
          align: "end",
        },
      ];
      const columns = table.columns.length;
      const width = 396 / columns;
      const drawCells = (cells: string[], y: number) => {
        cells.forEach((value, j) =>
          primitives.push({
            kind: "text",
            at: { x: 12 + j * width, y },
            size: 3,
            text: fit(printable(value, font), pt(3), pt(width - 4), font),
          }),
        );
        primitives.push({
          kind: "path",
          points: [
            { x: 12, y: y + 2 },
            { x: 408, y: y + 2 },
          ],
          weight: 0.15,
        });
      };
      drawCells(table.columns, 35);
      table.rows
        .slice(i, i + perPage)
        .forEach((row, index) => drawCells(row, 42 + index * 7));
      renderPrimitives(page, font, primitives);
    }
  }
  return pdf.save({ useObjectStreams: false });
}
