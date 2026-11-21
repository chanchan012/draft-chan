# Resume handoff

## Next proposed subgoal

M8.1 is implemented in `lib/plans/storeys.ts`, `lib/plans/spaces.ts` and `components/studio/building-panel.tsx`. Run `npm test -- tests/storeys.unit.test.ts tests/mcp.unit.test.ts` and `npm run test:e2e -- --grep "adds an upper storey|undoes one adjacent"`. The graph stays at v1, database migrations end at 0005, and MCP exposes 37 tools at this checkpoint. M8.2 adds structure and derived building views.

M7.1 and M7.2 are complete. M8.1 is next in the drafting track. Review the [CAD roadmap](CAD_ROADMAP.md) and inspect `lib/plans/model.ts`, `lib/plans/constraints.ts` and `lib/plans/organization.ts` before changing the wall or room graph.

M7.2 application merge `652602cb61072f2cea51f68131f4b294f64c1b24` exposes 33 MCP tools and three resources. Run `npm test -- tests/constraints.unit.test.ts tests/organization.unit.test.ts tests/mcp.unit.test.ts` and `npm run test:e2e -- --grep "solves a driving distance|updates a door block"` with a Studio test server. Graph v1 adds optional constraints, layers, definitions and instances. Neon migrations remain through 0005 and the existing environment variables are sufficient.

The M6.2 preview/apply contract and migration ledger details are recorded below under M6.2 Agent transactions.

The visual track starts at M13.1 in the [architectural CAD roadmap](CAD_ROADMAP.md). Inspect the current renderer with `rg --files components/studio lib/plans | rg "isometric|wall-mesh"`. Use the existing MCP-furnished apartment in `tests/e2e/studio.spec.ts` as the first reference scene.

## Reproduce the foundation

Use Node 24 and npm. From the repository root run:

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
```

The dev entry point is `npm run dev`. For an existing Chromium binary, set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. Set PLAYWRIGHT_BASE_URL to test an already running server. The public and signed-out checks can use an unconfigured local Clerk instance. The dashboard browser fixture mounts the real client component, uses the application styles, and intercepts RPC. Set PLAYWRIGHT_CHECK_CLERK=1 against a configured deployment to verify the embedded Clerk inputs and primary actions.

## External services

Copy .env.example to .env.local for local Next development. Supply both Clerk keys to enable identity, both Upstash REST variables to enable distributed throttling, and a Neon DATABASE_URL to use persistence. Production and Preview share the Clerk development pair and the same `draft` database through the `draft_app` role. Production also has the Upstash pair and Inngest event and signing keys. Live Preview job testing needs Preview Inngest credentials when M1.2 adds the job endpoint.

The initial Drizzle migration is already applied to `draft`. For future migrations, provide a direct database owner connection in the shell as DATABASE_URL and run:

```sh
npm run db:migrate
```

## M1.1 release checkpoint

Source is at https://github.com/chanchan012/draft-chan. The feature branch is feature/1.1-foundation. Application merge 0a0adcde04ab7fb14818dbdcea9e570e89d977b2 passed the production build. The main branch also carries the post-release documentation.

| Environment | Verified release | Address |
| --- | --- | --- |
| Vercel production | dpl_73izYCFeEo1eKSxYQbtsV9fpHqqM | https://draft-chan.vercel.app |
| Vercel feature preview | dpl_7TBRpH7XoV772hfwFU9c3kkjX3xE | https://draft-chan-bpu2xal38-chanchans-projects-aada625f.vercel.app |

The Vercel project ID is prj_TTJ9f3B8EwiM9e76d8iknhBTSPBx. The current unsigned smoke commands are recorded in the authentication checkpoint below.

## M1.2 release checkpoint

The application merge is 32746d1d4463b0c926dec17a0381c0cdce5ec0cb. Production deployment dpl_BE57tzfgWqERwgdW9QLBEaqJrSWv and Preview deployment dpl_GKu517pHjJkgnbezQhYb8hd8dQ2J reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-iksc4g24o-chanchans-projects-aada625f.vercel.app/dashboard)

The shared Neon database draft has migration 0001 applied with Drizzle timestamp 1795051066909 and hash 8f776ab5daa1754cff217c662c7144d92113909faa43173ff5978bb4e358d695. The application role can update the thumbnail column. For a fresh database, run the checked-in migrations with a schema owner using the instructions above.

Inngest Production is synced to https://draft-chan.vercel.app/api/inngest. Event 01M7RPRD41WAYN0R9VC6C1QN9S produced completed run 01M7RPRD8YA57T0ZMCKY0D1VA2 and a stored SVG. The disposable plan was removed. Preview has Clerk and Neon available. Live Preview thumbnail jobs require separate Inngest environment configuration. Vitest worker tests use PGlite. The browser suite uses a dashboard fixture with intercepted member RPC responses. Live credentialed browser CRUD remains unverified because automated sign-up stopped at Clerk verification.

## Authentication and responsive layout checkpoint

The auth-only workspace and responsive Clerk forms are live from merge `e22bac18d799a75078840e3cfdf902066eb52c40`. Vercel production deployment `dpl_HSsmeYW6y2q2Xt5GxRiuByNrAg3T` and feature preview `dpl_2MBdxhC7RQRi8LphqZK4mbMzMaie` reached READY. Both use the existing Clerk development instance. The release requires no schema migration or new environment variables.

Recheck the current signed-out boundary with:

```sh
curl -sSI https://draft-chan.vercel.app/dashboard
curl -sSI https://draft-chan.vercel.app/studio/example
curl -sS -i https://draft-chan.vercel.app/api/session
PLAYWRIGHT_CHECK_CLERK=1 PLAYWRIGHT_BASE_URL=https://draft-chan.vercel.app npm run test:e2e
```

This checkpoint used Draft’s former /sign-in screen. The current private redirect opens the landing dialog. The unsigned API returns HTTP 401 with a JSON error. All 35 Playwright checks passed locally and on production. The layout matrix covers 1440×900, 768×1024, 390×844, 320×568 and 844×390. To run from a managed network, use PLAYWRIGHT_PROXY_SERVER if needed and configure the runner’s certificate trust. Live sign-in and sign-up form rendering passed. Credentialed live browser CRUD still needs an authenticated test session. Fixtures cover the signed-in UI and PGlite verifies owner-scoped writes.

## M2.1 release checkpoint

The verified feature head is `1c2894a816630466da26298dfaeed75f27241bab` on `feature/2.1-geometry`. The application merge is `5331c5742aa01a5e424fcd96a64bae86dd69197b`. Production deployment `dpl_EkcEwwnxFEB6EMi4jbcRPVX5T6Xu` and Preview deployment `dpl_6kiNBV8v7AWideruhUBnymVMaFZX` reached READY. [Production](https://draft-chan.vercel.app) · [Feature preview](https://draft-chan-86qe8lmsb-chanchans-projects-aada625f.vercel.app)

The Neon database uses the same Drizzle migrations through 0001. JSON graph version 1 now carries typed walls and optional room holes. Dashboard starters write walls and a derived room and record the verified owner as the author. Legacy blank and rectangular starters load into the store. The rectangle loader uses 120 mm interior walls and computes the original area from the wall centerlines. Existing saved rows can be read in place.

To run the engine tests alone, use `npm test -- tests/geometry.unit.test.ts`. The verified release passed strict TypeScript, 29 Vitest tests, and the 35-check Chromium matrix against `npm run build` served with `npm start`. Use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e` with the server running. The database-backed RPC test verifies owner attribution and starter geometry. The browser dashboard tests intercept member RPC.

## Landing dialog checkpoint

The application merge is `35674820899bb533aa7513a2f6ae06827b2983a3`. Vercel Production `dpl_4Cw8if5zu3awyQabfmkvNwHN3X6g` and Preview `dpl_DzLiuV8KaYEcegYv2T7G3pMh6jyV` reached READY. The release uses the existing database schema and Clerk development instance.

```sh
curl -sSI https://draft-chan.vercel.app/dashboard
curl -sSI https://draft-chan.vercel.app/sign-in
PLAYWRIGHT_CHECK_CLERK=1 PLAYWRIGHT_BASE_URL=https://draft-chan.vercel.app npm run test:e2e
```

Expect the dashboard to redirect to /?auth=sign-in with its URL-encoded local return path. The old sign-in URL redirects to the same modal without a target. All 35 Chromium checks passed against the optimized local server and public production. Production coverage includes live Clerk form rendering, switching modes, and closing with Escape at five viewport sizes. The signed-in header is covered by a session-state fixture. Completing authentication with a live account remains outside the automated check.

## M2.2 release checkpoint

The feature head is `74eb6e6525256dafc77b9f9c3be488431ca1e5f8` on `feature/2.2-studio`. The application merge is `5b277b4f8049fd29f2924267478b6e14d9f7bc04`. Production deployment `dpl_bsPQrJpqpG4o5tcC41NGmJqzZS6j` and Preview deployment `dpl_BSrMz4snLj74c64wgmSvANYHHAvf` reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-ducg3n2zc-chanchans-projects-aada625f.vercel.app)

Select a floorplan card in the dashboard to open Studio. Use Wall for two points or a drag, Door for a point on an existing wall, and the Inspector to change units, snap spacing, wall thickness or door parameters. Keyboard controls include V, W, D and H for tools, arrows and Enter on the drawing surface, Escape to cancel, Ctrl or Cmd+Z to undo, and Ctrl or Cmd+S to save.

Studio saves manually through the owner-scoped graph route and optimistic revision check. The existing database schema through migration 0001 stores the new door records in the version 1 graph. Browser coverage mounts the Studio with a signed-in fixture and intercepts graph RPC. PGlite runs the real server persistence path. The public deployment verified the signed-out redirect and HTTP 401 for graph reads and writes. A full signed-in production editing session remains outside the automated run.

```sh
npm run typecheck
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. The release passed 38 Vitest checks and 45 Playwright checks across 1440×900, 768×1024, 390×844, 320×568, and 844×390.

## M3.1 release checkpoint

The feature head is `6e2b4fa5974dd3b102f01bef353201cbb1561d25` on `feature/3.1-fixtures-clearance`. The application merge is `fa9444f7c5ffac8487b2e60aa537e9f0997858d5`. Production deployment `dpl_FaJ7Dm9GnhXcyLHWxcv8apmoecGG` and Preview deployment `dpl_E8HKZ1Gz9Xp3BjKkLwTLrt44oBRS` reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-5iza3rjcb-chanchans-projects-aada625f.vercel.app)

In Studio choose Fixture or Utility, then use the Inspector to set the template and dimensions before placement. The Inspector controls layer visibility. Select an item to edit or remove it. Choose Clearance and select a finding to view its 2D evidence. The graph uses version 1 and migrations through 0001. Typed `fixtures` and new `utilities` are part of the owner-scoped save snapshot, and earlier callers may omit them. The checker uses the published metric doorway and walkway benchmarks and the modeled geometry as described in the architecture.

Run `npm test -- tests/clearance.unit.test.ts` for the focused geometry and placement tests. Strict TypeScript, 46 Vitest checks, the production build and 50 Playwright checks passed across five viewports. The authenticated editing suite uses a browser fixture with intercepted RPC. PGlite exercises the actual database path. The deployed signed-out Studio redirect preserved the intended destination and graph GET and PATCH returned HTTP 401.

## Pre-M3.2 editing release checkpoint

The feature head is `3b8ca1dd31edfd3ca18dfd869c06d65b7734c33f` on `fix/studio-editing-workflow`. The application merge is `4ea9bd467195837a889ad2796a511f231eefc3bc`. Production deployment `dpl_5GjET2D5Phq6wpYdNnGTcK1DooZB` and Preview deployment `dpl_8jjZ8P95G8Saxv69RiNeg7T3jcaE` reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-cxt9pzhdq-chanchans-projects-aada625f.vercel.app)

In 2D Select mode, drag from empty canvas to select by area. Use Shift-click or turn on Multi-select to toggle individual items. Drag the selection or use the arrows to move it by the configured snap spacing. Backspace, Delete and the toolbar trash button delete the selection in one undo step. On a touch screen spread or pinch two fingers to zoom and move both fingers together to pan. Valid inspector values are reflected on the canvas as they are entered. Select Save to persist the revisions. The dashboard card link opens Studio and the ellipsis opens Rename and Delete. This checkpoint uses graph version 1, migrations through 0001, the existing environment variables and the Clerk development instance.

```sh
npm run typecheck
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. All 48 Vitest tests and 55 Playwright checks passed. The signed-in browser flows use fixtures, while PGlite covers the server persistence path. Production verified HTTP 200 for the landing page, the Studio sign-in redirect with its destination preserved, and HTTP 401 for unsigned graph GET and PATCH.

## Floating workbench release checkpoint

The feature head is `8a0419d8630784dc41a9cb64e66f8c26a9a042a5` on `fix/studio-floating-workbench`. The application merge is `88d35a7f9181476d50605489d45333d358f85a8c`. Production deployment `dpl_GHH3Rc73E5qFUnHmZjZQcpfJfutx` and Preview deployment `dpl_Fyo95vsG1nvbcjbYAfaiajht65Ud` reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-cb74zzvgj-chanchans-projects-aada625f.vercel.app)

Open Layers from the left rail or Inspector and Clearance from the right rail. On desktop, drag a panel’s inner boundary to resize it. With the boundary focused, use Left and Right for eight-pixel increments, Shift with an arrow for 32 pixels, or Home and End for the minimum and maximum. Double-click the divider to restore the starting width. Escape closes a focused panel and returns focus to its rail button. Phone panels open as bottom sheets. The release uses graph version 1, migrations through 0001, and the Clerk development instance.

```sh
npm run typecheck
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. The release passed 48 Vitest and 60 Playwright checks. Browser fixtures cover signed-in panel and editing flows across desktop, tablet, phone, compact phone, and landscape. Production returned HTTP 200 for the landing page, preserved Studio’s sign-in destination, and rejected unsigned graph GET and PATCH with HTTP 401.

## M3.2 release checkpoint

The feature head is `72b1874fb8d6a1ded83fa2fd3518de5fe06c53bd` on `feature/3.2-exports`. The application merge is `8cf2fe53a56563eba2c6c921e0293c0abde14b47`. Vercel Production `dpl_3NPv84Huc94F6SnvE3gy2AGU8snk` and Preview `dpl_4i3Xf9CcgR163psBkS7JBb5f6JFd` reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-cqpg6ee5f-chanchans-projects-aada625f.vercel.app)

The shared Neon database `draft` has migration `0002_green_firebird.sql` recorded with timestamp `1795107777417` and hash `f3c22a9b3b7aa876e03aea60bc3f852ea092079982a4b531d8670c254c29b4fe`. For a fresh deployment, apply the migrations as the schema owner, then grant the runtime role SELECT, INSERT and UPDATE on `public.floorplan_exports`. Inngest production sync `4f33a035-0423-468e-ac1e-869ce15625cb` registered `render-floorplan-blueprint`, its failure handler, and `recover-pending-blueprints` at `https://draft-chan.vercel.app/api/inngest`. The Inngest event and signing keys are scoped to Production. Scheduled recovery operates on the shared database.

In Studio, save the plan and open Exports on the right rail. The panel downloads a BOM CSV immediately and shows Generate, Retry, or Download for DXF and SVG at the saved revision. The user-facing download stays in Studio and reports errors in the panel.

```sh
npm run typecheck
npm test -- tests/exports.unit.test.ts tests/export-rpc.unit.test.ts
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. The release passed 53 Vitest tests and 65 Playwright checks. Signed-in browser flows use fixtures. An Inngest test-engine run exercised the renderer against isolated PGlite for both formats and checked duplicate execution. Production verified registered functions and HTTP 401 on unsigned BOM, status, queue, and download requests. The connector blocked creation of a disposable production test record, so render execution was verified in the isolated test database.

## M4.1 release checkpoint

The feature head is `8da112dd6a4d3ee5aefa03353281e36f798a65a0` on `feature/4.1-live-sync`. The application merge is `224f7f114329d38c355eca938d3e5a6efb087c91`. Vercel Production `dpl_965TcbFEbyj7XwK4Snd7AudvLLaH` and Preview `dpl_5L8wo86LgKkoFWY7KzzstesCGh9o` reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-4lfvrur7f-chanchans-projects-aada625f.vercel.app)

Open the same floorplan in two signed-in Studio tabs to see cursors and saved revisions propagate. The right rail shows the number of other active editors. Autosave uses the current saved revision and preserves conflicting local edits in the open tab. Save still commits immediately when the editor can write. The graph is version 1 and uses the shared Neon database through migration 0002. Production has the existing Upstash REST pair. Preview and unconfigured local environments use the process-local presence bus and reconcile revisions through Neon.

```sh
npm run typecheck
npm test -- tests/live.unit.test.ts
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. All 58 Vitest tests and 70 Playwright checks passed. Signed-in two-tab browser tests use fixtures, the Hono tests exercise owner-scoped Neon behavior through PGlite, and the separate Redis 8 test exercised the lease script and REST SDK through a loopback gateway. The Production smoke checks covered HTTP 401 for unsigned SSE and cursor requests and confirmed the sign-in return URL.

## M4.2 release checkpoint

The feature head is `91612291c00da0361d530e5ee071c2287a32f218` on `feature/4.2-mcp`. The application merge is `cbcaa7ac04614bbb190cae35b9a950fa35de42c8`. Vercel Production `dpl_DAz233a8yZG7GF17Y7VqRezofxhy` and Preview `dpl_BnfHzMwb8B5L5ksb24TNip8Utmeb` reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-9aktdeqgj-chanchans-projects-aada625f.vercel.app)

The shared Neon database `draft` has migration `0003_wandering_terror.sql` recorded with timestamp `1795139777243` and hash `de0af554047c89d0ac61583dfa1aa892692bfc82ce8b60f30201efbb3a7a351b`. For a fresh installation, apply the checked-in migrations with `npm run db:migrate` and the schema owner’s direct `DATABASE_URL`, then grant the runtime role access to the new table.

```sql
GRANT SELECT, INSERT, DELETE ON TABLE public.floorplan_agent_tokens TO draft_app;
```

Open a floorplan in Studio and choose **Connect an agent** from the right rail. Create and copy the seven-day token. HTTP clients use `https://draft-chan.vercel.app/api/mcp` with `Authorization: Bearer <token>`. For a stdio client that uses an `mcpServers` configuration, first run `npm ci` in the checkout, then add Draft with the actual absolute path and client environment values.

```json
{
  "mcpServers": {
    "draft": {
      "command": "node",
      "args": ["/absolute/path/to/draft/scripts/mcp-stdio.mjs"],
      "env": {
        "DRAFT_MCP_URL": "https://draft-chan.vercel.app/api/mcp",
        "DRAFT_MCP_TOKEN": "<token from Studio>"
      }
    }
  }
}
```

Read `draft://floorplan-graph` for the current revision before editing. Open the same floorplan in Studio to see the saved edits and agent cursor. Revoke the token from the same dialog when finished. Production and Preview use the same Clerk development instance and shared Neon database. No new Vercel environment variables are required.

```sh
git switch main
git pull --ff-only
npm ci
npm run typecheck
npm test -- tests/mcp.unit.test.ts
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. All 61 Vitest tests and 80 Playwright checks passed. The live Studio browser scenario uses a real MCP client and Hono handler with a fixture workspace. The integration suite uses PGlite and exercises actual token storage, revision-checked saves, presence fan-out, DXF rendering, and a stdio subprocess. Production returned HTTP 401 for missing and nonexistent agent tokens and unsigned token management, and preserved Studio’s redirect destination. Vercel Preview retains its authentication gate. Signed-in production agent writes remain unverified.

M4.2 completes the requested milestone sequence. The commands above reproduce the current release checks before any follow-up work.

## Clerk OAuth release checkpoint

The feature head is `e1cb4c5cece4c348e81974015f5ad96a933bd22c` on `feature/mcp-clerk-oauth`. The application merge is `5adc5583144c4fe0155bebd05da143a44bba63f5`. Vercel Production `dpl_2vYHe5VphCqeKC8e12UNGu8dSLcA` and Preview `dpl_7Et1UaKmUx6ijB6kN2BQb9pZj2j7` reached READY. OAuth uses the production hostname as its exact registered audience. [Dashboard](https://draft-chan.vercel.app/dashboard)

Migration `0004_mcp_oauth_floorplans.sql` is recorded in Neon `draft` with timestamp `1795159694291` and hash `ff5f67aee90a8a506b9a393fd3257825acb86e28db96bff26cd23b171c3be76b`. Apply the checked-in migrations as the database owner on a fresh installation, then run `GRANT SELECT, INSERT, DELETE ON TABLE public.floorplan_oauth_grants TO draft_app;`. Clerk resource `oares_3MMVE8Mr27znPn0UnHtm4ns3xWQ` belongs to Draft’s development instance `ins_3MHwRxmFb476GCO5P6M9jEHHwEa`. Production uses the existing Clerk keys and requires no new environment variables. Preview uses an alternate origin and can use existing manual tokens.

Sign in to Draft and open a disposable plan. In **Connect an agent**, choose **Enable OAuth access**. Add `https://draft-chan.vercel.app/api/mcp` as a custom MCP server in ChatGPT Plugins. Choose **OAuth** and **CIMD**, then sign in and approve the connection with Clerk. Install the resulting plugin before selecting it in a conversation. [ChatGPT custom MCP setup](https://developers.openai.com/api/docs/guides/custom-mcp-server)

For Codex CLI, add the server and complete its browser login when prompted.

```sh
codex mcp add draft --url https://draft-chan.vercel.app/api/mcp
codex mcp login draft
```

The browser sign-in and consent flow replaces manual token entry. If an existing Codex entry named `draft` uses a bearer token environment variable, replace that entry with the OAuth configuration. To end access to the floorplan, choose **Disable OAuth access** in Studio.

```sh
npm run typecheck
npm test -- tests/mcp.unit.test.ts
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. The release passed 62 Vitest tests and 85 Playwright checks. Live production rejected unsigned grant changes and missing and invalid MCP credentials. Clerk’s public checker passed the challenge, protected resource, HTTPS issuer, PKCE, CIMD, and audience checks. It reported advisory scope guidance because the challenge has no requested scope. Codex’s public CIMD client and an S256 authorization request reached Clerk’s account sign-in screen. Next, complete consent and verify an agent edits the enabled production floorplan, appears in Studio, queues a DXF, and loses access after the grant is disabled.

## Wall joins and isometric release checkpoint

Feature commit `d12d05624cefd381288a1fe4a451d991ed01f225` on `fix/studio-wall-joins-isometric` was merged as `e45eee8cebeffce978c81516df87f6a3ae22f9d8`. Vercel Preview `dpl_2q6tf6ngwMhYiJj7PqAox2VctJUr` and Production `dpl_2QuP1wK3TDBmWJNGUvmLCqbTMZEJ` reached READY. The rendering applies to existing floorplans on reload and uses graph version 1 and migrations through 0004. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Preview](https://draft-chan-kmmyrjui2-chanchans-projects-aada625f.vercel.app)

In Studio, join two walls at the same endpoint and check that the outer corner fills in 2D. Switch to **Isometric** on a furnished layout and check that the foreground walls reveal the room layout. The rear walls retain their full rendered height. The user reported a successful MCP connection before this release.

```sh
git switch main
git pull --ff-only
npm ci
npm run typecheck
npm test -- tests/geometry.unit.test.ts tests/mcp.unit.test.ts
npm test
npm run build
npm start
```

With the optimized server running, run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. All 65 Vitest tests and 85 Playwright checks passed. The MCP browser fixture verifies a joined outer corner and the furnished cutaway across five viewport sizes. Production returned HTTP 200 for the landing page and OAuth resource metadata, preserved the Studio sign-in destination, and returned the OAuth challenge for unauthenticated MCP requests. Signed-in rendering was verified on fixture plans.


## M6.2 Agent transactions

M6.2 application merge `1bcb64c0354c0a1e78041fec49bf55e08ff7c234` exposes 25 MCP tools and the three existing resources. To reproduce the agent workflow, use `preview_changes` with the latest saved revision and ordered operations, then `apply_changes` with the returned token and those same operations. Use `diff_revisions` with the base and saved revisions to inspect the result. Run `npm test -- tests/cad-edit.unit.test.ts tests/mcp.unit.test.ts` and `npm run test:e2e -- --grep "offsets a selected|one adjacent agent transaction"` with a Studio test server.

The shared `draft` database has migration `0005_agent_transactions.sql` recorded at `1795225128431` with SHA-256 `0249738f5c5d0d2dbe536f2154d728ffa12ebf07e250d171224e0ab85fa0a18f`. For a fresh database, run `npm run db:migrate` as the owner. Migration 0005 grants the runtime role access when `draft_app` already exists. If the role is created later, grant SELECT on `public.floorplan_revisions` and SELECT and INSERT on `public.floorplan_edit_batches`. Graph version 1 and existing environment variables are sufficient.
