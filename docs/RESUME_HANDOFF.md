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

## Start M1.2

```sh
git switch main
git pull --ff-only
git switch -c feature/1.2-dashboard
```

Brief the dashboard schema/API changes and acceptance criteria. Implement owner-scoped CRUD, square-foot/square-meter stats and the Inngest thumbnail pipeline. Add RPC and job tests plus browser grid and viewport coverage. Follow the requested test, merge, build, deployment and documentation cycle.

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
PLAYWRIGHT_BASE_URL=https://draft-chan.vercel.app npm run test:e2e
```

Expected responses are a guest identity and HTTP 401. In a managed network, configure the Playwright runner to use the environment's outbound HTTPS proxy and certificate trust. Credentialed sign-in and multi-instance rate limiting remain to be verified. M1.2 should test owner-scoped CRUD against the floorplans schema. Production and Preview access the same data, so use their configured Clerk identity boundaries for all writes. There are no Inngest, CAD geometry, export or MCP endpoints in this release.
