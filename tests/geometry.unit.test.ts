import { describe, expect, it } from "vitest";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { areaM2, thumbnailSvg } from "../lib/plans/geometry";
import type { DraftActor, Point, Wall } from "../lib/plans/model";
import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";
import { polygonAreaMm2 } from "../lib/plans/polygon";
import { solveWallTopology } from "../lib/plans/wall-topology";
import { wallMesh } from "../lib/plans/wall-mesh";
import {
  buildIsometric,
  cutawayHeight,
  wallRole,
} from "../lib/plans/isometric";
import { bounds } from "../lib/plans/footprints";

const pt = (x: number, y: number): Point => ({ x, y });
const wall = (id: string, start: Point, end: Point) => ({
  id,
  start,
  end,
  thicknessMm: 120,
  kind: "interior" as const,
});
function ring(prefix: string, points: Point[]): Wall[] {
  return points.map((start, i) =>
    wall(prefix + i, start, points[(i + 1) % points.length]),
  );
}
function box(prefix: string, ox = 0, oy = 0, size = 4000) {
  return ring(prefix, [
    pt(ox, oy),
    pt(ox + size, oy),
    pt(ox + size, oy + size),
    pt(ox, oy + size),
  ]);
}

describe("Studio wall surfaces", () => {
  it("fills the outer corner at shared endpoints with unequal thickness", () => {
    const corner = [
      wall("east", pt(0, 0), pt(4000, 0)),
      { ...wall("south", pt(0, 3000), pt(0, 0)), thicknessMm: 200 },
    ];
    for (const walls of [corner, corner.slice().reverse()]) {
      expect(wallMesh(walls).joints.map(({ footprint }) => footprint)).toEqual([
        [pt(0, 0), pt(0, -60), pt(-100, -60), pt(-100, 0)],
      ]);
    }
  });

  it("bevels acute joins and preserves deliberate gaps and opening jambs", () => {
    const east = wall("east", pt(0, 0), pt(4000, 0));
    const sharp = wall("sharp", pt(0, 0), pt(4000, 80));
    expect(wallMesh([east, sharp]).joints[0].footprint).toHaveLength(3);
    const south = wall("south", pt(0, 0), pt(0, 3000));
    expect(wallMesh([east, { ...south, start: pt(0, 1) }]).joints).toEqual([]);
    expect(
      wallMesh(
        [east, south],
        [{ id: "at-corner", wallId: east.id, offsetMm: 450, widthMm: 900 }],
      ).joints,
    ).toEqual([]);
  });

  it("builds a joined slab and clips front walls and windows at the cutaway", () => {
    const graph = initialGraph({ width: 4000, depth: 3000 });
    const [rear, front] = graph.walls;
    graph.windows = [
      {
        id: "rear",
        wallId: rear.id,
        offsetMm: 1500,
        widthMm: 1100,
        sillMm: 800,
        heightMm: 980,
      },
      {
        id: "front",
        wallId: front.id,
        offsetMm: 1500,
        widthMm: 1100,
        sillMm: 800,
        heightMm: 980,
      },
    ];
    expect(graph.walls.map((wall) => wallRole(wall, graph.rooms))).toEqual([
      "rear",
      "front",
      "front",
      "rear",
    ]);
    const model = buildIsometric(graph);
    expect(model.slab).toHaveLength(1);
    expect(model.slab[0]).toHaveLength(1);
    expect(bounds(model.slab[0][0])).toEqual({
      left: -60,
      top: -60,
      right: 4060,
      bottom: 3060,
    });
    expect(model.windows.map(({ id, height }) => ({ id, height }))).toEqual([
      { id: "rear", height: 980 },
      { id: "front", height: cutawayHeight.front - 800 },
    ]);
    expect(buildIsometric(initialGraph()).slab).toEqual([]);
  });
});

describe("wall topology", () => {
  it("joins shared endpoints and ignores open branches when solving rooms", () => {
    const walls = [...box("wall-"), wall("spur", pt(0, 2000), pt(800, 2000))];
    const result = solveWallTopology(walls);
    expect(result.spans).toHaveLength(6);
    expect(result.rooms).toEqual(solveWallTopology(walls.slice(0, -1)).rooms);
    expect(areaM2(result)).toBe(16);
    expect(solveWallTopology(walls.slice(0, 3)).rooms).toEqual([]);
  });

  it("splits two crossing walls into four adjoining rooms", () => {
    const walls = [
      ...box("outside-"),
      wall("north-south", pt(2000, -1000), pt(2000, 5000)),
      wall("east-west", pt(-1000, 2000), pt(5000, 2000)),
    ];
    const result = solveWallTopology(walls);
    expect(result.rooms).toHaveLength(4);
    expect(result.rooms.map((room) => polygonAreaMm2(room.polygon))).toEqual(
      Array(4).fill(4_000_000),
    );
    expect(
      result.spans.filter(
        ({ start, end }) =>
          (start.x === 2000 && start.y === 2000) ||
          (end.x === 2000 && end.y === 2000),
      ),
    ).toHaveLength(4);
    expect(areaM2(result)).toBe(16);
    expect(
      solveWallTopology(
        walls
          .slice()
          .reverse()
          .map((w) => ({
            ...w,
            start: w.end,
            end: w.start,
          })),
      ),
    ).toEqual(result);
  });

  it("solves a T-junction where the divider ends on another divider", () => {
    const result = solveWallTopology([
      ...box("boundary-"),
      wall("divider", pt(2000, 0), pt(2000, 4000)),
      wall("branch", pt(0, 1800), pt(2000, 1800)),
    ]);
    expect(
      result.rooms
        .map((room) => polygonAreaMm2(room.polygon))
        .sort((a, b) => a - b),
    ).toEqual([3_600_000, 4_400_000, 8_000_000]);
  });

  it("joins overlapping and duplicate collinear spans without duplicating rooms", () => {
    const walls = box("edge-");
    const result = solveWallTopology([
      ...walls,
      wall("overlap", pt(6000, 0), pt(1000, 0)),
      wall("duplicate", pt(4000, 0), pt(0, 0)),
    ]);
    expect(result.rooms).toEqual(solveWallTopology(walls).rooms);
    expect(result.spans).toContainEqual({
      start: pt(1000, 0),
      end: pt(4000, 0),
      wallIds: ["duplicate", "edge-0", "overlap"],
    });
    expect(result.spans).toContainEqual({
      start: pt(4000, 0),
      end: pt(6000, 0),
      wallIds: ["overlap"],
    });
    expect(
      solveWallTopology([
        wall("first", pt(0, 0), pt(20, 0)),
        wall("second", pt(8, 0), pt(100, 0)),
      ]).rooms,
    ).toEqual([]);
  });

  it("uses one fractional vertex where three authored segments cross", () => {
    const walls = [
      wall("a", pt(0, 0), pt(3, 3)),
      wall("b", pt(0, 1), pt(3, -2)),
      wall("c", pt(0, 2), pt(1, -1)),
    ];
    const result = solveWallTopology(walls);
    expect(result.spans).toHaveLength(6);
    expect(result.rooms).toEqual([]);
    for (const span of result.spans) {
      expect([span.start, span.end]).toContainEqual(pt(0.5, 0.5));
    }
  });

  it("keeps disconnected rooms and subtracts nested boundaries without double counting", () => {
    const walls = [
      ...box("outside-"),
      ...box("inside-", 1000, 1000, 2000),
      ...box("elsewhere-", -5000, -5000, 1000),
      wall("bridge", pt(0, 1000), pt(1000, 1000)),
    ];
    const result = solveWallTopology(walls);
    expect(result.rooms).toHaveLength(3);
    expect(result.rooms.filter((room) => room.holes?.length)).toHaveLength(1);
    expect(areaM2(result)).toBe(17);
    expect(
      result.rooms
        .map((r) => polygonAreaMm2(r.polygon, r.holes))
        .sort((a, b) => a - b),
    ).toEqual([1_000_000, 4_000_000, 12_000_000]);
    expect(thumbnailSvg(result)).toContain('fill-rule="evenodd"');
  });

  it("keeps nested outlines that touch at an articulation vertex", () => {
    const result = solveWallTopology([
      ...box("outside-"),
      ...ring("inside-", [pt(0, 0), pt(2000, 800), pt(800, 2000)]),
    ]);
    expect(result.rooms).toHaveLength(2);
    expect(result.rooms.find((r) => r.holes)?.holes?.length).toBe(1);
    expect(areaM2(result)).toBe(16);
  });

  it("tiles a crossed wall grid without gaps or duplicate faces", () => {
    const count = 12;
    const size = 300;
    const extent = count * size;
    const walls = Array.from({ length: count + 1 }, (_, i) => [
      wall("horizontal-" + i, pt(0, i * size), pt(extent, i * size)),
      wall("vertical-" + i, pt(i * size, 0), pt(i * size, extent)),
    ]).flat();
    const topology = solveWallTopology(walls);
    expect(topology.rooms).toHaveLength(count ** 2);
    expect(topology.spans).toHaveLength(2 * count * (count + 1));
    expect(areaM2(topology)).toBe(extent ** 2 / 1_000_000);
  });

  it("measures a translated concave polygon in either winding", () => {
    const outline = [
      pt(0, 0),
      pt(8, 0),
      pt(8, 4),
      pt(3, 4),
      pt(3, 9),
      pt(0, 9),
    ].map(({ x, y }) => pt(x + 900_000, y - 900_000));
    expect(polygonAreaMm2(outline)).toBe(47);
    expect(polygonAreaMm2(outline.slice().reverse())).toBe(47);
    expect(
      polygonAreaMm2(
        solveWallTopology(ring("concave-", outline)).rooms[0].polygon,
      ),
    ).toBe(47);
  });
});

const human: DraftActor = { kind: "human", id: "designer" };
const ai: DraftActor = { kind: "ai", id: "layout-agent" };

describe("DraftPlanState and commands", () => {
  it("hydrates saved starters with deterministic walls and retains area", () => {
    const saved = {
      ...initialGraph(),
      rooms: [
        {
          id: "room-1",
          polygon: [pt(0, 0), pt(5000, 0), pt(5000, 3000), pt(0, 3000)],
        },
      ],
      dimensions: [{ id: "dimension-1", length: 5000 }],
    };
    const { plan } = createDraftPlanStore(saved).getState();
    expect(plan.walls).toHaveLength(4);
    expect(plan.walls.every((w) => !w.createdBy)).toBe(true);
    expect(areaM2(plan)).toBe(15);
    const starter = initialGraph({ width: 5000, depth: 3000 });
    expect(plan.rooms).toEqual(starter.rooms);
    expect(plan.dimensions).toEqual(saved.dimensions);
    expect(saved.walls).toHaveLength(0);
    expect(Object.isFrozen(saved.dimensions[0])).toBe(false);
    expect(loadDraftPlan(initialGraph())).toEqual(initialGraph());
  });

  it("rejects malformed or unknown graph versions at the store boundary", () => {
    const empty = initialGraph();
    expect(() => loadDraftPlan({ ...empty, version: 2 })).toThrow();
    expect(() =>
      loadDraftPlan({
        ...empty,
        rooms: [
          {
            id: "crossed",
            polygon: [pt(0, 0), pt(20, 20), pt(20, 0), pt(0, 20)],
          },
        ],
      }),
    ).toThrow("rectangular starter");
  });

  it("records a creator and editor and undoes and redoes wall and room geometry atomically", () => {
    const session = createDraftPlanStore();
    const { execute, undo, redo } = session.getState();
    const walls = box("wall-");
    for (const w of walls) execute({ type: "wall.add", wall: w }, human);
    const before = session.getState().plan;
    const divider = wall("divider", pt(0, 2000), pt(4000, 2000));
    execute({ type: "wall.add", wall: divider }, ai);
    const divided = session.getState().plan;
    expect(divided.rooms).toHaveLength(2);
    expect(divided.walls.find((w) => w.id === divider.id)?.createdBy).toEqual(
      ai,
    );
    execute(
      { type: "wall.update", id: divider.id, changes: { thicknessMm: 180 } },
      human,
    );
    const edited = session.getState();
    expect(edited.past.at(-1)?.actor).toEqual(human);
    expect(edited.plan.walls.find((w) => w.id === divider.id)).toMatchObject({
      thicknessMm: 180,
      createdBy: ai,
      updatedBy: human,
    });
    expect(undo()).toBe(true);
    expect(session.getState().plan).toEqual(divided);
    expect(undo()).toBe(true);
    expect(session.getState().plan).toEqual(before);
    expect(redo()).toBe(true);
    expect(redo()).toBe(true);
    expect(session.getState().plan).toEqual(edited.plan);
    execute({ type: "wall.remove", id: divider.id }, ai);
    expect(session.getState().plan).toEqual(before);
    expect(undo()).toBe(true);
    expect(session.getState().plan).toEqual(edited.plan);
  });

  it("keeps invalid and no-op commands atomic, and discards redo after a new edit", () => {
    const session = createDraftPlanStore();
    const { execute, undo, redo } = session.getState();
    expect(undo()).toBe(false);
    expect(redo()).toBe(false);
    const w = wall("w", pt(0, 0), pt(500, 0));
    execute({ type: "wall.add", wall: w }, human);
    execute(
      { type: "wall.update", id: w.id, changes: { thicknessMm: 150 } },
      ai,
    );
    undo();
    const prior = session.getState();
    expect(() =>
      execute({ type: "wall.update", id: w.id, changes: { end: w.start } }, ai),
    ).toThrow();
    expect(() => execute({ type: "wall.add", wall: w }, ai)).toThrow();
    expect(() =>
      execute({ type: "wall.remove", id: "missing" }, human),
    ).toThrow();
    expect(
      execute(
        { type: "wall.update", id: w.id, changes: { thicknessMm: 120 } },
        ai,
      ),
    ).toBe(false);
    expect(session.getState()).toBe(prior);
    expect(
      execute(
        { type: "wall.update", id: w.id, changes: { thicknessMm: 180 } },
        ai,
      ),
    ).toBe(true);
    expect(redo()).toBe(false);
  });

  it("rejects fractional authored coordinates, invalid actors and duplicate saved IDs", () => {
    const session = createDraftPlanStore();
    const w = wall("w", pt(0, 0), pt(1, 0));
    expect(() =>
      session
        .getState()
        .execute({ type: "wall.add", wall: { ...w, end: pt(0.5, 0) } }, human),
    ).toThrow();
    expect(() =>
      session
        .getState()
        .execute({ type: "wall.add", wall: w }, { kind: "ai", id: "" }),
    ).toThrow();
    expect(() => loadDraftPlan({ ...initialGraph(), walls: [w, w] })).toThrow(
      "unique wall IDs",
    );
    expect(session.getState().plan).toEqual(initialGraph());
  });
});
