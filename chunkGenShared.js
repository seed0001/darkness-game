import { Matrix4, Vector3, Quaternion, Euler } from 'three';

export const BLADE_TARGET = 2800;

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

    let placed = 0;
    let tries = 0;
    const maxTries = bladeTarget * 10;

    while (placed < bladeTarget && tries < maxTries) {
        tries++;
        const lx = (rng() - 0.5) * 2 * half;
        const lz = (rng() - 0.5) * 2 * half;
        const wx = originX + lx;
        const wz = originZ + lz;
        const n = noise2(wx * 0.015, wz * 0.015);
        if (n < 0.012) continue;
        if (n < 0.12 && rng() > 0.62) continue;

        _pos.set(wx, groundY, wz);
        _euler.set((rng() - 0.5) * 0.2, rng() * Math.PI * 2, (rng() - 0.5) * 0.16, 'XYZ');
        _quat.setFromEuler(_euler);
        const s = 0.78 + rng() * 0.68;
        const sy = s * (0.94 + rng() * 0.26);
        _scale.set(s, sy, s);
        _mat.compose(_pos, _quat, _scale);
        _mat.toArray(matrices, placed * 16);
        placed++;
    }

    return { count: placed, matrices };
}
