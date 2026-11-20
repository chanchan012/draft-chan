# Architectural CAD and agent roadmap

**Status: proposed backlog.** Draft already supports floorplans, hosted openings, furnishing, an isometric cutaway, clearance screening, quantities and blueprint exports. Its authenticated MCP server exposes nine tools and three resources. The names below describe proposed additions. The product focus is architectural drafting from measured survey through an issued drawing set.

**Start with M5.1.** Give a drafter and an agent the same answer to “which wall is this, and how far is its finished face from that column?” That makes later trim, constraint and layout commands testable. The first delivery should let an agent inspect a saved plan, find a wall by location, snap to its midpoint and report a reproducible measurement in Studio.

## Milestones

### M5 · Precision drafting

- **5.1** Query by type, layer or bounds. Add stable geometric references, midpoint/intersection/perpendicular snaps, face and centerline measurements, exact coordinate entry and explicit unit conversion.
- **5.2** Add construction lines, polylines, arcs and circles, polar tracking, local origins and numeric distance/angle input.

Proposed MCP tools include `query_entities`, `inspect_entity`, `resolve_snap`, `measure_geometry`, `draw_polyline`, `draw_arc`, `draw_circle`.

**Acceptance.** On a rotated room, Studio and MCP return the same snap reference and face-to-face width. A 12 ft input yields 3657.6 mm before documented storage rounding. Construction geometry contributes zero room area and BOM quantity.

### M6 · Editing and agent transactions

- **6.1** Add move/copy/rotate/mirror, offset, trim/extend to a boundary, fillet/chamfer and linear/polar arrays. Preserve or explicitly report effects on hosted doors, windows and dimensions.
- **6.2** Expose preview, atomic apply and revision diff through MCP.

Proposed MCP tools include `transform_entities`, `offset_geometry`, `trim_extend`, `edit_corner`, `array_entities`, `preview_changes`, `apply_changes`, `diff_revisions`.

**Acceptance.** An agent previews a corridor widening and sees the affected openings. A successful batch creates one revision and one undo step. An invalid trim or stale preview makes zero writes. Retrying the same committed request returns its original receipt.

### M7 · Parametric design and drawing organization

- **7.1** Add coincident, parallel, perpendicular, equal-length and fixed-distance constraints, driving dimensions, degrees of freedom and conflict diagnostics.
- **7.2** Add named layers with locks and styles, reusable blocks with instances, typed parameters and shared definitions.

Proposed MCP tools include `add_constraint`, `set_driving_dimension`, `explain_constraints`, `manage_layer`, `define_block`, `insert_block`, `edit_block_definition`.

**Acceptance.** Change a room width and keep its corners square and its door hosted. Return the conflicting constraint IDs for an impossible width. Editing a door-type definition updates its instances and preserves instance overrides. Locked layers reject human and agent edits equally.

### M8 · Multi-storey building model

- **8.1** Introduce storeys, elevations, wall types and layer thicknesses, room boundaries and net/gross areas.
- **8.2** Add slabs, stairs and floor openings, roof profiles, linked plans, sections and elevations. Derive each view from the same model.

Proposed MCP tools include `create_storey`, `set_wall_type`, `query_spaces`, `create_slab`, `place_stair`, `create_roof`, `create_section`, `create_elevation`.

**Acceptance.** In a two-storey fixture, moving a stair updates its section and floor opening. Changing a wall assembly updates the interior width and net area while preserving the selected wall reference line. Existing single-storey plans reopen with one default storey.

### M9 · Construction documents and quantities

- **9.1** Add associative dimension chains, leaders, tags, hatches, line weights, paper/model space, named views and scaled sheet viewports.
- **9.2** Add title blocks, sheet numbers, door/window/finish schedules, vector PDF sets and issue revisions linked to the source model.

Proposed MCP tools include `tag_entities`, `dimension_chain`, `create_sheet`, `place_viewport`, `generate_schedule`, `publish_sheet_set`, `get_job_status`.

**Acceptance.** Publish a dimensioned A3 sheet at 1:50. A 5 m line measures 100 mm in the PDF. Door tags match schedule rows. Editing the live model leaves the previously issued set reproducible from its saved revision.

### M10 · CAD interchange and references

- **10.1** Import a documented DXF subset into a staging view with unit, layer and unsupported-entity reports. Support calibrated PDF/image underlays.
- **10.2** Add read-only external drawing references, typed DXF round trips and IFC exchange for a declared set of architectural elements.

Proposed MCP tools include `inspect_import`, `import_dxf`, `calibrate_underlay`, `attach_reference`, `refresh_reference`, `export_ifc`.

**Acceptance.** Round-trip a known DXF through an independent reader and compare coordinates, units and layers within the stated tolerance. A two-point underlay calibration reproduces a third check dimension. An IFC viewer opens both storeys and reports the expected wall types.

### M11 · Coordination and design review

- **11.1** Extend electrical/plumbing symbols into connected routes, add equipment zones and object-linked clash issues.
- **11.2** Add versioned jurisdiction and occupancy profiles, egress paths and accessible turning/approach checks. Return inputs, rule references, affected IDs and unresolved conditions.

Proposed MCP tools include `route_service`, `find_clashes`, `trace_egress`, `evaluate_rule_set`, `create_issue`, `resolve_issue`.

**Acceptance.** Detect an obstructed door approach and a pipe crossing a slab. Highlight both in Studio. For a rule that needs an unspecified occupancy, return “needs input.” A reviewer can reproduce each finding against the saved revision and rule edition.

### M12 · Team projects and operational readiness

- **12.1** Add explicit project membership, viewer/editor/reviewer roles, per-client grants, named alternatives, review comments and revision restore.
- **12.2** Add large-plan benchmarks, reconnect/recovery tests, backup restore drills and tracing from MCP request through save or export.

Proposed MCP tools include `create_design_option`, `compare_options`, `request_review`, `list_revisions`, `restore_revision`, `get_operation_status`.

**Acceptance.** A reviewer can comment on an option. An agent scoped to another option cannot read or change it. Restore creates an attributed revision. Exercise simultaneous edits, disconnect during save and worker retries, then restore a backup and reproduce an issued sheet.

## Agent contract across milestones

- **Discovery.** Extend the three shipped resources with a versioned capability list, drawing units and tolerance, active storey/layer, selection references and published sheet index as their milestones land. Return paginated query results and bounded spatial searches so an agent can work on a large drawing without fetching the graph each time.
- **Consistent commands.** Route UI and MCP mutations through the same validated document commands. Inputs use stable entity IDs, coordinate frame and units. Mutation results include the new revision, created/changed/deleted IDs, warnings and attribution. Preserve existing clients and test saved version 1 plans at each model migration.
- **Predictable writes.** M6 previews report dependent edits and invalid references. Bind the preview to the authorized document and base revision, and enforce the same validation at commit. Support idempotency keys and one-step undo for a batch. Keep OAuth access scoped to the authorized floorplan until explicit project grants ship.
- **Verification.** Each command gets geometry or model tests, authenticated MCP contract tests and a Studio parity case. For exports, open the result in an independent reader and check geometry, scale and revision. Keep the five-size viewport matrix. Benchmark selection, pan/zoom and batch edits on versioned small and large drawings before increasing entity limits.

## Suggested release sequence

Ship M5.1 first, followed by M5.2 and M6. Treat M5–M7 as the production drafting workbench and M8–M9 as the first construction-document release. Use a two-storey project as the end-to-end acceptance case. An agent should be able to inspect the plan, make a constrained edit, explain its effect on openings and quantities, produce a sheet set and identify the revision a human approved. Bring recovery, authorization and performance checks into each release as soon as its feature exists.
