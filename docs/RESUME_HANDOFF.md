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

The dev entry point is `npm run dev`. For an existing Chromium binary, set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. Set PLAYWRIGHT_BASE_URL to test an already running server. The foundation browser suite expects guest configuration.

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

The Vercel project ID is prj_TTJ9f3B8EwiM9e76d8iknhBTSPBx. Recheck guest production behavior with:

```sh
curl -fsS https://draft-chan.vercel.app/api/session
curl -sS -o /dev/null -w '%{http_code}\n' https://draft-chan.vercel.app/api/account
```

Expected responses are a guest identity and HTTP 401. In a managed network, configure the Playwright runner to use the environment's outbound HTTPS proxy and certificate trust. Credentialed sign-in and multi-instance rate limiting remain to be verified. M1.2 should test owner-scoped CRUD against the floorplans schema. Production and Preview access the same data, so use their configured Clerk identity boundaries for all writes. The M1.2 checkpoint below supersedes the initial dashboard and Inngest status.

## M1.2 release checkpoint

The application merge is 32746d1d4463b0c926dec17a0381c0cdce5ec0cb. Production deployment dpl_BE57tzfgWqERwgdW9QLBEaqJrSWv and Preview deployment dpl_GKu517pHjJkgnbezQhYb8hd8dQ2J reached READY. [Dashboard](https://draft-chan.vercel.app/dashboard) · [Feature preview](https://draft-chan-iksc4g24o-chanchans-projects-aada625f.vercel.app/dashboard)

The shared Neon database draft has migration 0001 applied with Drizzle timestamp 1795051066909 and hash 8f776ab5daa1754cff217c662c7144d92113909faa43173ff5978bb4e358d695. The application role can update the thumbnail column. For a fresh database, run the checked-in migrations with a schema owner using the instructions above.

Inngest Production is synced to https://draft-chan.vercel.app/api/inngest. Event 01M7RPRD41WAYN0R9VC6C1QN9S produced completed run 01M7RPRD8YA57T0ZMCKY0D1VA2 and a stored SVG. The disposable plan was removed. Preview has Clerk and Neon available. Live Preview thumbnail jobs require separate Inngest environment configuration. The checkout's Vitest worker tests use PGlite and its browser suite uses guest configuration plus intercepted member RPC responses. Live credentialed browser CRUD remains unverified because automated sign-up stopped at Clerk verification.

## Start M2.1

```sh
git switch main
git pull --ff-only
git switch -c feature/2.1-geometry
npm ci
npm run typecheck
npm test
```

Brief the graph compatibility rules before building the geometry engine. Preserve existing blank and rectangular starter graphs. Add undo/redo, wall joining and polygon area tests, then run the complete viewport and CRUD regression suite. Follow the requested merge, deployment and documentation cycle.
