import { it, expect } from "vitest";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  type PDFPage,
} from "pdf-lib";
import { schedules } from "../lib/plans/construction-schedules";
import { pointsPerMillimeter, renderSheetSet } from "../lib/server/sheet-pdf";
import { sheetFixture } from "./sheet-fixture";

function pageContents(page: PDFPage) {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => page.doc.context.lookup(ref))
      : [contents];
  return streams
    .map((stream) => {
      if (!(stream instanceof PDFRawStream))
        throw new Error("Expected a PDF content stream");
      return Buffer.from(decodePDFRawStream(stream).decode()).toString("ascii");
    })
    .join("\n");
}

const textToken = (value: string) =>
  "<" + Buffer.from(value, "ascii").toString("hex").toUpperCase() + ">";

it("renders exact A3 vector paper coordinates and repeats opening tags in schedules", async () => {
  const plan = sheetFixture();
  const current = schedules(plan);
  expect(current.doors[0]).toMatchObject({ tag: "D-01", widthMm: 900 });
  expect(current.windows[0]).toMatchObject({ tag: "W-03", sillMm: 900 });
  expect(current.finishes[0]).toMatchObject({
    room: "Living room",
    floor: "Oak parquet",
    netAreaM2: 14.0544,
  });
  const bytes = await renderSheetSet(plan, "Test project", 7);
  expect(await renderSheetSet(plan, "Test project", 7)).toEqual(bytes);
  const pdf = await PDFDocument.load(bytes);
  const [a3, doors, windows, finishes] = pdf.getPages();
  expect(pdf.getPageCount()).toBe(4);
  expect(a3.getWidth() / pointsPerMillimeter).toBeCloseTo(420, 10);
  expect(a3.getHeight() / pointsPerMillimeter).toBeCloseTo(297, 10);
  const content = pageContents(a3);
  const firstWall = content.match(
    /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) m\n(\d+(?:\.\d+)?) \2 l$/m,
  );
  expect(firstWall).not.toBeNull();
  expect(
    Math.abs(Number(firstWall![3]) - Number(firstWall![1])) /
      pointsPerMillimeter,
  ).toBeCloseTo(100, 10);
  for (const label of [
    "A101",
    "Oak House",
    "Source revision 7  |  Casey",
    "5000",
    "D-01",
    "W-03",
  ])
    expect(content).toContain(textToken(label));
  expect(content).not.toMatch(/\/Image|\bDo\b/);
  expect(pageContents(doors)).toContain(textToken("D-01"));
  expect(pageContents(windows)).toContain(textToken("W-03"));
  expect(pageContents(finishes)).toContain(textToken("Oak parquet"));
});

it("validates the sheet and title block before starting a render", async () => {
  const plan = sheetFixture();
  plan.documentItems = plan.documentItems!.map((item) =>
    item.kind === "viewport" ? { ...item, height: 270 } : item,
  );
  await expect(renderSheetSet(plan, "Project", 1)).rejects.toThrow("24 mm");
});
