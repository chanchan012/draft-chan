import {
  McpServer,
  ResourceNotFoundError,
  type CallToolResult,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import { z } from "zod";
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
  wallInput,
  doorInput,
  windowInput,
  fixtureInput,
  utilityInput,
  annotationInput,
  sketchFields,
  type SketchGeometry,
  type DraftActor,
  type DraftPlanState,
  type PlanCommand,
  type Point,
} from "../plans/model";
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
import { requestBlueprint } from "./blueprint-store";
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
type AgentEdit = { plan: DraftPlanState; cursor?: Point; result?: object };

export interface DraftMcpBackend {
  get: typeof plans.getStudio;
  save: typeof plans.saveStudio;
  publish(scope: AgentScope, revision: number, cursor?: Point): Promise<void>;
  exportDxf(scope: AgentScope, revision: number): Promise<object>;
}

export const draftMcpBackend: DraftMcpBackend = {
  get: plans.getStudio,
  save: plans.saveStudio,
  async publish(scope, revision, cursor) {
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
          { clientId: agentId, cursor },
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
        "Use floorplan-graph to get the current revision and object IDs. Geometry uses millimeters. Every write requires the saved revision. Read the graph again after a revision conflict.",
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
            ? { code: error.reason, message: error.message }
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
        .publish(scope, saved.revision, changed.cursor)
        .catch(() => {});
      return { planId, revision: saved.revision, ...changed.result };
    });
  }

  resource(
    "floorplan-graph",
    "Saved floorplan geometry and revision in model millimeters.",
    current,
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

  tool(
    "query_entities",
    "List entities at the saved revision. Bounds select overlapping envelopes in millimeters. Page with nextOffset on the same revision.",
    z.strictObject({
      kind: z.enum(entityKinds).optional(),
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
        ...queryEntities(doc.graph, input),
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
      radiusMm: z.number().positive().max(2_000_000),
      modes: z.array(z.enum(snapKinds)).min(1).max(5).optional(),
      anchor: precisePoint.optional(),
      ortho: z.boolean().optional(),
    }),
    true,
    async ({ point, ...options }) => {
      const doc = await current();
      const snap = resolveSnap(doc.graph.walls, point, options);
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

  function addSketch(doc: StudioDocument, geometry: SketchGeometry): AgentEdit {
    const id = crypto.randomUUID();
    return {
      plan: commands(doc, [{ type: "sketch.add", sketch: { id, geometry } }]),
      cursor:
        geometry.kind === "polyline"
          ? geometry.points.at(-1)
          : geometry.kind === "construction"
            ? geometry.end
            : geometry.center,
      result: { sketchId: id, kind: geometry.kind },
    };
  }
  edit(
    "draw_construction_line",
    "Add a two-point guide in model millimeters.",
    sketchFields[0].omit({ kind: true }).extend(revision),
    (doc, { expectedRevision: _, ...geometry }) =>
      addSketch(doc, { kind: "construction", ...geometry }),
  );
  edit(
    "draw_polyline",
    "Add an open or closed polyline in model millimeters. Omit the duplicate closing point.",
    sketchFields[1].omit({ kind: true }).extend(revision),
    (doc, { expectedRevision: _, ...geometry }) =>
      addSketch(doc, { kind: "polyline", ...geometry }),
  );
  edit(
    "draw_circle",
    "Add a circle with a center and radius in model millimeters.",
    sketchFields[2].omit({ kind: true }).extend(revision),
    (doc, { expectedRevision: _, ...geometry }) =>
      addSketch(doc, { kind: "circle", ...geometry }),
  );
  edit(
    "draw_arc",
    "Add an arc with a center and radius in model millimeters. Angles are clockwise degrees from right in Draft's Y-down model.",
    sketchFields[3].omit({ kind: true }).extend(revision),
    (doc, { expectedRevision: _, ...geometry }) =>
      addSketch(doc, { kind: "arc", ...geometry }),
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
              utility: { id, template: input.template, position },
            }
          : {
              type: "fixture.add",
              fixture: {
                id,
                template: input.template,
                position,
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
        result: { roomId, fixtureIds: fixtures.map(({ id }) => id) },
      };
    },
  );
  edit(
    "add_dimension_annotation",
    "Add a measured dimension line between two integer millimeter coordinates.",
    annotationInput.omit({ id: true }).extend(revision),
    (doc, { start, end }) => {
      const annotationId = crypto.randomUUID();
      return {
        plan: commands(doc, [
          {
            type: "dimension.add",
            annotation: { id: annotationId, start, end },
          },
        ]),
        cursor: end,
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
    z.strictObject({}),
    true,
    async () => {
      const doc = await current();
      return { planId, revision: doc.revision, ...checkClearances(doc.graph) };
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
