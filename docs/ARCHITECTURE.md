# Architecture

## Foundation

Next.js 16 App Router renders the landing and dashboard. React 19 handles the sample viewer, field guide, and Clerk authentication dialogs. Tailwind 4 and app/globals.css supply responsive layout and locally bundled fonts. The page shell uses 100dvh. Dialogs and the authentication region permit internal scrolling on short screens.

The public landing displays a static isometric illustration. Signed-in members can open the interactive sample from the dashboard, switch views, magnify the drawing, and toggle the grid. Its two-dimensional SVG and isometric image are independent study drawings. The shared graph engine is described under M2.1.

## Identity and RPC

The Next proxy runs Clerk middleware on page requests. It protects /dashboard and the /studio path, including descendants. Unsigned requests redirect to the landing sign-in dialog. The dashboard server component also verifies the session before rendering. The landing reads the session to render the appropriate account action. Auth dialogs are public, and both Clerk keys are required for workspace access. An installation with missing keys shows an availability message in the dialog.

Hono independently verifies Clerk sessions with @hono/clerk-auth. All Hono workspace routes return HTTP 401 for unsigned or unconfigured requests and use private, no-store responses. GET /api/session returns the verified member identity and GET /api/account returns its user ID. Floorplan persistence remains owner-scoped. The Inngest endpoint retains its separate signing-key authentication.

The landing opens auth with `/?auth=sign-in` or `/?auth=sign-up`. Clerk uses hash routing for form steps inside the dialog. The proxy redirects legacy sign-in and sign-up paths and includes a validated `returnTo` path for private dashboard or studio destinations. The dialog carries this target between both modes and uses it for the Clerk completion redirect. A direct landing auth link defaults to /dashboard.

The Upstash limiter allows 60 requests per 60-second sliding window. It uses the Vercel-supplied client address in deployed functions. The local fallback shares one bucket outside Vercel and is per-process. Both Redis variables are needed for a distributed limit. Incomplete Redis configuration or a Redis error yields HTTP 503. Throttled requests yield HTTP 429 and Retry-After.

## Persistence

The Drizzle source of truth is db/schema.ts. Its checked-in SQL migration creates the display_unit enum (mm, in) and floorplans table. Each row contains a UUID id, Clerk owner_id, name, display unit, nonnegative revision, JSONB graph and timestamptz creation/update times. The owner and update time form a composite index. Graph version 1 has arrays for walls, rooms, openings, fixtures and dimensions. The default graph is empty. Dashboard RPC scopes queries by the authenticated owner and compares revisions for rename and delete.

The Neon HTTP adapter connects lazily through DATABASE_URL. M1.1 performs no database writes at runtime. Migrations run explicitly against the chosen database.

## Deployed M1.1 topology

GitHub repository chanchan012/draft-chan supplies the tested branches to the Vercel Next.js project draft-chan. Vercel serves the session-aware landing page, static image assets, the Next proxy, and the Hono catch-all function. The production domain is https://draft-chan.vercel.app. Production and Preview use the same Clerk development instance, so an account can sign in on either deployment. Production uses Upstash throttling and Preview uses per-process throttling. Both environments point to the same Neon database, `draft`. The `draft_app` role has read and write access to floorplans. Apply schema migrations with the database owner credential.

The shared database has db/migrations/0000_broad_spyke.sql applied and recorded in the Drizzle migration ledger. The dashboard and job endpoint arrived in M1.2. SSE, the command engine and MCP transports remain future subgoals.

## M1.2 dashboard and background processing

The landing workspace link and Clerk fallback redirects lead to /dashboard. The dashboard fetches /api/floorplans and redirects to sign-in if the session expires. The dashboard header contains the Draft brand and the Clerk account control. Members can create, inspect, search, rename and delete plans. The shell occupies 100dvh and the library scrolls internally. See [DESIGN.md](../DESIGN.md) for the design capture and styling decisions.

The collection supports GET and POST. The /api/floorplans/:id route supports GET, PATCH and DELETE. Mutations validate strict request bodies. Creation uses a client-generated UUID so retries stay on one row. Rename and delete require the observed revision and return 409 for a stale or unavailable plan. Every user-facing database operation includes the verified Clerk owner. Unsafe requests with a foreign Origin receive HTTP 403.

Room polygons are arrays of {x,y} vertices in millimeters. The rectangle starter records one room in the version 1 graph. Dashboard area uses the sum of absolute shoelace areas converted to m² and ft². Empty and pre-M1.2 graphs without room polygons give zero. M2.1 derives rooms from connected walls and subtracts inner boundaries from the surrounding room area.

Migration db/migrations/0001_watery_rachel_grey.sql adds nullable floorplans.thumbnail text. A null value means pending. The Inngest app draft-cad-studio serves /api/inngest. Creation sends draft/floorplan.thumbnail.requested with the plan UUID. The render-floorplan-thumbnail function generates SVG from numeric coordinates and writes only a still-pending matching revision. Deleted plans and duplicate deliveries are harmless. The recover-pending-thumbnails function scans up to 100 pending rows every 15 minutes, including legacy rows and failed initial sends. The client refreshes pending thumbnails while the library is visible.

## M2.1 geometry and command store

The graph stays on JSON version 1 and uses the existing PostgreSQL migrations. A wall is identified by its authored ID and carries `start`, `end`, `thicknessMm`, `kind`, and optional `createdBy` and `updatedBy` actors. Authored endpoints are integer millimeters within ±1,000,000 mm. Thickness is a positive integer from 1 through 10,000 mm. Actor records contain a `kind` of `human` or `ai` and an `id`. Dashboard creation uses the verified Clerk owner for newly authored walls. A saved rectangular starter gets four deterministic 120 mm interior walls when loaded into the store. Legacy starter walls have empty attribution until edited.

`solveWallTopology` in `lib/plans/wall-topology.ts` intersects centerlines, splits T-junctions and crossings, deduplicates collinear spans while retaining their contributing wall IDs, and walks the resulting graph to derive bounded faces. Intersections are reduced rational coordinates internally and are emitted as millimeter numbers. Canonical boundary order and geometry-derived room IDs keep a layout stable across wall order, reversal, and redundant collinear subdivisions. The room record contains `id`, `polygon`, and optional `holes`. Inner enclosures yield a bounded room of their own and a hole in the surrounding room. Dashboard areas and thumbnail polygons use these same boundaries. Areas measure to wall centerlines and exclude holes.

`createDraftPlanStore` in `lib/plans/command-store.ts` wraps a Zustand vanilla store and accepts the saved graph. `execute(command, actor)` validates wall add, update, and remove operations before committing to the store. Each edit records the actor and its forward and inverse Immer patches. Undo and redo restore walls, rooms, and attribution together. These histories belong to the local store. The dashboard RPC returns plan cards. Studio uses dedicated owner-scoped graph endpoints.

## M2.2 Studio editor

The dashboard plan details link to `/studio/[id]`. Clerk and the owner-scoped database lookup protect the server route. The SVG drawing surface supports two-point or drag wall placement, pointer and keyboard input, endpoint and grid snaps, and an Ortho toggle. Millimeter and inch grids share integer millimeter model coordinates. Inch coordinates round to the nearest millimeter when committed. Pan, zoom, fit, and the inspector operate within the 100dvh workbench. Room fills and area summaries use wall centerlines. The isometric view projects wall runs at a fixed height of 2450 mm and depicts door openings as gaps for visual review.

Version 1 JSON now types the existing `openings` array. A door has `id`, `wallId`, integer `offsetMm` to its center from the authored wall start, `widthMm`, `hinge`, `swing`, and optional actor records. The store validates wall bounds and overlap along each host wall. Deleting a wall removes its doors in the same undoable command. The same command history supports drawing, editing, deleting, undoing, and redoing doors.

`GET /api/floorplans/:id/graph` returns `id`, `name`, `revision`, `unit`, and the normalized graph. Studio Save sends `PATCH` with the expected revision, display unit, and authored walls and openings. The current editor accepts up to 512 walls and 1024 doors. The server verifies ownership and revision, validates the geometry, derives room polygons and attributable changes, and updates the graph, unit, next revision, and thumbnail state together. The job queue regenerates missing previews, including open-wall drawings. A conflict retains local edits and offers the saved version in a new tab. The release uses the existing Drizzle migrations and JSON version.

## M3.1 fixtures, utility layers, and clearance screening

The fixture catalog in `lib/plans/catalog.ts` defines 12 templates and defaults for width, depth and height. The six utility templates cover outlet, switch, light, hot water, cold water and drain. Version 1 JSON `fixtures` records carry `id`, `template`, integer millimeter `position`, `widthMm`, `depthMm`, `heightMm`, cardinal `rotation`, and optional actor records. New `utilities` records carry `id`, `template`, `position` and actor records. A template determines the electrical or plumbing layer. Older graphs receive an empty utility array.

The Inspector edits dimensions, rotation and position. Add, update and delete operations use the existing undoable command store. Two-dimensional footprints use cardinal rotations and the isometric view projects the fixtures to their model heights. Utility symbols render in 2D as independently toggleable layers. Visibility is a view preference for the open Studio tab. Save persists the symbols and fixtures with the graph.

Graph PATCH accepts optional `fixtures` and `utilities` arrays, each bounded to 512 records. Omitted arrays preserve the saved collections for earlier callers. Submitted records are validated and checked for duplicate IDs. The owner supplies attribution through the existing revision-checked server path. The release uses the existing Drizzle migrations through 0001.

`checkClearances` flags modeled door widths below the published 815 mm benchmark, local gaps below the 915 mm benchmark, intersecting fixture and wall footprints, and obstructed or overlapping 90° door swings. Gap checks sample exposed cross-sections between parallel faces with at least 300 mm of shared span. Polygon collisions exclude tangent contact, and door swing checks against solids use a circular sector. Selecting a result highlights its geometry in plan view. Reports show at most 200 findings. The screen addresses modeled geometry. Actual doorway clear width at 90°, irregular routes, turns, and exceptions require separate review. [2010 ADA Standards §§ 403.5 and 404.2](https://www.ada.gov/law-and-regs/design-standards/2010-stds/#chapter-4-accessible-routes)
