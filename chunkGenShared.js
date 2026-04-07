import { Matrix4, Vector3, Quaternion, Euler } from 'three';

/** Instanced blades per chunk — denser field (Davide Prati–style lush grass). */
export const BLADE_TARGET = 12000;

export function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function hashChunk(cx, cz) {
    let h = cx * 374761393 + cz * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
}

export function noise2(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
}

/**
 * Patchy green tints (world-space noise) — multiplied with vertex colors on each blade.
 */
export function grassInstanceTint(wx, wz, out, i) {
    const coarse = noise2(wx * 0.0026, wz * 0.0027);
    const med = noise2(wx * 0.011 + 17.3, wz * 0.0105 + 9.1);
    const fine = noise2(wx * 0.064, wz * 0.067);
    const streak = noise2(wx * 0.0031, wz * 0.0029);
    const mix = coarse * 0.4 + med * 0.34 + fine * 0.16 + streak * 0.1;
    let r = 0.64 + mix * 0.26 + med * 0.12 + coarse * 0.08;
    let g = 0.8 + coarse * 0.24 + (1 - mix) * 0.1;
    let b = 0.52 + (1 - coarse) * 0.34 + fine * 0.14;
    const br = (r + g + b) / 3;
    const target = 0.9 + (fine - 0.5) * 0.1;
    const s = target / Math.max(br, 0.001);
    r = Math.min(1.22, Math.max(0.52, r * s));
    g = Math.min(1.26, Math.max(0.58, g * s));
    b = Math.min(1.15, Math.max(0.48, b * s));
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
}

const _pos = new Vector3();
const _scale = new Vector3();
const _quat = new Quaternion();
const _euler = new Euler();
const _mat = new Matrix4();

export function computeGrassInstanceMatrices(chunkSize, cx, cz, groundY, bladeTarget = BLADE_TARGET) {
    const rng = mulberry32(hashChunk(cx, cz));
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const half = chunkSize * 0.5;
    const matrices = new Float32Array(bladeTarget * 16);
    const instanceColors = new Float32Array(bladeTarget * 3);

    let placed = 0;
    let tries = 0;
    const maxTries = bladeTarget * 14;

    while (placed < bladeTarget && tries < maxTries) {
        tries++;
        const lx = (rng() - 0.5) * 2 * half;
        const lz = (rng() - 0.5) * 2 * half;
        const wx = originX + lx;
        const wz = originZ + lz;
        const n = noise2(wx * 0.015, wz * 0.015);
        if (n < 0.007) continue;
        if (n < 0.1 && rng() > 0.58) continue;

        grassInstanceTint(wx, wz, instanceColors, placed);

        _pos.set(wx, groundY, wz);
        _euler.set((rng() - 0.5) * 0.2, rng() * Math.PI * 2, (rng() - 0.5) * 0.16, 'XYZ');
        _quat.setFromEuler(_euler);
        const roll = rng();
        let s;
        if (roll < 0.62) {
            s = 0.48 + rng() * 0.22;
        } else if (roll < 0.9) {
            s = 0.72 + rng() * 0.22;
        } else {
            s = 0.98 + rng() * 0.52;
        }
        const sy = s * (0.92 + rng() * 0.32);
        _scale.set(s, sy, s);
        _mat.compose(_pos, _quat, _scale);
        _mat.toArray(matrices, placed * 16);
        placed++;
    }

    return { count: placed, matrices, instanceColors };
}

/**
 * Same as computeGrassInstanceMatrices but uses getHeightAt(wx, wz) per blade (terrain / lake).
 */
export function computeGrassInstanceMatricesWithHeight(chunkSize, cx, cz, getHeightAt, bladeTarget = BLADE_TARGET) {
    const rng = mulberry32(hashChunk(cx, cz));
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const half = chunkSize * 0.5;
    const matrices = new Float32Array(bladeTarget * 16);
    const instanceColors = new Float32Array(bladeTarget * 3);

    let placed = 0;
    let tries = 0;
    const maxTries = bladeTarget * 14;

    while (placed < bladeTarget && tries < maxTries) {
        tries++;
        const lx = (rng() - 0.5) * 2 * half;
        const lz = (rng() - 0.5) * 2 * half;
        const wx = originX + lx;
        const wz = originZ + lz;
        const n = noise2(wx * 0.015, wz * 0.015);
        if (n < 0.007) continue;
        if (n < 0.1 && rng() > 0.58) continue;

        const y = getHeightAt(wx, wz);
        if (y < -0.06) continue;

        grassInstanceTint(wx, wz, instanceColors, placed);

        _pos.set(wx, y, wz);
        _euler.set((rng() - 0.5) * 0.2, rng() * Math.PI * 2, (rng() - 0.5) * 0.16, 'XYZ');
        _quat.setFromEuler(_euler);
        const roll = rng();
        let s;
        if (roll < 0.62) {
            s = 0.48 + rng() * 0.22;
        } else if (roll < 0.9) {
            s = 0.72 + rng() * 0.22;
        } else {
            s = 0.98 + rng() * 0.52;
        }
        const sy = s * (0.92 + rng() * 0.32);
        _scale.set(s, sy, s);
        _mat.compose(_pos, _quat, _scale);
        _mat.toArray(matrices, placed * 16);
        placed++;
    }

    return { count: placed, matrices, instanceColors };
}
