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

## M1.1 verification boundary

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

## Pre-M2.1 · Auth-only workspace

Released 2026-11-19. The final application merge is `e22bac18d799a75078840e3cfdf902066eb52c40` and the feature branch is `fix/auth-only-workspace`.

| Phase | Result |
| --- | --- |
| Brief | Remove guest access, protect private pages, and improve auth and responsive layouts. |
| Build | Form & Function Studio’s frontend craft and design language guided the new Clerk screens. The public landing shows a static preview. Clerk protects dashboard and studio paths, Hono verifies workspace requests independently, and the interactive sample lives in the dashboard. |
| Test | Strict TypeScript and 15 Vitest tests passed. All 35 Playwright checks passed locally and in production across five viewport sizes. Production checks loaded the live Clerk forms, verified private redirects and API responses, and used mocked member RPC for dashboard interactions. |
| Merge | Feature branch and final merge pushed to GitHub after testing. |
| Deploy | Standard Next build passed. Preview `dpl_2MBdxhC7RQRi8LphqZK4mbMzMaie` and Production `dpl_HSsmeYW6y2q2Xt5GxRiuByNrAg3T` reached READY. No schema or credential changes were required. |
| Document | Architecture and handoff record private routes, smoke commands, and the credentialed verification boundary. |

[Sign in](https://draft-chan.vercel.app/sign-in) · [Final application merge](https://github.com/chanchan012/draft-chan/commit/e22bac18d799a75078840e3cfdf902066eb52c40)

## M2.1 · Deterministic geometry and command history

Released 2026-11-19. Feature commit `1c2894a816630466da26298dfaeed75f27241bab` on `feature/2.1-geometry` was merged as `5331c5742aa01a5e424fcd96a64bae86dd69197b`.

| Phase | Result |
| --- | --- |
| Brief | Solve wall topology, derive room polygons, preserve existing plan graphs, and attribute undoable wall edits to humans or AI agents. |
| Build | Added the typed graph, intersection solver, and Zustand/Immer command store. Dashboard starters persist authored walls. Area summaries and thumbnails use derived room boundaries. |
| Test | Strict TypeScript, 29 Vitest tests, and all 35 Playwright checks against a local production build passed. PGlite verified starter graph persistence and owner attribution. |
| Merge | The tested feature tree was committed to its branch and merged into GitHub main. |
| Deploy | The standard Next build passed. Preview `dpl_6kiNBV8v7AWideruhUBnymVMaFZX` and Production `dpl_EkcEwwnxFEB6EMi4jbcRPVX5T6Xu` reached READY. The public landing returned 200, unsigned floorplan RPC returned 401, and the dashboard redirected to sign-in. |
| Document | Architecture and resume handoff record the version 1 graph extension, centerline area convention, and Studio integration steps. |

[Application merge](https://github.com/chanchan012/draft-chan/commit/5331c5742aa01a5e424fcd96a64bae86dd69197b) · [Production](https://draft-chan.vercel.app)

## Pre-M2.2 · Landing authentication dialogs

Released 2026-11-19. Feature commit `cfe516f7a931636abc5310c9ccd38e36a2a89262` on `fix/landing-auth-modal` was merged as `35674820899bb533aa7513a2f6ae06827b2983a3`.

| Phase | Result |
| --- | --- |
| Brief | Remove page footers, simplify the dashboard header, and open account forms from the landing. |
| Build | Form & Function Studio's frontend craft guidance informed the native dialog. The landing header renders one account action based on session state, and legacy auth URLs redirect to the modal. |
| Test | Strict TypeScript, 32 Vitest tests, and 35 Playwright checks passed locally and on production. The production run covered both live Clerk forms across five viewport sizes. |
| Merge | The tested branch was merged into GitHub main. |
| Deploy | The Next build passed. Preview `dpl_DzLiuV8KaYEcegYv2T7G3pMh6jyV` and Production `dpl_4Cw8if5zu3awyQabfmkvNwHN3X6g` reached READY. |
| Document | Architecture, visual system, and resume handoff record modal URLs, private-route redirects, and coverage. |

## M2.2 · Responsive CAD Studio

Released 2026-11-19. Feature commit `74eb6e6525256dafc77b9f9c3be488431ca1e5f8` on `feature/2.2-studio` was merged as `5b277b4f8049fd29f2924267478b6e14d9f7bc04`.

| Phase | Result |
| --- | --- |
| Brief | Connect plan editing to the protected Studio route with a responsive workbench, wall and door drawing, and isometric preview. |
| Build | Form & Function Studio’s frontend craft guidance informed the grid, framing controls and inspector. Added point snapping, Ortho, live length, room quantities, door swings, undo and redo, and revision-checked saves. |
| Test | Strict TypeScript, 38 Vitest tests, and 45 Playwright checks passed. Chromium covered five viewport sizes, touch drawing at phone widths, and no page scroll. PGlite verified owner isolation, graph persistence, thumbnail refresh, and overlapping revision writes. |
| Merge | The tested feature tree was merged and pushed to GitHub main. |
| Deploy | The Next build passed. Preview `dpl_BSrMz4snLj74c64wgmSvANYHHAvf` and Production `dpl_bsPQrJpqpG4o5tcC41NGmJqzZS6j` reached READY. Studio preserved its private destination through sign-in and unsigned graph requests returned 401. |
| Document | Architecture and resume handoff record the door schema, Studio endpoints, controls, and verification boundaries. |

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/5b277b4f8049fd29f2924267478b6e14d9f7bc04)

## M3.1 · Fixtures, utility layers, and clearance review

Released 2026-11-19. Feature commit `6e2b4fa5974dd3b102f01bef353201cbb1561d25` on `feature/3.1-fixtures-clearance` was merged as `fa9444f7c5ffac8487b2e60aa537e9f0997858d5`.

| Phase | Result |
| --- | --- |
| Brief | Add editable furnishing templates, independent electrical and plumbing layers, and geometry-based clearance checks. |
| Build | Added 12 fixture and six utility templates, grouped Inspector controls, undoable placement, isometric fixture rendering, and selectable audit findings. |
| Test | Strict TypeScript, 46 Vitest tests, and 50 Playwright checks passed. The browser matrix covered touch placement, parameter changes, fixture persistence in the browser fixture, independent overlay visibility and visible clearance evidence. PGlite exercised owner-scoped persistence. |
| Merge | The tested feature tree was merged and pushed to GitHub main. |
| Deploy | The Next build passed. Preview `dpl_E8HKZ1Gz9Xp3BjKkLwTLrt44oBRS` and Production `dpl_FaJ7Dm9GnhXcyLHWxcv8apmoecGG` reached READY. Private redirect and unsigned graph RPC smoke checks passed. |
| Document | Architecture and handoff record the typed version 1 collections, geometry coverage and export starting point. |

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/fa9444f7c5ffac8487b2e60aa537e9f0997858d5)

## Pre-M3.2 · Studio editing and dashboard navigation

Released 2026-11-19. Feature commit `3b8ca1dd31edfd3ca18dfd869c06d65b7734c33f` on `fix/studio-editing-workflow` was merged as `4ea9bd467195837a889ad2796a511f231eefc3bc`.

| Phase | Result |
| --- | --- |
| Brief | Improve touch and desktop editing, recover canvas space, apply inspector changes immediately, and simplify saved-plan navigation. |
| Build | Added pinch zoom and two-finger pan, marquee and additive selection, group dragging and nudging, and keyboard and toolbar deletion. Used Form & Function Studio guidance for the compact controls and horizontal toolbar. Dashboard cards open Studio directly with Rename and Delete in the card menu. |
| Test | Strict TypeScript, 48 Vitest tests, and 55 Playwright checks passed against the optimized local build. The Chromium matrix covered five viewports, including compact phones and landscape. Signed-in interactions used browser fixtures. The unit suite exercised the database path with PGlite. |
| Merge | The tested feature tree was merged and pushed to GitHub main. |
| Deploy | The Next build passed. Preview `dpl_8jjZ8P95G8Saxv69RiNeg7T3jcaE` and Production `dpl_5GjET2D5Phq6wpYdNnGTcK1DooZB` reached READY. Public Studio retained its sign-in return URL. Unsigned graph GET and PATCH returned 401. |
| Document | Architecture and handoff record the gestures, atomic history, live inspector edits, version 1 graph and next subgoal. |

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/4ea9bd467195837a889ad2796a511f231eefc3bc) · [Feature preview](https://draft-chan-cxt9pzhdq-chanchans-projects-aada625f.vercel.app)

## Pre-M3.2 · Floating Studio workbench

Released 2026-11-19. Feature commit `8a0419d8630784dc41a9cb64e66f8c26a9a042a5` on `fix/studio-floating-workbench` was merged as `88d35a7f9181476d50605489d45333d358f85a8c`.

| Phase | Result |
| --- | --- |
| Brief | Use the reference layout for Studio while keeping Draft’s grid and editing behavior. |
| Build | Added floating view, drawing, and selection controls. Layers and Inspector collapse into edge rails and resize on desktop. Narrow phones use bottom sheets. |
| Test | Strict TypeScript, 48 Vitest tests, and 60 Playwright checks passed against the optimized build. Coverage includes keyboard and pointer resizing, panel collapse, overlay behavior, and the existing CAD workflows at five viewport sizes. |
| Merge | The tested feature tree was merged and pushed to GitHub main. |
| Deploy | Vercel Preview `dpl_Fyo95vsG1nvbcjbYAfaiajht65Ud` and Production `dpl_GHH3Rc73E5qFUnHmZjZQcpfJfutx` reached READY. The Studio sign-in return URL and unsigned graph HTTP 401 checks passed. |
| Document | The design system, architecture, and handoff record the layout behavior, deployment, and test commands. |

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/88d35a7f9181476d50605489d45333d358f85a8c) · [Feature preview](https://draft-chan-cb74zzvgj-chanchans-projects-aada625f.vercel.app)

## M3.2 · Bill of materials and blueprint exports

Released 2026-11-19. Feature commit `72b1874fb8d6a1ded83fa2fd3518de5fe06c53bd` on `feature/3.2-exports` was merged as `8cf2fe53a56563eba2c6c921e0293c0abde14b47`.

| Phase | Result |
| --- | --- |
| Brief | Generate materials quantities and downloadable DXF and SVG files from a saved floorplan revision. |
| Build | Added owner-scoped CSV and blueprint downloads, a Neon snapshot and artifact table, Inngest rendering and recovery, and the Studio Exports panel. |
| Test | Strict TypeScript, 53 Vitest tests, and 65 Playwright checks passed across five viewports. An isolated Inngest execution stored both formats and verified duplicate-run safety. An independent DXF audit reported zero errors and repairs. |
| Merge | The tested feature tree was merged and pushed to GitHub main. |
| Deploy | Neon migration 0002 was applied to `draft`. Vercel Preview `dpl_4i3Xf9CcgR163psBkS7JBb5f6JFd` and Production `dpl_3NPv84Huc94F6SnvE3gy2AGU8snk` reached READY. Inngest production sync `4f33a035-0423-468e-ac1e-869ce15625cb` registered the renderer and recovery schedule. All four unsigned export requests returned HTTP 401. |
| Document | Architecture and handoff record the storage and retry semantics, deployment verification, and M4.1 starting point. |

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/8cf2fe53a56563eba2c6c921e0293c0abde14b47) · [Feature preview](https://draft-chan-cqpg6ee5f-chanchans-projects-aada625f.vercel.app)

## M4.1 · Live sync, cursor presence, and autosave

Released 2026-11-19. Feature commit `8da112dd6a4d3ee5aefa03353281e36f798a65a0` on `feature/4.1-live-sync` was merged as `224f7f114329d38c355eca938d3e5a6efb087c91`.

| Phase | Result |
| --- | --- |
| Brief | Sync authorized Studio clients, show human and AI cursors, and save edits through Neon revision checks. |
| Build | Added floorplan-scoped Hono SSE, Upstash Pub/Sub and presence leases, debounced autosave, and conflict handling for concurrent editors. |
| Test | Strict TypeScript, 58 Vitest tests, and 70 Playwright checks passed. The five-viewport browser matrix exercised two-tab autosave, cursors, reconnect behavior, and the existing editor. An isolated Redis 8 test verified the SDK adapter, lease expiry, publications, and owner isolation. |
| Merge | The tested feature tree was merged and pushed to GitHub main. |
| Deploy | Vercel Preview `dpl_5L8wo86LgKkoFWY7KzzstesCGh9o` and Production `dpl_965TcbFEbyj7XwK4Snd7AudvLLaH` reached READY. Production returned HTTP 401 on unsigned live and presence requests and preserved the Studio sign-in destination. |
| Document | Architecture and handoff record the sync contract, conflict rules and MCP integration points. |

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/224f7f114329d38c355eca938d3e5a6efb087c91) · [Feature preview](https://draft-chan-4lfvrur7f-chanchans-projects-aada625f.vercel.app)

## M4.2 · MCP server and Studio agent setup

Released 2026-11-20. Feature commit `91612291c00da0361d530e5ee071c2287a32f218` on `feature/4.2-mcp` was merged as `cbcaa7ac04614bbb190cae35b9a950fa35de42c8`.

| Phase | Result |
| --- | --- |
| Brief | Connect authenticated AI clients to a single floorplan through HTTP and stdio. Verify a two-bedroom layout in an open Studio. |
| Build | Added three MCP resources, nine tools, and the Studio dialog for issuing and revoking agent tokens. Agent edits share Studio’s revision and presence path. Windows and dimension annotations persist in graph version 1 and render in blueprints. |
| Test | Strict TypeScript, 61 Vitest tests, and 80 Playwright checks passed. The MCP integration suite exercised HTTP, stdio, token lifecycle, revision conflicts, AI attribution, and DXF rendering. The browser suite verified the live two-bedroom workflow and manual window and dimension persistence at five viewport sizes. |
| Merge | The tested feature tree was merged and pushed to GitHub main. |
| Deploy | The Next build passed. Neon migration 0003 was applied to `draft`. Vercel Preview `dpl_BnfHzMwb8B5L5ksb24TNip8Utmeb` and Production `dpl_DAz233a8yZG7GF17Y7VqRezofxhy` reached READY. Production rejected missing and invalid MCP tokens, protected token management, and preserved Studio’s sign-in destination. |
| Document | The architecture and handoff record the transport, client setup, database grant, deployment IDs, and test boundaries. |

M4.2 is the last subgoal in the requested roadmap. The signed-in browser and agent workflows were verified using fixtures and isolated Postgres integration tests. The production smoke used unsigned requests and a nonexistent agent token.

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/cbcaa7ac04614bbb190cae35b9a950fa35de42c8) · [Feature preview](https://draft-chan-9aktdeqgj-chanchans-projects-aada625f.vercel.app)
