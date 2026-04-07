import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeGrassInstanceMatrices, hashChunk, mulberry32, BLADE_TARGET } from './chunkGenShared.js';

const PICKUP_ROCKS_PER_CHUNK = 4;
const PICKUP_STICKS_PER_CHUNK = 6;
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

/**
 * Single curved blade: subdivided vertical strips, arched forward (stylized field grass).
 * Two crossed planes — same style as common Three.js grass demos (e.g. davideprati.com/demo/grass).
 */
function makeCurvedCrossBladeGeometry(width, height, verticalSegs) {
    const bend = 0.34;
    const taper = 0.46;

    const buildPlane = () => {
        const g = new THREE.PlaneGeometry(width, height, 1, verticalSegs);
        g.translate(0, height * 0.5, 0);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            const t = THREE.MathUtils.clamp(y / height, 0, 1);
            const arch = bend * t * t;
            const tx = pos.getX(i);
            const body = 1 - taper * t;
            const tip = 1 - 0.98 * Math.pow(Math.max(0, (t - 0.52) / 0.48), 2.85);
            pos.setX(i, tx * body * tip + arch);
        }
        g.computeVertexNormals();
        return g;
    };

    const g0 = buildPlane();
    const g1 = g0.clone();
    g1.rotateY(Math.PI / 2);
    const geo = mergeGeometries([g0, g1], true);

    const colors = new Float32Array(geo.attributes.position.count * 3);
    const pos = geo.attributes.position;
    const cBottom = new THREE.Color(0x0f2412);
    const cLow = new THREE.Color(0x1f5230);
    const cMid = new THREE.Color(0x3d8c36);
    const cOlive = new THREE.Color(0x4a7a32);
    const cTop = new THREE.Color(0xc4f070);
    const cTip = new THREE.Color(0xe8f8a0);

    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = THREE.MathUtils.clamp(y / height, 0, 1);
        const bell = Math.sin(t * Math.PI);
        const wRoot = Math.pow(1 - t, 0.55) * 0.9;
        const wLow = (1 - t) * (1 - t) * 0.45;
        const wMid = bell * 0.75;
        const wOl = bell * bell * 0.28;
        const wYellow = THREE.MathUtils.smoothstep(t, 0.4, 0.95) * 0.55;
        const wTip = Math.pow(t, 0.65) * 0.85;
        const inv =
            1 /
            (wRoot + wLow + wMid + wOl + wYellow + wTip);
        const c = new THREE.Color(
            (cBottom.r * wRoot +
                cLow.r * wLow +
                cMid.r * wMid +
                cOlive.r * wOl +
                cTop.r * wYellow +
                cTip.r * wTip) *
                inv,
            (cBottom.g * wRoot +
                cLow.g * wLow +
                cMid.g * wMid +
                cOlive.g * wOl +
                cTop.g * wYellow +
                cTip.g * wTip) *
                inv,
            (cBottom.b * wRoot +
                cLow.b * wLow +
                cMid.b * wMid +
                cOlive.b * wOl +
                cTop.b * wYellow +
                cTip.b * wTip) *
                inv
        );
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
}

export function createSharedGrassBladeGeometry() {
    const w = 0.076;
    const h = 0.38;
    return makeCurvedCrossBladeGeometry(w, h, 8);
}

export function createSharedGrassWindMaterial() {
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.78,
        metalness: 0.04,
        alphaTest: 0.12,
        transparent: false
    });

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uGrassTime = { value: 0 };
        shader.vertexShader =
            'uniform float uGrassTime;\n' +
            shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                float _h = max(0.0, transformed.y);
                float _bend = _h * _h * (0.22 + _h * 0.06);
                #ifdef USE_INSTANCING
                vec4 _gw = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
                #else
                vec4 _gw = modelMatrix * vec4( transformed, 1.0 );
                #endif
                float _ph = _gw.x * 0.051 + _gw.z * 0.047;
                float _t = uGrassTime;
                float _wave = sin(_t * 1.12 + _ph)
                    + sin(_t * 2.38 + _ph * 1.31) * 0.58
                    + sin(_t * 3.55 + _ph * 0.41) * 0.32;
                float _waveZ = cos(_t * 1.05 + _ph * 1.07)
                    + sin(_t * 2.85 + _ph * 0.66) * 0.48;
                float _flutter = sin(_t * 5.2 + _gw.x * 0.31 + _gw.z * 0.29) * 0.14 * _h;
                transformed.x += _wave * _bend + _flutter;
                transformed.z += _waveZ * _bend * 0.92 + _flutter * 0.65;`
            );
        material.userData.grassShader = shader;
    };

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
    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
    mesh.count = count;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16));
    mesh.instanceMatrix.needsUpdate = true;
    if (instanceColors && instanceColors.length >= count * 3) {
        const arr = new Float32Array(maxInstances * 3);
        arr.fill(1);
        arr.set(instanceColors.subarray(0, count * 3), 0);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
    }
    return mesh;
}

export function buildGrassInstancedMesh(geometry, material, chunkSize, cx, cz, groundY) {
    const { count, matrices, instanceColors } = computeGrassInstanceMatrices(
        chunkSize,
        cx,
        cz,
        groundY,
        BLADE_TARGET
    );
    return buildGrassInstancedMeshFromMatrices(geometry, material, matrices, count, BLADE_TARGET, instanceColors);
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
        const geo = new THREE.DodecahedronGeometry(0.28 + rng() * 0.22, 0);
        const mesh = new THREE.Mesh(geo, createPickupRockMaterial());
        mesh.position.set(originX + lx, groundY + 0.16, originZ + lz);
        mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        const sc = 1.12 + rng() * 0.62;
        mesh.scale.setScalar(sc);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.pickupRock = true;
        mesh.userData.restScale = sc;
        mesh.userData.highlightEmissive = new THREE.Color(0x4a6aa8);
        scene.add(mesh);
        registerPickup(mesh);
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
        /* Horizontal cylinder-ish block for walking (mesh is irregular). */
        mesh.userData.collisionRadius = geoRadius * scale * 0.88 + 0.2;
        scene.add(mesh);
        meshes.push(mesh);
    }
    return meshes;
}
