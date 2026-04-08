import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeGrassInstanceMatrices, hashChunk, mulberry32, BLADE_TARGET } from './chunkGenShared.js';
import { getGrassGenerationParams } from './grassSettings.js';
import { createBerryMesh } from './food.js';

const PICKUP_ROCKS_PER_CHUNK = 4;
const PICKUP_STICKS_PER_CHUNK = 6;
const PICKUP_BERRIES_PER_CHUNK = 4;
const BOULDER_CHANCE = 0.5;
const BOULDERS_MAX_PER_CHUNK = 2;

export function createStickWoodMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x5c3f24,
        roughness: 0.91,
        metalness: 0.04,
        flatShading: true
    });
}

export { BLADE_TARGET };

/** `docs/grass-system.md` — crossed vertical planes, arch + taper + tip, vertex color gradient. */
const BLADE_W = 0.076;
const BLADE_H = 0.38;
const BLADE_VERT_SEGS = 8;
const BEND = 0.34;
const TAPER = 0.46;
const TIP_START = 0.52;
const TIP_EXP = 2.85;
const TIP_STRENGTH = 0.92;

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/** Palette stops from grass-system.md (dark base → lime tip). */
function bladeVertexColorAtT(t) {
    const root = [0x0f / 255, 0x24 / 255, 0x12 / 255];
    const low = [0x1f / 255, 0x52 / 255, 0x30 / 255];
    const mid = [0x3d / 255, 0x8c / 255, 0x36 / 255];
    const olive = [0x4a / 255, 0x7a / 255, 0x32 / 255];
    const yellow = [0xc4 / 255, 0xf0 / 255, 0x70 / 255];
    const tip = [0xe8 / 255, 0xf8 / 255, 0xa0 / 255];

    const w0 = Math.pow(1 - t, 4);
    const w1 = Math.pow(1 - t, 2) * smoothstep(0, 0.45, t);
    const w2 = Math.sin(t * Math.PI) * 0.85 + 0.12;
    const w3 = smoothstep(0.2, 0.7, t) * (1 - smoothstep(0.88, 1, t));
    const w4 = smoothstep(0.5, 0.95, t);
    const w5 = smoothstep(0.75, 1, t);

    const ws = w0 + w1 + w2 + w3 + w4 + w5;
    const r = (root[0] * w0 + low[0] * w1 + mid[0] * w2 + olive[0] * w3 + yellow[0] * w4 + tip[0] * w5) / ws;
    const g = (root[1] * w0 + low[1] * w1 + mid[1] * w2 + olive[1] * w3 + yellow[1] * w4 + tip[1] * w5) / ws;
    const b = (root[2] * w0 + low[2] * w1 + mid[2] * w2 + olive[2] * w3 + yellow[2] * w4 + tip[2] * w5) / ws;
    return [r, g, b];
}

function shapeBladePlaneGeometry(geo, height) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const t = Math.min(1, Math.max(0, y / height));

        const arch = BEND * t * t;
        let xNarrow = 1 - TAPER * t;
        if (t >= TIP_START) {
            const u = (t - TIP_START) / (1 - TIP_START);
            xNarrow *= 1 - TIP_STRENGTH * Math.pow(u, TIP_EXP);
        }
        pos.setX(i, x * xNarrow + arch);

        const [r, g, b] = bladeVertexColorAtT(t);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
}

function makeSingleBladePlane() {
    const geo = new THREE.PlaneGeometry(BLADE_W, BLADE_H, 1, BLADE_VERT_SEGS);
    geo.translate(0, BLADE_H * 0.5, 0);
    shapeBladePlaneGeometry(geo, BLADE_H);
    return geo;
}

/** Two planes at 90° (X), merged — see `docs/grass-system.md`. */
export function createSharedGrassBladeGeometry() {
    const a = makeSingleBladePlane();
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    return mergeGeometries([a, b], true);
}

/**
 * `MeshStandardMaterial` + `onBeforeCompile` wind (`uGrassTime`), instance × vertex colors.
 * Matches `docs/grass-system.md` §3–4.
 */
export function createSharedGrassWindMaterial() {
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.03,
        flatShading: true,
        side: THREE.DoubleSide,
        envMapIntensity: 0.4
    });

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uGrassTime = { value: 0 };
        material.userData.grassUniforms = { uGrassTime: shader.uniforms.uGrassTime };

        shader.vertexShader =
            'uniform float uGrassTime;\n' +
            shader.vertexShader.replace(
                '#include <begin_vertex>',
                /* glsl */ `
#include <begin_vertex>
float _h = max(0.0, transformed.y);
float _bend = _h * _h * (0.22 + _h * 0.06);
#ifdef USE_INSTANCING
vec4 _gw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 _gw = modelMatrix * vec4(transformed, 1.0);
#endif
float _ph = _gw.x * 0.051 + _gw.z * 0.047;
float _gt = uGrassTime;
float _w1 = sin(_gt * 1.7 + _ph) * 0.018;
float _w2 = cos(_gt * 2.3 + _ph * 1.3) * 0.014;
float _w3 = sin(_gt * 4.1 + _ph * 2.1) * 0.009;
float _fl = sin(_gt * 6.8 + _gw.x * 0.11 + _gw.z * 0.08) * _bend * 0.032;
transformed.x += (_w1 + _w2 * 0.85 + _fl) * _bend;
transformed.z += (_w2 + _w3 + _fl * 0.72) * _bend;
`
            );
    };

    material.customProgramCacheKey = () => 'grassWindStd1';
    return material;
}

export function buildGrassInstancedMeshFromMatrices(
    geometry,
    material,
    matrices,
    count,
    maxInstances = BLADE_TARGET,
    instanceColors = null
) {
    if (!count || count <= 0) return null;
    const cap = Math.max(maxInstances, count, 1);
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.count = count;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16));
    mesh.instanceMatrix.needsUpdate = true;
    if (instanceColors && instanceColors.length >= count * 3) {
        const arr = new Float32Array(cap * 3);
        arr.fill(1);
        arr.set(instanceColors.subarray(0, count * 3), 0);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
    }
    /** Required after bulk-writing instance matrices — otherwise bounds stay at origin and frustum culling drops the whole chunk. */
    mesh.computeBoundingSphere();
    return mesh;
}

export function buildGrassInstancedMesh(geometry, material, chunkSize, cx, cz, groundY, genParams = null) {
    const p = genParams ?? getGrassGenerationParams();
    const { count, matrices, instanceColors } = computeGrassInstanceMatrices(
        chunkSize,
        cx,
        cz,
        groundY,
        p.bladeTarget,
        p.widthScale,
        p.heightScale
    );
    return buildGrassInstancedMeshFromMatrices(
        geometry,
        material,
        matrices,
        count,
        p.bladeTarget,
        instanceColors
    );
}

function createPickupRockMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0xa89e96,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
        roughness: 0.78,
        metalness: 0.18,
        flatShading: true
    });
}

const boulderMat = new THREE.MeshStandardMaterial({
    color: 0x56514c,
    roughness: 0.98,
    metalness: 0.03,
    flatShading: true
});

export function createPickupRocksForChunk(scene, chunkSize, cx, cz, groundY, registerPickup) {
    const rng = mulberry32(hashChunk(cx, cz) ^ 0x9e3779b9);
    const meshes = [];
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const half = chunkSize * 0.5;

    for (let i = 0; i < PICKUP_ROCKS_PER_CHUNK; i++) {
        if (rng() < 0.14) continue;
        const lx = (rng() - 0.5) * 2 * half;
        const lz = (rng() - 0.5) * 2 * half;
        const geoR = 0.28 + rng() * 0.22;
        const geo = new THREE.DodecahedronGeometry(geoR, 0);
        const mesh = new THREE.Mesh(geo, createPickupRockMaterial());
        mesh.position.set(originX + lx, groundY + 0.16, originZ + lz);
        mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        const sc = 1.12 + rng() * 0.62;
        mesh.scale.setScalar(sc);
        mesh.userData.collisionRadius = geoR * sc * 0.82;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.pickupRock = true;
        mesh.userData.mineable = false;
        mesh.userData.restScale = sc;
        mesh.userData.highlightEmissive = new THREE.Color(0x4a6aa8);
        scene.add(mesh);
        registerPickup(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

/** Smaller pickup stones after breaking a boulder (not mineable). */
export function createMiningFragmentRocks(scene, originX, originZ, groundY, count, registerPickup) {
    const rng = mulberry32((Math.floor(originX * 733.13) ^ Math.floor(originZ * 491.7)) >>> 0);
    const meshes = [];
    for (let i = 0; i < count; i++) {
        const geoR = 0.09 + rng() * 0.09;
        const geo = new THREE.DodecahedronGeometry(geoR, 0);
        const mesh = new THREE.Mesh(geo, createPickupRockMaterial());
        const ang = rng() * Math.PI * 2;
        const rad = 0.18 + rng() * 0.55;
        mesh.position.set(
            originX + Math.cos(ang) * rad,
            groundY + 0.12,
            originZ + Math.sin(ang) * rad
        );
        mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        const sc = 0.82 + rng() * 0.38;
        mesh.scale.setScalar(sc);
        mesh.userData.pickupRock = true;
        mesh.userData.mineable = false;
        mesh.userData.restScale = sc;
        mesh.userData.highlightEmissive = new THREE.Color(0x4a6aa8);
        mesh.userData.collisionRadius = geoR * sc * 0.82;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        registerPickup(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

/**
 * Wild berry pickups (uncooked); registered as world food pickups.
 */
export function createPickupBerriesForChunk(scene, chunkSize, cx, cz, groundY, registerFood) {
    const rng = mulberry32(hashChunk(cx, cz) ^ 0x85ebca6b);
    const meshes = [];
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const half = chunkSize * 0.46;

    for (let i = 0; i < PICKUP_BERRIES_PER_CHUNK; i++) {
        if (rng() < 0.12) continue;
        const lx = (rng() - 0.5) * 2 * half;
        const lz = (rng() - 0.5) * 2 * half;
        const mesh = createBerryMesh(false);
        mesh.position.set(originX + lx, groundY + 0.12, originZ + lz);
        mesh.rotation.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
        const sc = 0.92 + rng() * 0.35;
        mesh.scale.setScalar(sc);
        mesh.userData.collisionRadius = 0.14 * sc;
        mesh.userData.highlightEmissive = new THREE.Color(0xaa2040);
        scene.add(mesh);
        registerFood(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

export function createPickupSticksForChunk(scene, chunkSize, cx, cz, groundY, registerStick) {
    const rng = mulberry32(hashChunk(cx, cz) ^ 0x6a09e667);
    const meshes = [];
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const half = chunkSize * 0.48;

    for (let i = 0; i < PICKUP_STICKS_PER_CHUNK; i++) {
        if (rng() < 0.1) continue;
        const lx = (rng() - 0.5) * 2 * half;
        const lz = (rng() - 0.5) * 2 * half;
        const len = 1.45 + rng() * 0.95;
        const geo = new THREE.CylinderGeometry(0.055 + rng() * 0.02, 0.075 + rng() * 0.025, len, 7);
        const mesh = new THREE.Mesh(geo, createStickWoodMaterial());
        mesh.rotation.z = Math.PI / 2;
        mesh.rotation.y = rng() * Math.PI * 2;
        mesh.position.set(originX + lx, groundY + 0.09, originZ + lz);
        mesh.userData.collisionRadius = len * 0.48 + 0.1;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.pickupStick = true;
        mesh.userData.restScale = 1;
        mesh.userData.highlightEmissive = new THREE.Color(0x7a5a2a);
        scene.add(mesh);
        registerStick(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

export function createBouldersForChunk(scene, chunkSize, cx, cz, groundY) {
    const rng = mulberry32(hashChunk(cx, cz) ^ 0x85ebca6b);
    const meshes = [];
    if (rng() > BOULDER_CHANCE) return meshes;

    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const half = chunkSize * 0.42;
    const n = rng() < 0.55 ? 1 : Math.min(BOULDERS_MAX_PER_CHUNK, 1 + Math.floor(rng() * 2));

    for (let i = 0; i < n; i++) {
        const lx = (rng() - 0.5) * 2 * half;
        const lz = (rng() - 0.5) * 2 * half;
        const geoRadius = 1.05 + rng() * 0.95;
        const geo = new THREE.DodecahedronGeometry(geoRadius, 1);
        const mesh = new THREE.Mesh(geo, boulderMat);
        const scale = 1.9 + rng() * 2.9;
        mesh.scale.setScalar(scale);
        mesh.position.set(originX + lx, groundY + scale * 0.52, originZ + lz);
        mesh.rotation.set(rng() * 0.45, rng() * Math.PI * 2, rng() * 0.38);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isBoulder = true;
        mesh.userData.mineable = true;
        mesh.userData.mineHits = 0;
        /* Horizontal cylinder-ish block for walking (mesh is irregular). */
        mesh.userData.collisionRadius = geoRadius * scale * 0.88 + 0.2;
        scene.add(mesh);
        meshes.push(mesh);
    }
    return meshes;
}
