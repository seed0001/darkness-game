# Procedural pine trees — ez-tree, placement, chopping, wind

This document describes how **darkness** creates **evergreen trees**: they are **procedurally generated** with the **[`@dgreenheck/ez-tree`](https://github.com/dgreenheck/ez-tree)** library (MIT), scaled to a **target world height**, **spawned per terrain chunk**, and integrated with **melee / axe chopping**, **fallen logs**, and **subtle wind motion**.

---

## 1. Dependency

| Package | Version (this repo) | Role |
|---------|---------------------|------|
| `@dgreenheck/ez-tree` | `^1.1.0` | `Tree` class, built-in presets (e.g. **Pine Medium**), `generate()`, optional `update()` for animation. |

The library outputs **Three.js** `Object3D` hierarchies (meshes for bark / foliage). You do **not** author GLB trees for the base pine; everything is generated from parameters + seed.

---

## 2. Factory: `createProceduralTree` (`ezTreeSpawn.js`)

**Import:** `import { Tree } from '@dgreenheck/ez-tree'`.

**Flow:**

1. **`const tree = new Tree()`**

2. **`tree.loadPreset('Pine Medium')`** — uses the library’s bundled preset (shape, branching, etc.).

3. **`tree.options.seed`** — set from a **32-bit unsigned** integer from your RNG (`(trng() * 0xffffffff) >>> 0`) so each tree differs but stays **deterministic** if the RNG is seeded the same way.

4. **Tints (art direction for this game):**

   - `tree.options.bark.tint = 0x989898`

   - `tree.options.leaves.tint = 0x878787`

   These **desaturate** the tree toward the gray, foggy world look.

5. **`tree.generate()`** — builds geometry/materials under the hood.

6. **Uniform scale to target height:**

   - `updateMatrixWorld(true)`, then **`Box3.setFromObject(tree)`**, read **`size.y`** as height `h`.

   - `baseScale = targetTreeHeightWorld / h`

   - `scale = baseScale * (1.0 + trng() * 0.45)` — **±45%** height variation.

   - **`tree.scale.setScalar(scale)`**

7. **Yaw:** `tree.rotation.y = trng() * Math.PI * 2`

8. **`userData`** (gameplay / wind):

   - `meshyTree`, `ezTree`, `treePhase: 'standing'`, `chopStandingHits: 0`

   - `windPhase = trng() * Math.PI * 2` — per-tree phase for sway

   - `baseRotX/Y/Z` — base rotation for wind (Y is copied from final yaw)

9. **Shadows:** `traverse` meshes → `castShadow` / `receiveShadow` **true**.

**Return:** the `tree` root object (add to scene like any `Object3D`).

---

## 3. World integration: height gate and `targetTreeHeightWorld` (`world.js`)

Trees are **not** spawned until **`loadPineTreeModel(humanHeightWorld)`** runs (called after the player character height is known from loading).

- **`referenceHumanHeight`** — clamped character height (default ~**1.65 m** if missing).

- **`treeHeightMultiplier = 16.5`** — target tree height ≈ **16.5× human height** (very tall stylized pines).

- **`targetTreeHeightWorld = referenceHumanHeight * treeHeightMultiplier`**

- **`pineReady = true`**, then **`backfillPendingTrees()`** — fills chunks that were generated **before** trees were ready (so early chunks still get trees).

---

## 4. Chunk placement: `spawnTreesForChunk`

**RNG:** `chunkTreeRng(cx, cz)` — **mulberry32** seeded from a hash of **chunk coordinates** (different from grass hash seed but same idea: **stable per chunk**).

**Count:** **`numTrees = 5 + floor(trng() * 5)`** → **5–9 trees per chunk**.

**Area:** Random position inside a **square inset** from chunk center:

- `inset = chunkSize * 0.46`

- `tx, tz` uniform in `[-inset, inset]`, world `wx = cx * chunkSize + tx`, etc.

**Lake:** **`sampleLakeDepth(wx, wz) < -0.48`** → **skip** (no trees in the lake depression).

**Grounding:**

1. `tree.position.set(wx, groundY, wz)` — chunk base Y.

2. **`updateMatrixWorld(true)`**, **`Box3`**, then **`terrainH = sampleLakeDepth(wx, wz)`** (local terrain height).

3. **`tree.position.y += groundY + terrainH - bounds.min.y`** so the **bottom of the bounding box** sits on the **actual height** (lake bowl + chunk offset).

**`chunk.objects`** holds the tree array for that chunk (used for axe queries and removal).

---

## 5. Chopping: standing tree → log → sticks

**Identification:** `userData.meshyTree` and `treePhase === 'standing'`.

**Hits:**

- **`tryMeleeAxeHit`** — player forward vs trees in range; picks closest in cone; **`applyTreeChop`**.

- **`tryAxeHitTree`** — thrown axe position vs tree **horizontal cylinder** (rough bounds); **`applyTreeChop`**.

**`applyTreeChop`:**

- Increments **`chopStandingHits`**.

- After **≥ 3** hits: **`replaceTreeWithChoppableLog`**.

**`replaceTreeWithChoppableLog`:**

- **`removeTreeFromChunks`** (scene + splice from chunk `objects`).

- **`spawnChoppableLogAt(x, z)`** — a **cylinder** `Mesh` (log), `userData.interactiveLog`, pushed to **`choppableLogs`**.

**Log → sticks:** **`breakLogIntoSticks`** (elsewhere) removes the log, spawns **8** stick pickups around the area with **cylinder** geometry and **`pickupStick`** userData.

---

## 6. Wind: `updateTreeWind(elapsedSeconds)`

Each frame, for every tree with **`meshyTree`** and still **standing**:

1. If **`obj.userData.ezTree`** and **`typeof obj.update === 'function'`** — call **`obj.update(t)`** — **ez-tree’s** built-in update (if present in your version).

2. **Else** — **fallback sway** on the **root** rotation:

   - Reset **`rotation.y`** from **`baseRotY`**.

   - **`rotation.x = baseRotX + cos(t * 0.28 + ph * 0.7) * 0.012 * s`**

   - **`rotation.z = baseRotZ + sin(t * 0.33 + ph * 0.55) * 0.015 * s`**

   with **`s = 0.85`** and **`ph = windPhase`**.

This is **subtle** whole-tree sway, not per-branch GPU wind.

---

## 7. Porting / reimplementation checklist

| Topic | What to replicate |
|--------|-------------------|
| **Geometry** | Use **ez-tree** or another procedural tree lib; or replace with **static GLB** instances + same placement/chop logic. |
| **Scale** | Measure **AABB height** after generate, scale to **target world height**, add random factor. |
| **Placement** | Chunk RNG, inset square, **height sample** + **min.y** bottom alignment, **water/lake** exclusion. |
| **Gameplay** | `userData` flags, hit counts, replace with **log** mesh, **sticks** from log. |
| **Wind** | Library `update()` or small **rotation** oscillation on root. |

---

## 8. File map

| File | Role |
|------|------|
| `ezTreeSpawn.js` | `createProceduralTree`, ez-tree preset, scale, tints, `userData`, shadows |
| `world.js` | `loadPineTreeModel`, `spawnTreesForChunk`, `backfillPendingTrees`, lake test, grounding, axe/chop, `updateTreeWind`, `spawnChoppableLogAt`, `breakLogIntoSticks` |
| `package.json` | `@dgreenheck/ez-tree` dependency |

---

## 9. Tuning knobs (quick reference)

| Knob | Location | Effect |
|------|----------|--------|
| `treeHeightMultiplier` | `world.js` `loadPineTreeModel` | Overall tree size vs character height. |
| `Pine Medium` | `ezTreeSpawn.js` | Preset name — swap for other ez-tree presets if available. |
| Bark / leaf `tint` | `ezTreeSpawn.js` | Color grading of procedural materials. |
| `5 + floor(trng() * 5)` | `spawnTreesForChunk` | Trees per chunk (5–9). |
| `inset = chunkSize * 0.46` | `spawnTreesForChunk` | How close to chunk edges trees may spawn. |
| Lake depth threshold | `spawnTreesForChunk` | `-0.48` — stricter = fewer trees near water. |
| Chop hits | `applyTreeChop` | `>= 3` to fell. |
| Wind fallback amplitudes | `updateTreeWind` | `0.012`, `0.015`, `s = 0.85`. |

---

*For library API details (all presets, options, `update()` behavior), see the upstream [`ez-tree` repository](https://github.com/dgreenheck/ez-tree).*
