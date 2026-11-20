# Architectural CAD and agent roadmap

**Status: proposed backlog.** Draft already supports floorplans, hosted openings, furnishing, an isometric cutaway, clearance screening, quantities and blueprint exports. Its authenticated MCP server exposes nine tools and three resources. The names below describe proposed additions. The product focus is architectural drafting from measured survey through an issued drawing set.

**Start with two small deliveries.** M13.1 is the next visual priority. Open an existing apartment as a furnished, sunlit architectural model, rotate it, and select the same window in plan and isometric views. M5.1 is the drafting priority. Find that window’s host wall, snap to its midpoint and measure the room face to face. Both can ship against today's single-storey plans. The sequence below identifies dependencies and suggested release order.

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

### M13 · Lifelike isometric presentation

The current SVG cutaway already exposes the rooms. The visual target is a scale model an architect could put in a client presentation. A recessed window should show its jamb, sill and glass. A sofa should touch the floor and cast a soft shadow. A viewer should be able to tell oak, linen and ceramic apart at the scale of a whole apartment.

- **13.1 · Furnished apartment.** Derive a GPU-rendered scene in real units from the saved graph and shared wall joins. Give openings real reveals, frame depths and door leaves. Use dimensioned furniture models with recognizable silhouettes, cushions, legs and contact points. Use a small licensed asset kit, physically based materials, correctly scaled textures and daylight with soft shadows. Give oak directional grain, fabric a broad rough highlight and glazing a subtle reflection that still lets the viewer see inside. Use consistent color management for the viewport and the exported image. Ship orthographic isometric presets, quarter-turn rotation, pan, fit, a cutaway toggle and picking by authored entity ID. Keep the measured grid and selection overlay available. Furniture and opening dimensions come from the plan.
- **13.2 · Light and finish studies.** Let users pin the camera, swap finishes per surface and compare alternatives side by side at the same exposure. Add project north, site timezone, date and local time for sun studies. Show the inputs behind a study and label illustrative light presets. Calibrated lighting analysis would need its own validation. Add room isolation and keyboard and touch camera controls.
- **13.3 · Client-ready images.** Save named camera and cut-plane settings. Render a high-resolution PNG through the existing job system, pinning the plan revision, asset versions, finish choices, light settings and camera. Support resource-limited devices with lower texture and shadow resolutions and the existing SVG cutaway on graphics-context loss. Later storeys and roofs can use M8 geometry as it ships.

Proposed MCP tools include `set_scene_camera`, `set_cutaway`, `assign_surface_finish`, `set_scene_lighting`, `render_presentation_view`. Reuse M9 job status when available. Add a proposed `scene-manifest` resource for entity-to-asset links, camera, lighting, missing assets and revision. Agents should be able to retrieve the rendered image alongside its revision and camera settings for visual review. A finish preview should be visible to the drafter before it becomes a saved specification.

**Release checks.** Maintain reference scenes for an empty L-shaped room, the MCP-furnished two-bedroom apartment and a narrow bathroom. Check four camera quarters for open seams, light leaks, floating objects and furniture disappearing behind a cut wall. Picking a window must select its actual plan ID at every angle. With a synthetic equatorial site at equinox, verify that a vertical post casts westward in the morning and eastward in the afternoon. Compare reference images under fixed lighting on a pinned renderer, and review the full-size output for material scale and legibility. For the furnished apartment, target p95 interactive frame time of 33 ms or less on a documented mid-range phone during a repeatable 10-second orbit after loading. Check all five viewport sizes, keyboard-only controls, context recovery and a 3840 × 2160 export from the pinned revision.

### M14 · Everyday use and move-in rehearsal

- **14.1 · Can it get through the door?** Trace a chosen item's footprint and rotation from entrance to destination. Model a sofa carried flat, an appliance on a trolley or a wheelchair turning with its user-defined envelope. Show the sweep, narrowest clearance and first blocking object. Extend to tilting and stairs once M8 provides the vertical geometry.
- **14.2 · Rehearse a routine.** Compose short tasks such as bringing groceries from the entrance to a kitchen counter or opening the dishwasher with a chair pulled out. Compare two furniture arrangements using travel distance, overlapping swing envelopes and unreachable destinations. Use the occupants' chosen scenarios and dimensions.

Proposed MCP tools include `define_activity_scenario`, `test_delivery_path`, `simulate_room_use`, `compare_activity_results`.

**Acceptance.** On a measured L-shaped hallway, a long sofa fits through the front door but cannot make the turn while carried flat. Highlight the first collision and replay its pose. Replacing it with a shorter sofa yields a replayable clear path. A search that exhausts its time budget returns “undetermined.” A case that requires tilting identifies the missing height data.

### M15 · Design brief and decision history

- **15.1 · Test the client's brief.** Capture goals in the client's own words, distinguish fixed requirements from preferences, and attach each measurable goal to room IDs, units and a check. For a qualitative goal such as “the kitchen should feel welcoming,” record the reviewer and a presentation view for discussion.
- **15.2 · Explain an alternative.** Compare named options from M12 against the same brief. Link each trade-off to a measured delta, an M13 camera view or a recorded client decision. Keep the original wording and the reason a requirement changed. Single-revision brief checks can ship with M5 measurements.

Proposed MCP tools include `record_design_requirement`, `evaluate_design_brief`, `compare_brief_results`, `record_design_decision`.

**Acceptance.** A client asks for a 900 mm kitchen aisle and a view of the garden from the dining table. Two options report their measured aisle widths and identify the bounding objects. Without a garden reference or an agreed eye position, the sightline stays unresolved. A reviewer can add those inputs and revisit the same decision after a layout change.

### M16 · Renovation budget, salvage and phasing

- **16.1 · Keep, relocate or replace.** Attach condition, quantity and disposition to existing objects. Extend the BOM with owner-supplied unit prices, currency, source date, waste and labor assumptions. Compare upfront cost, salvaged quantities and unpriced items. Calculate embodied carbon only for quantities with a declared factor, unit and source.
- **16.2 · Keep the building usable.** Group work into phases, describe which rooms and utilities must stay available, and show temporary access and shutdown conflicts. Compare alternatives at the same snapshot of prices and assumptions.

Proposed MCP tools include `classify_existing_asset`, `estimate_renovation_option`, `compare_reuse_scenarios`, `check_phase_access`.

**Acceptance.** Relocating six cabinets counts six reused units and includes their relocation labor. A missing price stays visible in the estimate. If a phase closes the only route to an occupied room, highlight the affected room and phase. Editing a price later preserves the issued comparison.

### M17 · Site evidence and owner handover

- **17.1 · Compare design with site observations.** Pin a field photo and a measured dimension to a wall, opening or room, with date, units and measurement uncertainty. Queue notes offline and reconcile them against the observed revision on reconnect. Let a reviewer preview a measured correction through M6.
- **17.2 · Turn the plan into an owner manual.** Attach installation records, finish references, warranties, manuals and maintenance dates to installed items. Generate a role-scoped room handover pack and keep private site photos out of shared packs unless explicitly included. Build on M12 project permissions for external reviewers.

Proposed MCP tools include `attach_site_observation`, `compare_site_measurement`, `propose_as_built_change`, `generate_room_handover`.

**Acceptance.** A field measurement of 887 ± 3 mm flags a modeled 900 mm opening against a 5 mm tolerance. Replaying the offline upload produces one observation. A later model edit makes the correction preview stale. The owner can retrieve the installed fixture's manual from the room pack, and a recipient with access only to that pack cannot retrieve an excluded photo.

## Agent contract across milestones

- **Discovery.** Extend the three shipped resources with a versioned capability list, drawing units and tolerance, active storey/layer, selection references and published sheet index as their milestones land. Return paginated query results and bounded spatial searches so an agent can work on a large drawing without fetching the graph each time.
- **Consistent commands.** Route UI and MCP mutations through the same validated document commands. Inputs use stable entity IDs, coordinate frame and units. Mutation results include the new revision, created/changed/deleted IDs, warnings and attribution. Preserve existing clients and test saved version 1 plans at each model migration.
- **Predictable writes.** M6 previews report dependent edits and invalid references. Bind the preview to the authorized document and base revision, and enforce the same validation at commit. Support idempotency keys and one-step undo for a batch. Keep OAuth access scoped to the authorized floorplan until explicit project grants ship.
- **Verification.** Each command gets geometry or model tests, authenticated MCP contract tests and a Studio parity case. For exports, open the result in an independent reader and check geometry, scale and revision. Keep the five-size viewport matrix. Benchmark selection, pan/zoom and batch edits on versioned small and large drawings before increasing entity limits.

## Suggested release sequence

1. **Next visual release.** M13.1 on a saved two-bedroom apartment. Build one excellent furnished scene and test it on a phone before expanding the asset catalog. In the drafting track, start M5.1 and share stable entity references between both views.
2. **Next client review.** M13.2–13.3 and M15.1. Compare a daylight kitchen and an evening kitchen from the same camera, review the brief and publish a revision-linked image. Ship M5.2 and M6 for precise, reversible edits.
3. **Next design decision.** Use M14.1 and M16.1 to compare keeping an existing sofa with buying a smaller one. Show the path around the entrance corner, the cost difference and the furnished result. These first slices can use one storey and local comparison snapshots.
4. **Project delivery.** M7–M12 support constrained drafting, storeys, construction sheets, interchange, coordination and team review. Use their completed capabilities for multi-storey rehearsals, named alternative reviews, construction phasing and M17 handover. Exercise recovery, permissions and performance with each release.
