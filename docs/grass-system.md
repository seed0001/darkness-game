# Stylized instanced grass — implementation notes

This document describes how the grass in **darkness** is built so you can reproduce or adapt it in another engine or game. The implementation targets **Three.js** with **WebGL** (`WebGLRenderer`), **instanced meshes**, and a small **custom vertex shader** hook for wind.

---

## 1. High-level architecture

| Piece | Role |
|--------|------|
| **Single shared blade geometry** | One `BufferGeometry` used by all instances (cheap GPU draw). |
| **One `InstancedMesh` per terrain chunk** | Each chunk holds up to `BLADE_TARGET` blades; `mesh.count` is the actual number placed. |
| **Instance matrices** | Position, rotation (yaw + slight tilt), scale (height variation). |
| **Instance colors** (optional but used here) | Per-blade RGB multipliers for patchy field tint; multiplied with vertex colors in the shader. |
| **Vertex colors on geometry** | Vertical gradient along each blade (dark base → bright tip). |
| **`MeshStandardMaterial` + `onBeforeCompile`** | Injects wind displacement after `#include <begin_vertex>`; supports `USE_INSTANCING` and `instanceMatrix`. |
| **Time uniform `uGrassTime`** | World time in seconds, updated each frame for animation. |
| **Chunk worker** (optional) | Grass placement runs in a Web Worker; matrices + instance colors are transferred back as `ArrayBuffer`s. |

---

## 2. Blade geometry (crossed curved planes)

**Idea:** Two vertical `PlaneGeometry`s (same mesh), **merged** at 90° (like an X), so the blade reads from every horizontal viewing angle. This is a common approach in WebGL grass demos (e.g. stylized field grass).

**Steps:**

1. **`PlaneGeometry(width, height, 1, verticalSegs)`**  
   - Multiple vertical segments (e.g. **8**) so vertices can be bent and the tip can taper.

2. **Translate** so the **bottom** of the plane sits on the ground:  
   `translate(0, height * 0.5, 0)` in local space (Y-up).

3. **Per-vertex shape (in the vertex loop):**  
   Let `t = clamp(y / height, 0, 1)` (height along the blade).

   - **Arch:** bend the blade forward (e.g. along +X):  
     `arch = bend * t^2` with `bend` ≈ 0.34, add to X.

   - **Body taper:** narrow width with height:  
     `body = 1 - taper * t` with `taper` ≈ 0.46; multiply `x` by `body`.

   - **Pointed tip:** extra narrow factor for the **upper** part of the blade (e.g. activate from `t ≈ 0.52` to `1` with a power curve, e.g. exponent **2.85**), so the tip pinches to a point.

4. **`computeVertexNormals()`** on each plane.

5. **Second plane:** clone, rotate **Y by π/2**, **`mergeGeometries`** (both planes, `useGroups` if you need groups).

**Typical dimensions in this project:** width ≈ **0.076**, height ≈ **0.38** world units (then scaled per instance).

---

## 3. Vertex colors (vertical gradient)

Each vertex gets an RGB in a `color` attribute. The gradient is **not** linear in one RGB; it uses a **weighted blend** of several palette stops (root, low, mid, olive, yellow band, tip) with weights that depend on `t`. Weights include terms like `(1-t)^k`, `sin(t * π)`, `smoothstep`, etc., then **normalize** by the sum of weights so the result stays in a sensible range.

**Palette example (dark base → lime tip):**

- Root / low: `#0f2412`, `#1f5230`
- Mid / olive: `#3d8c36`, `#4a7a32`
- Upper / tip: `#c4f070`, `#e8f8a0`

**Material:** `vertexColors: true` on `MeshStandardMaterial`.

---

## 4. Wind (custom shader injection)

Wind is **not** a separate pass; it’s **vertex displacement** in object space, scaled so the **base stays pinned** and the **tip moves more**.

**Mechanism:** `material.onBeforeCompile` → replace the chunk `#include <begin_vertex>` with:

1. Same `#include <begin_vertex>` (Three still sets `transformed` from morphs/skinning/etc.).

2. Then:

   - `_h = max(0.0, transformed.y)` — height along blade.

   - `_bend = _h * _h * (0.22 + _h * 0.06)` — quadratic (+ cubic) so only the upper part bends.

   - **World position for phase** (so wind doesn’t move in lockstep across the whole field):

     ```glsl
     #ifdef USE_INSTANCING
     vec4 _gw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
     #else
     vec4 _gw = modelMatrix * vec4(transformed, 1.0);
     #endif
     float _ph = _gw.x * 0.051 + _gw.z * 0.047;
     ```

   - **Multi-frequency waves** (sin/cos) of `uGrassTime` and `_ph` for X and Z.

   - **Flutter** term: extra high-frequency sin with `*_h` so it’s strongest at the tip.

   - Add to `transformed.x` and `transformed.z` (not Y, unless you want bounce).

**Uniform:** `uGrassTime` (float), set each frame from your game clock (e.g. `elapsedSeconds`).

**Note:** `onBeforeCompile` on `MeshStandardMaterial` is a **WebGL-only** path. If you move to **WebGPURenderer**, you must reimplement wind in **TSL / NodeMaterial** or another supported path.

---

## 5. Placement and instancing (per chunk)

**Constants:**

- `BLADE_TARGET` — max instances per chunk (e.g. **12000**).

**RNG:** `mulberry32` seeded with `hashChunk(cx, cz)` so each chunk is **deterministic** but **different** from neighbors.

**Candidate positions:** random `(lx, lz)` in the chunk square; world `wx, wz`.

**Density mask (cheap “noise”):**

- `noise2(x, y)` = fractional part of `sin(x * 12.9898 + y * 78.233) * 43758.5453` — classic hash-like 2D value.

- Reject if `noise2(wx * 0.015, wz * 0.015) < 0.007` (tiny bare patches).

- In **low** noise regions, **probabilistically** thin the grass (e.g. if `n < 0.1` and `rng() > 0.58` skip).

**Matrix per accepted blade:**

- `position = (wx, groundY, wz)` or `getHeightAt(wx, wz)` for uneven terrain / water.

- **Rotation:** small random tilt on X/Z, full random yaw on Y.

- **Scale:** three-tier mix — mostly **small**, some **medium**, few **large** (e.g. 62% / 28% / 10% bands with different `s` ranges); slightly different **Y** scale for natural variation.

- `compose(position, quaternion, scale)` → `Matrix4` → `Float32Array` column-major (16 floats per instance).

**Loop:** increment `placed` until `placed == BLADE_TARGET` or `tries exceeds maxTries` (e.g. `bladeTarget * 14`).

**Return:** `{ count, matrices, instanceColors }` — `count` may be less than `BLADE_TARGET` if the loop runs out of tries.

---

## 6. Patchy field tint (instance colors)

**Goal:** Large-scale “patches” of different green shades **without** one color per blade from the CPU in a huge texture.

**Approach:** For each placed blade at `(wx, wz)`, compute an RGB **multiplier** from **layered** `noise2` at different scales (coarse / medium / fine / streak), then slightly **renormalize** brightness so tints stay readable.

Write into `instanceColors[i * 3 + 0..2]`.

**Three.js:** assign `mesh.instanceColor = new InstancedBufferAttribute(float32Array, 3)` (length `maxInstances * 3`). Unused slots can be `1,1,1`. The built-in shader path **multiplies** instance color with vertex color when instancing color is enabled.

---

## 7. Building the `InstancedMesh`

```text
const mesh = new InstancedMesh(geometry, material, maxInstances);
mesh.count = actualPlacedCount;
mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16));
mesh.instanceMatrix.needsUpdate = true;
// optional:
mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
```

**Frustum culling:** `InstancedMesh` uses one AABB; if chunks are large, you may rely on **chunk-level** culling or accept conservative behavior.

---

## 8. Worker offload (optional)

**Why:** Placing 10k+ blades per chunk on the main thread can hitch.

**How:** Same `computeGrassInstanceMatrices` code in a **Worker**; `postMessage` returns `{ matrices, instanceColors }` with **transferable** `ArrayBuffer`s:

```js
postMessage({ matrices, instanceColors, count, ... }, [matrices.buffer, instanceColors.buffer]);
```

Main thread rebuilds typed arrays if needed, then builds `InstancedMesh`.

**Fallback:** If worker fails, run the same function on the main thread.

---

## 9. Special cases (this project)

- **Lake / terrain height:** `computeGrassInstanceMatricesWithHeight` uses `getHeightAt(wx, wz)` and skips underwater positions (`y < threshold`).

- **Rebuilding grass** after terrain changes (e.g. lake chunk): replace the chunk’s `InstancedMesh` with newly computed matrices + instance colors.

---

## 10. Performance levers

| Lever | Effect |
|--------|--------|
| `BLADE_TARGET` | Linear-ish cost; primary knob. |
| Vertical segments on blade | More vertices per instance. |
| `alphaTest` | Cheap cutout look; tune vs. grass edge artifacts. |
| Worker | Moves placement cost off the main thread. |
| Chunk size | Bigger chunks = fewer draw calls but more instances per mesh. |

---

## 11. File map (reference)

| File | Contents |
|------|----------|
| `chunkGenShared.js` | `BLADE_TARGET`, `mulberry32`, `hashChunk`, `noise2`, `grassInstanceTint`, `computeGrassInstanceMatrices`, `computeGrassInstanceMatricesWithHeight` |
| `grassRocks.js` | Blade geometry, wind material, `buildGrassInstancedMesh` / `buildGrassInstancedMeshFromMatrices` |
| `chunkWorker.js` | Worker entry that calls `computeGrassInstanceMatrices` |
| `world.js` | Shared geometry/material, chunk lifecycle, worker message handler, `updateDecorationTime` for `uGrassTime` |

---

## 12. Porting checklist (other game / engine)

1. **Geometry:** crossed planes (or billboards / mesh cards) + vertical gradient (vertex color or UV gradient).

2. **Instancing:** one buffer for matrices; optional per-instance color for patchy tint.

3. **Wind:** vertex shader in **world or object space**, phase from **world XZ**, amplitude ~ **height²** (base fixed).

4. **Placement:** deterministic RNG per chunk + optional density noise + height rejection.

5. **Time:** single global time uniform for wind.

6. **If not Three.js:** replicate the same math in your engine’s shader language; instancing APIs differ but the data layout (matrices + optional colors) is the same idea.

---

*This document is a reference for the implementation in this repository; tune constants for art direction and performance in your own project.*
