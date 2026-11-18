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

Copy .env.example to .env.local for local Next development. Supply both Clerk keys to enable identity, both Upstash REST variables to enable distributed throttling, and a Neon DATABASE_URL to use persistence. Configure the same variables in Vercel separately for each environment. Rebuild after changing the public Clerk key. Set the Clerk allowed origins and redirect URLs for the chosen domains.

Drizzle Kit reads DATABASE_URL from the shell. Before M1.2 CRUD, with the intended Neon database selected, run:

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
