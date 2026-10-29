// Generic post-process for GLBs written by the 3ds Max 2026 native exporter (exportFile … using:GLTF_Export).
// Fixes what the exporter can't do (see SKILL.md "glTF / Web Export"):
//   1. removes the unnamed wrapper nodes and bakes their rotation/scale (the Z-up -> Y-up turn) into the meshes;
//      every named node keeps only its world translation (identity rotation, scale 1). Shared meshes are baked
//      once, and cloned if an instance needs a different bake.
//   2. optionally rebuilds a hierarchy from a JSON tree (the exporter flattens it and drops helpers)
//   3. linearises the raw colour factors (base colour, emissive); optional KHR_materials_emissive_strength
//   4. mipmapped samplers, 5. opaque RGBA PNGs re-encoded as RGB (lossless, verified)
//   6. dedup + prune (after normalising -0 and attribute order), no cameras / punctual lights / extras
//
// Usage:
//   node gltf_postprocess.mjs <in.glb> <out.glb> [--tree tree.json] [--emissive-strength N] [--emissive-material a,b]
// tree.json: { "groupName": ["child", "otherGroup", …], "otherGroup": [ … ] }. Keys become new empty identity
//   nodes at the origin, keys not listed as anyone's child are scene roots, other names must exist in the file.
//   Named nodes not in the tree stay at the scene root. Without --tree every named node is a scene root.
// --emissive-strength applies to the --emissive-material names, or else to every material with a non-zero emissive.
// Needs: npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions pngjs
// Tested on a 12-wheel articulated truck asset (17 meshes, 2-level tree): 0 glTF-validator errors.
import { readFileSync, statSync } from "node:fs";
import { NodeIO, TextureInfo } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import { PNG } from "pngjs";

// ---- arguments -------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const treePath = opt("--tree");
const emissiveStrength = opt("--emissive-strength");
const emissiveMaterials = opt("--emissive-material")?.split(",").map((s) => s.trim());
const [IN, OUT] = args;
if (!IN || !OUT) { console.error("usage: node gltf_postprocess.mjs <in.glb> <out.glb> [--tree tree.json] [--emissive-strength N] [--emissive-material a,b]"); process.exit(2); }
const TREE = treePath ? JSON.parse(readFileSync(treePath, "utf8")) : {};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const log = (...a) => console.log(...a);

// ---- small column-major matrix helpers -------------------------------------------------------------------
const linear3 = (m) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
const mul3v = (a, x, y, z) => [a[0] * x + a[3] * y + a[6] * z, a[1] * x + a[4] * y + a[7] * z, a[2] * x + a[5] * y + a[8] * z];
function invTranspose3(a) {
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;   // a[col*3+row]
  const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
  const det = a00 * b01 + a01 * b11 + a02 * b21;
  const inv = [b01, -a22 * a01 + a02 * a21, a12 * a01 - a02 * a11, b11, a22 * a00 - a02 * a20, -a12 * a00 + a02 * a10, b21, -a21 * a00 + a01 * a20, a11 * a00 - a01 * a10].map((v) => v / det);
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
}
const sameMat = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

// write transformed copies of a primitive's vertex attributes (originals are left for prune)
function bakePrimitive(prim, L) {
  const N = invTranspose3(L);
  for (const [sem, M, isDir] of [["POSITION", L, false], ["NORMAL", N, true]]) {
    const acc = prim.getAttribute(sem);
    if (!acc) continue;
    const src = acc.getArray(), dst = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      let v = mul3v(M, src[i], src[i + 1], src[i + 2]);
      if (isDir) { const l = Math.hypot(...v) || 1; v = v.map((c) => c / l); }
      dst.set(v.map((c) => c + 0), i);   // -0 -> +0: dedup compares bytes
    }
    prim.setAttribute(sem, doc.createAccessor(acc.getName()).setType("VEC3").setArray(dst).setBuffer(acc.getBuffer()));
  }
}

// ---- 1 + 2: unwrap, bake, rebuild the tree ---------------------------------------------------------------------
for (const n of root.listNodes()) if (n.getCamera()) n.dispose();   // exported cameras are not wanted in a web asset
const named = root.listNodes().filter((n) => n.getName());
const byName = new Map(named.map((n) => [n.getName(), n]));
const groupNames = Object.keys(TREE);
const clash = groupNames.filter((g) => byName.has(g));
if (clash.length) throw new Error(`tree group names already exist as nodes in ${IN}: ${clash.join(", ")}`);
const listed = Object.values(TREE).flat();
const missing = listed.filter((n) => !groupNames.includes(n) && !byName.has(n));
if (missing.length) throw new Error(`tree names not found in ${IN}: ${missing.join(", ")}`);

const bakedWith = new Map();   // Mesh -> linear matrix it was baked with
let clonedMeshes = 0;
const placement = new Map();   // node -> world translation, read before anything is re-parented
for (const node of named) {
  const world = node.getWorldMatrix();
  const L = linear3(world);
  placement.set(node, [world[12], world[13], world[14]].map((v) => (Math.abs(v) < 1e-7 ? 0 : v)));
  let mesh = node.getMesh();
  if (!mesh) continue;
  const prev = bakedWith.get(mesh);
  if (prev && !sameMat(prev, L)) {
    const copy = doc.createMesh(mesh.getName());
    mesh.listPrimitives().forEach((p) => copy.addPrimitive(p.clone()));
    node.setMesh(copy);
    mesh = copy;
    clonedMeshes++;
  }
  if (!bakedWith.has(mesh)) {
    mesh.listPrimitives().forEach((p) => bakePrimitive(p, L));
    bakedWith.set(mesh, L);
  }
}
for (const node of named) {
  const parent = node.getParentNode();
  if (parent) parent.removeChild(node);
  else scene.removeChild(node);
  node.setTranslation(placement.get(node)).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
}
for (const n of root.listNodes()) if (!n.getName()) n.dispose();   // the exporter's wrappers

const groups = Object.fromEntries(groupNames.map((g) => [g, doc.createNode(g)]));
for (const [g, kids] of Object.entries(TREE)) for (const k of kids) groups[g].addChild(groups[k] ?? byName.get(k));
for (const g of groupNames.filter((g) => !listed.includes(g))) scene.addChild(groups[g]);
const loose = named.filter((n) => !listed.includes(n.getName()));
for (const n of loose) scene.addChild(n);
root.setDefaultScene(scene);
log(`nodes: ${named.length} named, ${groupNames.length} groups created, ${loose.length} left at scene root; ${bakedWith.size} meshes baked, ${clonedMeshes} cloned`);
// (children of a group keep world translations, so groups must sit at the origin with identity, as created here)

// ---- 3: colour factors are written raw (sRGB / 255) by the exporter; glTF wants linear ----------------------
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fmt = (a) => "[" + a.map((v) => v.toFixed(4)).join(", ") + "]";
const strengthExt = emissiveStrength ? doc.createExtension(KHRMaterialsEmissiveStrength) : null;
for (const m of root.listMaterials()) {
  const bc = m.getBaseColorFactor(), em = m.getEmissiveFactor();
  const bcLin = [...bc.slice(0, 3).map(toLinear), bc[3]], emLin = em.map(toLinear);
  if (!sameMat(bc, bcLin)) { m.setBaseColorFactor(bcLin); log(`${m.getName()}: baseColorFactor ${fmt(bc)} -> ${fmt(bcLin)}`); }
  if (!sameMat(em, emLin)) { m.setEmissiveFactor(emLin); log(`${m.getName()}: emissiveFactor ${fmt(em)} -> ${fmt(emLin)}`); }
  const wanted = emissiveMaterials ? emissiveMaterials.includes(m.getName()) : em.some((c) => c > 0);
  if (strengthExt && wanted) {
    m.setExtension("KHR_materials_emissive_strength", strengthExt.createEmissiveStrength().setEmissiveStrength(Number(emissiveStrength)));
    log(`${m.getName()}: KHR_materials_emissive_strength = ${emissiveStrength}`);
  }
}

// ---- 4: mipmapped samplers ------------------------------------------------------------------------------------
for (const m of root.listMaterials()) {
  for (const [tex, info] of [
    [m.getBaseColorTexture(), m.getBaseColorTextureInfo()], [m.getEmissiveTexture(), m.getEmissiveTextureInfo()],
    [m.getNormalTexture(), m.getNormalTextureInfo()], [m.getOcclusionTexture(), m.getOcclusionTextureInfo()],
    [m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()],
  ]) if (tex && info) info.setMinFilter(TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR).setMagFilter(TextureInfo.MagFilter.LINEAR);
}

// ---- 5: opaque RGBA PNGs -> RGB PNG, best of a few lossless deflate settings ------------------------------------
for (const tex of root.listTextures()) {
  if (tex.getMimeType() !== "image/png") continue;
  const before = tex.getImage();
  const png = PNG.sync.read(Buffer.from(before));
  let opaque = true;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) { opaque = false; break; }
  if (!opaque) { log(`${tex.getName()}: has real alpha, left as is`); continue; }
  let best = null;
  for (const deflateStrategy of [0, 1, 2, 3]) {
    const bytes = PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9, deflateStrategy, filterType: -1 });
    if (!best || bytes.length < best.length) best = bytes;
  }
  const back = PNG.sync.read(best);
  for (let p = 0; p < png.data.length; p += 4) {
    if (back.data[p] !== png.data[p] || back.data[p + 1] !== png.data[p + 1] || back.data[p + 2] !== png.data[p + 2]) throw new Error(`${tex.getName()}: re-encode changed pixels`);
  }
  tex.setImage(new Uint8Array(best));
  log(`texture ${tex.getName() || "(unnamed)"} ${png.width}x${png.height}: RGBA ${before.length} B -> RGB ${best.length} B, pixels identical`);
}

// ---- 6: dedup + prune, no cameras / punctual lights / extras -----------------------------------------------
// dedup compares meshes by attribute order too, which the bake changes, so sort every primitive's attributes first
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const sems = prim.listSemantics().sort();
  const accs = sems.map((s) => prim.getAttribute(s));
  sems.forEach((s) => prim.setAttribute(s, null));
  sems.forEach((s, i) => prim.setAttribute(s, accs[i]));
}
await doc.transform(dedup(), prune({ keepLeaves: true }));
root.listCameras().forEach((c) => c.dispose());
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === "KHR_lights_punctual") ext.dispose();
for (const list of [root.listNodes(), root.listMeshes(), root.listMaterials(), root.listTextures(), root.listAccessors(), root.listScenes(), root.listBuffers()]) {
  for (const p of list) p.setExtras({});
}
root.setExtras({});
root.getAsset().generator = "gltf_postprocess.mjs (3dsmax-mcp skill, glTF-Transform) from 3ds Max GLTF_Export";

await io.write(OUT, doc);
log(`meshes ${root.listMeshes().length}, materials ${root.listMaterials().length}, textures ${root.listTextures().length}, extensions [${root.listExtensionsUsed().map((e) => e.extensionName).join(", ")}]`);
log(`${IN} (${statSync(IN).size} B) -> ${OUT} (${statSync(OUT).size} B)`);
