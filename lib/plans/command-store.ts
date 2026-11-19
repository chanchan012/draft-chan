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
  compareText,
  wallCommandSchema,
  wallSchema,
  type DraftActor,
  type DraftPlanState,
  type Wall,
  type WallCommand,
} from "./model";
import { initialGraph, loadDraftPlan } from "./plan-state";
import { solveWallTopology } from "./wall-topology";

enablePatches();

type CommandEntry = {
  readonly actor: DraftActor;
  readonly command: WallCommand;
  readonly patches: Patch[];
  readonly inverse: Patch[];
};
type DraftStore = {
  readonly plan: DraftPlanState;
  readonly past: readonly CommandEntry[];
  readonly future: readonly CommandEntry[];
  execute(command: WallCommand, actor: DraftActor): boolean;
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

export function createDraftPlanStore(input: unknown = initialGraph()) {
  const store = createStore<DraftStore>((set, get) => ({
    plan: freeze(loadDraftPlan(input), true),
    past: [],
    future: [],
    execute(input, author) {
      const command = wallCommandSchema.parse(input);
      const actor = actorSchema.parse(author);
      const { plan, past } = get();
      const [next, patches, inverse] = produceWithPatches(plan, (draft) => {
        if (command.type === "wall.add") {
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
          } else {
            const wall = draft.walls[index];
            const updated = wallSchema.parse({
              ...wall,
              ...command.changes,
              updatedBy: actor,
            });
            if (sameParameters(wall, updated)) return;
            draft.walls[index] = updated;
          }
        }
        draft.rooms = solveWallTopology(draft.walls).rooms;
      });
      if (!patches.length) return false;
      set({
        plan: next,
        past: [...past, freeze({ actor, command, patches, inverse }, true)],
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
