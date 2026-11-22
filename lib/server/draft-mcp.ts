import {
  McpServer,
  ResourceNotFoundError,
  type CallToolResult,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  cadEditCommands,
  cadEditOptions,
  type CadEdit,
} from "../plans/cad-edit";
import {
  finishRoom,
  scheduleKinds,
  schedules,
} from "../plans/construction-schedules";
import {
  createDrawingReference,
  referenceMetadata,
} from "../plans/drawing-references";
import {
  interchangeDownloadPath,
  type InterchangeFormat,
} from "../plans/interchange-export";
import { interchangeFile } from "./interchange-export";
import { dxfImportCommands, dxfUnits, stageDxf } from "../plans/dxf-import";
import {
  underlayMetadata,
  underlayPoint,
  underlayTransform,
} from "../plans/underlays";
import { ConstraintConflict, constraintReport } from "../plans/constraints";
import { summarizeChanges } from "../plans/change-summary";
import { calculateBom } from "../plans/bom";
import {
  fixtureCatalog,
  fixtureKinds,
  utilityCatalog,
  utilityKinds,
} from "../plans/catalog";
import { checkClearances } from "../plans/clearance";
import { createDraftPlanStore } from "../plans/command-store";
import { exportRevision } from "../plans/exports";
import {
  furnishRoom,
  joinWalls,
  roomPresets,
  spatialAudit,
  splitWall,
  wallById,
} from "../plans/agent-geometry";
import {
  modelPointInput,
  underlayCalibrationInput,
  underlayInput,
  wallInput,
  doorInput,
  windowInput,
  fixtureInput,
  utilityInput,
  annotationInput,
  constraintInput,
  buildingElements,
  documentItems,
  type DocumentItem,
  type Sheet,
  buildingViews,
  type BuildingElement,
  type BuildingView,
  storeyInput,
  storeyIdInput,
  wallTypeInput,
  wallReferenceInput,
  drawingLayerInput,
  blockInput,
  blockPlacementInput,
  sketchFields,
  type SketchGeometry,
  type DraftActor,
  type DraftPlanState,
  type PlanCommand,
  type Point,
} from "../plans/model";
import { documentMarks, paperDrawing } from "../plans/sheet-drawing";
import { deriveBuildingView } from "../plans/building-views";
import { openingsForSlab } from "../plans/building";
import { querySpaces } from "../plans/spaces";
import { planStoreys, storeyPlan, storeyById } from "../plans/storeys";
import { pointAlong } from "../plans/openings";
import {
  entityKinds,
  inspectEntity,
  lengthUnits,
  measurePoints,
  measureWallEdges,
  modelPrecision,
  queryEntities,
  resolveSnap,
  snapKinds,
  wallEdges,
} from "../plans/precision";
import {
  saveStudioSchema,
  studioSnapshot,
  type StudioDocument,
} from "../plans/studio-document";
import type { AgentScope } from "./agent-tokens";
import {
  createPreview,
  newBatchId,
  operationsSchema,
  prepareBatch,
  readPreview,
} from "./agent-transactions";
import { revisionStore, type BatchReceipt } from "./revision-store";
import {
  getBlueprintStatus,
  listSheetIssues,
  requestBlueprint,
} from "./blueprint-store";
import { queueBlueprint } from "./blueprint-jobs";
import { liveBus, planChannel, publishPlanPresence } from "./live-bus";
import { plans } from "./plans";
import { queueThumbnail } from "./thumbnails";

const objectId = z.string().trim().min(1).max(128);
const preciseCoordinate = z.number().finite().min(-1_010_000).max(1_010_000);
const precisePoint = z.strictObject({
  x: preciseCoordinate,
  y: preciseCoordinate,
});
const wallEdgeReference = z.strictObject({
  wallId: objectId,
  edge: z.enum(wallEdges),
});
const revision = {
  expectedRevision: exportRevision.describe(
    "Current revision from floorplan-graph.",
  ),
};
const catalog = {
  fixtures: fixtureCatalog,
  utilities: utilityCatalog,
  roomPresets,
};
type AgentEdit = {
  plan: DraftPlanState;
  cursor?: Point;
  cursorStoreyId?: string;
  result?: object;
};

export interface DraftMcpBackend {
  get: typeof plans.getStudio;
  transactions?: typeof revisionStore;
  save: typeof plans.saveStudio;
  publish(
    scope: AgentScope,
    revision: number,
    cursor?: Point,
    storeyId?: string,
  ): Promise<void>;
  exportDxf(scope: AgentScope, revision: number): Promise<object>;
}

export const draftMcpBackend: DraftMcpBackend = {
  get: plans.getStudio,
  transactions: revisionStore,
  save: plans.saveStudio,
  async publish(scope, revision, cursor, storeyId) {
    const { owner, planId, agentId } = scope;
    const work = [
      liveBus.publish(planChannel(owner, planId), {
        type: "revision",
        revision,
      }),
      queueThumbnail(planId),
    ];
    if (cursor)
      work.push(
        publishPlanPresence(
          owner,
          planId,
          { kind: "ai", id: agentId },
          { clientId: agentId, cursor, storeyId },
        ),
      );
    await Promise.allSettled(work);
  },
  async exportDxf({ owner, planId }, revision) {
    const requested = await requestBlueprint(owner, planId, {
      format: "dxf",
      revision,
    });
    if (requested.status !== "accepted")
      throw new ToolFailure(
        "revision_conflict",
        "Read the latest floorplan revision and try again.",
      );
    if (requested.queue) await queueBlueprint(requested.queue).catch(() => {});
    return {
      export: requested.blueprint,
      downloadPath: `/api/floorplans/${planId}/exports/${requested.blueprint.id}/download`,
    };
  },
};

class ToolFailure extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly details?: object,
  ) {
    super(message);
  }
}
function result(value: object, error = false): CallToolResult {
  return {
    isError: error,
    structuredContent: value as Record<string, unknown>,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

export function createDraftMcp(scope: AgentScope, backend = draftMcpBackend) {
  const server = new McpServer(
    { name: "draft-studio", version: "0.1.0" },
    {
      instructions:
        "Use floorplan-graph to get the current revision and object IDs. Geometry uses millimeters. Write tools require a saved revision or a matching preview token. Read the graph again after a revision conflict.",
    },
  );
  const actor: DraftActor = { kind: "ai", id: scope.agentId };
  const { owner, planId } = scope;
  async function current() {
    const doc = await backend.get(owner, planId);
    if (!doc)
      throw new ToolFailure(
        "plan_unavailable",
        "The connected floorplan is unavailable.",
      );
    return doc;
  }
  function commands(doc: StudioDocument, edits: readonly PlanCommand[]) {
    const store = createDraftPlanStore(doc.graph);
    store.getState().executeBatch(edits, actor);
    return store.getState().plan;
  }
  function resource(
    name: string,
    description: string,
    read: () => Promise<object>,
  ) {
    server.registerResource(
      name,
      "draft://" + name,
      { description, mimeType: "application/json" },
      async (uri) => {
        try {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify(await read()),
              },
            ],
          };
        } catch (error) {
          if (error instanceof ToolFailure)
            throw new ResourceNotFoundError(uri.href);
          throw error;
        }
      },
    );
  }
  function tool<T extends z.ZodType>(
    name: string,
    description: string,
    inputSchema: T,
    readOnlyHint: boolean,
    run: (input: z.output<T>) => Promise<object>,
  ) {
    const invoke = (async (input: z.output<T>) => {
      try {
        return result(await run(input));
      } catch (error) {
        return result(
          error instanceof ToolFailure
            ? { code: error.reason, message: error.message, ...error.details }
            : {
                code: "temporarily_unavailable",
                message:
                  "Draft could not complete the request. Read the latest revision before retrying.",
              },
          true,
        );
      }
    }) as ToolCallback<T>;
    server.registerTool(
      name,
      {
        inputSchema,
        description,
        annotations: {
          readOnlyHint,
          destructiveHint: !readOnlyHint,
          ...(name === "apply_changes" ? { idempotentHint: true } : {}),
          openWorldHint: false,
        },
      },
      invoke,
    );
  }
  function edit<T extends z.ZodType<{ expectedRevision: number }>>(
    name: string,
    description: string,
    schema: T,
    transform: (doc: StudioDocument, input: z.output<T>) => AgentEdit,
  ) {
    tool(name, description, schema, false, async (input) => {
      const doc = await current();
      if (doc.revision !== input.expectedRevision)
        throw new ToolFailure(
          "revision_conflict",
          "Read floorplan-graph and retry with its current revision.",
        );
      let changed: AgentEdit;
      let snapshot;
      try {
        changed = transform(doc, input);
        snapshot = saveStudioSchema.parse({
          revision: doc.revision,
          ...studioSnapshot(changed.plan, doc.unit),
        });
      } catch (error) {
        if (error instanceof ConstraintConflict)
          throw new ToolFailure("constraint_conflict", error.message, {
            constraintIds: error.constraintIds,
          });
        throw new ToolFailure(
          "invalid_geometry",
          error instanceof Error ? error.message : "Invalid geometry.",
        );
      }
      const saved = await backend.save(owner, planId, snapshot, actor);
      if (saved.status === "conflict")
        throw new ToolFailure(
          "revision_conflict",
          "Another editor saved first. Read floorplan-graph and retry.",
        );
      if (saved.status === "invalid")
        throw new ToolFailure("invalid_geometry", saved.error);
      await backend
        .publish(scope, saved.revision, changed.cursor, changed.cursorStoreyId)
        .catch(() => {});
      return { planId, revision: saved.revision, ...changed.result };
    });
  }

  resource(
    "floorplan-graph",
    "Saved floorplan geometry and revision in model millimeters.",
    async () => {
      const doc = await current();
      return {
        ...doc,
        graph: {
          ...doc.graph,
          underlays: doc.graph.underlays?.map(underlayMetadata),
          drawingReferences:
            doc.graph.drawingReferences?.map(referenceMetadata),
        },
      };
    },
  );
  resource(
    "spatial-audit",
    "Room areas, modeled doorway widths, and room adjacency.",
    async () => {
      const doc = await current();
      return { planId, revision: doc.revision, ...spatialAudit(doc.graph) };
    },
  );
  resource(
    "catalog",
    "Furniture, electrical, plumbing, and room presets.",
    async () => catalog,
  );

  function writeDocument(
    doc: StudioDocument,
    items: DocumentItem[],
  ): AgentEdit {
    const itemIds = items.map(({ id }) => id);
    if (new Set(itemIds).size !== itemIds.length)
      throw new Error("Use distinct item IDs.");
    return {
      plan: commands(
        doc,
        items.map((item) => ({ type: "document.write", item })),
      ),
      result: { itemIds },
    };
  }
  edit(
    "dimension_chain",
    "Create or update a storey dimension chain with wall endpoints, opening or fixture centers, or fixed millimeter points. The offset places the chain outside its anchors.",
    z.strictObject({
      ...revision,
      chain: documentItems[0].omit({ kind: true }),
    }),
    (doc, { chain }) => writeDocument(doc, [{ kind: "chain", ...chain }]),
  );
  edit(
    "add_leader",
    "Create or update a leader label tied to a storey geometry anchor.",
    z.strictObject({
      ...revision,
      leader: documentItems[1].omit({ kind: true }),
    }),
    (doc, { leader }) => writeDocument(doc, [{ kind: "leader", ...leader }]),
  );
  edit(
    "tag_entities",
    "Associate unique tags with native doors, windows or fixtures. Writes all tags in one revision.",
    z.strictObject({
      ...revision,
      tags: z
        .array(documentItems[2].omit({ kind: true }))
        .min(1)
        .max(64),
    }),
    (doc, { tags }) =>
      writeDocument(
        doc,
        tags.map((tag) => ({ kind: "tag", ...tag })),
      ),
  );
  edit(
    "add_hatch",
    "Create or update a diagonal or crosshatch clipped to a simple model-space polygon.",
    z.strictObject({
      ...revision,
      hatch: documentItems[3].omit({ kind: true }),
    }),
    (doc, { hatch }) => writeDocument(doc, [{ kind: "hatch", ...hatch }]),
  );
  edit(
    "save_named_view",
    "Save a storey plan, section or elevation view with a center in drawing millimeters. Vertical views use negative elevation on the Y axis.",
    z.strictObject({
      ...revision,
      view: documentItems[4].omit({ kind: true }),
    }),
    (doc, { view }) => writeDocument(doc, [{ kind: "view", ...view }]),
  );
  edit(
    "create_sheet",
    "Create or update a numbered A2, A3 or A4 drawing sheet with an explicit orientation.",
    z.strictObject({
      ...revision,
      sheet: documentItems[5].omit({ kind: true }),
    }),
    (doc, { sheet }) => writeDocument(doc, [{ kind: "sheet", ...sheet }]),
  );
  edit(
    "place_viewport",
    "Place or update a named view on a sheet. Use paper millimeters from top left and a scale denominator such as 50 for 1:50.",
    z.strictObject({
      ...revision,
      viewport: documentItems[6].omit({ kind: true }),
    }),
    (doc, { viewport }) =>
      writeDocument(doc, [{ kind: "viewport", ...viewport }]),
  );
  edit(
    "remove_document_items",
    "Remove annotation, viewport, named view or sheet IDs together. Include dependent viewports when deleting their sheet or view.",
    z.strictObject({ ...revision, ids: z.array(objectId).min(1).max(64) }),
    (doc, { ids }) => ({
      plan: commands(
        doc,
        [...new Set(ids)].map((id) => ({ type: "document.remove", id })),
      ),
      result: { ids },
    }),
  );
  tool(
    "query_drawing_documents",
    "List drawing items and unresolved anchors, or read a sheet's clipped viewport definitions and vector coordinates in paper millimeters.",
    z.strictObject({ sheetId: objectId.optional() }),
    true,
    async ({ sheetId }) => {
      const doc = await current();
      const items = doc.graph.documentItems ?? [];
      const details = { planId, revision: doc.revision };
      if (!sheetId)
        return {
          ...details,
          items,
          unresolved: planStoreys(doc.graph).flatMap(
            ({ id }) => documentMarks(doc.graph, id, 50).unresolved,
          ),
        };
      const sheet = items.find(
        (item): item is Sheet => item.kind === "sheet" && item.id === sheetId,
      );
      if (!sheet)
        throw new ToolFailure(
          "entity_unavailable",
          "The sheet is unavailable.",
        );
      return { ...details, ...paperDrawing(doc.graph, sheet) };
    },
  );

  edit(
    "set_room_finish",
    "Assign floor, wall and ceiling finishes to the enclosed room at a model point on the specified storey.",
    z.strictObject({
      ...revision,
      finish: documentItems[7].omit({ kind: true }),
    }),
    (doc, { finish }) => {
      const item = { kind: "finish" as const, ...finish };
      if (!finishRoom(doc.graph, item))
        throw new Error("Use a point inside an enclosed room.");
      return writeDocument(doc, [item]);
    },
  );
  tool(
    "generate_schedule",
    "Read the door, window or room finish schedule at the current or a saved historical revision. Door and window rows reuse plan tags.",
    z.strictObject({
      kind: z.enum(scheduleKinds),
      revision: exportRevision.optional(),
      offset: z.int().nonnegative().default(0),
      limit: z.int().min(1).max(100).default(50),
    }),
    true,
    async ({ kind, revision, offset, limit }) => {
      const doc = await current();
      const source =
        revision === undefined || doc.revision === revision
          ? doc
          : (
              await (backend.transactions ?? revisionStore).revisions(
                scope,
                revision,
                revision,
              )
            )[0];
      if (!source)
        throw new ToolFailure(
          "revision_unavailable",
          "That source revision is unavailable.",
        );
      const rows = schedules(source.graph)[kind];
      return {
        planId,
        revision: source.revision,
        kind,
        total: rows.length,
        rows: rows.slice(offset, offset + limit),
      };
    },
  );
  tool(
    "publish_sheet_set",
    "Queue a vector PDF issue of the sheet set and schedules from a saved revision. Subsequent requests reuse the same issue.",
    z.strictObject({ ...revision }),
    false,
    async ({ expectedRevision }) => {
      const requested = await requestBlueprint(owner, planId, {
        format: "pdf",
        revision: expectedRevision,
      });
      if (requested.status === "invalid")
        throw new ToolFailure("invalid_sheet_set", requested.error);
      if (requested.status !== "accepted")
        throw new ToolFailure(
          "revision_unavailable",
          "That source revision is unavailable.",
        );
      if (requested.queue)
        await queueBlueprint(requested.queue).catch(() => {});
      return {
        planId,
        issue: requested.blueprint,
        downloadPath: `/api/floorplans/${planId}/exports/${requested.blueprint.id}/download`,
      };
    },
  );
  tool(
    "get_job_status",
    "Read the status and source revision for a queued PDF, SVG or DXF job on the connected floorplan.",
    z.strictObject({ jobId: z.uuid() }),
    true,
    async ({ jobId }) => {
      const job = await getBlueprintStatus(owner, planId, jobId);
      if (!job)
        throw new ToolFailure(
          "job_unavailable",
          "The export job is unavailable.",
        );
      return {
        planId,
        job,
        downloadPath: `/api/floorplans/${planId}/exports/${jobId}/download`,
      };
    },
  );
  tool(
    "list_sheet_issues",
    "List up to 100 PDF issues for the connected floorplan, newest source revision first.",
    z.strictObject({}),
    true,
    async () => {
      const issues = await listSheetIssues(owner, planId);
      if (!issues)
        throw new ToolFailure(
          "plan_unavailable",
          "The connected floorplan is unavailable.",
        );
      return { planId, issues };
    },
  );

  const dxfSource = {
    dxf: z.string().min(1).max(39_000),
    units: z.enum(dxfUnits).optional(),
  };
  tool(
    "inspect_import",
    "Inspect ASCII DXF source units, layers, skipped entities and a sample of supported geometry. For larger files use the Studio Interchange panel.",
    z.strictObject(dxfSource),
    true,
    async ({ dxf, units }) => {
      await current();
      try {
        const { shapes, ...report } = stageDxf(dxf, units);
        return {
          ...report,
          supportedGeometry: shapes.length,
          sample: shapes.slice(0, 20),
        };
      } catch (error) {
        throw new ToolFailure(
          "invalid_dxf",
          error instanceof Error ? error.message : "Invalid DXF.",
        );
      }
    },
  );
  edit(
    "import_dxf",
    "Import supported DXF geometry as native 2D sketches on named layers in one saved revision. Inspect the source and resolve units first.",
    z.strictObject({
      ...revision,
      ...dxfSource,
      storeyId: storeyIdInput,
      layers: z.array(z.string().max(80)).max(64).optional(),
    }),
    (doc, { dxf, units, storeyId, layers }) => {
      const staged = stageDxf(dxf, units);
      const { commands: edits, imported } = dxfImportCommands(
        doc.graph,
        staged,
        storeyById(doc.graph, storeyId).id,
        layers ??
          staged.layers
            .filter((item) => item.supported > 0)
            .map(({ name }) => name),
      );
      return {
        plan: commands(doc, edits),
        result: { imported, skipped: staged.unsupported },
      };
    },
  );
  edit(
    "attach_underlay",
    "Attach a small JPEG preview with its source metadata, calibration and storey. Use Studio for PDF rasterization or assets that exceed the MCP request limit.",
    z.strictObject({ ...revision, underlay: underlayInput }),
    (doc, { underlay }) => {
      if (doc.graph.underlays?.some((item) => item.id === underlay.id))
        throw new Error("That underlay ID is already attached.");
      return {
        plan: commands(doc, [{ type: "underlay.write", item: underlay }]),
        result: { underlay: underlayMetadata(underlay) },
      };
    },
  );
  edit(
    "calibrate_underlay",
    "Update the similarity transform using two image pixel and model millimeter pairs. Optionally return coordinates for a third check point.",
    z.strictObject({
      ...revision,
      id: objectId,
      calibration: underlayCalibrationInput,
      checkPixel: z
        .strictObject({
          x: z.number().min(0).max(2048),
          y: z.number().min(0).max(2048),
        })
        .optional(),
    }),
    (doc, { id, calibration, checkPixel }) => {
      const item = doc.graph.underlays?.find((underlay) => underlay.id === id);
      if (!item) throw new Error("The underlay is unavailable.");
      if (
        checkPixel &&
        (checkPixel.x > item.width || checkPixel.y > item.height)
      )
        throw new Error("The check point must be in the source preview.");
      return {
        plan: commands(doc, [
          { type: "underlay.write", item: { ...item, calibration } },
        ]),
        result: {
          id,
          transform: underlayTransform(calibration),
          ...(checkPixel && {
            checkModel: underlayPoint(calibration, checkPixel),
          }),
        },
      };
    },
  );
  tool(
    "list_underlays",
    "Read underlay source dimensions, placement, and calibration without their JPEG bytes.",
    z.strictObject({}),
    true,
    async () => {
      const doc = await current();
      return {
        planId,
        revision: doc.revision,
        underlays: (doc.graph.underlays ?? []).map(underlayMetadata),
      };
    },
  );
  edit(
    "remove_underlay",
    "Detach an underlay from the connected floorplan.",
    z.strictObject({ ...revision, id: objectId }),
    (doc, { id }) => ({
      plan: commands(doc, [{ type: "underlay.remove", id }]),
      result: { id },
    }),
  );

  edit(
    "attach_reference",
    "Attach a read-only snapshot from ASCII DXF to a storey. Drawing references do not join editable geometry.",
    z.strictObject({
      ...revision,
      ...dxfSource,
      id: objectId,
      name: z.string().trim().min(1).max(120),
      storeyId: storeyIdInput,
      offset: modelPointInput.optional(),
    }),
    (doc, input) => {
      if (doc.graph.drawingReferences?.some(({ id }) => id === input.id))
        throw new Error("That reference ID already exists.");
      const stage = stageDxf(input.dxf, input.units);
      const item = createDrawingReference(
        stage,
        input.name,
        storeyById(doc.graph, input.storeyId).id,
        input.id,
        undefined,
        undefined,
        input.offset,
      );
      return {
        plan: commands(doc, [{ type: "reference.write", item }]),
        result: {
          reference: referenceMetadata(item),
          skipped: stage.unsupported,
        },
      };
    },
  );
  edit(
    "refresh_reference",
    "Replace a reference's read-only DXF snapshot while retaining its storey, placement and visibility.",
    z.strictObject({
      ...revision,
      ...dxfSource,
      id: objectId,
      name: z.string().trim().min(1).max(120).optional(),
    }),
    (doc, input) => {
      const previous = doc.graph.drawingReferences?.find(
        ({ id }) => id === input.id,
      );
      if (!previous) throw new Error("The reference is unavailable.");
      const stage = stageDxf(input.dxf, input.units);
      const item = createDrawingReference(
        stage,
        input.name ?? previous.name,
        previous.storeyId,
        input.id,
        undefined,
        previous,
      );
      return {
        plan: commands(doc, [{ type: "reference.write", item }]),
        result: {
          reference: referenceMetadata(item),
          skipped: stage.unsupported,
        },
      };
    },
  );
  edit(
    "place_reference",
    "Set a read-only drawing reference's offset in millimeters and its visibility.",
    z.strictObject({
      ...revision,
      id: objectId,
      offset: modelPointInput,
      visible: z.boolean(),
    }),
    (doc, { id, offset, visible }) => {
      const item = doc.graph.drawingReferences?.find(
        (reference) => reference.id === id,
      );
      if (!item) throw new Error("The reference is unavailable.");
      const next = { ...item, offset, visible };
      return {
        plan: commands(doc, [{ type: "reference.write", item: next }]),
        result: { reference: referenceMetadata(next) },
      };
    },
  );
  edit(
    "detach_reference",
    "Detach a read-only drawing reference and retain editable model entities.",
    z.strictObject({ ...revision, id: objectId }),
    (doc, { id }) => ({
      plan: commands(doc, [{ type: "reference.remove", id }]),
      result: { id },
    }),
  );
  tool(
    "list_references",
    "List read-only drawing reference sources and placements for the current revision.",
    z.strictObject({}),
    true,
    async () => {
      const doc = await current();
      return {
        planId,
        revision: doc.revision,
        references: (doc.graph.drawingReferences ?? []).map(referenceMetadata),
      };
    },
  );

  async function exportInterchange(
    format: InterchangeFormat,
    revisionNumber: number,
    includeData: boolean,
    storeyId?: string,
  ) {
    const doc = await current();
    const source =
      doc.revision === revisionNumber
        ? doc
        : (
            await (backend.transactions ?? revisionStore).revisions(
              scope,
              revisionNumber,
              revisionNumber,
            )
          )[0];
    if (!source)
      throw new ToolFailure(
        "revision_unavailable",
        "That saved drawing revision is unavailable.",
      );
    if (format === "typed-dxf") {
      try {
        storeyById(source.graph, storeyId);
      } catch {
        throw new ToolFailure(
          "storey_unavailable",
          "That storey is unavailable in the saved revision.",
        );
      }
    }
    const path = interchangeDownloadPath(
      planId,
      revisionNumber,
      format,
      storeyId,
    );
    if (!includeData)
      return { planId, revision: revisionNumber, format, downloadPath: path };
    const file = interchangeFile(source, format, storeyId);
    return {
      planId,
      revision: revisionNumber,
      format,
      downloadPath: path,
      name: file.filename,
      mediaType: file.type,
      ...(file.content.length <= 120_000
        ? { content: file.content }
        : { note: "Download the full file from the signed-in Studio." }),
    };
  }
  tool(
    "export_typed_dxf",
    "Export an editable storey drawing with typed LINE, LWPOLYLINE, CIRCLE and ARC sketches and named layers.",
    z.strictObject({
      revision: exportRevision,
      storeyId: storeyIdInput,
      includeData: z.boolean().default(false),
    }),
    true,
    ({ revision, storeyId, includeData }) =>
      exportInterchange("typed-dxf", revision, includeData, storeyId),
  );
  tool(
    "export_ifc",
    "Export IFC4 for the saved building's storeys, walls with material types, hosted doors and windows, and slabs with modeled voids.",
    z.strictObject({
      revision: exportRevision,
      includeData: z.boolean().default(false),
    }),
    true,
    ({ revision, includeData }) =>
      exportInterchange("ifc", revision, includeData),
  );

  edit(
    "create_storey",
    "Add a named storey with a distinct elevation and wall height in millimeters. Legacy plans have a ground storey named Ground floor.",
    z.strictObject({
      ...revision,
      storey: storeyInput,
    }),
    (doc, { storey }) => {
      if (planStoreys(doc.graph).some((level) => level.id === storey.id))
        throw new Error("That storey ID already exists.");
      return {
        plan: commands(doc, [{ type: "storey.write", storey }]),
        result: { storeyId: storey.id },
      };
    },
  );
  edit(
    "update_storey",
    "Set the name, elevation and wall height of an existing storey.",
    z.strictObject({
      ...revision,
      storey: storeyInput,
    }),
    (doc, { storey }) => {
      storeyById(doc.graph, storey.id);
      return {
        plan: commands(doc, [{ type: "storey.write", storey }]),
        result: { storeyId: storey.id },
      };
    },
  );
  edit(
    "set_wall_type",
    "Define or update an assembly and optionally assign it to walls. A positive or negative reference is the matching face, and its authored coordinates stay fixed.",
    z
      .strictObject({
        ...revision,
        wallType: wallTypeInput.optional(),
        wallTypeId: objectId.nullable().optional(),
        wallIds: z.array(objectId).min(1).max(128).optional(),
        referenceLine: wallReferenceInput.optional(),
      })
      .refine((input) => Boolean(input.wallType || input.wallIds)),
    (doc, input) => {
      const batch: PlanCommand[] = [];
      if (input.wallType)
        batch.push({ type: "wall_type.write", wallType: input.wallType });
      for (const id of input.wallIds ?? []) {
        const wall = wallById(doc.graph, id);
        batch.push({
          type: "wall.assembly",
          id,
          wallTypeId:
            input.wallTypeId === undefined
              ? (input.wallType?.id ?? wall.wallTypeId ?? null)
              : input.wallTypeId,
          referenceLine: input.referenceLine ?? wall.referenceLine ?? "center",
        });
      }
      const plan = commands(doc, batch);
      return { plan, result: summarizeChanges(doc.graph, plan) };
    },
  );
  tool(
    "query_spaces",
    "Read storeys, enclosed reference boundaries, usable net polygons and gross enclosed floor areas. Optionally select one storey.",
    z.strictObject({
      storeyId: storeyIdInput,
    }),
    true,
    async ({ storeyId }) => {
      const doc = await current();
      if (storeyId) storeyById(doc.graph, storeyId);
      return {
        planId,
        revision: doc.revision,
        storeys: querySpaces(doc.graph, storeyId),
      };
    },
  );

  function writeBuilding(
    doc: StudioDocument,
    item: BuildingElement,
  ): AgentEdit {
    const plan = commands(doc, [{ type: "building.write", item }]);
    const slabId =
      item.kind === "slab"
        ? item.id
        : item.kind === "stair"
          ? item.openingSlabId
          : item.kind === "opening"
            ? item.slabId
            : undefined;
    return {
      plan,
      result: {
        elementId: item.id,
        ...(slabId ? { slabId, openings: openingsForSlab(plan, slabId) } : {}),
      },
    };
  }
  function writeView(doc: StudioDocument, view: BuildingView): AgentEdit {
    const plan = commands(doc, [{ type: "building.view", view }]);
    return { plan, result: { viewId: view.id } };
  }
  edit(
    "create_slab",
    "Create or replace a slab by ID. Supply a simple footprint in millimeters and a storey. Offset is measured from that storey's elevation to the slab top.",
    z.strictObject({
      ...revision,
      slab: buildingElements[0].omit({ kind: true }),
    }),
    (doc, { slab }) => writeBuilding(doc, { kind: "slab", ...slab }),
  );
  edit(
    "create_floor_opening",
    "Create or replace a polygonal opening inside a slab.",
    z.strictObject({
      ...revision,
      opening: buildingElements[1].omit({ kind: true }),
    }),
    (doc, { opening }) => writeBuilding(doc, { kind: "opening", ...opening }),
  );
  edit(
    "place_stair",
    "Place or move a straight stair by ID. A supplied openingSlabId cuts the stair footprint into the destination slab and updates on moves.",
    z.strictObject({
      ...revision,
      stair: buildingElements[2].omit({ kind: true }),
    }),
    (doc, { stair }) => writeBuilding(doc, { kind: "stair", ...stair }),
  );
  edit(
    "create_roof",
    "Create or replace a flat, shed or gable roof profile in model millimeters and degrees. The direction is clockwise from +X in plan.",
    z.strictObject({
      ...revision,
      roof: buildingElements[3].omit({ kind: true }),
    }),
    (doc, { roof }) => writeBuilding(doc, { kind: "roof", ...roof }),
  );
  edit(
    "create_section",
    "Save or replace a finite section cut from start to end in plan. Each derived section spans the building's storeys.",
    z.strictObject({
      ...revision,
      section: buildingViews[0].omit({ kind: true }),
    }),
    (doc, { section }) => writeView(doc, { kind: "section", ...section }),
  );
  edit(
    "create_elevation",
    "Save or replace an orthographic elevation from the given side of the building.",
    z.strictObject({
      ...revision,
      elevation: buildingViews[1].omit({ kind: true }),
    }),
    (doc, { elevation }) => writeView(doc, { kind: "elevation", ...elevation }),
  );
  edit(
    "remove_building_item",
    "Remove a structural element or view by ID. Slabs referenced by openings or stairs must be detached first.",
    z.strictObject({
      ...revision,
      id: objectId,
      collection: z.enum(["elements", "views"]),
    }),
    (doc, { id, collection }) => ({
      plan: commands(doc, [{ type: "building.remove", id, collection }]),
      result: { id },
    }),
  );
  tool(
    "query_building_view",
    "Get a derived section or elevation with model-space polygons. Omit viewId to list saved views and current slab openings.",
    z.strictObject({
      viewId: objectId.optional(),
    }),
    true,
    async ({ viewId }) => {
      const doc = await current();
      const views = doc.graph.buildingViews ?? [];
      if (viewId) {
        const view = views.find((item) => item.id === viewId);
        if (!view)
          throw new ToolFailure(
            "entity_unavailable",
            "The building view is unavailable.",
          );
        return {
          planId,
          revision: doc.revision,
          ...deriveBuildingView(doc.graph, view),
        };
      }
      return {
        planId,
        revision: doc.revision,
        views,
        slabs: (doc.graph.buildingElements ?? []).flatMap((item) =>
          item.kind === "slab"
            ? [{ ...item, openings: openingsForSlab(doc.graph, item.id) }]
            : [],
        ),
      };
    },
  );

  tool(
    "query_entities",
    "List entities at the saved revision. Bounds select overlapping envelopes in millimeters. Page with nextOffset on the same revision.",
    z.strictObject({
      kind: z.enum(entityKinds).optional(),
      storeyId: storeyIdInput,
      layer: objectId.optional(),
      bounds: z
        .strictObject({
          left: preciseCoordinate,
          top: preciseCoordinate,
          right: preciseCoordinate,
          bottom: preciseCoordinate,
        })
        .refine(
          ({ left, right, top, bottom }) => left <= right && top <= bottom,
        )
        .optional(),
      offset: z.int().min(0).max(100_000).default(0),
      limit: z.int().min(1).max(100).default(25),
    }),
    true,
    async (input) => {
      const doc = await current();
      return {
        planId,
        revision: doc.revision,
        ...queryEntities(
          input.storeyId
            ? storeyPlan(doc.graph, storeyById(doc.graph, input.storeyId).id)
            : doc.graph,
          input,
        ),
      };
    },
  );
  tool(
    "inspect_entity",
    "Inspect an entity by its stable kind and ID, including authored parameters and drawing bounds.",
    z.strictObject({
      kind: z.enum(entityKinds),
      id: objectId,
    }),
    true,
    async (ref) => {
      const doc = await current();
      const entity = inspectEntity(doc.graph, ref);
      if (!entity)
        throw new ToolFailure(
          "entity_unavailable",
          "No entity matches this reference.",
        );
      return { planId, revision: doc.revision, ...entity };
    },
  );
  tool(
    "resolve_snap",
    "Find a wall endpoint, midpoint, centerline intersection, perpendicular foot or finished face near a point in millimeters. Include an anchor for perpendicular snaps. Returns the exact point and integer model point for subsequent edits.",
    z.strictObject({
      point: precisePoint,
      storeyId: storeyIdInput,
      radiusMm: z.number().positive().max(2_000_000),
      modes: z.array(z.enum(snapKinds)).min(1).max(5).optional(),
      anchor: precisePoint.optional(),
      ortho: z.boolean().optional(),
    }),
    true,
    async ({ point, storeyId, ...options }) => {
      const doc = await current();
      const snap = resolveSnap(
        storeyPlan(doc.graph, storeyById(doc.graph, storeyId).id).walls,
        point,
        options,
      );
      return {
        planId,
        revision: doc.revision,
        snap: snap ? { ...snap, modelPoint: modelPrecision(snap.point) } : null,
      };
    },
  );
  tool(
    "measure_geometry",
    "Measure between model points, or the shortest distance between two wall centerlines or finished faces. A positive edge is on the +(-dy, dx) side of the directed wall in Draft's Y-down model.",
    z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("points"),
        start: precisePoint,
        end: precisePoint,
        unit: z.enum(lengthUnits).default("mm"),
      }),
      z.strictObject({
        mode: z.literal("wall_edges"),
        from: wallEdgeReference,
        to: wallEdgeReference,
        unit: z.enum(lengthUnits).default("mm"),
      }),
    ]),
    true,
    async (input) => {
      const doc = await current();
      const measurement =
        input.mode === "points"
          ? measurePoints(input.start, input.end, input.unit)
          : measureWallEdges(doc.graph.walls, input.from, input.to, input.unit);
      if (!measurement)
        throw new ToolFailure(
          "entity_unavailable",
          "A wall in this reference is unavailable.",
        );
      return { planId, revision: doc.revision, ...measurement };
    },
  );

  edit(
    "add_constraint",
    "Add a wall relation or fixed distance and solve the affected wall endpoints. Supply a stable constraint ID.",
    z.strictObject({
      ...revision,
      constraint: constraintInput,
    }),
    (doc, input) => {
      const plan = commands(doc, [
        { type: "constraint.add", constraint: input.constraint },
      ]);
      return {
        plan,
        result: {
          constraintId: input.constraint.id,
          ...summarizeChanges(doc.graph, plan),
        },
      };
    },
  );

  edit(
    "set_driving_dimension",
    "Change a fixed-distance constraint in millimeters. Door and window hosts are validated before save.",
    z.strictObject({
      ...revision,
      constraintId: objectId,
      distanceMm: z.number().finite().min(1).max(2_828_427),
    }),
    (doc, input) => {
      const plan = commands(doc, [
        {
          type: "constraint.drive",
          id: input.constraintId,
          distanceMm: input.distanceMm,
        },
      ]);
      return {
        plan,
        result: {
          constraintId: input.constraintId,
          ...summarizeChanges(doc.graph, plan),
        },
      };
    },
  );

  edit(
    "remove_constraint",
    "Remove a wall constraint by ID. Current geometry stays in place.",
    z.strictObject({
      ...revision,
      constraintId: objectId,
    }),
    (doc, input) => ({
      plan: commands(doc, [
        { type: "constraint.remove", id: input.constraintId },
      ]),
      result: { constraintId: input.constraintId },
    }),
  );

  tool(
    "explain_constraints",
    "List wall constraints and report Jacobian rank, degrees of freedom and conflicting IDs. Optionally test an additional constraint without saving.",
    z.strictObject({
      proposed: constraintInput.optional(),
    }),
    true,
    async ({ proposed }) => {
      const doc = await current();
      if (!proposed)
        return {
          planId,
          revision: doc.revision,
          ...constraintReport(doc.graph.walls, doc.graph.constraints),
        };
      try {
        const plan = commands(doc, [
          { type: "constraint.add", constraint: proposed },
        ]);
        return {
          planId,
          revision: doc.revision,
          feasible: true,
          ...constraintReport(plan.walls, plan.constraints),
        };
      } catch (error) {
        if (!(error instanceof ConstraintConflict)) throw error;
        return {
          planId,
          revision: doc.revision,
          feasible: false,
          conflictingConstraintIds: error.constraintIds,
          message: error.message,
        };
      }
    },
  );

  edit(
    "manage_layer",
    "Create or replace a named layer, or remove an unlocked layer. Put includes the complete member list and style. A member moves from its previous layer if it is unlocked.",
    z.discriminatedUnion("action", [
      z.strictObject({
        ...revision,
        action: z.literal("put"),
        layer: drawingLayerInput,
      }),
      z.strictObject({
        ...revision,
        action: z.literal("remove"),
        layerId: objectId,
      }),
    ]),
    (doc, input) => {
      const command: PlanCommand =
        input.action === "put"
          ? { type: "layer.write", layer: input.layer }
          : { type: "layer.remove", id: input.layerId };
      const plan = commands(doc, [command]);
      return { plan, result: summarizeChanges(doc.graph, plan) };
    },
  );

  edit(
    "define_block",
    "Create a reusable door, window or fixture definition with typed defaults. Supply a unique definition ID and name.",
    z.strictObject({
      ...revision,
      definition: blockInput,
    }),
    (doc, input) => ({
      plan: commands(doc, [
        { type: "block.define", definition: input.definition },
      ]),
      result: { blockId: input.definition.id },
    }),
  );

  edit(
    "insert_block",
    "Insert a native object linked to a reusable definition. Provide a host wall and offset for openings, or a position and rotation for furniture. Optional overrides stay local to the instance.",
    z.strictObject({
      ...revision,
      blockId: objectId,
      placement: blockPlacementInput,
    }),
    (doc, input) => {
      const id = newBatchId();
      return {
        plan: commands(doc, [
          {
            type: "block.insert",
            id,
            blockId: input.blockId,
            placement: input.placement,
          },
        ]),
        result: { blockId: input.blockId, instanceId: id },
      };
    },
  );

  edit(
    "edit_block_definition",
    "Replace the typed defaults of an existing definition. Inheriting objects update together and explicit instance overrides persist.",
    z.strictObject({
      ...revision,
      definition: blockInput,
    }),
    (doc, input) => {
      const plan = commands(doc, [
        { type: "block.update", definition: input.definition },
      ]);
      return {
        plan,
        result: {
          blockId: input.definition.id,
          ...summarizeChanges(doc.graph, plan),
        },
      };
    },
  );

  function editCad(doc: StudioDocument, input: CadEdit): AgentEdit {
    const plan = commands(doc, cadEditCommands(doc.graph, input));
    const result = summarizeChanges(doc.graph, plan);
    if (!result.changes.length)
      throw new Error("The edit does not change any geometry.");
    return { plan, result };
  }
  edit(
    "transform_entities",
    "Move, copy, rotate or mirror selected entities. Hosted openings follow selected walls. Angles are clockwise, coordinates in millimeters.",
    cadEditOptions.transform.extend(revision),
    (doc, { expectedRevision: _, ...input }) =>
      editCad(doc, { operation: "transform", ...input }),
  );
  edit(
    "offset_geometry",
    "Offset a wall or sketch by a signed distance. Positive offsets follow the positive wall edge, or increase an arc or circle radius.",
    cadEditOptions.offset.extend(revision),
    (doc, { expectedRevision: _, ...input }) =>
      editCad(doc, { operation: "offset", ...input }),
  );
  edit(
    "trim_extend",
    "Trim or extend one endpoint to the finite boundary of a wall or two-point sketch. Rejects cuts through openings.",
    cadEditOptions.trim_extend.extend(revision),
    (doc, { expectedRevision: _, ...input }) =>
      editCad(doc, { operation: "trim_extend", ...input }),
  );
  edit(
    "edit_corner",
    "Chamfer two walls or two straight sketches with a shared endpoint. Fillets apply to straight sketch linework. Size is setback for chamfer and radius for fillet.",
    cadEditOptions.corner.extend(revision),
    (doc, { expectedRevision: _, ...input }) =>
      editCad(doc, { operation: "corner", ...input }),
  );
  edit(
    "array_entities",
    "Create a linear or clockwise polar array. Count includes the original selection and hosted openings are copied with their walls.",
    cadEditOptions.array.extend(revision),
    (doc, { expectedRevision: _, ...input }) =>
      editCad(doc, { operation: "array", ...input }),
  );

  function transactions() {
    if (!backend.transactions)
      throw new ToolFailure(
        "transactions_unavailable",
        "This Draft backend does not support persistent transactions.",
      );
    return backend.transactions;
  }
  function validatedBatch(
    doc: StudioDocument,
    id: string,
    operations: CadEdit[],
  ) {
    try {
      return prepareBatch(doc, actor, id, operations);
    } catch (error) {
      throw new ToolFailure(
        "invalid_geometry",
        error instanceof Error ? error.message : "Invalid geometry.",
      );
    }
  }

  tool(
    "preview_changes",
    "Simulate ordered CAD operations on a saved revision. Reports before/after geometry, affected openings and a token valid for 15 minutes. Save with apply_changes using the same operations.",
    z.strictObject({
      ...revision,
      operations: operationsSchema,
    }),
    true,
    async (input) => {
      transactions();
      const doc = await current();
      if (doc.revision !== input.expectedRevision)
        throw new ToolFailure(
          "revision_conflict",
          "Read the latest floorplan revision and preview again.",
        );
      const id = newBatchId();
      const { summary, outcome } = validatedBatch(doc, id, input.operations);
      const { token, stamp } = createPreview(
        scope,
        id,
        doc.revision,
        input.operations,
        outcome,
      );
      return {
        planId,
        revision: doc.revision,
        previewToken: token,
        expiresAt: stamp.expiresAt,
        ...summary,
      };
    },
  );

  tool(
    "apply_changes",
    "Commit all operations from an unexpired preview together. Resend the same previewToken and operations to retrieve the original receipt after a successful commit.",
    z.strictObject({
      previewToken: z.string().min(1).max(1024),
      operations: operationsSchema,
    }),
    false,
    async ({ previewToken, operations }) => {
      const repo = transactions();
      const stamp = readPreview(scope, previewToken, operations);
      if (!stamp)
        throw new ToolFailure(
          "invalid_preview",
          "Use the token and exact operations from a preview for this floorplan and agent.",
        );
      const receipt = await repo.getReceipt(scope, stamp.id);
      if (receipt) return receipt;
      if (stamp.expiresAt <= Date.now())
        throw new ToolFailure("preview_expired", "Create a fresh preview.");
      const doc = await current();
      if (doc.revision === stamp.revision) {
        const { graph, summary, outcome } = validatedBatch(
          doc,
          stamp.id,
          operations,
        );
        if (outcome !== stamp.outcome)
          throw new ToolFailure(
            "invalid_preview",
            "The preview differs from the current geometry result. Preview again.",
          );
        const next: BatchReceipt = {
          planId,
          batchId: stamp.id,
          baseRevision: doc.revision,
          revision: doc.revision + 1,
          summary,
        };
        if (await repo.commit(scope, doc, graph, next)) {
          await backend.publish(scope, next.revision).catch(() => {});
          // Read the stored receipt so initial and repeated response payloads match.
          return (await repo.getReceipt(scope, stamp.id)) ?? next;
        }
      }
      // A concurrent retry may have committed after the first lookup.
      const concurrent = await repo.getReceipt(scope, stamp.id);
      if (concurrent) return concurrent;
      throw new ToolFailure(
        "revision_conflict",
        "The plan changed after preview. Read the latest floorplan and preview again.",
      );
    },
  );

  tool(
    "diff_revisions",
    "Compare authored geometry and plan metadata at two saved revisions. Compare captured revisions starting with the state at rollout. Use nextOffset to page changes.",
    z.strictObject({
      fromRevision: exportRevision,
      toRevision: exportRevision,
      offset: z.int().min(0).max(20_000).default(0),
      limit: z.int().min(1).max(100).default(25),
    }),
    true,
    async ({ fromRevision, toRevision, offset, limit }) => {
      const versions = await transactions().revisions(
        scope,
        fromRevision,
        toRevision,
      );
      const from = versions.find((item) => item.revision === fromRevision);
      const to = versions.find((item) => item.revision === toRevision);
      if (!from || !to)
        throw new ToolFailure(
          "revision_unavailable",
          "One or both saved revisions are unavailable for this floorplan.",
        );
      const summary = summarizeChanges(from.graph, to.graph);
      const total = summary.changes.length;
      return {
        planId,
        fromRevision,
        toRevision,
        before: { name: from.name, unit: from.unit },
        after: { name: to.name, unit: to.unit },
        ...summary,
        changes: summary.changes.slice(offset, offset + limit),
        total,
        nextOffset: offset + limit < total ? offset + limit : null,
      };
    },
  );

  function addSketch(
    doc: StudioDocument,
    geometry: SketchGeometry,
    storeyId?: string,
  ): AgentEdit {
    const id = crypto.randomUUID();
    return {
      plan: commands(doc, [
        { type: "sketch.add", sketch: { id, geometry, storeyId } },
      ]),
      cursor:
        geometry.kind === "polyline"
          ? geometry.points.at(-1)
          : geometry.kind === "construction"
            ? geometry.end
            : geometry.center,
      cursorStoreyId: storeyId,
      result: { sketchId: id, kind: geometry.kind },
    };
  }
  edit(
    "draw_construction_line",
    "Add a two-point guide in model millimeters.",
    sketchFields[0]
      .omit({ kind: true })
      .extend({ ...revision, storeyId: storeyIdInput }),
    (doc, { expectedRevision: _, storeyId, ...geometry }) =>
      addSketch(doc, { kind: "construction", ...geometry }, storeyId),
  );
  edit(
    "draw_polyline",
    "Add an open or closed polyline in model millimeters. Omit the duplicate closing point.",
    sketchFields[1]
      .omit({ kind: true })
      .extend({ ...revision, storeyId: storeyIdInput }),
    (doc, { expectedRevision: _, storeyId, ...geometry }) =>
      addSketch(doc, { kind: "polyline", ...geometry }, storeyId),
  );
  edit(
    "draw_circle",
    "Add a circle with a center and radius in model millimeters.",
    sketchFields[2]
      .omit({ kind: true })
      .extend({ ...revision, storeyId: storeyIdInput }),
    (doc, { expectedRevision: _, storeyId, ...geometry }) =>
      addSketch(doc, { kind: "circle", ...geometry }, storeyId),
  );
  edit(
    "draw_arc",
    "Add an arc with a center and radius in model millimeters. Angles are clockwise degrees from right in Draft's Y-down model.",
    sketchFields[3]
      .omit({ kind: true })
      .extend({ ...revision, storeyId: storeyIdInput }),
    (doc, { expectedRevision: _, storeyId, ...geometry }) =>
      addSketch(doc, { kind: "arc", ...geometry }, storeyId),
  );

  edit(
    "draw_wall",
    "Draw a wall between two integer millimeter coordinates.",
    wallInput.omit({ id: true }).extend(revision),
    (doc, { expectedRevision: _, ...wall }) => {
      const id = crypto.randomUUID();
      return {
        plan: commands(doc, [{ type: "wall.add", wall: { id, ...wall } }]),
        cursor: wall.end,
        cursorStoreyId: wall.storeyId,
        result: { wallId: id },
      };
    },
  );
  edit(
    "split_or_join_wall",
    "Split at an interior centerline point or join two alike collinear walls that share an endpoint.",
    z.discriminatedUnion("operation", [
      z.strictObject({
        ...revision,
        operation: z.literal("split"),
        wallId: objectId,
        point: modelPointInput,
      }),
      z.strictObject({
        ...revision,
        operation: z.literal("join"),
        wallId: objectId,
        otherWallId: objectId,
      }),
    ]),
    (doc, input) => {
      if (input.operation === "split") {
        const newWallId = crypto.randomUUID();
        return {
          plan: splitWall(doc.graph, input.wallId, input.point, newWallId),
          cursor: input.point,
          result: { wallId: input.wallId, newWallId },
        };
      }
      const plan = joinWalls(doc.graph, input.wallId, input.otherWallId);
      return {
        plan,
        cursor: wallById(plan, input.wallId).end,
        result: { wallId: input.wallId },
      };
    },
  );
  edit(
    "place_opening",
    "Place a door or window. Offset is measured from the host wall start to the opening center.",
    z.discriminatedUnion("kind", [
      doorInput
        .omit({ id: true })
        .extend({ ...revision, kind: z.literal("door") }),
      windowInput
        .omit({ id: true })
        .extend({ ...revision, kind: z.literal("window") }),
    ]),
    (doc, input) => {
      const { expectedRevision: _, kind, ...fields } = input;
      const openingId = crypto.randomUUID();
      const cursor = pointAlong(
        wallById(doc.graph, fields.wallId),
        fields.offsetMm,
      );
      const command: PlanCommand =
        kind === "door"
          ? {
              type: "door.add",
              door: {
                id: openingId,
                ...doorInput.omit({ id: true }).parse(fields),
              },
            }
          : {
              type: "window.add",
              opening: {
                id: openingId,
                ...windowInput.omit({ id: true }).parse(fields),
              },
            };
      return {
        plan: commands(doc, [command]),
        cursor,
        cursorStoreyId: wallById(doc.graph, fields.wallId).storeyId,
        result: { openingId, kind },
      };
    },
  );
  edit(
    "place_fixture",
    "Place parametric furniture or an electrical or plumbing symbol. Omitted furniture dimensions use the catalog.",
    z.discriminatedUnion("kind", [
      z.strictObject({
        ...revision,
        kind: z.literal("furniture"),
        position: modelPointInput,
        storeyId: storeyIdInput,
        template: z.enum(fixtureKinds),
        ...fixtureInput
          .pick({
            widthMm: true,
            depthMm: true,
            heightMm: true,
            rotation: true,
          })
          .partial().shape,
      }),
      utilityInput.omit({ id: true, template: true }).extend({
        ...revision,
        kind: z.literal("utility"),
        template: z.enum(utilityKinds),
      }),
    ]),
    (doc, input) => {
      const id = crypto.randomUUID();
      const { position, template } = input;
      const command: PlanCommand =
        input.kind === "utility"
          ? {
              type: "utility.add",
              utility: {
                id,
                template: input.template,
                position,
                storeyId: input.storeyId,
              },
            }
          : {
              type: "fixture.add",
              fixture: {
                id,
                template: input.template,
                position,
                storeyId: input.storeyId,
                widthMm:
                  input.widthMm ?? fixtureCatalog[input.template].widthMm,
                depthMm:
                  input.depthMm ?? fixtureCatalog[input.template].depthMm,
                heightMm:
                  input.heightMm ?? fixtureCatalog[input.template].heightMm,
                rotation: input.rotation ?? 0,
              },
            };
      return {
        plan: commands(doc, [command]),
        cursor: position,
        cursorStoreyId: input.storeyId,
        result: { fixtureId: id, template },
      };
    },
  );
  edit(
    "furnish_room_preset",
    "Place an entire room preset inside a room from spatial-audit.",
    z.strictObject({
      ...revision,
      roomId: objectId,
      preset: z.enum(["bedroom", "living", "kitchen", "bath"]),
    }),
    (doc, { roomId, preset }) => {
      const fixtures = furnishRoom(doc.graph, roomId, preset);
      return {
        plan: commands(
          doc,
          fixtures.map((fixture) => ({ type: "fixture.add", fixture })),
        ),
        cursor: fixtures[0].position,
        cursorStoreyId: fixtures[0].storeyId,
        result: { roomId, fixtureIds: fixtures.map(({ id }) => id) },
      };
    },
  );
  edit(
    "add_dimension_annotation",
    "Add a measured dimension line between two integer millimeter coordinates.",
    annotationInput.omit({ id: true }).extend(revision),
    (doc, { start, end, storeyId }) => {
      const annotationId = crypto.randomUUID();
      return {
        plan: commands(doc, [
          {
            type: "dimension.add",
            annotation: { id: annotationId, start, end, storeyId },
          },
        ]),
        cursor: end,
        cursorStoreyId: storeyId,
        result: {
          annotationId,
          lengthMm: Math.hypot(end.x - start.x, end.y - start.y),
        },
      };
    },
  );
  tool(
    "check_clearance_codes",
    "Check modeled ADA doorway and walkway widths, swing obstructions, and footprint collisions.",
    z.strictObject({ storeyId: storeyIdInput }),
    true,
    async ({ storeyId }) => {
      const doc = await current();
      return {
        planId,
        revision: doc.revision,
        ...checkClearances(
          storeyPlan(doc.graph, storeyById(doc.graph, storeyId).id),
        ),
      };
    },
  );
  tool(
    "calculate_bom",
    "Calculate wall runs and counts for doors, windows, furniture and utility symbols.",
    z.strictObject({}),
    true,
    async () => {
      const doc = await current();
      return { planId, revision: doc.revision, items: calculateBom(doc.graph) };
    },
  );
  tool(
    "trigger_dxf_export",
    "Queue a DXF blueprint of the saved revision. Repeat with the same revision for status.",
    z.strictObject(revision),
    false,
    ({ expectedRevision }) => backend.exportDxf(scope, expectedRevision),
  );
  return server;
}
