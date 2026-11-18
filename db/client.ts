import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
export function openDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for persistent floorplans");
  return drizzle(neon(process.env.DATABASE_URL), { schema });
}
