# Architecture

The [architectural CAD roadmap](CAD_ROADMAP.md) tracks proposed geometry, rendering and MCP extensions. M13 proposes a presentation scene derived from the saved graph, with entity IDs shared across views and versioned materials, camera and lighting for reproducible exports. The shipped SVG cutaway is described below.

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

Dashboard floorplan cards link directly to `/studio/[id]`. Clerk and the owner-scoped database lookup protect the server route. The SVG drawing surface supports two-point or drag wall placement, pointer and keyboard input, endpoint and grid snaps, and an Ortho toggle. Millimeter and inch grids share integer millimeter model coordinates. Inch coordinates round to the nearest millimeter when committed. Pan, zoom, fit, and the inspector operate within the 100dvh workbench. Room fills and area summaries use wall centerlines. The isometric view projects wall runs at a fixed height of 2450 mm and depicts door openings as gaps for visual review.

Version 1 JSON now types the existing `openings` array. A door has `id`, `wallId`, integer `offsetMm` to its center from the authored wall start, `widthMm`, `hinge`, `swing`, and optional actor records. The store validates wall bounds and overlap along each host wall. Deleting a wall removes its doors in the same undoable command. The same command history supports drawing, editing, deleting, undoing, and redoing doors.

`GET /api/floorplans/:id/graph` returns `id`, `name`, `revision`, `unit`, and the normalized graph. Studio Save sends `PATCH` with the expected revision, display unit, and authored walls and openings. The current editor accepts up to 512 walls and 1024 doors. The server verifies ownership and revision, validates the geometry, derives room polygons and attributable changes, and updates the graph, unit, next revision, and thumbnail state together. The job queue regenerates missing previews, including open-wall drawings. A conflict retains local edits and offers the saved version in a new tab. The release uses the existing Drizzle migrations and JSON version.

## M3.1 fixtures, utility layers, and clearance screening

The fixture catalog in `lib/plans/catalog.ts` defines 12 templates and defaults for width, depth and height. The six utility templates cover outlet, switch, light, hot water, cold water and drain. Version 1 JSON `fixtures` records carry `id`, `template`, integer millimeter `position`, `widthMm`, `depthMm`, `heightMm`, cardinal `rotation`, and optional actor records. New `utilities` records carry `id`, `template`, `position` and actor records. A template determines the electrical or plumbing layer. Older graphs receive an empty utility array.

The Inspector edits dimensions, rotation and position. Add, update and delete operations use the existing undoable command store. Two-dimensional footprints use cardinal rotations and the isometric view projects the fixtures to their model heights. Utility symbols render in 2D as independently toggleable layers. Visibility is a view preference for the open Studio tab. Save persists the symbols and fixtures with the graph.

Graph PATCH accepts optional `fixtures` and `utilities` arrays, each bounded to 512 records. Omitted arrays preserve the saved collections for earlier callers. Submitted records are validated and checked for duplicate IDs. The owner supplies attribution through the existing revision-checked server path. The release uses the existing Drizzle migrations through 0001.

`checkClearances` flags modeled door widths below the published 815 mm benchmark, local gaps below the 915 mm benchmark, intersecting fixture and wall footprints, and obstructed or overlapping 90° door swings. Gap checks sample exposed cross-sections between parallel faces with at least 300 mm of shared span. Polygon collisions exclude tangent contact, and door swing checks against solids use a circular sector. Selecting a result highlights its geometry in plan view. Reports show at most 200 findings. The screen addresses modeled geometry. Actual doorway clear width at 90°, irregular routes, turns, and exceptions require separate review. [2010 ADA Standards §§ 403.5 and 404.2](https://www.ada.gov/law-and-regs/design-standards/2010-stds/#chapter-4-accessible-routes)

## Pre-M3.2 editing and navigation

Valid inspector values update the local drawing immediately. Numeric controls keep incomplete input while the field is active. Save sends the current snapshot through the revision-checked graph PATCH.

The drawing surface uses pointer capture for drawing, moving, and marquee selection. Pinch zoom anchors the model point under the moving midpoint, which also supports two-finger panning. A pinch suppresses tool placement until both touches have lifted. Select supports a marquee dragged from empty canvas and additive toggling with Shift-click or the toolbar’s Multi-select mode. The current selection excludes hidden utility layers. Selected elements can be dragged or nudged by the grid spacing. Backspace, Delete and the toolbar’s Delete selection invoke the same group removal command. Focus inside an editable field keeps its normal text editing shortcuts.

The selection logic in `lib/plans/editor-selection.ts` produces existing entity commands. The store’s `executeBatch` applies them atomically, validates final opening placement, and recomputes room topology once when walls change. A group edit occupies one undo step. Moving a host wall carries its doors. Moving a door alone projects the drag along its wall and updates its existing `offsetMm` field subject to normal validation. Drag previews show authored geometry, and committed edits recalculate derived rooms. This release uses JSON graph version 1 and Drizzle migrations through 0001.

The card’s top-right ellipsis opens Rename and Delete actions. These use the existing revision-checked dashboard endpoints and dialogs. The card link and its action button are independent keyboard targets.

## Floating Studio workbench

The Studio header holds the floorplan name and save state, drawing history, zoom controls, and Save. The `Surface` owns the zoom and fit state and renders the controls into the header through a React portal. The 2D, Isometric, and Ortho controls float above the drawing. Drawing tools float vertically at the left of the canvas and move to a bottom row at widths of 620 px or below or heights of 490 px or below. Selection actions float separately near the bottom.

The Layers rail opens the utility visibility panel. The right rail opens the Inspector or Clearance in the same panel. Both panels start collapsed. Above 1000 px, `StudioPanel` docks each panel next to the canvas and provides a pointer and keyboard separator. Widths stay local to the open Studio tab and are restored when the panel reopens. At 1000 px or below, a single panel overlays the drawing. At 620 px or below, that panel opens from the bottom and its content scrolls within the sheet. The workbench fits `100dvh` throughout. Layout preferences live in component state. The saved plan uses graph version 1 and Drizzle migrations through 0001.

## M3.2 bill of materials and blueprints

The Exports button opens the shared Studio panel. It displays the current saved revision and polls every four seconds while a blueprint is pending. The owner can start a DXF or SVG job or download a materials CSV once the latest changes are saved. A failed job offers Retry. The client handles download errors in the panel and stops polling when the panel closes.

The `/api/floorplans/:id/bom?revision=N` route calculates CSV from the saved graph when the requested revision matches. `calculateBom` groups authored walls by kind and thickness, deducts hosted door widths from linear wall quantities, and counts doors by width, fixtures by template and dimensions, and utility symbols by template. Wall lengths are in meters and dimensions are in millimeters.

`POST /api/floorplans/:id/exports` accepts a DXF or SVG format and saved revision. An atomic `INSERT … SELECT` captures the floorplan’s name and graph at that revision under the verified owner. The `floorplan_exports` table keeps one row per floorplan, revision, and format. Duplicate pending or ready requests reuse the row. Retry increments the attempt and keeps the original snapshot. Newly requested stale revisions return HTTP 409. `GET /api/floorplans/:id/exports?revision=N` lists the owner’s job statuses. `GET /api/floorplans/:id/exports/:exportId/download` serves the completed attachment after checking ownership and readiness. Deleting a floorplan cascades to its exports.

The `render-floorplan-blueprint` Inngest function receives the job ID and attempt and renders inside a durable step. The update checks the pending status and attempt, writes the artifact, and clears the snapshot. The failure callback marks the same attempt as failed. The five-minute `recover-pending-blueprints` schedule resends events for pending jobs older than two minutes using the same deduplication ID. DXF and SVG share wall-run outlines, door leaves and swings, fixture footprints, and utility markers. DXF uses millimeters and the CAD Y-up coordinate system. SVG uses millimeter page dimensions and the Studio Y-down orientation.

Migration `0002_green_firebird.sql` adds the export table and two enums. The application runtime accesses the table through the existing `draft_app` role. The floorplan graph stays at version 1. The jobs use the existing Inngest application and its Production credentials.

## M4.1 live sync, presence, and autosave

`GET /api/floorplans/:id/live` authenticates through Clerk and checks ownership in Neon before opening an SSE response. Its JSON frames carry revision notifications, presence, and deletion. A snapshot carries the current revision and active cursors. After the initial snapshot, the stream rechecks the owner and revision every ten seconds, which recovers missed Pub/Sub events and removes deleted plans. Streams close after 25 seconds or at the verified Clerk token expiry, whichever occurs first. The client reconnects with the current session and stops on HTTP 401 or 404. The API function has a 60-second maximum duration.

Graph writes, renames, and deletes publish after the Neon write. Postgres owns the graph and revision. Redis distributes revision notifications and stores up to 32 presence leases per plan. Each cursor renews on movement at most twice a second and refreshes about every 11 seconds while the tab is visible. Leases expire after 25 seconds. Redis updates the lease index, cursor hash, and Pub/Sub publication atomically. Keys use the verified owner and canonical floorplan ID. Production uses the existing Upstash REST configuration. Environments without those keys use a process-local bus, with revision catch-up through Neon between instances.

`POST /api/floorplans/:id/presence` accepts a tab UUID and a model-space cursor or null. It takes the human actor from Clerk and verifies ownership. A trusted server caller can publish an AI cursor through `publishPlanPresence` in `lib/server/live-bus.ts` after verifying access to the plan. Public requests use 60 RPC requests per minute per ingress bucket and a separate 300-request bucket for cursor updates.

Studio autosaves after 1.2 seconds of editing inactivity through the revision-checked graph PATCH. It serializes saves and remote reads, retries transient failures with backoff, and applies newer revisions to clean tabs automatically. A dirty tab compares the current draft, its last saved snapshot, and the new saved snapshot. Changes to different objects merge if the combined geometry validates. Different edits to the same object or invalid combined geometry pause saving and preserve the draft. Merged local geometry becomes one undo step on the new baseline. Exports still target the displayed saved revision. The release uses graph version 1 and Drizzle migrations through 0002.

## M4.2 agent authentication and transports

In a signed-in Studio, open **Connect an agent** to issue a credential. `GET`, `POST`, and `DELETE` under `/api/floorplans/:id/agent-tokens` use Clerk and verify the floorplan owner. The server generates a 256-bit bearer token and reveals it on creation. Neon stores its SHA-256 hash, display name, floorplan ID, token UUID, and seven-day expiration. The UUID is the trusted AI actor ID. Revocation removes the row and invalidates subsequent requests. Deleting a plan removes its tokens through the foreign key. Migration `0003_wandering_terror.sql` adds the table, unique hash constraint, and floorplan/expiry index. The Vercel runtime role `draft_app` has SELECT, INSERT, and DELETE on the table.

`/api/mcp` uses the MCP v2 server SDK with the Hono adapter and stateless Streamable HTTP. It resolves each bearer token to a plan and owner before creating a server for the request. The endpoint rejects foreign origins and has a separate 120-request sliding-window bucket per minute and ingress client address. `scripts/mcp-stdio.mjs` runs a local MCP server and relays resources and tools to the same authenticated HTTP endpoint. Its client requires `DRAFT_MCP_URL` and `DRAFT_MCP_TOKEN`. The deployed application uses its existing environment variables and Clerk development instance.

### MCP resources and tools

| Resource | Response |
| --- | --- |
| `draft://floorplan-graph` | Saved floorplan, revision, and geometry in model millimeters |
| `draft://spatial-audit` | Room polygons and square meters, modeled doorway widths, and room adjacency |
| `draft://catalog` | Furniture, electrical and plumbing templates, and room presets |

The six graph editing tools are `draw_wall`, `split_or_join_wall`, `place_opening`, `place_fixture`, `furnish_room_preset`, and `add_dimension_annotation`. Each validates Zod input, takes `expectedRevision`, and returns the updated revision and affected IDs. Wall splits and joins remap hosted openings. A room preset writes all its fixtures together. `revision_conflict` means the client should read `floorplan-graph` again before retrying. On a committed edit, the same owner-scoped channel used by Studio publishes the revision and an AI cursor lease. Browser autosave and graph reconciliation see agent edits through that channel.

`check_clearance_codes` runs Draft’s modeled doorway, walkway, door-swing, and collision screening. `calculate_bom` returns the current materials and fixture counts. `trigger_dxf_export` takes the saved revision and uses the existing durable Inngest export pipeline. Repeating the request for the same revision returns its status. The returned download path uses the existing signed-in owner route.

### Windows and dimension annotations

Graph version 1 adds optional `windows` and `annotations` collections. Existing graphs and older snapshot writers can omit either collection. Window parameters use a host wall ID, center offset, width, sill, and height in millimeters. Windows and doors share host-wall validation. Dimension annotations use two distinct model points and display their distance in the selected unit. Studio’s Door tool offers the Window mode in the inspector. Measure draws dimension annotations. Both collections participate in revision reconciliation, history, and SVG and DXF blueprints. Windows also render in the isometric view and appear in BOM counts.

## Clerk OAuth for MCP

OAuth clients discover `/.well-known/oauth-protected-resource/api/mcp` through the `WWW-Authenticate` challenge. The metadata advertises the exact resource `https://draft-chan.vercel.app/api/mcp` and the authorization server derived from Draft’s Clerk publishable key. The existing Clerk development instance issues access tokens for the registered audience. It supports PKCE with S256 and OAuth Client ID Metadata Documents (CIMD). Dynamic Client Registration is disabled. OAuth is advertised only at the configured resource origin. Deployments with a separately registered URL can set `DRAFT_MCP_OAUTH_RESOURCE_URL` to that URL.

The Hono middleware passes the Authorization header to Clerk’s backend SDK with `acceptsToken: 'oauth_token'` and the exact Draft audience. Studio sessions are used separately for floorplan grant management. OAuth access requires the token’s verified user and client identities and an enabled floorplan owned by that user. The `floorplan_oauth_grants` table uses the owner ID as its primary key, references the floorplan with cascade deletion, and stores a grant UUID. Draft combines that UUID with the Clerk client ID for a stable AI attribution and cursor ID. All OAuth clients approved by the user for Draft can access that account’s selected floorplan. Disable OAuth access on the current floorplan before enabling another. Revoking the Studio grant blocks subsequent MCP requests while it remains disabled.

`GET`, `POST`, and `DELETE` on `/api/floorplans/:id/mcp-oauth` use authenticated workspace RPC. Changes require the Draft origin. The OAuth flow uses the same resources, tools, revision checks, and rate limiter as manual agent tokens. The production migration is `0004_mcp_oauth_floorplans.sql`. The runtime role requires SELECT, INSERT, and DELETE on the new table. Graph version 1 and existing token credentials remain compatible.

## Studio wall joins and isometric cutaway

Studio derives corner fill polygons from solid wall runs in `lib/plans/wall-mesh.ts`. When endpoints coincide and the outer angle leaves space between the run ends, the mesh intersects the two wall offsets to fill that corner. Acute angles use a bevel when the intersection exceeds the miter limit. Door and window jambs come from the original runs. Only coincident endpoints get a corner fill, so deliberate spacing between separated walls stays visible. The shared fill geometry is used in plan and isometric views and is derived from graph version 1 at render time.

`lib/plans/isometric.ts` classifies perimeter walls by room adjacency and camera direction. The cutaway displays rear walls at 2450 mm, foreground walls at 1020 mm, and interior partitions at 1030 mm. These are display heights. It clips window geometry at the visible wall height and unions equal-height wall sections and floor contours with Polygon Clipping. The SVG renderer adds a 165 mm slab, wood grain and wet-room finishes, glazing, and template-specific furniture details. The isometric camera uses a wider fit on phones. The release uses database migrations through 0004.


## Precision drafting

`lib/plans/precision.ts` is shared by Studio and MCP. Queries page stable kind/ID references, use model-space bounding envelopes and report the saved revision over MCP. Centerline snaps resolve endpoints, midpoints, finite-segment intersections and perpendicular feet. Wall-face mode resolves either longitudinal face of a directed wall. The positive edge is the offset along `(-dy, dx)` in Draft's Y-down coordinates. Finish-to-finish measurements use the shortest segment between the requested faces. Measurements preserve fractional millimeters. The write boundary rounds input coordinates once to integer model millimeters. Existing OAuth scopes govern all new read tools.


## Sketch geometry and polar input

Graph v1 has an optional `sketches` array of up to 512 records. Each record has a stable ID, typed geometry and authored attribution. The four kinds are `construction`, `polyline`, `circle` and `arc`. Polylines hold up to 128 vertices. Linear coordinates and circle or arc centers store integer millimeters. Radii and angles preserve fractional values. The model uses Y-down coordinates, zero degrees pointing right and an increasing clockwise angle. DXF reverses Y and swaps arc endpoints to maintain the model's occupied sweep.

`lib/plans/sketch.ts` supplies SVG path generation, bounds, hit testing and polar input. The command store applies add, replace and remove within existing undo batches. Snapshot saves validate the optional collection and preserve the saved array if an older client omits it. The rebase merges disjoint sketches by ID and surfaces conflicts on simultaneous edits of the same sketch. Construction lines appear dashed in Studio and SVG and are placed on a separate CONSTRUCTION layer in DXF. Sketch records remain separate from wall topology, clearance and material quantities.

In Studio, the local origin shifts the drawing grid and the coordinate input frame for the open workspace. The public graph and MCP tools keep absolute model coordinates. Numeric distance and angle input bypasses snap and tracking. With pointer input the active object snap takes precedence, followed by wall Ortho, optional polar tracking and grid snapping. The precision measurement tools continue to use wall references and model points.


## M6.1 CAD editing commands

Studio's Edit geometry panel and MCP both use `lib/plans/cad-edit.ts` to build the existing PlanCommand batches. Hosted doors and windows are translated, rotated or copied with their wall. Reflection flips the door swing. Trim/extend and chamfer project the existing opening centers onto the new wall and reject a cut that would leave an opening outside it. The change summary reports authored geometry and affected opening IDs. Dimension annotations are independent coordinates. Current furniture uses cardinal rotations, and fillets are curves on sketch linework. Straight walls support a chamfer with matching type and thickness.


## M6.2 Agent transactions and revision history

`preview_changes` runs up to 24 ordered CAD edits in memory. Each operation validates geometry before the next operation runs. The response includes before and after geometry, affected opening IDs and a 15-minute HMAC-signed token. The signature is domain-separated and uses the existing Clerk server secret. It binds the floorplan, owner and agent scope to the saved revision, normalized inputs and resulting authored snapshot. Generated entity IDs derive from the preview UUID so apply reproduces the preview across instances.

`apply_changes` verifies the token and reruns the same operations. The conditional floorplan UPDATE and the receipt INSERT share one PostgreSQL statement. A database trigger archives the previous revision within that statement. Competing requests with the same token return the originally committed receipt, including after preview expiry while authentication and token verification succeed. Different previews against a stale revision receive `revision_conflict`. The existing live bus sends one revision event after commit.

Migration `0005_agent_transactions.sql` creates `floorplan_revisions` and `floorplan_edit_batches`. Revision changes from existing saves and renames archive the previous row. `diff_revisions` reads current and archived owner-scoped versions in a single query, then pages the authored object differences. Comparisons start with the state at migration rollout. Both tables cascade when the floorplan is deleted. The trigger archives from the floorplan row with a fixed search path. The runtime role reads the archive and reads and inserts receipts.

Studio fetches the optional latest `agentBatch` marker with the saved graph. When an open tab has a clean baseline and receives the immediately following revision from an agent batch, it creates one undo entry for the whole change. Dirty or skipped-revision updates use the existing rebase and conflict behavior.


## M7.1 Wall constraints

The saved graph has up to 96 optional wall constraints. `lib/plans/constraints.ts` uses shared coordinates as joint variables during a solve and iterates damped least-squares steps. It rounds the solved coordinates to the millimeter model, validates relations within 2 mm, guards hosted opening bounds, and rebuilds derived rooms before committing. The diagnostic reports Jacobian rank and remaining coordinate degrees of freedom, including rigid motion. Driving dimensions reference wall endpoints and appear in drawing exports. Direct edits validate existing relations, and removing a referenced wall requires removing its constraints in the same edit or first.


## M7.2 Drawing organization

Named layers store stable entity-kind and ID references, a display name, visibility, a color, a 2D line pattern and a lock flag. Each object belongs to at most one named layer. Visibility filters Studio display, hit testing and snapping. The export worker uses the authored graph, including geometry on layers hidden in Studio. Constraints and quantities also use the authored model.

Shared block definitions support doors, windows and catalog fixtures. Instances retain native object IDs and placement. Each link stores its definition and an override map. Definition edits materialize inherited values into native objects, and direct instance edits update the relevant overrides. This keeps the existing clearance, quantity, isometric and export paths working with the resolved dimensions. Copy, mirror and arrays preserve links. A mirrored door copy records its new swing explicitly.

The command store and snapshot save share `lib/plans/organization.ts`. While a layer remains locked, changes to its members, links, objects or an opening's host wall are rejected. A layer can be unlocked through the layer controls. Missing links from deleted unlocked objects are pruned. Snapshot rebasing and revision diffs include layers, definitions and instances. No relational migration is required.


## M8.1 Storeys and wall assemblies

Existing drawings resolve omitted storey references to `ground` with an elevation of 0 mm and wall height of 2450 mm. Named storeys share a single graph. Rooms are derived from wall reference segments by storey. Openings derive their storey from their host. Wall assemblies sum up to 16 named material thicknesses, and resolving the thickness leaves the authored wall endpoints fixed. Physical wall outlines, opening placement and face measurements use the resulting offsets from the reference line.

`query_spaces` returns reference boundaries, net polygons after subtraction of wall material and gross enclosed plate areas. Gross omits free wall tails outside enclosed boundaries. Areas are geometric measurements in m². Studio edits and display are scoped to the active storey. SVG and DXF tile the storeys side by side in elevation order and label each plate.

## M8.2 Building structure and views

Graph v1 optionally stores `buildingElements` and `buildingViews`. Element records have a stable ID and a kind for slabs, openings, stairs or roofs. Slabs have an elevation offset and thickness. Manual openings reference a slab by ID. A straight stair stores its start and end, width, riser count and source and destination storeys. It can reference a slab on the destination storey. The stair footprint supplies the opening polygon whenever the slab is drawn or measured. Roofs have a footprint, base offset, roof axis and flat, shed or gable pitch.

`lib/plans/building.ts` validates polygons, storey and slab references, stair rise and runs, and containment within a hosting slab. Openings cut the slab polygons, and their union is excluded from storey area calculations. Studio undo and redo, MCP writes, graph saves and concurrent snapshot rebases share these checks. Removing a referenced slab requires changing its dependents first. The existing JSON graph storage and revision history hold these records.

`lib/plans/building-views.ts` derives a section along two plan points or an orthographic elevation from a cardinal direction. Views display storey datums, walls and hosted openings, slabs, stairs and roof profiles. Studio shows structure in each active storey plan and isometric view. Plan SVG and DXF include slab, floor opening, stair and roof outlines. Saved view definitions store the cut or orientation parameters, so they remain linked to subsequent model edits.

The eight M8.2 MCP tools are `create_slab`, `create_floor_opening`, `place_stair`, `create_roof`, `create_section`, `create_elevation`, `query_building_view` and `remove_building_item`. Writes use the existing authenticated plan scope and revision control. Use the same ID in `place_stair` to update the stair and read its regenerated opening. `query_building_view` returns derived drawing geometry for a saved view ID and lists view definitions and slab openings when the ID is omitted.

## M9.1 Drawing documents

Graph v1 stores optional `documentItems` with stable IDs for dimension chains, leaders, tags, hatches, named views, sheets and viewports. Chain dimensions and leaders resolve wall endpoints, opening centers, fixtures or user-entered fixed model coordinates when drawn. If referenced geometry is deleted, the annotations remain editable and Studio and MCP report their unresolved anchors. Hatches clip diagonal or crosshatch lines to a simple polygon.

A named view stores a source storey or building view plus a model-space center. A viewport occupies a rectangle in paper millimeters and converts model coordinates by its explicit scale denominator. Paper styles resolve optional named layer weights in millimeters. The same paper primitives describe clipping, paths and text for Studio and the PDF renderer. The existing revision graph persists paper layout and model geometry together.

The MCP tools are `dimension_chain`, `add_leader`, `tag_entities`, `add_hatch`, `save_named_view`, `create_sheet`, `place_viewport`, `remove_document_items` and `query_drawing_documents`.

## M9.2 Sheet schedules and issues

A sheet stores its number, title, paper size, orientation and optional project and drafter names. Studio and PDF render the same paper geometry and title block. A PDF viewport clips its vector paths and labels at its explicit paper rectangle. PDF coordinates convert at 72 points per inch. The publisher reserves the last 24 mm of each sheet for its title block. The surface preview uses the same layout. PDF text uses standard Helvetica and substitutes unsupported glyphs with a question mark.

Door and window schedules reuse authored tags and dimensions from the graph. Untagged openings are listed as such. A finish record anchors a floor, wall and ceiling specification to a point in an enclosed room on a storey. Finish schedules resolve that point against the saved room geometry and report net area. PDF publication requires a viewport per sheet and valid annotation and finish references.

One PDF job per floorplan and source revision uses the existing `floorplan_exports` table, Inngest worker, recovery schedule and owner-scoped download route. Migration 0006 adds the `pdf` enum value. The issue request captures an owned current or archived revision and queues it once. Successful render stores the binary PDF encoded as base64 in the existing artifact field. The immutable artifact is served as an attachment and remains available alongside new issues. The revision archive also retains the source graph. The Inngest step returns a completion flag and keeps the PDF in Neon.

MCP adds `set_room_finish`, `generate_schedule`, `publish_sheet_set`, `get_job_status` and `list_sheet_issues`. Agent scopes restrict schedule and job reads to the connected floorplan. Downloads require the existing app sign-in.

## M10.1 Staged DXF and calibrated underlays

`lib/plans/dxf-import.ts` reads ASCII-style group records with model-space LINE, straight LWPOLYLINE, CIRCLE and ARC. Supported header units are mm, cm, m, inches and feet. The user can override source units. DXF Y is inverted and coordinates are rounded to 1 mm. The stage reports unsupported entities, paper space, unsupported bulges or widths, extrusion and defined model limits. Studio handles files up to 2 MB. Import applies typed sketches and layer membership atomically.

Studio converts image files and selected PDF.js pages to bounded JPEG previews. Up to four underlays are stored in the existing graph. A two-point similarity transform determines the preview’s uniform scale, translation and rotation. Underlays appear behind 2D geometry on their storey. `inspect_import`, `import_dxf`, `attach_underlay`, `calibrate_underlay`, `list_underlays` and `remove_underlay` use the existing scoped MCP revision contract. Read responses omit raster bytes.

## M10.2 CAD exchange and references

Read-only drawing references store a versioned snapshot of supported DXF shapes and layer styles on a storey. A replacement file increments the reference version and preserves the model-mm offset and visibility. References appear on the 2D stage and remain outside editable entities, snapping, room topology and export geometry. The graph holds up to six references with a shared 12,000-vertex cap.

The owner-scoped Hono route `GET /api/floorplans/:id/interchange` reads a saved current or archived revision. `format=typed-dxf` exports the selected storey’s native sketches in millimeters, maintaining line, polyline, circle and arc records and layer names. Illegal DXF layer-name characters are normalized. The existing blueprint DXF remains the architectural outline export. `format=ifc` exports the building in IFC4 STEP format with placements by storey, extruded walls and slabs, IFC wall types and materials, hosted door and window openings, and slab profile holes. The IFC exchange scope is export for those entities. Both exports use attached files with private cache controls.

MCP adds `attach_reference`, `refresh_reference`, `place_reference`, `detach_reference`, `list_references`, `export_typed_dxf` and `export_ifc`. Reference reads expose metadata. Export tools return authenticated download links and can return text for small files. Operations retain Clerk and the existing floorplan OAuth grant contract.

## M11.1 Service coordination

Graph v1 adds an optional `coordination` array. A service route stores its system, diameter, owner storey and 2–32 waypoints in millimeters. Waypoints can follow electrical or plumbing symbols. A linked waypoint resolves to the symbol’s current X/Y and storey elevation plus its own Z offset. Equipment zones store a plan polygon and lower and upper Z offsets.

`lib/plans/coordination.ts` screens routed diameters against other services, walls, fixtures, equipment zones and slabs. The slab test accounts for modeled openings and uses conservative horizontal and vertical envelopes near corners. The Studio Coordination panel writes through the command store, so these records share revisioned persistence, actor attribution and undo with the plan. An issue stores stable geometry evidence, source edition and revision. Resolving it preserves that evidence.

MCP adds `route_service`, `write_equipment_zone`, `remove_coordination_item`, `list_coordination`, `find_clashes`, `create_issue` and `resolve_issue`. Writes use the existing floorplan grant and expected revision. JSON persistence and the revision archive use the existing Neon schema through 0006.

## M11.2 Versioned code review

The same optional graph v1 `coordination` array now accepts `profile`, `egress`, `approach` and `turning` records. One profile per storey selects the `us-ibc2021-ada2010-v1` pack with a jurisdiction label and optional occupancy and sprinkler design. The jurisdiction label is recorded with the inputs. The pack applies the selected US model-code references.

An egress path stores up to 64 authored plan waypoints. Its final point follows the designated same-storey door. The checker tests the path from an enclosed room against modeled wall and fixture geometry. The travel-distance screen supports selected Group B and R-2 configurations from 2021 IBC Table 1017.2. The accessibility screens use the 1525 mm circle from 2010 ADA §304.3.1 and front push or pull maneuvering rectangles from Table 404.2.4.1. The pack covers authored paths and modeled obstructions. Route discovery, building-wide egress and jurisdiction amendments remain outside its scope. [2021 IBC Table 1017.2](https://codes.iccsafe.org/s/IBC2021P1/chapter-10-means-of-egress/IBC2021P1-Ch10-Sec1017.2) · [2010 ADA Standards](https://www.ada.gov/law-and-regs/design-standards/2010-stds/)

`lib/plans/review-rules.ts` produces pass, fail or needs-input results with rule edition, reference, inputs and affected IDs. Studio draws the authored path and overlays finding geometry. The server verifies that a new issue matches the current saved revision. The owner-scoped `GET /api/floorplans/:id/coordination-issues/:issueId` evaluates the archived graph and compares the reproduced evidence with the saved finding. Keep the version 1 evaluation available when later rule packs ship.

MCP exposes `set_rule_profile`, `write_egress_path`, `write_access_check`, `trace_egress`, `evaluate_rule_set` and `reproduce_issue` through HTTP and stdio. Read tools can inspect a saved source revision. Issue replay uses the issue’s original revision. Graph v1 and the existing owner and floorplan scope, JSON revision archive and environment configuration carry the release.

## M12.1 Team projects

Existing floorplans are project roots. A named option is another floorplan row linked to the root, with source plan and revision metadata. Forking copies saved graph v1 and its display unit. It starts a separate revision history at zero. Review notes, coordination issues tied to earlier revisions, issued artifacts, and credentials belong to the source and are excluded from the fork. The root must have no remaining options before it can be deleted.

Owners manage membership by verified Clerk user ID. Viewers can open project options and download available artifacts. Reviewers can also comment on saved revisions. Editors can save geometry, fork, request review, and restore. Project reads resolve membership from the root. Geometry mutations check the editor permission again in the revision-checked database update. Shared Studio uses the owner’s plan channel and sends the actual Clerk actor with presence and saves. A stream rechecks membership at its next heartbeat.

`GET /api/floorplans/:id/project` returns the authorized option list. The same Hono route group handles membership, comparison, saved reviews, revision history, restore, and client assignment. Restore copies a prior graph and unit into a new revision and atomically records the source revision and human or agent actor. The current plan name and existing revision history are preserved.

Explicit Clerk OAuth grants bind an owner and client ID to one option. Revoking an explicit grant blocks fallback to the existing default grant for that client. Existing default grants cover project roots. MCP comparison reads revisions of the connected option, and forking does not transfer the client’s grant. The added tools are `create_design_option`, `compare_options`, `request_review`, `list_revisions` and `restore_revision`.

## M12.2 Operation receipts and recovery

Migration `0008_edit_operation_receipts.sql` adds `floorplan_edit_operations`. Its key scopes the operation UUID to a floorplan and agent. Direct MCP editing tools accept an optional client-generated `operationId`. The server hashes the validated tool name and inputs. The optimistic graph update, revision archive trigger and receipt insert run in one SQL statement. A retry with the same ID and inputs returns the original response. Reusing the ID with different inputs returns `operation_id_conflict`.

`get_operation_status` resolves direct edit IDs and batch IDs within the connected floorplan and agent scope. Export IDs resolve within the connected floorplan. Direct edits, batches, and export workers emit `draft.operation` events in deployed runtime logs. The operation ID correlates saved and replayed edits with the request. The blueprint job ID correlates the request, dispatch, worker attempt and final output status. Events carry IDs, stage, revision and attempt where available.

When the browser comes online, Studio wakes the live stream retry and advances the save retry. If the server committed a save with a lost acknowledgment, Studio can adopt that revision as its baseline, preserve subsequent local edits, and save them on the newer revision. The browser test forces this sequence and reloads the persisted result.

Blueprint attempts use the existing revision and attempt checks. Worker completion replaces the pending snapshot with the issued artifact. Recovery requeues aged pending jobs. The backup drill loads a database backup into a fresh instance, retries a failed attempt, rejects the stale attempt and reproduces the archived vector PDF. The managed rehearsal uses an isolated Neon branch copy and compares the saved PDF against a fresh render of its archived graph.
