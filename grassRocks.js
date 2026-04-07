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

export function createSharedGrassBladeGeometry() {
    const w = 0.16;
    const h = 0.6;
    const g0 = new THREE.PlaneGeometry(w, h, 1, 2);
    g0.translate(0, h * 0.5, 0);
    const g1 = g0.clone();
    g1.rotateY(Math.PI / 2);
    const geo = mergeGeometries([g0, g1], true);

    const colors = new Float32Array(geo.attributes.position.count * 3);
    const pos = geo.attributes.position;
    const cBottom = new THREE.Color(0x122a14);
    const cMid = new THREE.Color(0x2a6b26);
    const cTop = new THREE.Color(0x7ee868);
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = THREE.MathUtils.clamp(y / h, 0, 1);
        const c = t < 0.42 ? cBottom.clone().lerp(cMid, t / 0.42) : cMid.clone().lerp(cTop, (t - 0.42) / 0.58);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
}

export function createSharedGrassWindMaterial() {
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0.02,
        alphaTest: 0.2,
        transparent: false
    });

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uGrassTime = { value: 0 };
        shader.vertexShader =
            'uniform float uGrassTime;\n' +
            shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                float _h = max(0.001, transformed.y);
                float _ph = transformed.x * 2.3 + transformed.z * 2.0 + float( gl_InstanceID ) * 0.171;
                float _w1 = sin( uGrassTime * 2.05 + _ph ) * 0.24 * _h * _h;
                float _w2 = sin( uGrassTime * 3.25 + _ph * 0.73 ) * 0.09 * _h;
                transformed.x += _w1 + _w2;
                transformed.z += _w1 * 0.65 + _w2 * 0.38;`
            );
        material.userData.grassShader = shader;
    };

    return material;
}

export function buildGrassInstancedMeshFromMatrices(geometry, material, matrices, count, maxInstances = BLADE_TARGET) {
    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
    mesh.count = count;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16));
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
}

export function buildGrassInstancedMesh(geometry, material, chunkSize, cx, cz, groundY) {
    const { count, matrices } = computeGrassInstanceMatrices(chunkSize, cx, cz, groundY, BLADE_TARGET);
    return buildGrassInstancedMeshFromMatrices(geometry, material, matrices, count);
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
