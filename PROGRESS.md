# Draft progress

## M1.1 · Foundation and shell

Released on 2026-11-18. The verified application merge is `0a0adcde04ab7fb14818dbdcea9e570e89d977b2`. The release documentation follows the application merge on main.

| Phase | Result |
| --- | --- |
| Brief | Scope covered toolchain, schema, guest and member identity boundaries, throttling, landing and auth shells, and viewport verification. |
| Build | Next.js 16.4.6, React 19.3.1, strict TypeScript, Tailwind 4, Hono with Clerk, Upstash sliding-window adapter, lazy Neon client, and generated Drizzle migration. |
| Test | Type checking passed. Nine Vitest tests passed. All 25 Chromium checks passed locally across five viewport sizes. |
| Merge | Feature commit `1e54301652edfcb6775ccf6fe4d9d6ff8b0eb66f` on `feature/1.1-foundation` merged into main. Both branches were pushed to GitHub. |
| Deploy | Local production build passed. Vercel preview and production reached READY. All 25 browser/API checks passed on the production domain. |
| Document | Architecture and resume handoff include the schema, runtime boundaries, commands and remaining integration work. |

[Production](https://draft-chan.vercel.app) · [Feature preview](https://draft-chan-git-feature-11-fo-a3a98b-chanchans-projects-aada625f.vercel.app) · [Application merge](https://github.com/chanchan012/draft-chan/commit/0a0adcde04ab7fb14818dbdcea9e570e89d977b2)

## Verification boundary

Production and Preview use the same Draft Clerk development instance. Production uses Upstash rate limiting and Preview uses the process-local limiter. The guest session endpoint returned HTTP 200 and the account endpoint returned HTTP 401. Credentialed sign-in and multi-instance rate-limit enforcement still need end-to-end checks.

Production and Preview use the same Neon database, `draft`, with the `draft_app` runtime role. The initial Drizzle migration is applied and recorded in the migration ledger. The runtime role can read and write floorplans and lacks schema creation permission.

The viewport matrix covers 1440×900, 768×1024, 390×844, 320×568 and 844×390. The production browser run used the managed network proxy with runner-local certificate handling. Separate HTTPS smoke requests using the system trust store verified the production origin. The post-release Vercel runtime error check returned zero errors.

## M1.2 · Dashboard and thumbnails

Released 2026-11-19. The feature commit is `6cf6dc3` on `feature/1.2-dashboard`. The tested application merge is `32746d1`.

| Phase | Result |
| --- | --- |
| Brief | Dashboard CRUD, dual-unit area summaries, responsive grid and background thumbnails. |
| Build | Firecrawl design capture informed the dashboard. Signed-in users can start blank or with a rectangular room, inspect, rename, search and delete their plans. Guests can open the sample. |
| Test | Strict TypeScript, 14 Vitest tests and 35 Playwright tests passed. PostgreSQL-backed tests cover authorization, persisted mutations, stale revisions and worker retries. Member browser flows used intercepted RPC responses at five viewport sizes. |
| Merge | Feature branch merged to main and both branches pushed to GitHub. |
| Deploy | Production build passed. Production and Preview reached READY. Neon migration 0001 is applied. Inngest Cloud synced the production app and completed a thumbnail run. |
| Document | Architecture and resume handoff include the graph layout, migration, worker recovery and verification boundaries. |

The public dashboard fit a 390×844 viewport. The signed-out plan endpoint returned HTTP 401 and the dashboard sign-in action loaded Clerk. Automated signup reached Clerk request verification, leaving the live credentialed browser CRUD flow unverified. Production job run `01M7RPRD8YA57T0ZMCKY0D1VA2` returned `written: true`. The test plan held a 443-character SVG with a room polygon and was deleted after inspection.

[Public dashboard](https://draft-chan.vercel.app/dashboard) · [M1.2 preview](https://draft-chan-iksc4g24o-chanchans-projects-aada625f.vercel.app/dashboard) · [Design reference](DESIGN.md)

## Next subgoal

M2.1 adds deterministic geometry, wall intersections, room solving, command history and attribution. The CAD editor, exports, real-time collaboration and MCP remain later milestones.
