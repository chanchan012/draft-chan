import type { Underlay } from "@/lib/plans/model";

export type UnderlayPreview = Pick<
  Underlay,
  "name" | "source" | "raster" | "width" | "height"
>;
const maxEdge = 1600;

function jpeg(canvas: HTMLCanvasElement) {
  for (const quality of [0.86, 0.7, 0.5, 0.35, 0.2]) {
    const raster = canvas.toDataURL("image/jpeg", quality);
    if (raster.length <= 500000 && raster.startsWith("data:image/jpeg;base64,"))
      return raster;
  }
  throw new Error("This page is too detailed for the underlay size limit.");
}

async function rasterPdf(data: ArrayBuffer, pageNumber: number) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    // The PDF.js worker module has no type declarations.
    // @ts-expect-error Worker types are internal to PDF.js.
    import("pdfjs-dist/build/pdf.worker.min.mjs"),
  ]);
  // Self-contained rendering also works when external scripts are blocked.
  const runtime = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
  runtime.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler };
  const loading = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    enableXfa: false,
    maxImageSize: 16_000_000,
    useWorkerFetch: false,
  });
  try {
    const document = await loading.promise;
    if (pageNumber > document.numPages)
      throw new Error("The PDF has " + document.numPages + " pages.");
    const page = await document.getPage(pageNumber);
    const native = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: maxEdge / Math.max(native.width, native.height),
    });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({
      canvas,
      viewport,
      annotationMode: pdfjs.AnnotationMode.DISABLE,
    }).promise;
    return { width: canvas.width, height: canvas.height, raster: jpeg(canvas) };
  } finally {
    await loading.destroy();
  }
}

export async function previewUnderlay(
  file: File,
  page: number,
): Promise<UnderlayPreview> {
  if (!file.size || file.size > 20_000_000)
    throw new Error("Choose a PDF or image up to 20 MB.");
  const name =
    file.name
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .trim()
      .slice(0, 120) || "Underlay";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (!Number.isInteger(page) || page < 1 || page > 1000)
      throw new Error("Enter a PDF page from 1 to 1000.");
    return {
      name,
      source: { kind: "pdf", page },
      ...(await rasterPdf(await file.arrayBuffer(), page)),
    };
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PDF, JPEG, PNG or WebP.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const graphics = canvas.getContext("2d", { alpha: false });
    if (!graphics) throw new Error("The image could not be drawn.");
    graphics.fillStyle = "#ffffff";
    graphics.fillRect(0, 0, canvas.width, canvas.height);
    graphics.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      name,
      source: { kind: "image" },
      width: canvas.width,
      height: canvas.height,
      raster: jpeg(canvas),
    };
  } finally {
    bitmap.close();
  }
}
