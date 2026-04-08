import * as THREE from 'three';
/** Same flow + dual normal maps as three.js `webgpu_water` / Water2Mesh; WebGL path (Reflector + Refractor). */
import { Water as WaterFlow } from 'three/examples/jsm/objects/Water2.js';
import {
    buildGrassInstancedMesh,
    buildGrassInstancedMeshFromMatrices,
    createPickupRocksForChunk,
    createMiningFragmentRocks,
    createPickupSticksForChunk,
    createPickupBerriesForChunk,
    createBouldersForChunk,
    createStickWoodMaterial
} from './grassRocks.js';
import { createGrassParticleBladeGeometry, createGrassParticleMaterial } from './grassParticleField.js';
import { computeGrassInstanceMatricesWithHeight } from './chunkGenShared.js';
import { getGrassGenerationParams } from './grassSettings.js';
import { createProceduralTree } from './ezTreeSpawn.js';

function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function chunkTreeRng(cx, cz) {
    let h = cx * 374761393 + cz * 668265263 + 0x51f4e2b7;
    h = (h ^ (h >>> 13)) * 1274126177;
    return mulberry32((h ^ (h >>> 16)) >>> 0);
}

/** Elliptical depression next to spawn (0,0) — east / slightly north */
export const LAKE_CX = 26;
export const LAKE_CZ = 12;
export const LAKE_RX = 23;
export const LAKE_RZ = 17;
const LAKE_MAX_DEPTH = 2.45;

/** True when the player is close enough to the lake ellipsoid (e.g. shallow water checks). */
export function isNearLakeWater(wx, wz, margin = 4) {
    const dx = (wx - LAKE_CX) / (LAKE_RX + margin);
    const dz = (wz - LAKE_CZ) / (LAKE_RZ + margin);
    return dx * dx + dz * dz <= 1;
}

export function sampleLakeDepth(wx, wz) {
    const dx = (wx - LAKE_CX) / LAKE_RX;
    const dz = (wz - LAKE_CZ) / LAKE_RZ;
    const e = dx * dx + dz * dz;
    if (e >= 1) return 0;
    const t = 1 - e;
    const s = t * t * (3 - 2 * t);
    return -LAKE_MAX_DEPTH * Math.pow(s, 1.08);
}

// Simple Simplex-like noise for terrain
class Noise {
    constructor(seed = 0) {
        this.p = new Uint8Array(256);
        this.permutation = new Uint8Array(512);
        for (let i = 0; i < 256; i++) this.p[i] = i;
        for (let i = 255; i > 0; i--) {
            const r = Math.floor(Math.random() * (i + 1));
            [this.p[i], this.p[r]] = [this.p[r], this.p[i]];
        }
        for (let i = 0; i < 512; i++) this.permutation[i] = this.p[i & 255];
    }

    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(t, a, b) { return a + t * (b - a); }
    grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise(x, y, z = 0) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);
        const A = this.permutation[X] + Y, AA = this.permutation[A] + Z, AB = this.permutation[A + 1] + Z;
        const B = this.permutation[X + 1] + Y, BA = this.permutation[B] + Z, BB = this.permutation[B + 1] + Z;

        return this.lerp(w, this.lerp(v, this.lerp(u, this.grad(this.permutation[AA], x, y, z),
            this.grad(this.permutation[BA], x - 1, y, z)),
            this.lerp(u, this.grad(this.permutation[AB], x, y - 1, z),
                this.grad(this.permutation[BB], x - 1, y - 1, z))),
            this.lerp(v, this.lerp(u, this.grad(this.permutation[AA + 1], x, y, z - 1),
                this.grad(this.permutation[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad(this.permutation[AB + 1], x, y - 1, z - 1),
                    this.grad(this.permutation[BB + 1], x - 1, y - 1, z - 1))));
    }
}

export class WorldManager {
    constructor(scene, renderer = null) {
        this.scene = scene;
        this.renderer = renderer;
        this.chunkSize = 64;
        this.resolution = 4;
        this.chunks = new Map();
        this.noise = new Noise();
        this.activeChunks = new Set();
        this.waterLevel = -10.0;
        this.pickupRocks = [];
        this.pickupSticks = [];
        this.pickupFoods = [];
        this.choppableLogs = [];
        this.grassGeometry = createGrassParticleBladeGeometry();
        this.grassMaterial = createGrassParticleMaterial();

        /** Procedural pines via @dgreenheck/ez-tree (see ezTreeSpawn.js). */
        this.pineReady = false;

        this.terrainMaterial = new THREE.MeshStandardMaterial({
            map: null,
            color: 0x9aa294,
            metalness: 0,
            roughness: 1.0,
            flatShading: false
        });

        const textureLoader = new THREE.TextureLoader();
        this._groundTexturePromise = textureLoader
            .loadAsync('/ground.png')
            .then((tex) => {
                tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(8, 8);
                tex.colorSpace = THREE.SRGBColorSpace;
                this.terrainMaterial.map = tex;
                this.terrainMaterial.needsUpdate = true;
            })
            .catch((err) => {
                console.warn('Ground texture failed to load:', err);
            });

        this.initWater();

        this.baseChunkRadius = 2;
        this.chunkStreamRadius = 2;
        this.preloadChunkRadius = Math.ceil(this.baseChunkRadius * 1.5);
        this.chunkGenBudgetPerFrame = 3;

        this.chunkWorker = null;
        this.initChunkWorker();
    }

    initChunkWorker() {
        try {
            this.chunkWorker = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
            this.chunkWorker.onmessage = (e) => this.onChunkWorkerMessage(e.data);
            this.chunkWorker.onerror = (err) => {
                console.warn('Chunk worker runtime error, falling back to main thread:', err);
                this.chunkWorker = null;
            };
        } catch (e) {
            console.warn('Chunk worker unavailable, grass generates on main thread:', e);
            this.chunkWorker = null;
        }
    }

    onChunkWorkerMessage(data) {
        if (!data) return;
        if (data.type === 'error') {
            console.warn('Chunk worker:', data.message);
            this.fallbackGrassForChunk(data.key, data.grassRequestId);
            return;
        }
        if (data.type !== 'grass') return;
        const chunk = this.chunks.get(data.key);
        if (!chunk) return;
        if (
            data.grassRequestId !== undefined &&
            data.grassRequestId !== chunk.grassRequestId
        ) {
            return;
        }

        if (chunk.grass) {
            this.scene.remove(chunk.grass);
            chunk.grass = null;
        }

        const maxB = Math.max(data.bladeTarget ?? 0, data.count, 1);
        const grass = buildGrassInstancedMeshFromMatrices(
            this.grassGeometry,
            this.grassMaterial,
            data.matrices,
            data.count,
            maxB,
            data.instanceColors
        );
        if (grass) {
            this.scene.add(grass);
            chunk.grass = grass;
        } else {
            chunk.grass = null;
        }
        this.applyLakeGrassToChunkIfNeeded(chunk);
    }

    fallbackGrassForChunk(key, grassRequestId) {
        const chunk = this.chunks.get(key);
        if (!chunk || chunk.grass) return;
        if (
            grassRequestId !== undefined &&
            grassRequestId !== chunk.grassRequestId
        ) {
            return;
        }
        const groundY = chunk.mesh.position.y;
        const grass = buildGrassInstancedMesh(
            this.grassGeometry,
            this.grassMaterial,
            this.chunkSize,
            chunk.cx,
            chunk.cz,
            groundY
        );
        if (grass) {
            this.scene.add(grass);
            chunk.grass = grass;
        }
        this.applyLakeGrassToChunkIfNeeded(chunk);
    }

    loadPineTreeModel(humanHeightWorld) {
        const refHuman = Math.max(
            typeof humanHeightWorld === 'number' && !Number.isNaN(humanHeightWorld)
                ? humanHeightWorld
                : 1.65,
            0.08
        );
        /** World target height for canopy (~human height × this). Higher = bigger trees. */
        const treeHeightMultiplier = 16.5;
        this.referenceHumanHeight = refHuman;
        this.targetTreeHeightWorld = refHuman * treeHeightMultiplier;

        this.pineReady = true;
        this.backfillPendingTrees();
        return Promise.resolve();
    }

    spawnTreesForChunk(cx, cz, groundY, outArray) {
        if (!this.pineReady) return;

        const trng = chunkTreeRng(cx, cz);
        /** 5–9 trees per chunk (was 1–3). */
        const numTrees = 5 + Math.floor(trng() * 5);
        const inset = this.chunkSize * 0.46;

        for (let i = 0; i < numTrees; i++) {
            const tree = createProceduralTree(trng, this.targetTreeHeightWorld);
            tree.userData.chunkKey = `${cx},${cz}`;

            const tx = (trng() - 0.5) * 2 * inset;
            const tz = (trng() - 0.5) * 2 * inset;
            const wx = cx * this.chunkSize + tx;
            const wz = cz * this.chunkSize + tz;
            if (sampleLakeDepth(wx, wz) < -0.48) continue;

            tree.position.set(wx, groundY, wz);
            tree.updateMatrixWorld(true);

            const bounds = new THREE.Box3().setFromObject(tree);
            const terrainH = sampleLakeDepth(wx, wz);
            tree.position.y += groundY + terrainH - bounds.min.y;

            this.scene.add(tree);
            outArray.push(tree);
        }
    }

    backfillPendingTrees() {
        if (!this.pineReady) return;
        this.chunks.forEach((chunk) => {
            if (chunk.objects && chunk.objects.length > 0) return;
            const groundY = chunk.mesh.position.y;
            const trees = [];
            this.spawnTreesForChunk(chunk.cx, chunk.cz, groundY, trees);
            chunk.objects = trees;
        });
    }

    async preloadWorldAt(position, onProgress) {
        const px = Math.floor(position.x / this.chunkSize);
        const pz = Math.floor(position.z / this.chunkSize);
        const r = this.preloadChunkRadius;
        const span = 2 * r + 1;
        const total = span * span;
        let done = 0;

        for (let x = px - r; x <= px + r; x++) {
            for (let z = pz - r; z <= pz + r; z++) {
                this.generateChunk(x, z);
                done++;
                if (onProgress) {
                    onProgress(done / total);
                }
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
        }
    }

    initWater() {
        const texBase =
            'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/water/';
        const loader = new THREE.TextureLoader();
        this._waterPromise = Promise.all([
            loader.loadAsync(texBase + 'Water_1_M_Normal.jpg'),
            loader.loadAsync(texBase + 'Water_2_M_Normal.jpg')
        ])
            .then(([normalMap0, normalMap1]) => {
                normalMap0.wrapS = normalMap0.wrapT = THREE.RepeatWrapping;
                normalMap1.wrapS = normalMap1.wrapT = THREE.RepeatWrapping;

                /** Matches official `webgpu_water` example defaults (flow is constant direction, not a flow map). */
                const flowDir = new THREE.Vector2(1, 1).normalize();

                const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
                this.water = new WaterFlow(waterGeometry, {
                    textureWidth: 256,
                    textureHeight: 256,
                    normalMap0,
                    normalMap1,
                    color: new THREE.Color(0x1e3540),
                    scale: 2,
                    flowDirection: flowDir,
                    flowSpeed: 0.03,
                    reflectivity: 0.02
                });
                this.water.rotation.x = -Math.PI / 2;
                this.water.position.y = this.waterLevel;
                this.scene.add(this.water);

                const lakeW = LAKE_RX * 2 + 14;
                const lakeD = LAKE_RZ * 2 + 14;
                const lakeGeometry = new THREE.PlaneGeometry(lakeW, lakeD);
                this.lakeWater = new WaterFlow(lakeGeometry, {
                    textureWidth: 512,
                    textureHeight: 512,
                    normalMap0,
                    normalMap1,
                    color: new THREE.Color(0x99e0ff),
                    scale: 2,
                    flowDirection: flowDir.clone(),
                    flowSpeed: 0.03,
                    reflectivity: 0.02
                });
                this.lakeWater.rotation.x = -Math.PI / 2;
                this.lakeWater.position.set(LAKE_CX, -0.12, LAKE_CZ);
                this.scene.add(this.lakeWater);
            })
            .catch((err) => {
                console.warn('Water normal maps failed to load:', err);
            });
    }

    whenCoreAssetsReady() {
        return Promise.all([this._groundTexturePromise, this._waterPromise]);
    }

    generateChunk(cx, cz, savedData = null) {
        const key = `${cx},${cz}`;
        if (this.chunks.has(key)) return;

        const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, this.resolution, this.resolution);
        geometry.rotateX(-Math.PI / 2);

        const position = geometry.attributes.position;
        const heights = [];

        for (let i = 0; i < position.count; i++) {
            const lx = position.getX(i);
            const lz = position.getZ(i);
            const wx = cx * this.chunkSize + lx;
            const wz = cz * this.chunkSize + lz;
            const h = sampleLakeDepth(wx, wz);
            position.setY(i, h);
            heights.push(h);
        }

        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        
        this.scene.add(mesh);

        const groundY = mesh.position.y;

        const chunkTrees = [];
        this.spawnTreesForChunk(cx, cz, groundY, chunkTrees);

        const pickupRocks = createPickupRocksForChunk(
            this.scene,
            this.chunkSize,
            cx,
            cz,
            groundY,
            (m) => this.registerPickupRock(m)
        );
        const pickupSticks = createPickupSticksForChunk(
            this.scene,
            this.chunkSize,
            cx,
            cz,
            groundY,
            (m) => this.registerPickupStick(m)
        );
        const pickupBerries = createPickupBerriesForChunk(
            this.scene,
            this.chunkSize,
            cx,
            cz,
            groundY,
            (m) => this.registerPickupFood(m)
        );
        const boulders = createBouldersForChunk(this.scene, this.chunkSize, cx, cz, groundY);

        const chunkData = {
            mesh,
            heights,
            cx,
            cz,
            objects: chunkTrees,
            grass: null,
            grassRequestId: 1,
            pickupRocks,
            pickupSticks,
            pickupBerries,
            boulders
        };
        /** Register chunk before worker replies — otherwise grass messages can arrive first and be dropped. */
        this.chunks.set(key, chunkData);

        const grassGen = getGrassGenerationParams();
        if (this.chunkWorker) {
            this.chunkWorker.postMessage({
                type: 'grass',
                key,
                cx,
                cz,
                chunkSize: this.chunkSize,
                groundY,
                grassRequestId: chunkData.grassRequestId,
                bladeTarget: grassGen.bladeTarget,
                widthScale: grassGen.widthScale,
                heightScale: grassGen.heightScale
            });
        } else {
            const grass = buildGrassInstancedMesh(
                this.grassGeometry,
                this.grassMaterial,
                this.chunkSize,
                cx,
                cz,
                groundY,
                grassGen
            );
            if (grass) {
                this.scene.add(grass);
                chunkData.grass = grass;
            }
            this.applyLakeGrassToChunkIfNeeded(chunkData);
        }

        pickupRocks.forEach((m) => {
            m.position.y = this.getHeightAt(m.position.x, m.position.z) + 0.16;
        });
        pickupSticks.forEach((m) => {
            m.position.y = this.getHeightAt(m.position.x, m.position.z) + 0.09;
        });
        pickupBerries.forEach((m) => {
            m.position.y = this.getHeightAt(m.position.x, m.position.z) + 0.12;
        });
        boulders.forEach((m) => {
            const gy = this.getHeightAt(m.position.x, m.position.z);
            const sc = m.scale.x;
            m.position.y = gy + sc * 0.52;
        });

        return key;
    }

    applyLakeGrassToChunkIfNeeded(chunk) {
        if (!chunk.grass) return;
        const { cx, cz } = chunk;
        const ccx = cx * this.chunkSize + this.chunkSize * 0.5;
        const ccz = cz * this.chunkSize + this.chunkSize * 0.5;
        if (Math.hypot(ccx - LAKE_CX, ccz - LAKE_CZ) > 54) return;

        this.scene.remove(chunk.grass);
        const p = getGrassGenerationParams();
        const { count, matrices, instanceColors } = computeGrassInstanceMatricesWithHeight(
            this.chunkSize,
            cx,
            cz,
            (wx, wz) => this.getHeightAt(wx, wz),
            p.bladeTarget,
            p.widthScale,
            p.heightScale
        );
        const grass = buildGrassInstancedMeshFromMatrices(
            this.grassGeometry,
            this.grassMaterial,
            matrices,
            count,
            p.bladeTarget,
            instanceColors
        );
        if (grass) {
            this.scene.add(grass);
            chunk.grass = grass;
        } else {
            chunk.grass = null;
        }
    }

    /**
     * Rebuild grass for every loaded chunk (after changing grass settings).
     */
    regenerateAllGrass() {
        const grassGen = getGrassGenerationParams();
        for (const chunk of this.chunks.values()) {
            if (chunk.grass) {
                this.scene.remove(chunk.grass);
                chunk.grass = null;
            }
        }
        for (const chunk of this.chunks.values()) {
            const key = `${chunk.cx},${chunk.cz}`;
            const groundY = chunk.mesh.position.y;
            if (this.chunkWorker) {
                chunk.grassRequestId = (chunk.grassRequestId ?? 0) + 1;
                this.chunkWorker.postMessage({
                    type: 'grass',
                    key,
                    cx: chunk.cx,
                    cz: chunk.cz,
                    chunkSize: this.chunkSize,
                    groundY,
                    grassRequestId: chunk.grassRequestId,
                    bladeTarget: grassGen.bladeTarget,
                    widthScale: grassGen.widthScale,
                    heightScale: grassGen.heightScale
                });
            } else {
                chunk.grassRequestId = (chunk.grassRequestId ?? 0) + 1;
                const grass = buildGrassInstancedMesh(
                    this.grassGeometry,
                    this.grassMaterial,
                    this.chunkSize,
                    chunk.cx,
                    chunk.cz,
                    groundY,
                    grassGen
                );
                if (grass) {
                    this.scene.add(grass);
                    chunk.grass = grass;
                }
                this.applyLakeGrassToChunkIfNeeded(chunk);
            }
        }
    }

    registerPickupRock(mesh) {
        if (!mesh || !mesh.userData.pickupRock) return;
        if (this.pickupRocks.includes(mesh)) return;
        this.pickupRocks.push(mesh);
    }

    unregisterPickupRock(mesh) {
        const i = this.pickupRocks.indexOf(mesh);
        if (i >= 0) this.pickupRocks.splice(i, 1);
    }

    registerPickupStick(mesh) {
        if (!mesh || !mesh.userData.pickupStick) return;
        if (this.pickupSticks.includes(mesh)) return;
        this.pickupSticks.push(mesh);
    }

    unregisterPickupStick(mesh) {
        const i = this.pickupSticks.indexOf(mesh);
        if (i >= 0) this.pickupSticks.splice(i, 1);
    }

    registerPickupFood(mesh) {
        if (!mesh || !mesh.userData.pickupFood) return;
        if (this.pickupFoods.includes(mesh)) return;
        this.pickupFoods.push(mesh);
    }

    unregisterPickupFood(mesh) {
        const i = this.pickupFoods.indexOf(mesh);
        if (i >= 0) this.pickupFoods.splice(i, 1);
    }

    /**
     * @returns {null | 'tree' | 'boulder'} What was struck (for SFX: stone vs wood).
     */
    tryMeleeAxeHit(playerPos, forwardXZ) {
        if (!playerPos || !forwardXZ) return null;
        const f = forwardXZ.clone();
        f.y = 0;
        if (f.lengthSq() < 1e-8) return null;
        f.normalize();

        const reach = 6.25;
        const minDot = 0.15;
        let best = null;
        let bestD = Infinity;
        let bestKind = null;

        this.chunks.forEach((chunk) => {
            if (!chunk.objects) return;
            for (let o = 0; o < chunk.objects.length; o++) {
                const tree = chunk.objects[o];
                if (!tree.userData?.meshyTree) continue;
                if (tree.userData.treePhase !== 'standing') continue;
                const tx = tree.position.x;
                const tz = tree.position.z;
                const dx = tx - playerPos.x;
                const dz = tz - playerPos.z;
                const dist = Math.hypot(dx, dz);
                if (dist > reach || dist < 0.06) continue;
                const toTree = new THREE.Vector3(dx, 0, dz).normalize();
                if (f.dot(toTree) < minDot) continue;
                if (dist < bestD) {
                    bestD = dist;
                    best = tree;
                    bestKind = 'tree';
                }
            }
        });

        this.chunks.forEach((chunk) => {
            if (!chunk.boulders) return;
            for (let i = 0; i < chunk.boulders.length; i++) {
                const b = chunk.boulders[i];
                if (!b.parent || !b.userData.isBoulder) continue;
                if (b.userData.mineable === false) continue;
                const dx = b.position.x - playerPos.x;
                const dz = b.position.z - playerPos.z;
                const dist = Math.hypot(dx, dz);
                if (dist > reach || dist < 0.06) continue;
                const toB = new THREE.Vector3(dx, 0, dz).normalize();
                if (f.dot(toB) < minDot) continue;
                if (dist < bestD) {
                    bestD = dist;
                    best = b;
                    bestKind = 'boulder';
                }
            }
        });

        if (!best || !bestKind) return null;
        if (bestKind === 'tree') {
            this.applyTreeChop(best);
        } else {
            this.applyBoulderMineHit(best);
        }
        return bestKind;
    }

    /** Standing tree in melee cone (wood chop SFX on swing — not boulders). */
    isTreeOnlyNearForChop(playerPos, forwardXZ, reach = 6.25, minDot = 0.15) {
        if (!playerPos || !forwardXZ) return false;
        const f = forwardXZ.clone();
        f.y = 0;
        if (f.lengthSq() < 1e-8) return false;
        f.normalize();

        for (const chunk of this.chunks.values()) {
            if (!chunk.objects) continue;
            for (let o = 0; o < chunk.objects.length; o++) {
                const tree = chunk.objects[o];
                if (!tree.userData?.meshyTree) continue;
                if (tree.userData.treePhase !== 'standing') continue;
                const tx = tree.position.x;
                const tz = tree.position.z;
                const dx = tx - playerPos.x;
                const dz = tz - playerPos.z;
                const dist = Math.hypot(dx, dz);
                if (dist > reach || dist < 0.06) continue;
                const toTree = new THREE.Vector3(dx, 0, dz).normalize();
                if (f.dot(toTree) < minDot) continue;
                return true;
            }
        }
        return false;
    }

    /** Tree or mineable boulder in front of the player (axe swing SFX). */
    isTreeNearForChop(playerPos, forwardXZ, reach = 6.25, minDot = 0.15) {
        if (!playerPos || !forwardXZ) return false;
        const f = forwardXZ.clone();
        f.y = 0;
        if (f.lengthSq() < 1e-8) return false;
        f.normalize();

        for (const chunk of this.chunks.values()) {
            if (!chunk.objects) continue;
            for (let o = 0; o < chunk.objects.length; o++) {
                const tree = chunk.objects[o];
                if (!tree.userData?.meshyTree) continue;
                if (tree.userData.treePhase !== 'standing') continue;
                const tx = tree.position.x;
                const tz = tree.position.z;
                const dx = tx - playerPos.x;
                const dz = tz - playerPos.z;
                const dist = Math.hypot(dx, dz);
                if (dist > reach || dist < 0.06) continue;
                const toTree = new THREE.Vector3(dx, 0, dz).normalize();
                if (f.dot(toTree) < minDot) continue;
                return true;
            }
        }

        for (const chunk of this.chunks.values()) {
            if (!chunk.boulders) continue;
            for (let i = 0; i < chunk.boulders.length; i++) {
                const b = chunk.boulders[i];
                if (!b.parent || !b.userData.isBoulder) continue;
                if (b.userData.mineable === false) continue;
                const dx = b.position.x - playerPos.x;
                const dz = b.position.z - playerPos.z;
                const dist = Math.hypot(dx, dz);
                if (dist > reach || dist < 0.06) continue;
                const toB = new THREE.Vector3(dx, 0, dz).normalize();
                if (f.dot(toB) < minDot) continue;
                return true;
            }
        }
        return false;
    }

    /**
     * @returns {null | 'tree' | 'boulder'} First target type hit this frame (for SFX).
     */
    tryAxeHitTree(axePos, hitSet) {
        if (!axePos || !hitSet) return null;
        let hitKind = null;
        this.chunks.forEach((chunk) => {
            if (!chunk.objects) return;
            for (let o = 0; o < chunk.objects.length; o++) {
                const tree = chunk.objects[o];
                if (!tree.userData?.meshyTree) continue;
                if (hitSet.has(tree.uuid)) continue;

                tree.updateMatrixWorld(true);
                if (tree.userData.treePhase !== 'standing') continue;
                const box = new THREE.Box3().setFromObject(tree);
                const tx = tree.position.x;
                const tz = tree.position.z;
                const horiz = Math.hypot(axePos.x - tx, axePos.z - tz);
                const tr =
                    typeof tree.userData.collisionRadius === 'number' && tree.userData.collisionRadius > 0
                        ? tree.userData.collisionRadius
                        : 2.2;
                const maxR = tr + 1.5;
                if (horiz > maxR) continue;
                if (axePos.y < box.min.y - 2.0 || axePos.y > box.max.y + 4.0) continue;

                hitSet.add(tree.uuid);
                this.applyTreeChop(tree);
                if (!hitKind) hitKind = 'tree';
            }
        });

        if (hitKind) return hitKind;

        this.chunks.forEach((chunk) => {
            if (!chunk.boulders) return;
            for (let i = 0; i < chunk.boulders.length; i++) {
                const boulder = chunk.boulders[i];
                if (!boulder.parent || !boulder.userData.isBoulder) continue;
                if (boulder.userData.mineable === false) continue;
                if (hitSet.has(boulder.uuid)) continue;

                const horiz = Math.hypot(axePos.x - boulder.position.x, axePos.z - boulder.position.z);
                const br = boulder.userData.collisionRadius;
                const maxR = (typeof br === 'number' && br > 0 ? br : 2) + 1.05;
                if (horiz > maxR) continue;
                if (axePos.y < boulder.position.y - 1.2 || axePos.y > boulder.position.y + 8.5) continue;

                hitSet.add(boulder.uuid);
                this.applyBoulderMineHit(boulder);
                if (!hitKind) hitKind = 'boulder';
            }
        });
        return hitKind;
    }

    applyTreeChop(tree) {
        if (!tree.userData?.meshyTree) return;
        if (tree.userData.treePhase !== 'standing') return;
        tree.userData.chopStandingHits = (tree.userData.chopStandingHits || 0) + 1;
        if (tree.userData.chopStandingHits >= 3) {
            this.replaceTreeWithChoppableLog(tree);
        }
    }

    applyBoulderMineHit(boulder) {
        if (!boulder.userData?.isBoulder) return;
        if (boulder.userData.mineable === false) return;
        boulder.userData.mineHits = (boulder.userData.mineHits || 0) + 1;
        if (boulder.userData.mineHits >= 5) {
            this.fragmentBoulderIntoPickupStones(boulder);
        }
    }

    _removeBoulderFromChunkArrays(boulder) {
        this.chunks.forEach((chunk) => {
            if (!chunk.boulders) return;
            const i = chunk.boulders.indexOf(boulder);
            if (i >= 0) chunk.boulders.splice(i, 1);
        });
    }

    _spawnStoneFragmentsAt(ox, oz, n) {
        const gy = this.getHeightAt(ox, oz);
        const fragments = createMiningFragmentRocks(this.scene, ox, oz, gy, n, (m) => this.registerPickupRock(m));
        const cx = Math.floor(ox / this.chunkSize);
        const cz = Math.floor(oz / this.chunkSize);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (chunk && chunk.pickupRocks) {
            for (let i = 0; i < fragments.length; i++) {
                chunk.pickupRocks.push(fragments[i]);
            }
        }
        fragments.forEach((m) => {
            m.position.y = this.getHeightAt(m.position.x, m.position.z) + 0.16;
        });
        return fragments;
    }

    fragmentBoulderIntoPickupStones(boulder) {
        if (!boulder.userData?.isBoulder) return;
        const ox = boulder.position.x;
        const oz = boulder.position.z;

        this._removeBoulderFromChunkArrays(boulder);
        this.scene.remove(boulder);
        if (boulder.geometry) boulder.geometry.dispose();
        if (boulder.material && typeof boulder.material.dispose === 'function') {
            boulder.material.dispose();
        }

        const n = 4 + Math.floor(Math.random() * 2);
        this._spawnStoneFragmentsAt(ox, oz, n);
    }

    replaceTreeWithChoppableLog(tree) {
        const x = tree.position.x;
        const z = tree.position.z;
        this.removeTreeFromChunks(tree);
        this.spawnChoppableLogAt(x, z);
    }

    spawnChoppableLogAt(x, z) {
        const gy = this.getHeightAt(x, z);
        const geo = new THREE.CylinderGeometry(0.34, 0.42, 2.45, 10);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4a3218,
            roughness: 0.92,
            metalness: 0.05,
            flatShading: true,
            emissive: new THREE.Color(0x000000),
            emissiveIntensity: 0
        });
        const log = new THREE.Mesh(geo, mat);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = Math.random() * Math.PI * 2;
        log.position.set(x, gy + 0.26, z);
        log.castShadow = true;
        log.receiveShadow = true;
        log.userData.interactiveLog = true;
        log.userData.highlightEmissive = new THREE.Color(0xe8b868);
        log.userData.collisionRadius = 2.45 * 0.48 + 0.15;
        this.scene.add(log);
        this.choppableLogs.push(log);
    }

    breakLogIntoSticks(log) {
        const i = this.choppableLogs.indexOf(log);
        if (i >= 0) this.choppableLogs.splice(i, 1);

        const x = log.position.x;
        const z = log.position.z;
        this.scene.remove(log);
        log.geometry?.dispose();
        if (log.material && typeof log.material.dispose === 'function') {
            log.material.dispose();
        }

        const n = 8;
        for (let k = 0; k < n; k++) {
            const ang = (k / n) * Math.PI * 2 + Math.random() * 0.4;
            const r = 0.65 + Math.random() * 0.55;
            const sx = x + Math.cos(ang) * r;
            const sz = z + Math.sin(ang) * r;
            const sgy = this.getHeightAt(sx, sz);
            const len = 1.15 + Math.random() * 0.85;
            const geo = new THREE.CylinderGeometry(0.052, 0.072, len, 7);
            const mesh = new THREE.Mesh(geo, createStickWoodMaterial());
            mesh.rotation.z = Math.PI / 2;
            mesh.rotation.y = Math.random() * Math.PI * 2;
            mesh.position.set(sx, sgy + 0.09, sz);
            mesh.userData.collisionRadius = len * 0.48 + 0.1;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.pickupStick = true;
            mesh.userData.restScale = 1;
            mesh.userData.highlightEmissive = new THREE.Color(0x7a5a2a);
            this.scene.add(mesh);
            this.registerPickupStick(mesh);
        }
    }

    removeTreeFromChunks(tree) {
        this.scene.remove(tree);
        this.chunks.forEach((chunk) => {
            if (!chunk.objects) return;
            const i = chunk.objects.indexOf(tree);
            if (i >= 0) chunk.objects.splice(i, 1);
        });
    }

    updateDecorationTime(elapsedSeconds, deltaSeconds = 0, lighting = null) {
        const gu = this.grassMaterial?.userData?.grassUniforms;
        if (gu?.uGrassTime) {
            gu.uGrassTime.value = elapsedSeconds;
        }
    }

    updateTreeWind(elapsedSeconds) {
        const t = elapsedSeconds;
        this.chunks.forEach((chunk) => {
            if (!chunk.objects) return;
            chunk.objects.forEach((obj) => {
                if (!obj.userData?.meshyTree) return;
                if (obj.userData.treePhase && obj.userData.treePhase !== 'standing') return;
                if (obj.userData.ezTree && typeof obj.update === 'function') {
                    obj.update(t);
                    return;
                }
                const ph = obj.userData.windPhase ?? 0;
                const s = 0.85;
                obj.rotation.y = obj.userData.baseRotY ?? obj.rotation.y;
                obj.rotation.x =
                    (obj.userData.baseRotX ?? 0) + Math.cos(t * 0.28 + ph * 0.7) * 0.012 * s;
                obj.rotation.z =
                    (obj.userData.baseRotZ ?? 0) + Math.sin(t * 0.33 + ph * 0.55) * 0.015 * s;
            });
        });
    }

    updatePickupRockHighlight(playerPos, elapsedSeconds) {
        if (!playerPos) return;
        const px = playerPos.x;
        const pz = playerPos.z;
        const inner = 1.25;
        const outer = 5.2;
        const list = this.pickupRocks;
        for (let i = 0; i < list.length; i++) {
            const mesh = list[i];
            if (!mesh.parent || !mesh.material) continue;
            const dx = mesh.position.x - px;
            const dz = mesh.position.z - pz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            let k = 0;
            if (dist <= inner) {
                k = 1;
            } else if (dist < outer) {
                const t = (outer - dist) / (outer - inner);
                k = t * t * (3 - 2 * t);
            }
            const pulse =
                0.14 * Math.sin(elapsedSeconds * 6.2 + mesh.position.x * 0.19 + mesh.position.z * 0.16);
            const m = mesh.material;
            const tint = mesh.userData.highlightEmissive;
            const boost = THREE.MathUtils.clamp(k * 0.92 + pulse * k, 0, 1.35);
            if (boost < 0.008) {
                m.emissive.setHex(0x000000);
                m.emissiveIntensity = 0;
            } else if (tint) {
                m.emissive.copy(tint);
                m.emissiveIntensity = boost;
            } else {
                m.emissive.setHex(0x5a7ab8);
                m.emissiveIntensity = boost;
            }
        }

        const sticks = this.pickupSticks;
        for (let i = 0; i < sticks.length; i++) {
            const mesh = sticks[i];
            if (!mesh.parent || !mesh.material) continue;
            const dx = mesh.position.x - px;
            const dz = mesh.position.z - pz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            let k = 0;
            if (dist <= inner) {
                k = 1;
            } else if (dist < outer) {
                const t = (outer - dist) / (outer - inner);
                k = t * t * (3 - 2 * t);
            }
            const pulse =
                0.12 * Math.sin(elapsedSeconds * 5.8 + mesh.position.x * 0.17 + mesh.position.z * 0.14);
            const m = mesh.material;
            const tint = mesh.userData.highlightEmissive;
            const boost = THREE.MathUtils.clamp(k * 0.85 + pulse * k, 0, 1.25);
            if (boost < 0.008) {
                m.emissive.setHex(0x000000);
                m.emissiveIntensity = 0;
            } else if (tint) {
                m.emissive.copy(tint);
                m.emissiveIntensity = boost;
            } else {
                m.emissive.setHex(0x7a5a2a);
                m.emissiveIntensity = boost;
            }
        }

        const foods = this.pickupFoods;
        for (let i = 0; i < foods.length; i++) {
            const mesh = foods[i];
            if (!mesh.parent || !mesh.material) continue;
            const dx = mesh.position.x - px;
            const dz = mesh.position.z - pz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            let k = 0;
            if (dist <= inner) {
                k = 1;
            } else if (dist < outer) {
                const t = (outer - dist) / (outer - inner);
                k = t * t * (3 - 2 * t);
            }
            const pulse =
                0.13 * Math.sin(elapsedSeconds * 6.0 + mesh.position.x * 0.18 + mesh.position.z * 0.15);
            const m = mesh.material;
            const tint = mesh.userData.highlightEmissive;
            const boost = THREE.MathUtils.clamp(k * 0.88 + pulse * k, 0, 1.3);
            if (boost < 0.008) {
                m.emissive.setHex(0x000000);
                m.emissiveIntensity = 0;
            } else if (tint) {
                m.emissive.copy(tint);
                m.emissiveIntensity = boost;
            } else {
                m.emissive.setHex(0xaa2040);
                m.emissiveIntensity = boost;
            }
        }

        const logs = this.choppableLogs;
        for (let i = 0; i < logs.length; i++) {
            const mesh = logs[i];
            if (!mesh.parent || !mesh.material) continue;
            const dx = mesh.position.x - px;
            const dz = mesh.position.z - pz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            let k = 0;
            if (dist <= inner) {
                k = 1;
            } else if (dist < outer) {
                const t = (outer - dist) / (outer - inner);
                k = t * t * (3 - 2 * t);
            }
            const pulse =
                0.18 * Math.sin(elapsedSeconds * 5.5 + mesh.position.x * 0.14 + mesh.position.z * 0.14);
            const m = mesh.material;
            const tint = mesh.userData.highlightEmissive;
            const boost = THREE.MathUtils.clamp(k * 1.05 + pulse * k, 0, 1.55);
            if (boost < 0.008) {
                m.emissive.setHex(0x000000);
                m.emissiveIntensity = 0;
            } else if (tint) {
                m.emissive.copy(tint);
                m.emissiveIntensity = boost;
            } else {
                m.emissive.setHex(0xe8b868);
                m.emissiveIntensity = boost;
            }
        }
    }

    update(playerPosition) {
        const px = Math.floor(playerPosition.x / this.chunkSize);
        const pz = Math.floor(playerPosition.z / this.chunkSize);
        const r = this.chunkStreamRadius;

        const missing = [];
        for (let x = px - r; x <= px + r; x++) {
            for (let z = pz - r; z <= pz + r; z++) {
                const key = `${x},${z}`;
                if (!this.chunks.has(key)) {
                    const dx = x - px;
                    const dz = z - pz;
                    missing.push({ x, z, d2: dx * dx + dz * dz });
                }
            }
        }
        missing.sort((a, b) => a.d2 - b.d2);
        const budget = this.chunkGenBudgetPerFrame;
        for (let i = 0; i < Math.min(budget, missing.length); i++) {
            this.generateChunk(missing[i].x, missing[i].z);
        }

        // Water2 animates flow via internal Clock in onBeforeRender — no manual time uniform.
    }

    /**
     * Push (x,z) out of circular obstacles (trees, boulders, rocks, sticks, logs).
     */
    resolveObstacleCollision(x, z, playerRadius = 0.42) {
        let px = x;
        let pz = z;
        const obstacles = [];
        const pushObstacle = (o) => {
            if (!o || !o.parent) return;
            let r = o.userData.collisionRadius;
            if (typeof r !== 'number' || r <= 0) {
                if (o.userData?.isBoulder) {
                    r = 1.45 * o.scale.x + 0.25;
                } else if (o.userData?.meshyTree) {
                    r = 2.5;
                } else if (o.userData?.pickupRock) {
                    r = 0.38 * (o.userData.restScale ?? o.scale.x);
                } else if (o.userData?.pickupStick) {
                    r = 0.55;
                } else if (o.userData?.pickupFood) {
                    r =
                        typeof o.userData.collisionRadius === 'number'
                            ? o.userData.collisionRadius
                            : 0.15;
                } else if (o.userData?.interactiveLog) {
                    r = 1.35;
                } else {
                    return;
                }
            }
            const qdx = x - o.position.x;
            const qdz = z - o.position.z;
            const loose = r + playerRadius + 52;
            if (qdx * qdx + qdz * qdz > loose * loose) return;
            obstacles.push({ o, r });
        };

        this.chunks.forEach((chunk) => {
            if (chunk.boulders) {
                for (let i = 0; i < chunk.boulders.length; i++) {
                    pushObstacle(chunk.boulders[i]);
                }
            }
            if (chunk.objects) {
                for (let i = 0; i < chunk.objects.length; i++) {
                    const t = chunk.objects[i];
                    if (t.userData?.meshyTree) pushObstacle(t);
                }
            }
        });
        for (let i = 0; i < this.pickupRocks.length; i++) {
            pushObstacle(this.pickupRocks[i]);
        }
        for (let i = 0; i < this.pickupSticks.length; i++) {
            pushObstacle(this.pickupSticks[i]);
        }
        for (let i = 0; i < this.pickupFoods.length; i++) {
            pushObstacle(this.pickupFoods[i]);
        }
        for (let i = 0; i < this.choppableLogs.length; i++) {
            pushObstacle(this.choppableLogs[i]);
        }

        obstacles.sort((a, b) => b.r - a.r);

        for (let iter = 0; iter < 5; iter++) {
            for (let i = 0; i < obstacles.length; i++) {
                const { o, r } = obstacles[i];
                const dx = px - o.position.x;
                const dz = pz - o.position.z;
                const distSq = dx * dx + dz * dz;
                const minD = playerRadius + r;
                const minSq = minD * minD;
                if (distSq >= minSq || distSq < 1e-10) continue;
                const dist = Math.sqrt(distSq);
                const push = (minD - dist) / dist;
                px += dx * push;
                pz += dz * push;
            }
        }
        return { x: px, z: pz };
    }

    /** @deprecated Use {@link resolveObstacleCollision} — kept for callers. */
    resolveBoulderCollision(x, z, playerRadius = 0.42) {
        return this.resolveObstacleCollision(x, z, playerRadius);
    }

    getHeightAt(x, z) {
        const cx = Math.floor(x / this.chunkSize);
        const cz = Math.floor(z / this.chunkSize);
        const chunk = this.chunks.get(`${cx},${cz}`);
        const base = chunk && chunk.mesh ? chunk.mesh.position.y : 0;
        return base + sampleLakeDepth(x, z);
    }

    save() {
        const data = {
            chunks: Array.from(this.chunks.entries()).map(([key, chunk]) => ({
                key,
                cx: chunk.cx,
                cz: chunk.cz,
                heights: chunk.heights
            })),
            waterLevel: this.waterLevel
        };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'darkness_world.json';
        a.click();
    }

    import(json) {
        if (this.chunkWorker) {
            this.chunkWorker.terminate();
            this.chunkWorker = null;
            this.initChunkWorker();
        }

        this.choppableLogs.forEach((log) => {
            this.scene.remove(log);
            log.geometry?.dispose();
            if (log.material && typeof log.material.dispose === 'function') {
                log.material.dispose();
            }
        });
        this.choppableLogs.length = 0;

        this.chunks.forEach(c => {
            this.scene.remove(c.mesh);
            if (c.objects) {
                c.objects.forEach((obj) => {
                    this.scene.remove(obj);
                });
            }
            if (c.grass) this.scene.remove(c.grass);
            if (c.boulders) {
                c.boulders.forEach((b) => {
                    this.scene.remove(b);
                    b.geometry?.dispose();
                });
            }
            if (c.pickupRocks) {
                c.pickupRocks.forEach((r) => {
                    this.unregisterPickupRock(r);
                    this.scene.remove(r);
                    r.geometry?.dispose();
                    if (r.material && typeof r.material.dispose === 'function') {
                        r.material.dispose();
                    }
                });
            }
            if (c.pickupSticks) {
                c.pickupSticks.forEach((s) => {
                    this.unregisterPickupStick(s);
                    this.scene.remove(s);
                    s.geometry?.dispose();
                    if (s.material && typeof s.material.dispose === 'function') {
                        s.material.dispose();
                    }
                });
            }
            if (c.pickupBerries) {
                c.pickupBerries.forEach((b) => {
                    this.unregisterPickupFood(b);
                    this.scene.remove(b);
                    b.geometry?.dispose();
                    if (b.material && typeof b.material.dispose === 'function') {
                        b.material.dispose();
                    }
                });
            }
        });
        this.pickupRocks.length = 0;
        this.pickupSticks.length = 0;
        this.pickupFoods.length = 0;
        this.chunks.clear();

        const data = JSON.parse(json);
        data.chunks.forEach(c => {
            this.generateChunk(c.cx, c.cz, c.heights);
        });
        this.waterLevel = data.waterLevel;
        if (this.water) {
            this.water.position.y = this.waterLevel;
        }
    }
}
