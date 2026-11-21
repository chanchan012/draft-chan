import {
  blockInstanceInput,
  compareText,
  doorSchema,
  fixtureSchema,
  windowSchema,
  type BlockDefinition,
  type BlockInstance,
  type DraftActor,
  type DraftPlanState,
  type DrawingEntity,
  type DrawingLayer,
  type PlanCommand,
} from "./model";

export const entityKey = ({ kind, id }: DrawingEntity) => kind + ":" + id;

function entities(plan: DraftPlanState) {
  return {
    wall: plan.walls,
    door: plan.openings,
    window: plan.windows ?? [],
    fixture: plan.fixtures,
    utility: plan.utilities,
    dimension: plan.annotations ?? [],
    sketch: plan.sketches ?? [],
  };
}

function entityMap(plan: DraftPlanState) {
  const result = new Map<string, { id: string }>();
  const lists = entities(plan);
  for (const kind of Object.keys(lists) as DrawingEntity["kind"][])
    for (const entity of lists[kind])
      result.set(entityKey({ kind, id: entity.id }), entity);
  return result;
}

export function layersByEntity(plan: DraftPlanState) {
  return new Map(
    (plan.drawingLayers ?? []).flatMap((layer) =>
      layer.members.map((member) => [entityKey(member), layer] as const),
    ),
  );
}

function fingerprint(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item)
        .filter(([key]) => key !== "updatedBy" && key !== "createdBy")
        .sort(([a], [b]) => compareText(a, b)),
    );
  });
}

function blockParameters(
  entity: object,
  defaults: BlockDefinition["parameters"],
) {
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, Reflect.get(entity, key)]),
  );
}

function linkedEntity(
  plan: DraftPlanState,
  instance: Pick<BlockInstance, "kind" | "id">,
) {
  return entities(plan)[instance.kind].find(({ id }) => id === instance.id);
}

export function validateOrganization(plan: DraftPlanState) {
  if (
    !plan.drawingLayers?.length &&
    !plan.blocks?.length &&
    !plan.blockInstances?.length
  )
    return;
  const valid = entityMap(plan);
  const assigned = new Set<string>();
  const unique = (
    items: readonly { id: string; name: string }[],
    label: string,
  ) => {
    if (
      new Set(items.map((i) => i.id)).size !== items.length ||
      new Set(items.map((i) => i.name.toLowerCase())).size !== items.length
    )
      throw new Error(label + " must have distinct IDs and names.");
  };
  unique(plan.drawingLayers ?? [], "Drawing layers");
  unique(plan.blocks ?? [], "Block definitions");
  for (const layer of plan.drawingLayers ?? []) {
    for (const member of layer.members) {
      const key = entityKey(member);
      if (!valid.has(key))
        throw new Error(
          "Layer " + layer.name + " references a missing " + member.kind + ".",
        );
      if (assigned.has(key))
        throw new Error("An object can belong to one named layer.");
      assigned.add(key);
    }
  }
  const definitions = new Map(
    (plan.blocks ?? []).map((block) => [block.id, block]),
  );
  const links = new Set<string>();
  for (const instance of plan.blockInstances ?? []) {
    const key = entityKey(instance);
    const definition = definitions.get(instance.blockId);
    const native = valid.get(key);
    if (
      links.has(instance.id) ||
      !definition ||
      definition.kind !== instance.kind ||
      !native
    )
      throw new Error(
        "A block instance must have a unique object and a matching definition.",
      );
    links.add(instance.id);
    const applied = { ...definition.parameters, ...instance.overrides };
    if (
      fingerprint(blockParameters(native, definition.parameters)) !==
      fingerprint(applied)
    )
      throw new Error(
        "Block instance " + instance.id + " differs from its parameters.",
      );
  }
  for (const definition of plan.blocks ?? [])
    if (
      definition.kind === "window" &&
      definition.parameters.sillMm + definition.parameters.heightMm > 2450
    )
      throw new Error(
        "Block window parameters must fit within the wall height.",
      );
}

function assertLayerLocks(before: DraftPlanState, after: DraftPlanState) {
  if (
    !before.drawingLayers?.some((layer) => layer.locked) &&
    !after.drawingLayers?.some((layer) => layer.locked)
  )
    return;
  const previous = entityMap(before);
  const updated = entityMap(after);
  const afterLayers = new Map(
    after.drawingLayers?.map((layer) => [layer.id, layer]),
  );
  const beforeLayers = new Map(
    before.drawingLayers?.map((layer) => [layer.id, layer]),
  );
  const membership = layersByEntity(after);
  const beforeWalls = new Map(before.walls.map((wall) => [wall.id, wall]));
  const afterWalls = new Map(after.walls.map((wall) => [wall.id, wall]));
  for (const layer of before.drawingLayers ?? []) {
    if (!layer.locked) continue;
    const nextLayer = afterLayers.get(layer.id);
    if (!nextLayer)
      throw new Error("Unlock layer " + layer.name + " before removing it.");
    if (!nextLayer.locked) continue;
    for (const item of layer.members) {
      const key = entityKey(item);
      if (
        membership.get(key)?.id !== layer.id ||
        fingerprint(previous.get(key)) !== fingerprint(updated.get(key))
      )
        throw new Error("Layer " + layer.name + " is locked.");
      const hosted = previous.get(key);
      if (
        (item.kind === "door" || item.kind === "window") &&
        hosted &&
        "wallId" in hosted &&
        typeof hosted.wallId === "string" &&
        fingerprint(beforeWalls.get(hosted.wallId)) !==
          fingerprint(afterWalls.get(hosted.wallId))
      )
        throw new Error(
          "A hosted opening on layer " + layer.name + " is locked.",
        );
      const oldLink = before.blockInstances?.find(
        (x) => x.kind === item.kind && x.id === item.id,
      );
      const newLink = after.blockInstances?.find(
        (x) => x.kind === item.kind && x.id === item.id,
      );
      if (fingerprint(oldLink) !== fingerprint(newLink))
        throw new Error("Layer " + layer.name + " is locked.");
    }
  }
  for (const layer of after.drawingLayers ?? []) {
    const existing = beforeLayers.get(layer.id);
    if (!layer.locked || !existing?.locked) continue;
    const oldKeys = new Set(existing.members.map(entityKey));
    if (layer.members.some((item) => !oldKeys.has(entityKey(item))))
      throw new Error("Layer " + layer.name + " is locked.");
  }
}

export function hasOrganization(plan: DraftPlanState) {
  return Boolean(
    plan.drawingLayers?.length ||
    plan.blocks?.length ||
    plan.blockInstances?.length,
  );
}

// Resolve definitions into native objects for existing CAD, audit, and export paths.
export function reconcileOrganization(
  before: DraftPlanState,
  after: DraftPlanState,
  actor: DraftActor,
) {
  if (!hasOrganization(before) && !hasOrganization(after)) return;
  const definitions = new Map(after.blocks?.map((block) => [block.id, block]));
  const oldDefinitions = new Map(
    before.blocks?.map((block) => [block.id, block]),
  );
  const oldLinks = new Map(
    before.blockInstances?.map((link) => [link.id, link]),
  );
  const links: BlockInstance[] = [];
  for (const link of after.blockInstances ?? []) {
    const prior = oldLinks.get(link.id);
    const native = linkedEntity(after, link);
    const definition = definitions.get(link.blockId);
    if (!native && prior && linkedEntity(before, prior)) continue;
    if (!native || !definition || definition.kind !== link.kind)
      throw new Error(
        "Missing a native block object or matching block definition.",
      );
    const overrides = { ...link.overrides };
    if (
      prior &&
      prior.kind === link.kind &&
      prior.blockId === link.blockId &&
      fingerprint(prior.overrides) === fingerprint(link.overrides)
    ) {
      const previous = linkedEntity(before, prior);
      const oldDefinition = oldDefinitions.get(prior.blockId);
      if (previous)
        for (const [key, value] of Object.entries(
          blockParameters(native, definition.parameters),
        )) {
          const inherited = Reflect.get(definition.parameters, key);
          const definitionChanged =
            oldDefinition &&
            Reflect.get(oldDefinition.parameters, key) !== inherited;
          if (
            definitionChanged &&
            value === inherited &&
            !Object.hasOwn(overrides, key)
          )
            continue;
          if (value !== Reflect.get(previous, key))
            Reflect.set(overrides, key, value);
        }
    }
    const next = blockInstanceInput.parse({ ...link, overrides });
    links.push(next);
    const parameters = { ...definition.parameters, ...next.overrides };
    if (
      fingerprint(blockParameters(native, definition.parameters)) ===
      fingerprint(parameters)
    )
      continue;
    const updated = { ...native, ...parameters, updatedBy: actor };
    switch (link.kind) {
      case "door":
        after.openings = after.openings.map((item) =>
          item.id === link.id ? doorSchema.parse(updated) : item,
        );
        break;
      case "window":
        after.windows = after.windows?.map((item) =>
          item.id === link.id ? windowSchema.parse(updated) : item,
        );
        break;
      case "fixture":
        after.fixtures = after.fixtures.map((item) =>
          item.id === link.id ? fixtureSchema.parse(updated) : item,
        );
        break;
    }
  }
  if (
    after.blockInstances &&
    fingerprint(after.blockInstances) !== fingerprint(links)
  )
    after.blockInstances = links;

  if (after.drawingLayers?.length) {
    const previous = entityMap(before);
    const next = entityMap(after);
    for (const layer of after.drawingLayers) {
      const retained = layer.members.filter((item) => {
        const key = entityKey(item);
        return next.has(key) || !previous.has(key);
      });
      if (retained.length !== layer.members.length) layer.members = retained;
    }
  }
  assertLayerLocks(before, after);
  validateOrganization(after);
}

export function insertBlock(
  plan: DraftPlanState,
  input: Extract<PlanCommand, { type: "block.insert" }>,
) {
  const definition = plan.blocks?.find(({ id }) => id === input.blockId);
  const { id, placement, blockId } = input;
  const { overrides = {} } = placement;
  if (!definition || definition.kind !== placement.kind)
    throw new Error("Select a block definition matching this placement.");
  const link = blockInstanceInput.parse({
    id,
    blockId,
    kind: placement.kind,
    overrides,
  });
  let command: PlanCommand;
  switch (definition.kind) {
    case "door":
      if (placement.kind !== "door") throw new Error("Select a door host.");
      command = {
        type: "door.add",
        door: {
          id,
          wallId: placement.wallId,
          offsetMm: placement.offsetMm,
          ...definition.parameters,
          ...placement.overrides,
        },
      };
      break;
    case "window":
      if (placement.kind !== "window") throw new Error("Select a window host.");
      command = {
        type: "window.add",
        opening: {
          id,
          wallId: placement.wallId,
          offsetMm: placement.offsetMm,
          ...definition.parameters,
          ...placement.overrides,
        },
      };
      break;
    case "fixture":
      if (placement.kind !== "fixture")
        throw new Error("Select a fixture position.");
      command = {
        type: "fixture.add",
        fixture: {
          id,
          position: placement.position,
          rotation: placement.rotation,
          storeyId: placement.storeyId,
          ...definition.parameters,
          ...placement.overrides,
        },
      };
      break;
  }
  return { link, command };
}

export function upsertLayer(
  layers: readonly DrawingLayer[],
  incoming: DrawingLayer,
) {
  const keys = new Set(incoming.members.map(entityKey));
  const remaining = layers
    .filter((layer) => layer.id !== incoming.id)
    .map((layer) => ({
      ...layer,
      members: layer.members.filter((item) => !keys.has(entityKey(item))),
    }));
  const members = [...incoming.members].sort((a, b) =>
    compareText(entityKey(a), entityKey(b)),
  );
  return [...remaining, { ...incoming, members }].sort((a, b) =>
    compareText(a.id, b.id),
  );
}

export function visibleDrawing(plan: DraftPlanState): DraftPlanState {
  if (!plan.drawingLayers?.some((layer) => !layer.visible)) return plan;
  const hidden = new Set(
    plan.drawingLayers.flatMap((layer) =>
      layer.visible ? [] : layer.members.map(entityKey),
    ),
  );
  const visible = (kind: DrawingEntity["kind"], id: string) =>
    !hidden.has(entityKey({ kind, id }));
  const walls = plan.walls.filter((item) => visible("wall", item.id));
  const wallIds = new Set(walls.map((item) => item.id));
  return {
    ...plan,
    walls,
    openings: plan.openings.filter(
      (item) => wallIds.has(item.wallId) && visible("door", item.id),
    ),
    windows: plan.windows?.filter(
      (item) => wallIds.has(item.wallId) && visible("window", item.id),
    ),
    fixtures: plan.fixtures.filter((item) => visible("fixture", item.id)),
    utilities: plan.utilities.filter((item) => visible("utility", item.id)),
    annotations: plan.annotations?.filter((item) =>
      visible("dimension", item.id),
    ),
    sketches: plan.sketches?.filter((item) => visible("sketch", item.id)),
    constraints: plan.constraints?.filter((item) =>
      "first" in item
        ? wallIds.has(item.first.wallId) && wallIds.has(item.second.wallId)
        : wallIds.has(item.firstWallId) && wallIds.has(item.secondWallId),
    ),
  };
}
