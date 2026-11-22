# Draft progress

## CAD roadmap

The [architectural CAD roadmap](docs/CAD_ROADMAP.md) tracks the completed M5–M10 implementation and planned M11–M17, with candidate MCP tools and release checks. M11.1 is next in the drafting track. M13.1 is the next visual milestone. Later milestones cover move-in rehearsals, client briefs, renovation and owner handover. The release history below records shipped work.

## M5.1 · Precision drafting

Application merge `92e2b58653e508b0df4dbbfeb0f9a8c043a8b44b` adds model queries, stable wall references, snaps and measurements. In Wall or Measure, open Precision input to choose object snaps, wall faces or grid only, and place exact coordinates in mm, cm, m, in or ft. The MCP tools are `query_entities`, `inspect_entity`, `resolve_snap` and `measure_geometry`.

Type check, 67 Vitest checks and the optimized Next build passed. The initial browser run passed 88 checks. After the mobile form placement fix, all five precision-input viewport checks passed on rerun. Graph v1 and the database schema require no migration. Vercel Preview `dpl_2YgvLmVDBZYx8uQzH9XD5XVxw2bR` and Production `dpl_AgjMyQvsoPPjL1sia3NbqDnqRmUR` reached Ready.

## M5.2 · Drawing primitives and exact entry

Application merge `b63368f95fd7e8999c68d812485df150d0817dba` adds the 2D Sketch tool for construction lines, open or closed polylines, circles and clockwise arcs. Precision input adds a local origin, optional angular tracking and distance/angle entry. Sketches support undo, selection, movement, deletion, revisioned saves and live sync. SVG uses vector paths, and DXF exports native lines, polylines, circles and arcs. Sketch geometry contributes zero room area or BOM quantity.

Vercel Preview `dpl_J2yrxSbKzD2LyRHzPkJemcmjPk29` and Production `dpl_2bbNLZjy68ifxM1UJoPs9zNdeaaB` reached Ready. Production returned HTTP 200 for the landing page, 307 for signed-out Studio access and 401 with the OAuth discovery challenge for signed-out MCP.

MCP adds `draw_construction_line`, `draw_polyline`, `draw_circle` and `draw_arc`. Authenticated clients discover 17 tools in total. Graph v1 gains optional `sketches`. Database migrations are current through 0004, with no new migration for M5.

Type checking, 68 Vitest checks and the optimized Next build passed. After correcting the circle test locator and save fixture, all 95 Chromium checks passed across desktop, tablet, phone, compact phone and landscape viewports.

## M6.1 · CAD editing

Application merge `24695794dc8c98ab33ae06d506912c4b6a856980` adds Studio's Edit geometry panel and five MCP tools for transforms, offsets, trim/extend, corner edits and arrays. Hosted openings follow selected walls. Trim and corner edits reject the entire change if an opening cannot stay hosted. Dimensions have independent endpoints and can be included in a transform. Vercel Preview `dpl_Cvruk5yyiE4m1SuKeGYsruksrzbc` and Production `dpl_H6TTFReYg6po56y6MVqLmDS1s4nA` reached Ready.

Strict type checking, the Next production build and 72 Vitest tests passed. Playwright passed 99 checks in the initial run and the wall offset and undo case passed on all five viewports after targeting the exposed part of the wall in landscape. Graph version 1 and database migrations through 0004 carry the release.

## M6.2 · Agent transactions

Application merge `1bcb64c0354c0a1e78041fec49bf55e08ff7c234` adds `preview_changes`, `apply_changes` and `diff_revisions`, bringing MCP to 25 tools. The corridor fixture verifies that a preview reports the hosted door, an invalid trim makes no writes and concurrent retries commit only one revision. A clean Studio tab that receives the immediately following agent batch can undo it in one step.

Strict TypeScript, the Next production build, 73 Vitest tests and 105 Playwright checks across five viewports passed. The temporary Neon branch exercised the migration as the runtime role. Migration `0005_agent_transactions.sql` is applied to the shared `draft` database. The graph format stays at version 1. Vercel Preview `dpl_EPZYyH5AyDg7yk2r1ieK6xexLz8i` and Production `dpl_AT3Bi7w3uF5cfCCRVBWvrfaWdeik` reached Ready. Production returned HTTP 200 for the landing page, HTTP 307 for signed-out Studio and HTTP 401 with OAuth discovery for signed-out MCP.

## M7.1 · Wall constraints and driving dimensions

Application merge `e7bf6244e4b9217423e8f1566eb5bb824147ac7e` adds coincident, parallel, perpendicular, equal-length and fixed-distance relations. Studio solves driving dimensions and shows degrees of freedom. MCP exposes `add_constraint`, `set_driving_dimension`, `explain_constraints` and `remove_constraint` with conflict IDs on unsatisfied edits. Driving dimensions render in Studio and SVG/DXF exports.

Strict TypeScript, the Next build, 77 Vitest tests and 110 Playwright checks passed. Production `dpl_CfgEwkGtQo1NHtVYrG4P9uWTaJBz` reached Ready. Preview `dpl_2trvKgr7mfwNa7zc8H28xfZrCakC` reached Ready. Graph v1 gains optional `constraints` and uses database migrations through 0005.

## M7.2 · Named layers and reusable blocks

Application merge `652602cb61072f2cea51f68131f4b294f64c1b24` adds named layers with assigned objects, visibility, color, line pattern and editing locks. Studio's Blocks panel creates and inserts typed door, window and fixture definitions. Editing defaults updates inheriting instances and keeps overrides. CAD copies retain their links, with an explicit door swing override on a mirrored copy. Layer locks protect members and hosted openings through Studio, MCP and snapshot saves.

Strict TypeScript, the Next production build, 79 Vitest tests and 115 Playwright checks passed. Draft exposes 33 MCP tools and three resources. Optional graph v1 fields `drawingLayers`, `blocks` and `blockInstances` use the existing JSON storage. Database migrations stay at 0005. Vercel Preview `dpl_BTo4ZL17Pmi7vkdTRABiAzF8QSA9` and Production `dpl_EFJif7tmkywb5qU1idtWHPHgxHJS` reached Ready. Production smoke checks returned HTTP 200 for the landing page, HTTP 307 for signed-out Studio and HTTP 401 with OAuth discovery for signed-out MCP.

## M8.1 · Storeys, assemblies and spaces

Application merge `4ee5539b8592f129f620abf34b04e85495914a9e` adds the Studio Building panel and an explicit storey model with an implicit Ground floor for older plans. Room topology, wall constraints, clearances, snaps and live cursors are scoped by storey. Wall assemblies specify material thicknesses and an authored centre or face reference. Net room polygons use finished wall solids. Gross storey areas follow the enclosed outside faces. Multi-storey SVG and DXF exports label side-by-side plans.

Strict TypeScript, the Next build and 82 Vitest tests passed. The initial browser matrix passed 117 cases. After correcting rebase snapshot field order, all ten targeted storey-switching and remote-undo checks passed across five viewports. Draft exposes 37 MCP tools. Graph v1 adds optional storeys, assemblies and object placements. Database migrations remain through 0005. Vercel production dpl_AG9LJxQoAAWD8St9kBgU1MWkh86L reached Ready. Feature preview dpl_BuBSvvsPRuvdN2Q6uey3HzQZEzi6 reached Ready.

## M8.2 · Building structure and linked views

Application merge `85385402a2c6a343cce25661f0ecf673507e8cb0` adds polygonal slabs, floor openings, straight stairs, and flat, shed and gable roofs. Storey plans, cut sections and orthographic elevations derive from the same model. A move to a stair linked to its destination slab updates the slab opening, room area and any affected views. Studio exposes these edits under Building → Structure and Building → Views. SVG and DXF plan exports include structural outlines.

Strict TypeScript, the Next.js production build, 85 Vitest tests and 125 Playwright checks passed. The browser run covered five viewports. Its two-storey fixture verifies that moving a stair updates the section and the opening in the upper storey. The authenticated MCP tests verify that workflow and expose 45 tools and three resources in total. The graph stays at v1 with optional `buildingElements` and `buildingViews` fields. Neon migrations remain through 0005 and existing environment variables suffice.

Vercel preview `dpl_GX3JHUXH6yTVpLF8Cj4ZXZ5PTDpr` and production `dpl_BAuBvqHaxnysMeuF2XY45jWE38Pe` reached Ready. Production checks returned HTTP 200 for the landing page, HTTP 307 for signed-out Studio and HTTP 401 with OAuth discovery for signed-out MCP.

## M9.1 · Drawing annotations and paper space

Application merge `9736d2ee21bfcd1e0dab1075714a64935877ebf7`. Studio’s Sheets panel authors dimension chains, leaders, entity tags and polygon hatches. Named views reference storey plans, sections or elevations. Paper-space viewports accept exact paper millimeters and scale denominators. Named layer weights apply to the paper drawing. Studio and MCP use the same model, save validation and undo commands.

TypeScript, the Next.js build, 88 Vitest tests and 130 Playwright checks passed. In the five-viewport browser matrix, a 5000 mm wall occupied 100 mm of the A3 sheet at 1:50 and its viewport restored after reload. MCP exposes 54 tools and three resources. Graph v1 adds optional `documentItems` and `drawingLayers[].lineWeightMm`. Vercel preview `dpl_CW7bE7qm2zPXdufhE9r7Cfa1Yv3v` reached Ready. The verified M9.2 production release also contains M9.1. Neon stays at migration 0005.

## M9.2 · Construction schedules and PDF issue sets

Application merge `084e5c556709591e41773a29f028a160b5368ed3`. Studio’s Sheets panel edits title block details, assigns room finishes and shows door, window and finish schedules. Inngest publishes a vector PDF set from the chosen saved revision. Owners can see previous issues, retry failed jobs and download the original PDF after further model edits. Draft exposes 59 MCP tools and three resources. Graph v1 adds `finish` records. Neon database draft has verified migration 0006 at journal timestamp 1795248628468 with SHA-256 054e52b2ea01a1ecd15ecda03a0964fbdd791d048ee00a61aeadb8700b304814.

TypeScript, the Next.js production build, 92 Vitest tests and 135 Playwright cases passed. The broad browser run passed 130 cases, and all five PDF issue cases passed after correcting their test fixture to use the API's canonical graph ordering. The PDF checks measured a 5 m wall at 100 mm on A3 at 1:50, matched opening tags to schedule rows and compared the issued file after an edit. Poppler independently opened and rendered the four-page sample. The Vercel quota cleared. M9.2 preview `dpl_BYT7KgMT3rWQC3vgvLKRxxD2uTV7` and production `dpl_H1g3Fa3WiTnGK2eUiRJTDvhXUEnF` reached Ready. The public URL served the tested M9 commit and passed landing, signed-out Studio and MCP OAuth smoke checks.

## M10.1 · Staged DXF and calibrated underlays

Application merge `044b268caa129d334b84ba6ab948f6d9c11b2884`. Studio previews ASCII DXF geometry, source units, layer styles and unsupported entities. Confirmed imports create typed sketches and layer membership in one undo step. Two corresponding points align JPEG, PNG, WebP and individual PDF pages to a storey, with an optional third check point.

TypeScript, Next.js build, 96 Vitest tests and 140 Playwright checks passed. MCP exposes 65 tools. Graph v1 adds optional `underlays`; existing Neon migrations through 0006 suffice. Vercel preview `dpl_JAGn8aFhmepsEd72TqehyMBzyFGJ` is Ready. Production `dpl_9AsXAjbRsVjGvMx6TN1FGaTqHSsn` reached Ready from the tested feature commit.

## M10.2 · CAD references, typed DXF and IFC4

Merge `44a4785cacce1ea96974f0ddcb33b91b119f0f6f` adds read-only DXF reference snapshots with independent storey placement, a visible state and a replacement-file refresh that retains position. Typed DXF saves LINE, LWPOLYLINE, CIRCLE and ARC with named layers for the chosen storey. IFC4 saves the building’s storeys, walls, wall types and material layers, hosted doors and windows, and slabs with voids.

TypeScript, the Next.js production build, 101 Vitest tests and 145 Playwright checks passed. ezdxf independently reopened and audited the exported drawing. IfcOpenShell opened both storeys, resolved wall types and hosted openings, validated schema and generated meshes. MCP exposes 72 tools and three resources. Graph v1 adds optional `drawingReferences`; migrations remain at 0006. Vercel preview `dpl_BvZs8xX1JWzFc3AmoRTTw3KycpM6` and production `dpl_GaScGc7jvCPc2D9PMLWxAG9LP26j` reached Ready, and the public landing, signed-out Studio and MCP OAuth checks passed.

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

## Post-M4.2 · Clerk OAuth for MCP

Released 2026-11-20. Feature `e1cb4c5cece4c348e81974015f5ad96a933bd22c` on `feature/mcp-clerk-oauth` was merged as `5adc5583144c4fe0155bebd05da143a44bba63f5`.

| Phase | Result |
| --- | --- |
| Brief | Connect Codex and ChatGPT-compatible clients through Clerk without copying a floorplan token. |
| Build | Added Clerk OAuth discovery and verification at `/api/mcp`. Studio lets a signed-in owner enable or disable access for one floorplan at a time. Manual tokens remain available for existing clients. |
| Test | TypeScript, the optimized Next build, 62 Vitest tests, and 85 Playwright checks passed. The integration test used the Clerk SDK with a mocked Clerk verification endpoint and PGlite. It checked audience rejection, owner isolation, an authorized edit, and grant revocation. |
| Merge | The tested tree was merged into GitHub `main`. |
| Deploy | Neon migration 0004 was applied. Vercel Preview `dpl_7Et1UaKmUx6ijB6kN2BQb9pZj2j7` and Production `dpl_2vYHe5VphCqeKC8e12UNGu8dSLcA` reached READY. Draft’s existing Clerk development instance registered the production resource. The live challenge, issuer discovery, invalid-token rejection, and Codex CIMD redirect to Clerk sign-in passed. |
| Document | Architecture and handoff record token verification, the selected floorplan grant, and OAuth setup for ChatGPT and Codex. |

The live smoke reached Clerk sign-in. Account consent, token exchange, and an authenticated production MCP edit remain to be verified with a signed-in account.

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/5adc5583144c4fe0155bebd05da143a44bba63f5) · [Feature preview](https://draft-chan-puigf0ma0-chanchans-projects-aada625f.vercel.app)

## Studio wall joins and isometric cutaway

Released 2026-11-21. Feature commit `d12d05624cefd381288a1fe4a451d991ed01f225` on `fix/studio-wall-joins-isometric` was merged as `e45eee8cebeffce978c81516df87f6a3ae22f9d8`.

| Phase | Result |
| --- | --- |
| Brief | Close the visible corner notches in Studio and make the isometric view readable on a furnished plan. |
| Build | Derived corner fills from shared endpoints, rendered a raised floor slab and cutaway walls, and gave glazing and furniture distinct materials and details. |
| Test | Strict TypeScript, the Next build, 65 Vitest tests, and 85 Playwright checks passed. The MCP browser fixture verified the joined 2D corners and furnished isometric view across five viewport sizes. Reviewed rendered desktop and compact phone frames. |
| Merge | The tested tree was merged into GitHub `main`. |
| Deploy | Vercel Preview `dpl_2q6tf6ngwMhYiJj7PqAox2VctJUr` and Production `dpl_2QuP1wK3TDBmWJNGUvmLCqbTMZEJ` reached READY. Landing, Studio’s sign-in redirect, and MCP OAuth discovery passed production smoke checks. |
| Document | Architecture and handoff record the view geometry, release IDs, and reproduction commands. |

The user reported a successful MCP connection. Release verification used fixture plans for browser checks and public endpoints for production smoke checks.

[Dashboard](https://draft-chan.vercel.app/dashboard) · [Application merge](https://github.com/chanchan012/draft-chan/commit/e45eee8cebeffce978c81516df87f6a3ae22f9d8) · [Feature preview](https://draft-chan-kmmyrjui2-chanchans-projects-aada625f.vercel.app)
