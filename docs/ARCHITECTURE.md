# Architecture

## Foundation

Next.js 16 App Router renders the landing page and optional catch-all Clerk sign-in and sign-up routes. React 19 handles the sample viewer and native modal field guide. Tailwind 4 and app/globals.css supply responsive layout and locally bundled fonts. The page shell uses 100dvh. Dialogs and the authentication region permit internal scrolling on short screens.

The public landing displays a static isometric illustration. Signed-in members can open the interactive sample from the dashboard, switch views, magnify the drawing, and toggle the grid. Its two-dimensional SVG and isometric image are independent study drawings. The shared graph geometry engine begins in M2.

## Identity and RPC

The Next proxy runs Clerk middleware on page requests. It protects /dashboard and the reserved /studio path, including descendants. Unsigned requests redirect to Draft’s /sign-in page. The dashboard server component also verifies the session before rendering. The landing, sign-in, and sign-up pages are public. Both Clerk keys are required for workspace access. An installation with missing keys shows an availability message on auth pages.

Hono independently verifies Clerk sessions with @hono/clerk-auth. All Hono workspace routes return HTTP 401 for unsigned or unconfigured requests and use private, no-store responses. GET /api/session returns the verified member identity and GET /api/account returns its user ID. Floorplan persistence remains owner-scoped. The Inngest endpoint retains its separate signing-key authentication.

The Upstash limiter allows 60 requests per 60-second sliding window. It uses the Vercel-supplied client address in deployed functions. The local fallback shares one bucket outside Vercel and is per-process. Both Redis variables are needed for a distributed limit. Incomplete Redis configuration or a Redis error yields HTTP 503. Throttled requests yield HTTP 429 and Retry-After.

## Persistence

The Drizzle source of truth is db/schema.ts. Its checked-in SQL migration creates the display_unit enum (mm, in) and floorplans table. Each row contains a UUID id, Clerk owner_id, name, display unit, nonnegative revision, JSONB graph and timestamptz creation/update times. The owner and update time form a composite index. Graph version 1 has arrays for walls, rooms, openings, fixtures and dimensions. The default graph is empty. Dashboard RPC scopes queries by the authenticated owner and compares revisions for rename and delete.

The Neon HTTP adapter connects lazily through DATABASE_URL. M1.1 performs no database writes at runtime. Migrations run explicitly against the chosen database.

## Deployed M1.1 topology

GitHub repository chanchan012/draft-chan supplies the tested branches to the Vercel Next.js project draft-chan. Vercel serves the static landing page and image assets, dynamic sign-in/sign-up routes, the Next proxy and the Hono catch-all function. The production domain is https://draft-chan.vercel.app. Production and Preview use the same Clerk development instance, so an account can sign in on either deployment. Production uses Upstash throttling and Preview uses per-process throttling. Both environments point to the same Neon database, `draft`. The `draft_app` role has read and write access to floorplans. Apply schema migrations with the database owner credential.

The shared database has db/migrations/0000_broad_spyke.sql applied and recorded in the Drizzle migration ledger. The dashboard and job endpoint arrived in M1.2. SSE, the command engine and MCP transports remain future subgoals.

## M1.2 dashboard and background processing

The landing workspace link and Clerk fallback redirects lead to /dashboard. The dashboard fetches /api/floorplans and redirects to sign-in if the session expires. Members can create, inspect, search, rename and delete plans. The shell occupies 100dvh and the library scrolls internally. See [DESIGN.md](../DESIGN.md) for the design capture and styling decisions.

The collection supports GET and POST. The /api/floorplans/:id route supports GET, PATCH and DELETE. Mutations validate strict request bodies. Creation uses a client-generated UUID so retries stay on one row. Rename and delete require the observed revision and return 409 for a stale or unavailable plan. Every user-facing database operation includes the verified Clerk owner. Unsafe requests with a foreign Origin receive HTTP 403.

Room polygons are arrays of {x,y} vertices in millimeters. The rectangle starter records one room in the version 1 graph. Dashboard area uses the sum of absolute shoelace areas converted to m² and ft². Empty and pre-M1.2 graphs without room polygons give zero. M2.1 will derive rooms from connected walls.

Migration db/migrations/0001_watery_rachel_grey.sql adds nullable floorplans.thumbnail text. A null value means pending. The Inngest app draft-cad-studio serves /api/inngest. Creation sends draft/floorplan.thumbnail.requested with the plan UUID. The render-floorplan-thumbnail function generates SVG from numeric coordinates and writes only a still-pending matching revision. Deleted plans and duplicate deliveries are harmless. The recover-pending-thumbnails function scans up to 100 pending rows every 15 minutes, including legacy rows and failed initial sends. The client refreshes pending thumbnails while the library is visible.
