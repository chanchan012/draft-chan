import { eq, sql } from "drizzle-orm";
import { openDatabase } from "../../db/client";
import {
  floorplanProjectMembers as members,
  floorplans,
} from "../../db/schema";
import type { ProjectRole } from "../plans/projects";

export type ProjectAccess = {
  owner: string;
  projectId: string;
  role: ProjectRole;
};
export const projectKey = sql<string>`coalesce(${floorplans.projectId}, ${floorplans.id})`;

export function planPermission(
  user: string,
  permission: "read" | "edit" | "review" | "own",
) {
  const own = eq(floorplans.ownerId, user);
  if (permission === "own") return own;
  const required =
    permission === "edit"
      ? sql`and ${members.role} = 'editor'`
      : permission === "review"
        ? sql`and ${members.role} in ('reviewer', 'editor')`
        : sql.empty();
  return sql`(${own} or exists (
    select 1 from ${members}
    where ${members.projectId} = ${projectKey} and ${members.userId} = ${user} ${required}
  ))`;
}

export async function projectAccess(
  user: string,
  planId: string,
): Promise<ProjectAccess | null> {
  const [row] = await openDatabase()
    .select({
      owner: floorplans.ownerId,
      projectId: projectKey,
      role: members.role,
    })
    .from(floorplans)
    .leftJoin(
      members,
      sql`${members.projectId} = ${projectKey} and ${members.userId} = ${user}`,
    )
    .where(eq(floorplans.id, planId));
  if (!row) return null;
  const role = row.owner === user ? "owner" : row.role;
  return role ? { owner: row.owner, projectId: row.projectId, role } : null;
}
