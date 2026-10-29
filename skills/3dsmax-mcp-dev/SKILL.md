---
name: 3dsmax-mcp
description: Tool choices, workflows, and MAXScript pitfalls for controlling 3ds Max via MCP.
---

# 3ds Max MCP — Agent Guide

Principles:
- Match the user's request. Do not run setup, discovery, or scene analysis by habit.
- Do not call `get_bridge_status` or `get_session_context` as a session preamble.
- Prefer a dedicated MCP tool over raw MAXScript when a tool clearly matches the task.
- Do not render unless the user explicitly asks. Viewport capture is fine when visual proof is useful.
- Multiple Max instances: use **MCP Claim This Max** in the target window so tools hit the right session.

## Tool Choice

Scene reads — use **`query_scene(action=...)`**:
- `overview` | `filter` | `class` | `property` | `selection` | `delta`
- **`get_instances`** / **`get_dependencies`** — instancing and reference graph
- **`get_session_context`** — bridge + capabilities + overview + selection (on demand only)

Object/material/plugin inspection:
- `inspect_object`, `inspect_properties`, `get_material_slots`, `get_materials`
- `analyze_node_orientation` — pivot, bbox, local axes, world matrix before rig/vehicle/camera transforms
- `introspect_class`, `introspect_instance`, `introspect_osl`, `discover_plugin_classes`, `map_class_relationships` — unfamiliar plugin APIs and exact param names
- Arnold materials such as `ai_standard_surface` may not appear in class discovery; inspect with `inspect_plugin_class` or `introspect_osl`

Mutation:
- Use object, modifier, material, controller, organization, and viewport tools when they match.
- Verify after meaningful edits with `query_scene(action=delta)`, re-inspection, or viewport capture.

Debugging:
- `walk_references` — trace dependencies from a live object
- `watch_scene` — track user actions during an interactive session
- `execute_maxscript` — fallback only when no dedicated tool exists

## Scene Organization

**Layers** — `manage_layers`:
- Actions: `list`, `create`, `delete`, `set_current`, `set_properties`, `add_objects`, `select_objects`
- Properties: hidden, frozen, renderable, color, boxMode, castShadows, rcvShadows, xRayMtl, backCull, rename, parent

**Groups** — `manage_groups`:
- Actions: `list`, `create`, `ungroup`, `open`, `close`, `attach`, `detach`

**Named Selection Sets** — `manage_selection_sets`:
- Actions: `list`, `create`, `delete`, `select`, `replace`

## Tool Reference

### Scene reads
`query_scene` `get_hierarchy` `get_instances` `get_dependencies`

### Objects
`get_object_properties` `analyze_node_orientation` `set_object_property` `create_object` `delete_objects` `transform_object` `select_objects` `set_visibility` `clone_objects` `set_parent` `batch_rename_objects`

### Modifiers
`add_modifier` `remove_modifier` `set_modifier_state` `set_modifier_property` `collapse_modifier_stack` `make_modifier_unique`

### Materials
- Create + assign: `assign_material`, `create_material_from_textures`, `smart_import`, `palette_laydown`
- Edit: `set_material_property`, `set_material_properties`
- Inspect: `get_material_slots`, `get_materials`
- Multi/Sub: `set_sub_material`
- Textures: `create_texture_map`, `set_texture_map_properties`
- Dual pipeline: `create_shell_material`, `replace_material`, `batch_replace_materials`
- OSL: `write_osl_shader`

### Material notes
- `create_material_from_textures` and `smart_import` default to **OpenPBR**. Pass `material_class` for Physical, Arnold, Redshift, V-Ray, MaterialX, Octane, etc. (see tool tripback `hint.renderers`).
- `create_shell_material` wraps two scene materials in `Shell_Material` (render slot 0, export/viewport slot 1), or builds from `texture_folder` with `render_material_class` / `export_material_class`. Shell is a container, not a renderer.

### Viewport
- Fast: `capture_viewport`
- Multi-angle grid: `capture_multi_view`
- Fullscreen: `capture_screen` (requires `enabled=True`)

### External .max files (no scene load)
- `inspect_max_file`, `search_max_files`, `merge_from_file`, `batch_file_info`

### Plugin discovery
- `discover_plugin_surface`, `get_plugin_manifest`, `refresh_plugin_manifest`
- `inspect_plugin_class`, `inspect_plugin_constructor`, `inspect_plugin_instance`
- MCP resources: `resource://3dsmax-mcp/plugins/{name}/manifest|guide|recipes|gotchas`

### tyFlow
- Create: `create_tyflow`, `create_tyflow_preset`
- Inspect: `get_tyflow_info` (`include_operator_properties` for deep readback)
- Edit: `modify_tyflow_operator`, `set_tyflow_shape`, `set_tyflow_physx`, `add_tyflow_collision`
- Simulate: `reset_tyflow_simulation`, `get_tyflow_particle_count`, `get_tyflow_particles`

### Forest Pack
- `scatter_forest_pack` — surfaces + source geometry; auto footprint per variant

### Controllers & wiring
- `assign_controller`, `inspect_controller`, `inspect_track_view`, `set_controller_props`, `add_controller_target`
- `list_wireable_params`, `wire_params`, `get_wired_params`, `unwire_params`

### Data Channel
- `add_data_channel`, `inspect_data_channel`, `set_data_channel_operator`, `add_dc_script_operator`

### Scene management
- `manage_scene` (hold/fetch/reset/save/info)
- `get_state_sets`, `get_camera_sequence`

## When to Use `execute_maxscript`

**Almost never.** Only when there is genuinely no dedicated tool:
- Animation keyframing, render/environment settings, custom one-off scripted operations

**Do not use for:** anything a dedicated tool already does — properties, objects, materials, selection, batch ops, inspection.

## MCP Tool Pitfalls

- `set_modifier_property`: `name` + `modifier_index` (1-based) for one modifier; `modifier_class` + `names` for batch. Inspect with `inspect_properties(target="modifier")` first.
- `smart_import`: default `lod_filter="lod0"`. Shared maps match on asset id; variant meshes in a bundle folder with `Textures/` share one material key — omit `name_pattern` for all variants.
- `palette_laydown`: `sample_mode="random_per_subfolder"` for large per-subfolder asset libraries; `overflow_mode="palette_then_library"` when more than 24 picks.
- `scatter_forest_pack`: needs non-zero `widthlist`/`heightlist` per geometry item. Hide source meshes after scatter.
- `add_data_channel`: reuses first DC modifier by default; `create_new=true` for a second stack entry.
- `get_material_slots`: prefer `slot_scope="map"` unless you need every param (`slot_scope="all"` + `include_values:true` is huge on Arnold/Physical).
- `create_object`: default `pos_mode="ground"` — `pos` is bottom-center contact, not bbox center. Tripback includes `bbox`, `placement`, `groundContact`.
- Box: `width=X`, `length=Y`, `height=Z`.
- `list_wireable_params` paths include `[#Parameters]` levels — pass through to `wire_params` as-is.
- `create_shell_material`: `mcp_findMaterialByName` uses `sceneMaterials` — `getClassInstances Material` is invalid (Material is not a MAXClass).
- `python -m src.server` runs as `__main__`; alias it to `src.server` before importing tool modules or `from ..server import mcp` creates a second empty FastMCP instance.

## Session Gotchas

- **Units reset with the scene**: `manage_scene reset` / `resetMaxFile` restores the startup units (often mm / Generic). Re-set `units.SystemType`, `DisplayType`, `MetricType` after every reset and before any export.
- **Bridge never connects on a fresh Max 2026**: a modal "Heads Up! default scene material has changed (OpenPBR)" sits behind the splash and blocks startup. Click **Continue** (tick "Don't show again").
- **Safe mode is a substring match on the whole command**: `doscommand`, `shelllaunch`, `deletefile`, `python.execute`, `createfile`, `hiddendoscommand` are blocked even inside comments, strings or file paths. Delete or move files outside Max.
- **Ports**: native bridge = named pipe `\\.\pipe\3dsmax-mcp`; TCP fallback = `127.0.0.1:8765` (keep other local servers off it). `ConnectionError … 8765` also just means Max isn't running, so check the process first.

## MAXScript Pitfalls

- **No parens with keyword args**: `Box width:10` not `Box() width:10`
- **Wrap in try/catch**: `try (...) catch (ex) (ex)`
- **`Noise` vs `Noisemodifier`**: texture map vs modifier
- **`(getDir #temp)`** is Max temp, not OS temp
- **.NET strings**: convert to MAXScript strings before string methods
- Controller/wire paths: normalize display tokens like `[#Z Position]` to `[#z_position]`
- TCP fallback is opt-in; prefer the native bridge, and if Max viewport interaction stutters while fallback is running, stop the fallback and use the native bridge path.
- **"Bad free thunk local member index"**: a `for … collect` passed *directly* as a function argument that reads a local/param fails at runtime. Collect into a local first: `local pts = for … collect …; f pts`.
- **Negative arguments**: `f p -1.25 2` parses as `f (p - 1.25) 2`. Parenthesise: `f p (-1.25) 2`, `f p (-x)`.
- **`getPolygonCount` on Editable Poly counts polygons, not triangles** (a 16-sided wheel: 82 vs 188). For triangle budgets use `(snapshotAsMesh o).numfaces`.
- **`polyop.createPolygon` returns `undefined`** when the new face's winding conflicts with a neighbour. Throw on it and you get a free normal-orientation check.
- **Probe expressions create nodes**: `(Box()).mapcoords` leaves a real Box in the scene. Inspect existing objects instead.
- **JSON (Max 2026 / .NET 8)**: no Newtonsoft, and `JsonDocument.Parse`'s optional *struct* arg can't be omitted or `dotNetObject`-constructed. Use `dotNet.loadAssembly "System.Text.Json"`, build the options with `(dotNetClass "System.Activator").CreateInstance ((dotNetClass "System.Type").GetType "System.Text.Json.JsonDocumentOptions, System.Text.Json")`, then call `.Parse txt opts`.

### OSL
- Use `write_osl_shader` for file I/O and compilation
- Use `introspect_osl` before wiring — not `introspect_class` on OSLMap (massive output)
- Shader function name must match `shader_name`; use unique names (cache reuse)
- OSLMap lowercases param names

## glTF / Web Export (native `GLTF_Export`, Max 2026)

- **Call**: `exportFile f #noPrompt selectedOnly:true using:GLTF_Export` (`.glb` = binary). `GLTF_Export.GLTFExportOptions` only has `ShellMaterialUseBakedMtl`: no axis, scale or hierarchy options. Each export also writes `<file>.glb.log`; delete it outside Max.
- **Axes**: glTF (x, y, z) = Max (X, Z, −Y), metres 1:1. A model facing Max **−Y** faces glTF **+Z** (glTF's "front").
- **Node layout**: every mesh becomes an unnamed wrapper (Z-up→Y-up × world transform) holding the named mesh node with an identity transform; vertices stay in Max local space.
- **Hierarchy is flattened** (also mesh→mesh, also `selectedOnly:false`). **Helpers (Point/Dummy) are dropped**, so you can't get empty nodes from Max. Rebuild parenting and empties in post or at runtime.
- **Affect Pivot Only is ignored** (the object offset isn't applied, so the geometry shifts). Prefer native pivots: build into an Editable Poly created at the origin and only set `.pos`. Otherwise bake: read world verts (`polyop.getVert o i node:o`), clear `objectOffsetPos/Rot/Scale`, *then* write them back with `polyop.setVert … node:o`.
- **UVs only with a textured material**: no `TEXCOORD_0` unless the material has a bitmap (e.g. PhysicalMaterial `base_color_map`).
- **Colour factors are written raw** (`base_color` / `emit_color` value ÷ 255, not linearised). Linearise in post, or keep colours in an sRGB texture with a white `base_color` (the factor is then omitted).
- **Emission**: becomes a raw `emissiveFactor` only. `emit_luminance` / kelvin are ignored, and there's no `KHR_materials_emissive_strength`.
- **Sampler has no mipmaps** (min/mag LINEAR), so set `LINEAR_MIPMAP_LINEAR` in post. **PNGs are re-encoded as RGBA** (opaque alpha added, sRGB chunk dropped; RGB unchanged).
- **Multi/Sub** gives one primitive per material ID. Material findings were tested with **PhysicalMaterial**; OpenPBR is not verified.
- **Web pipeline**: scripted build (native pivots) → `exportFile` → gltf-transform post-process (unwrap + bake transforms, rebuild the tree, linearise factors, mipmaps, RGB PNG, dedup/prune) → Khronos `gltf-validator`. npm only has prereleases of the validator, so install it without a version range.
  - Generic script: `gltf_postprocess.mjs` in this folder.
  - Tested end to end on a 12-wheel articulated truck asset: scripted build, fixed node tree, validator plus custom checks.
- **gltf-transform `dedup()` misses identical meshes** when baked data differs only in −0 vs +0 bytes, or in attribute insertion order. Write `c + 0` and re-add attributes in sorted order first (the script does both).

## MAXScript Reference (bundled)

Read the relevant reference file before writing unfamiliar MAXScript:

| File | Covers |
|------|--------|
| `maxscript-core-syntax.md` | Variables, scope, types, operators, control flow |
| `maxscript-common-patterns.md` | Undo/animate blocks, callbacks, file I/O |
| `maxscript-3dsmax-objects.md` | Nodes, transforms, hierarchy, properties |
| `maxscript-mesh-poly-ops.md` | Sub-object mesh/poly ops |
| `maxscript-materials-textures.md` | Materials, texmaps, PBR |
| `maxscript-animation-controllers.md` | Controllers, constraints, wire params |
| `maxscript-rendering-cameras.md` | Render settings, cameras, environment |
| `maxscript-splines-shapes.md` | Splines and shapes |
| `maxscript-scripted-plugins.md` | Scripted geometry, modifiers, utilities |
| `maxscript-ui-rollouts.md` | Rollout UIs and dialogs |

### Unwrap UVW
- Open the editor: `$Box001.modifiers[#Unwrap_UVW].edit()` — not the `OpenUnwrapUI` macro alone

## Standalone Chat (WIP)

Experimental in-Max chat (Customize UI → MCP → MCP Chat). Prefer external MCP for production.

- Same tools and `safe_mode` as external MCP
- Call `query_scene` / `inspect_object` for scene state — not auto-injected by default
- Slash commands: `/reload`, `/clear`, `/help`
