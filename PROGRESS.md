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

Production runs the read-only guest demo with Upstash rate limiting. The guest session endpoint returned HTTP 200 and the account endpoint returned HTTP 401. Preview uses the Draft Clerk development instance and the process-local limiter. The Preview sign-in page loaded successfully. Credentialed sign-in and multi-instance rate-limit enforcement still need end-to-end checks.

Production and Preview use the same Neon database, `draft`, with the `draft_app` runtime role. The initial Drizzle migration is applied and recorded in the migration ledger. The runtime role can read and write floorplans and lacks schema creation permission.

The viewport matrix covers 1440×900, 768×1024, 390×844, 320×568 and 844×390. The production browser run used the managed network proxy with runner-local certificate handling. Separate HTTPS smoke requests using the system trust store verified the production origin. The post-release Vercel runtime error check returned zero errors.

## Next subgoal

M1.2 adds owner-scoped dashboard CRUD, square-foot/square-meter statistics and Inngest thumbnail jobs. M2–M4 remain pending. Geometry, drawing commands, editable CAD, exports, real-time synchronization and MCP parity belong to those milestones.
