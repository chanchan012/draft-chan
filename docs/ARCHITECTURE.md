# Architecture

## Foundation

Next.js 16 App Router renders the landing page and optional catch-all Clerk sign-in and sign-up routes. React 19 handles the sample viewer and native modal field guide. Tailwind 4 and app/globals.css supply responsive layout and locally bundled fonts. The page shell uses 100dvh. Dialogs and the authentication region permit internal scrolling on short screens.

The sample is illustrative. Its two-dimensional SVG and isometric image are independent study drawings. The guest can switch views, magnify the drawing, and toggle the grid. The shared graph geometry engine begins in M2.

## Identity and RPC

The Next proxy runs Clerk middleware on page requests with both Clerk keys configured. Hono independently authenticates API requests using @hono/clerk-auth. Each request receives a validated guest or member identity. GET /api/session returns the identity and GET /api/account requires a verified member. Both endpoints use private, no-store responses. Guests have read-only access to bundled sample content.

The Upstash limiter allows 60 requests per 60-second sliding window. It uses the Vercel-supplied client address in deployed functions. The local fallback shares one bucket outside Vercel and is per-process, suitable for the demo. Both Redis variables are needed for a distributed limit. Incomplete Redis configuration or a Redis error yields HTTP 503. Throttled requests yield HTTP 429 and Retry-After.

## Persistence

The Drizzle source of truth is db/schema.ts. Its checked-in SQL migration creates the display_unit enum (mm, in) and floorplans table. Each row contains a UUID id, Clerk owner_id, name, display unit, nonnegative revision, JSONB graph and timestamptz creation/update times. The owner and update time form a composite index. Graph version 1 has arrays for walls, rooms, openings, fixtures and dimensions. The default graph is empty. Future CRUD must scope every query by the verified owner, update updated_at on writes and compare revisions for concurrent updates.

The Neon HTTP adapter connects lazily through DATABASE_URL. M1.1 performs no database writes at runtime. Migrations run explicitly against the chosen database.

## Deployed M1.1 topology

GitHub repository chanchan012/draft-chan supplies the tested branches to the Vercel Next.js project draft-chan. Vercel serves the static landing page and image assets, dynamic sign-in/sign-up routes, the Next proxy and the Hono catch-all function. The production domain is https://draft-chan.vercel.app. Production uses guest access and Upstash throttling. Preview uses the Clerk development instance and per-process throttling. Both environments point to the same Neon database, `draft`. The `draft_app` role has read and write access to floorplans. Apply schema migrations with the database owner credential.

The shared database has db/migrations/0000_broad_spyke.sql applied and recorded in the Drizzle migration ledger. The dashboard, background job endpoint, SSE endpoint, versioned command engine and MCP transports are future subgoals.
