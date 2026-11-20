import {
  applyPatches,
  enablePatches,
  freeze,
  produceWithPatches,
  type Patch,
} from "immer";
import { createStore } from "zustand/vanilla";
import {
  actorSchema,
  annotationSchema,
  compareText,
  doorSchema,
  fixtureSchema,
  placementLimit,
  utilitySchema,
  openingLimit,
  planCommandSchema,
  wallLimit,
  wallSchema,
  windowSchema,
  type DraftActor,
  type DraftPlanState,
  type Wall,
  type PlanCommand,
} from "./model";
import { initialGraph, loadDraftPlan } from "./plan-state";
import { validateOpenings } from "./openings";
import { solveWallTopology } from "./wall-topology";

enablePatches();

type CommandEntry = {
  readonly actor: DraftActor;
  readonly commands: PlanCommand[];
  readonly patches: Patch[];
  readonly inverse: Patch[];
};
type DraftStore = {
  readonly plan: DraftPlanState;
  readonly past: readonly CommandEntry[];
  readonly future: readonly CommandEntry[];
  execute(command: PlanCommand, actor: DraftActor): boolean;
  executeBatch(commands: readonly PlanCommand[], actor: DraftActor): boolean;
  adoptRemote(
    saved: DraftPlanState,
    actor: DraftActor,
    draft?: DraftPlanState,
  ): void;
  undo(): boolean;
  redo(): boolean;
};

function sameParameters(a: Wall, b: Wall) {
  return (
    a.start.x === b.start.x &&
    a.start.y === b.start.y &&
    a.end.x === b.end.x &&
    a.end.y === b.end.y &&
    a.thicknessMm === b.thicknessMm &&
    a.kind === b.kind
  );
}

function addPlacement<T extends { id: string }>(items: T[], item: T) {
  if (items.length >= placementLimit)
    throw new Error("This plan has reached the layer's placement limit.");
  if (items.some(({ id }) => id === item.id))
    throw new Error("This placement ID already exists.");
  items.push(item);
  items.sort((a, b) => compareText(a.id, b.id));
}

function editPlacement<T extends { id: string; updatedBy?: DraftActor }>(
  items: T[],
  id: string,
  actor: DraftActor,
  changes?: Partial<T>,
  schema?: { parse(value: unknown): T },
) {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) throw new Error("Placement not found.");
  if (!changes || !schema) {
    items.splice(index, 1);
    return;
  }
  const previous = items[index];
  const candidate = schema.parse({ ...previous, ...changes });
  if (JSON.stringify(previous) !== JSON.stringify(candidate)) {
    items[index] = { ...candidate, updatedBy: actor };
  }
}

function applyEdit(
  draft: DraftPlanState,
  command: PlanCommand,
  actor: DraftActor,
) {
  switch (command.type) {
    case "window.add": {
      const windows = (draft.windows ??= []);
      if (windows.length >= openingLimit)
        throw new Error("This plan has reached the window limit.");
      windows.push(
        windowSchema.parse({
          ...command.opening,
          createdBy: actor,
          updatedBy: actor,
        }),
      );
      windows.sort((a, b) => compareText(a.id, b.id));
      return;
    }
    case "window.remove":
      return editPlacement(draft.windows ?? [], command.id, actor);
    case "window.update":
      return editPlacement(
        draft.windows ?? [],
        command.id,
        actor,
        command.changes,
        windowSchema,
      );
    case "dimension.add":
      return addPlacement(
        (draft.annotations ??= []),
        annotationSchema.parse({
          ...command.annotation,
          createdBy: actor,
          updatedBy: actor,
        }),
      );
    case "dimension.remove":
      return editPlacement(draft.annotations ?? [], command.id, actor);
    case "dimension.update":
      return editPlacement(
        draft.annotations ?? [],
        command.id,
        actor,
        command.changes,
        annotationSchema,
      );
    case "fixture.add":
      return addPlacement(
        draft.fixtures,
        fixtureSchema.parse({
          ...command.fixture,
          createdBy: actor,
          updatedBy: actor,
        }),
      );
    case "utility.add":
      return addPlacement(
        draft.utilities,
        utilitySchema.parse({
          ...command.utility,
          createdBy: actor,
          updatedBy: actor,
        }),
      );
    case "fixture.update":
      return editPlacement(
        draft.fixtures,
        command.id,
        actor,
        command.changes,
        fixtureSchema,
      );
    case "utility.update":
      return editPlacement(
        draft.utilities,
        command.id,
        actor,
        command.changes,
        utilitySchema,
      );
    case "fixture.remove":
      return editPlacement(draft.fixtures, command.id, actor);
    case "utility.remove":
      return editPlacement(draft.utilities, command.id, actor);
  }
  if (command.type === "door.add") {
    if (draft.openings.length >= openingLimit)
      throw new Error("This plan has reached the opening limit.");
    draft.openings.push(
      doorSchema.parse({
        ...command.door,
        createdBy: actor,
        updatedBy: actor,
      }),
    );
    draft.openings.sort((a, b) => compareText(a.id, b.id));
    return;
  }
  if (command.type === "door.update" || command.type === "door.remove") {
    const index = draft.openings.findIndex((door) => door.id === command.id);
    if (index === -1) throw new Error("Door not found.");
    if (command.type === "door.remove") draft.openings.splice(index, 1);
    else {
      const door = draft.openings[index];
      const updated = doorSchema.parse({
        ...door,
        ...command.changes,
        updatedBy: actor,
      });
      if (
        door.widthMm === updated.widthMm &&
        door.offsetMm === updated.offsetMm &&
        door.hinge === updated.hinge &&
        door.swing === updated.swing
      )
        return;
      draft.openings[index] = updated;
    }
    return;
  }
  if (command.type === "wall.add") {
    if (draft.walls.length >= wallLimit)
      throw new Error("This plan has reached the wall limit.");
    if (draft.walls.some((wall) => wall.id === command.wall.id)) {
      throw new Error("A wall with that ID already exists.");
    }
    draft.walls.push(
      wallSchema.parse({
        ...command.wall,
        createdBy: actor,
        updatedBy: actor,
      }),
    );
    draft.walls.sort((a, b) => compareText(a.id, b.id));
  } else {
    const index = draft.walls.findIndex((wall) => wall.id === command.id);
    if (index === -1) throw new Error("Wall not found.");
    if (command.type === "wall.remove") {
      draft.walls.splice(index, 1);
      draft.openings = draft.openings.filter(
        (door) => door.wallId !== command.id,
      );
      if (draft.windows)
        draft.windows = draft.windows.filter(
          (window) => window.wallId !== command.id,
        );
    } else {
      const wall = draft.walls[index];
      const updated = wallSchema.parse({
        ...wall,
        ...command.changes,
        updatedBy: actor,
      });
      if (sameParameters(wall, updated)) return false;
      draft.walls[index] = updated;
    }
  }
  return true;
}

export function createDraftPlanStore(input: unknown = initialGraph()) {
  const store = createStore<DraftStore>((set, get) => ({
    plan: freeze(loadDraftPlan(input), true),
    past: [],
    future: [],
    execute(input, author) {
      return get().executeBatch([input], author);
    },
    adoptRemote(saved, actor, draft) {
      const [plan, patches, inverse] = produceWithPatches(
        saved,
        () => draft ?? saved,
      );
      // Rebased local geometry is one undo step on the new baseline.
      const past = patches.length
        ? [freeze({ actor, commands: [], patches, inverse }, true)]
        : [];
      set({ plan: freeze(plan, true), past, future: [] });
    },
    executeBatch(inputs, author) {
      const commands = inputs.map((input) => planCommandSchema.parse(input));
      const actor = actorSchema.parse(author);
      const { plan, past } = get();
      const [next, patches, inverse] = produceWithPatches(plan, (draft) => {
        let wallsChanged = false;
        for (const command of commands) {
          if (applyEdit(draft, command, actor)) wallsChanged = true;
        }
        if (
          wallsChanged ||
          commands.some(
            ({ type }) =>
              type.startsWith("door.") || type.startsWith("window."),
          )
        ) {
          validateOpenings(draft.walls, [
            ...draft.openings,
            ...(draft.windows ?? []),
          ]);
        }
        if (wallsChanged) draft.rooms = solveWallTopology(draft.walls).rooms;
      });
      if (!patches.length) return false;
      set({
        plan: next,
        past: [...past, freeze({ actor, commands, patches, inverse }, true)],
        future: [],
      });
      return true;
    },
    undo() {
      const { plan, past, future } = get();
      const entry = past.at(-1);
      if (!entry) return false;
      set({
        plan: applyPatches(plan, entry.inverse),
        past: past.slice(0, -1),
        future: [...future, entry],
      });
      return true;
    },
    redo() {
      const { plan, past, future } = get();
      const entry = future.at(-1);
      if (!entry) return false;
      set({
        plan: applyPatches(plan, entry.patches),
        past: [...past, entry],
        future: future.slice(0, -1),
      });
      return true;
    },
  }));
  const { getState, getInitialState, subscribe } = store;
  return { getState, getInitialState, subscribe };
}
