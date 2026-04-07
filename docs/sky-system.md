# Sky dome — night / day transition and procedural night sky

This document describes how **darkness** implements the sky: a **large inverted sphere** that follows the camera, a **single fragment shader** that draws **procedural stars + nebula (night)** and a **simple gradient + sun (day)**, blended by **`dayPhase`**. It also explains how **`dayPhase`** is driven from the game loop and tied to **lights** and **fog**.

---

## 1. Geometry and material

| Piece | Implementation |
|--------|----------------|
| **Mesh** | `SphereGeometry(radius, 32, 32)` with **radius 2000** (world units). |
| **Facing** | `side: THREE.BackSide` — camera sits **inside** the sphere; the inner surface is rendered. |
| **Material** | `ShaderMaterial` with custom **vertex + fragment** GLSL strings (embedded in `sky.js`). |
| **Uniforms** | `time` (float, seconds), `dayPhase` (float, **0 = night**, **1 = day**). |
| **Motion** | Each frame, **`mesh.position.copy(cameraPosition)`** so the dome is **infinite** (no parallax against distant geometry; good enough for a stylized sky). |

**Scene background:** `scene.background` is set to a solid color (`0x252b26`) so any gap or clear color does not read pure black; the sky sphere fills the view when the camera looks up.

---

## 2. Vertex shader

**Output:** `vWorldPosition` — world-space position of the sphere vertex (after `modelMatrix`).

```glsl
vec4 worldPosition = modelMatrix * vec4(position, 1.0);
vWorldPosition = worldPosition.xyz;
gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
```

The fragment shader uses **`normalize(vWorldPosition)`** as a **view direction** from the origin (approximately from the camera once the mesh follows the camera), i.e. a **direction-based** sky (same idea as a cubemap lookup, but procedural).

---

## 3. Night sky (stars + “galaxy” nebula)

Everything below runs in **fragment** space using `direction = normalize(vWorldPosition)`.

### 3.1 Hash and 3D noise

- **`hash(vec3 p)`** — cheap integer-ish noise from fractional trig-like mixing on `fract(p * …)`.

- **`noise(vec3 x)`** — value noise on a **3D grid**: `floor` / `fract`, smoothstep interpolation (`f * f * (3 - 2*f)`), trilinear **mix** of 8 corner hashes.

These are building blocks for **fbm** and stars.

### 3.2 Stars (procedural point glitter)

- Scale direction: `starPos = direction * 800.0` (large multiplier = **small angular features** on the sphere).

- `starGrain = hash(floor(starPos))` — one random value per **cell** in a 3D lattice along the ray direction.

- **`stars = pow(starGrain, 800.0) * 2.0`** — enormous exponent = **only the very brightest random samples survive** → sparse **pinpoint** stars.

- **Cull half the cells:** `if (hash(floor(starPos) + 31.0) < 0.5) stars = 0.0` — roughly **50% fewer** stars.

- **Twinkle:** `stars *= 0.9 + 0.1 * sin(time * 1.5 + starGrain * 20.0)` — slow modulation per star cell.

There is no star texture; it is **pure math** on the GPU.

### 3.3 Nebula (fractal Brownian motion)

- **`fbm(vec3 p)`** — 5 octaves: accumulate `noise(p) * amplitude`, then `p = p * 2.0 + shift`, `amplitude *= 0.5` — classic **FBM**.

- **Sample position:** `nebulaPos = direction * 3.0 + time * 0.005` — nebula **drifts slowly** over time.

- **Layered color:**

  - `n = fbm(nebulaPos)` — overall mask.

  - **Blue channel:** `blueNebula = vec3(0.01, 0.03, 0.15) * fbm(nebulaPos * 1.5 + 1.0)`.

  - **Purple channel:** `purpleNebula = vec3(0.08, 0.01, 0.15) * fbm(nebulaPos * 2.0 + 5.0)`.

  - **`finalNebula = (blueNebula + purpleNebula) * n * 0.4`** — combined **blue / purple** volumetric-looking haze.

This reads as a **stylized galaxy / nebula** — not physically based, but cheap and animated.

### 3.4 Night composite + horizon lift

- **`nightColor = finalNebula + vec3(stars)`** — nebula plus star specks.

- **Near-horizon lift (reduce harsh black band):**

  ```glsl
  float nearGround = 1.0 - smoothstep(-0.12, 0.22, direction.y);
  nightColor += vec3(0.045, 0.05, 0.042) * nearGround;
  ```

  When the view direction is **low** (toward the horizon), a small **dark green-gray** is added so the night sky meets the terrain/fog a bit more softly.

---

## 4. Day sky (gradient + sun)

- **Gradient:** `daySkyTop = (0.1, 0.4, 0.8)`, `daySkyBottom = (0.7, 0.85, 1.0)`.

- **`dayColor = mix(daySkyBottom, daySkyTop, max(direction.y, 0.0))`** — brighter toward zenith.

- **Sun (analytic disk + glow):**

  - Fixed direction: `sunDir = normalize(vec3(0.5, 0.8, -0.3))`.

  - **Core:** `pow(max(dot(direction, sunDir), 0.0), 100.0)` — very tight highlight.

  - **Glow:** `pow(..., 5.0) * 0.5` — wider bloom.

  - Tint `(1.0, 0.9, 0.8)` added to `dayColor`.

---

## 5. Blending night ↔ day (`dayPhase`)

**Uniform:** `dayPhase` ∈ **[0, 1]** (night → day).

```glsl
vec3 finalColor = mix(nightColor, dayColor, dayPhase);
```

So at **`dayPhase = 0`** you see only night; at **`1`** only day; in between a **linear RGB blend** (sun and stars are both computed every pixel; only the mix weight changes — simple but a bit wasteful; acceptable for a fullscreen sky pass).

### Horizon fade (separate for night and day)

```glsl
float nightFade = smoothstep(-0.2, 0.3, direction.y + 0.1);
float dayFade = smoothstep(-0.1, 0.1, direction.y);
finalColor *= mix(nightFade, dayFade, dayPhase);
```

This **dims** the sky near the **bottom** of the dome differently for night vs day, so the transition at the horizon feels a bit more controlled when mixed with terrain/fog.

**Output:** `gl_FragColor = vec4(finalColor, 1.0)`.

---

## 6. Game-side day / night drive (`main.js`)

### 6.1 State

- **`isDay`** — boolean target (day vs night).

- **`dayPhase`** — current smoothed value passed to the sky (and used for lighting/fog).

- **`targetDayPhase`** — `1.0` when day, `0.0` when night.

### 6.2 Toggling

- **Key `1`:** flips `isDay` and sets `targetDayPhase` to `1` or `0`.

- **UI “transition” button** (`#transition-btn`): same flip.

### 6.3 Animation loop (`animate`)

Each frame:

1. If `|dayPhase - targetDayPhase| > 0.01`:

   - **`dayPhase = lerp(dayPhase, targetDayPhase, delta * 0.5)`** — **transition speed** `0.5` (tweak for slower/faster dawn/dusk).

2. **Linked to scene:**

   - **Ambient:** `0.1 + dayPhase * 0.7`

   - **Directional (sun):** `dayPhase * 1.5`

   - **Fog color:** `lerpColors(nightFog, dayFog, dayPhase)` (night `0x252b26`, day `0x7fbfff`).

   - **Fog density:** `lerp(0.00175, 0.0005, dayPhase)`.

3. When close enough, snap `dayPhase = targetDayPhase`.

4. **`this.sky.update(elapsed, camera.position, this.dayPhase)`** — passes **elapsed time** and **day phase** into the sky uniforms.

So the **same scalar** `dayPhase` coordinates **sky shader**, **fill light**, **sun**, and **atmospheric fog** for a coherent transition.

---

## 7. Porting notes

- **WebGL1 / GLSL100:** This uses `gl_FragColor`; for WebGL2 you may switch to `out vec4 fragColor` and set `gl_FragDepth` if needed.

- **Color space:** Three.js may apply output encoding depending on renderer settings; if the sky looks too dim or too neon, check **renderer.outputColorSpace** and whether this material should use **`toneMapping: NoToneMapping`** on the `ShaderMaterial` (not set in the current code — worth testing).

- **Performance:** One fullscreen-ish sphere with a moderate fragment cost; FBM + stars every pixel is usually fine at 1080p; optimize by lowering sphere segments or simplifying FBM octaves if needed.

- **Physical sky:** This is **not** Preetham / Hosek-Wilkie; it is **art-directed**. Swapping in a precomputed gradient texture or an analytical physical model would replace the **day** branch; the **night** branch could stay or be replaced with a star cubemap.

---

## 8. File map

| File | Role |
|------|------|
| `sky.js` | `SkyDome` class, all GLSL strings, uniforms, mesh follow camera |
| `main.js` | `dayPhase` / `targetDayPhase`, lerp, lights, fog, key `1`, `sky.update(...)` |

---

*Constants (sun direction, colors, FBM octaves) are tuning knobs — adjust for your art direction.*
