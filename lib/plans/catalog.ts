export const fixtureCatalog = {
  sofa: {
    label: "Sofa",
    group: "Living",
    widthMm: 2100,
    depthMm: 900,
    heightMm: 820,
  },
  coffeeTable: {
    label: "Coffee table",
    group: "Living",
    widthMm: 1050,
    depthMm: 600,
    heightMm: 420,
  },
  chair: {
    label: "Chair",
    group: "Living",
    widthMm: 530,
    depthMm: 550,
    heightMm: 830,
  },
  diningTable: {
    label: "Dining table",
    group: "Living",
    widthMm: 1550,
    depthMm: 850,
    heightMm: 750,
  },
  queenBed: {
    label: "Queen bed",
    group: "Bedroom",
    widthMm: 1550,
    depthMm: 2080,
    heightMm: 510,
  },
  wardrobe: {
    label: "Wardrobe",
    group: "Bedroom",
    widthMm: 1500,
    depthMm: 590,
    heightMm: 2100,
  },
  desk: {
    label: "Desk",
    group: "Work",
    widthMm: 1200,
    depthMm: 650,
    heightMm: 750,
  },
  vanity: {
    label: "Vanity",
    group: "Bath",
    widthMm: 700,
    depthMm: 510,
    heightMm: 850,
  },
  toilet: {
    label: "Toilet",
    group: "Bath",
    widthMm: 405,
    depthMm: 700,
    heightMm: 740,
  },
  shower: {
    label: "Shower",
    group: "Bath",
    widthMm: 915,
    depthMm: 915,
    heightMm: 70,
  },
  kitchenSink: {
    label: "Kitchen sink unit",
    group: "Kitchen",
    widthMm: 800,
    depthMm: 610,
    heightMm: 900,
  },
  baseCabinet: {
    label: "Base cabinet",
    group: "Kitchen",
    widthMm: 610,
    depthMm: 610,
    heightMm: 900,
  },
} as const;
export type FixtureKind = keyof typeof fixtureCatalog;
export const fixtureKinds = Object.keys(fixtureCatalog) as FixtureKind[];

export const utilityCatalog = {
  outlet: { label: "Outlet", layer: "electrical", glyph: "O" },
  switch: { label: "Switch", layer: "electrical", glyph: "S" },
  light: { label: "Light point", layer: "electrical", glyph: "L" },
  coldWater: { label: "Cold water", layer: "plumbing", glyph: "C" },
  hotWater: { label: "Hot water", layer: "plumbing", glyph: "H" },
  drain: { label: "Drain", layer: "plumbing", glyph: "D" },
} as const;
export type UtilityKind = keyof typeof utilityCatalog;
export type UtilityLayer = (typeof utilityCatalog)[UtilityKind]["layer"];
export const utilityKinds = Object.keys(utilityCatalog) as UtilityKind[];
