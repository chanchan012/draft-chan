# Resume handoff

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

Select a floorplan in the dashboard and choose Open Studio. Use Wall for two points or a drag, Door for a point on an existing wall, and the Inspector to change units, snap spacing, wall thickness or door parameters. Keyboard controls include V, W, D and H for tools, arrows and Enter on the drawing surface, Escape to cancel, Ctrl or Cmd+Z to undo, and Ctrl or Cmd+S to save.

Studio saves manually through the owner-scoped graph route and optimistic revision check. The existing database schema through migration 0001 stores the new door records in the version 1 graph. Browser coverage mounts the Studio with a signed-in fixture and intercepts graph RPC. PGlite runs the real server persistence path. The public deployment verified the signed-out redirect and HTTP 401 for graph reads and writes. A full signed-in production editing session remains outside the automated run.

```sh
npm run typecheck
npm test
npm run build
npm start
```

With the optimized server running, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. The release passed 38 Vitest checks and 45 Playwright checks across 1440×900, 768×1024, 390×844, 320×568, and 844×390.

## Start M3.1

```sh
git switch main
git pull --ff-only
git switch -c feature/3.1-fixtures-clearance
npm ci
npm run typecheck
npm test
```

Brief the fixture and overlay record shapes before building. Extend the command store and Studio snapshot validator with the new editable fields, preserving existing doors and graph metadata. Use the existing wall centerlines, thickness, door swing geometry, and rooms as inputs to the clearance checks. Run collision and accessibility cases in Vitest and the full Studio browser matrix.
