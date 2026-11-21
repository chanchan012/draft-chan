import { dot, subtract } from "./footprints";
import {
  compareText,
  defaultStoreyId,
  modelPointInput,
  type Constraint,
  type Point,
  type Wall,
  type WallEndpoint,
} from "./model";

const endpoints = ["start", "end"] as const;
const scalarLength = (p: Point) => Math.hypot(p.x, p.y);
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const pointKey = ({ x, y }: Point) => x + "," + y;
export const constraintToleranceMm = 2;
const precision = 0.00001;
type Equation = {
  id: string;
  variables: number[];
  evaluate(values: readonly number[]): number[];
};

export class ConstraintConflict extends Error {
  constructor(
    readonly constraintIds: string[],
    message = "The geometry conflicts with these constraints.",
  ) {
    super(message + " " + constraintIds.join(", "));
  }
}

function system(walls: readonly Wall[], constraints: readonly Constraint[]) {
  const variables = new Map<string, number>();
  const byWall = new Map<string, Record<"start" | "end", number>>();
  const original: number[] = [];
  for (const wall of walls) {
    const indices = endpoints.map((endpoint) => {
      const p = wall[endpoint];
      const key = (wall.storeyId ?? defaultStoreyId) + ":" + pointKey(p);
      const index = variables.get(key) ?? original.length;
      if (index === original.length) {
        original.push(p.x, p.y);
        variables.set(key, index);
      }
      return index;
    });
    byWall.set(wall.id, { start: indices[0], end: indices[1] });
  }

  const equations: Equation[] = [];
  const point = (values: readonly number[], index: number): Point => ({
    x: values[index],
    y: values[index + 1],
  });
  const missing: string[] = [];
  const ordered = [...constraints].sort((a, b) => compareText(a.id, b.id));
  const distances = new Map<string, { id: string; distanceMm: number }>();
  for (const c of ordered) {
    if ("first" in c) {
      const a = byWall.get(c.first.wallId)?.[c.first.endpoint];
      const b = byWall.get(c.second.wallId)?.[c.second.endpoint];
      if (a === undefined || b === undefined) {
        missing.push(c.id);
        continue;
      }
      if (c.kind === "fixed_distance") {
        if (a === b)
          throw new ConstraintConflict(
            [c.id],
            "A nonzero distance needs two distinct points.",
          );
        const key = Math.min(a, b) + ":" + Math.max(a, b);
        const prior = distances.get(key);
        if (prior && prior.distanceMm !== c.distanceMm)
          throw new ConstraintConflict(
            [prior.id, c.id],
            "The same points have different driving distances.",
          );
        distances.set(key, c);
      }
      equations.push({
        id: c.id,
        variables: [a, a + 1, b, b + 1],
        evaluate(values) {
          const delta = subtract(point(values, b), point(values, a));
          return c.kind === "coincident"
            ? [delta.x, delta.y]
            : [scalarLength(delta) - c.distanceMm];
        },
      });
      continue;
    }
    const a = byWall.get(c.firstWallId);
    const b = byWall.get(c.secondWallId);
    if (!a || !b) {
      missing.push(c.id);
      continue;
    }
    if (c.firstWallId === c.secondWallId)
      throw new ConstraintConflict([c.id], "Select two different walls.");
    equations.push({
      id: c.id,
      variables: [a.start, a.end, b.start, b.end].flatMap((i) => [i, i + 1]),
      evaluate(values) {
        const u = subtract(point(values, a.end), point(values, a.start));
        const v = subtract(point(values, b.end), point(values, b.start));
        const la = scalarLength(u);
        const lb = scalarLength(v);
        if (c.kind === "equal_length") return [la - lb];
        const product = c.kind === "parallel" ? cross(u, v) : dot(u, v);
        // Residual is the deviation, in millimeters, across the shorter wall.
        return [product / Math.max(1, la, lb)];
      },
    });
  }
  if (missing.length)
    throw new ConstraintConflict(
      missing,
      "A constraint references a missing wall.",
    );
  return { variables, original, equations };
}

function residuals(equations: readonly Equation[], values: readonly number[]) {
  return equations.flatMap((row) => row.evaluate(values));
}

function jacobian(equations: readonly Equation[], values: number[]) {
  const epsilon = 0.001;
  const indices = [...new Set(equations.flatMap((row) => row.variables))].sort(
    (a, b) => a - b,
  );
  const columns = new Map(indices.map((i, column) => [i, column]));
  const rows = equations.flatMap((equation) => {
    const baseline = equation.evaluate(values);
    const rows = baseline.map(() => new Array<number>(indices.length).fill(0));
    for (const i of new Set(equation.variables)) {
      const original = values[i];
      values[i] = original + epsilon;
      const next = equation.evaluate(values);
      values[i] = original - epsilon;
      const previous = equation.evaluate(values);
      values[i] = original;
      for (let row = 0; row < baseline.length; row++)
        rows[row][columns.get(i)!] =
          (next[row] - previous[row]) / (2 * epsilon);
    }
    return rows;
  });
  return { rows, indices };
}

function eliminated(matrix: number[][], columns: number, tolerance: number) {
  let pivots = 0;
  for (let col = 0; col < columns && pivots < matrix.length; col++) {
    let best = pivots;
    for (let row = pivots + 1; row < matrix.length; row++)
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[best][col])) best = row;
    if (Math.abs(matrix[best][col]) <= tolerance) continue;
    [matrix[best], matrix[pivots]] = [matrix[pivots], matrix[best]];
    const pivot = matrix[pivots];
    const divisor = pivot[col];
    for (let j = col; j < pivot.length; j++) pivot[j] /= divisor;
    for (let row = 0; row < matrix.length; row++) {
      if (row === pivots) continue;
      const factor = matrix[row][col];
      if (factor === 0) continue;
      for (let j = col; j < pivot.length; j++)
        matrix[row][j] -= factor * pivot[j];
    }
    pivots++;
  }
  return pivots;
}

function errorScore(values: number[]) {
  return values.reduce((total, v) => total + v * v, 0);
}

function conflicting(
  equations: Equation[],
  values: number[],
  tolerance: number,
) {
  return equations
    .filter((row) => row.evaluate(values).some((v) => Math.abs(v) > tolerance))
    .map((row) => row.id);
}

export function validateConstraints(
  walls: readonly Wall[],
  constraints: readonly Constraint[] = [],
) {
  if (!constraints.length) return;
  const { original, equations } = system(walls, constraints);
  const unsatisfied = conflicting(equations, original, constraintToleranceMm);
  if (unsatisfied.length) throw new ConstraintConflict(unsatisfied);
}

export function constraintReport(
  walls: readonly Wall[],
  constraints: readonly Constraint[] = [],
) {
  const { original, equations } = system(walls, constraints);
  const { rows, indices } = jacobian(equations, original);
  const independent = eliminated(rows, indices.length, 1e-5);
  return {
    constraintCount: constraints.length,
    degreesOfFreedom: original.length - independent,
    redundantEquations: rows.length - independent,
    conflictingConstraintIds: conflicting(
      equations,
      original,
      constraintToleranceMm,
    ),
    constraints,
    toleranceMm: constraintToleranceMm,
  };
}

export function solveConstraints(
  walls: readonly Wall[],
  constraints: readonly Constraint[],
): Wall[] {
  if (!constraints.length) return [...walls];
  const { variables, original, equations } = system(walls, constraints);
  let values = original.slice();
  let residual = residuals(equations, values);
  let score = errorScore(residual);
  for (
    let iteration = 0;
    iteration < 32 && score > precision ** 2;
    iteration++
  ) {
    const { rows, indices } = jacobian(equations, values);
    const gram = rows.map((row, i) => [
      ...rows.map(
        (column, j) =>
          row.reduce((sum, item, k) => sum + item * column[k], 0) +
          (i === j ? 0.0001 : 0),
      ),
      -residual[i],
    ]);
    eliminated(gram, rows.length, 1e-10);
    const delta = indices.map((_, col) =>
      rows.reduce((sum, row, i) => sum + row[col] * gram[i][rows.length], 0),
    );
    let improved = false;
    for (let factor = 1; factor >= 1 / 128; factor /= 2) {
      const next = values.slice();
      for (const [col, i] of indices.entries()) next[i] += delta[col] * factor;
      const nextResidual = residuals(equations, next);
      const nextScore = errorScore(nextResidual);
      if (nextScore >= score - 1e-13) continue;
      values = next;
      residual = nextResidual;
      score = nextScore;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  const continuous = conflicting(equations, values, 0.001);
  if (continuous.length)
    throw new ConstraintConflict(
      continuous,
      "No valid solution was found for this set of constraints.",
    );
  const result = walls.map((wall) => {
    const nextPoint = (end: WallEndpoint["endpoint"]) => {
      const index = variables.get(
        (wall.storeyId ?? defaultStoreyId) + ":" + pointKey(wall[end]),
      )!;
      return {
        x: Math.round(values[index]) + 0,
        y: Math.round(values[index + 1]) + 0,
      };
    };
    const start = nextPoint("start");
    const end = nextPoint("end");
    if (
      pointKey(start) === pointKey(end) ||
      !modelPointInput.safeParse(start).success ||
      !modelPointInput.safeParse(end).success
    )
      throw new ConstraintConflict(
        constraints.map(({ id }) => id),
        "Solving would collapse a wall or leave the supported canvas.",
      );
    return { ...wall, start, end };
  });
  validateConstraints(result, constraints);
  return result;
}

export function drivingDimensions(
  walls: readonly Wall[],
  constraints: readonly Constraint[] = [],
) {
  if (!constraints.length) return [];
  const byId = new Map(walls.map((w) => [w.id, w]));
  return constraints.flatMap((c) =>
    c.kind === "fixed_distance"
      ? [
          {
            id: c.id,
            start: byId.get(c.first.wallId)![c.first.endpoint],
            end: byId.get(c.second.wallId)![c.second.endpoint],
            distanceMm: c.distanceMm,
          },
        ]
      : [],
  );
}
