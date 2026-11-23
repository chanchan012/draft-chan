import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { floorplanExports } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  failBlueprint,
  getBlueprintFile,
  renderQueuedBlueprint,
  requestBlueprint,
  unconfirmedBlueprints,
} from "../lib/server/blueprint-store";
import { plans } from "../lib/server/plans";
import { studioSnapshot } from "../lib/plans/studio-document";
import { sheetFixture } from "./sheet-fixture";

let db: ReturnType<typeof drizzle>;
vi.mock("../db/client", () => ({ openDatabase: () => db }));
const digest = (artifact: string) =>
  createHash("sha256").update(Buffer.from(artifact, "base64")).digest("hex");

it("restores a database backup and reissues the same archived PDF after a failed attempt", async () => {
  const original = new PGlite();
  let restored: PGlite | undefined;
  const owner = "user_restore_fixture";
  const id = crypto.randomUUID();
  try {
    db = drizzle(original);
    await migrate(db, { migrationsFolder: "./db/migrations" });
    await plans.create(owner, { id, name: "Recovery fixture" });
    expect(
      await plans.saveStudio(owner, id, {
        revision: 0,
        ...studioSnapshot(sheetFixture(), "mm"),
      }),
    ).toEqual({ status: "saved", revision: 1 });
    expect(await plans.rename(owner, id, 1, "Current design")).toMatchObject({
      revision: 2,
    });
    const issued = await requestBlueprint(owner, id, {
      revision: 1,
      format: "pdf",
    });
    if (issued.status !== "accepted" || !issued.queue)
      throw new Error("Expected a queued PDF");
    const jobId = issued.blueprint.id;
    await db
      .update(floorplanExports)
      .set({ requestedAt: new Date(0) })
      .where(eq(floorplanExports.id, jobId));
    const backup = await original.dumpDataDir("gzip");
    expect(await renderQueuedBlueprint(issued.queue)).toEqual({
      written: true,
    });
    const first = await getBlueprintFile(owner, id, jobId);
    if (!first?.artifact) throw new Error("Expected the issued PDF");

    restored = new PGlite({ loadDataDir: backup });
    db = drizzle(restored);
    await restored.waitReady;
    expect(await plans.getStudio(owner, id)).toMatchObject({
      name: "Current design",
      revision: 2,
    });
    expect(await unconfirmedBlueprints()).toContainEqual({
      id: jobId,
      attempt: 1,
    });
    await failBlueprint({ id: jobId, attempt: 1 });
    expect(
      await requestBlueprint(owner, id, { revision: 1, format: "pdf" }),
    ).toMatchObject({
      status: "accepted",
      queue: { id: jobId, attempt: 2 },
    });
    expect(await renderQueuedBlueprint({ id: jobId, attempt: 1 })).toEqual({
      written: false,
    });
    const duplicates = await Promise.all(
      [2, 2].map((attempt) => renderQueuedBlueprint({ id: jobId, attempt })),
    );
    expect(duplicates.filter(({ written }) => written)).toHaveLength(1);
    const reproduced = await getBlueprintFile(owner, id, jobId);
    if (!reproduced?.artifact) throw new Error("Expected a reproduced PDF");
    expect(digest(reproduced.artifact)).toEqual(digest(first.artifact));
    const pdf = await PDFDocument.load(
      Buffer.from(reproduced.artifact, "base64"),
    );
    expect(pdf.getTitle()).toBe("Recovery fixture | Source revision 1");
    expect(pdf.getPageCount()).toBe(4);
    expect(await getBlueprintFile("other-user", id, jobId)).toBeNull();
  } finally {
    await restored?.close();
    await original.close();
  }
}, 30_000);
