import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
    createSharedGrassBladeGeometry,
    createSharedGrassWindMaterial,
    buildGrassInstancedMesh,
    buildGrassInstancedMeshFromMatrices,
    createPickupRocksForChunk,
    createBouldersForChunk
} from './grassRocks.js';

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
    constructor(scene) {
        this.scene = scene;
        this.chunkSize = 64;
        this.resolution = 4;
        this.chunks = new Map();
        this.noise = new Noise();
        this.activeChunks = new Set();
        this.waterLevel = -10.0;
        this.pickupRocks = [];
        this.grassGeometry = createSharedGrassBladeGeometry();
        this.grassMaterial = createSharedGrassWindMaterial();

        this.pineReady = false;
        this.pineTreeProto = null;
        this.pineTreeScale = 1;
        this.pineSharedMaterial = null;

        this.terrainMaterial = new THREE.MeshStandardMaterial({
            map: null,
            color: 0x888888,
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
            this.fallbackGrassForChunk(data.key);
            return;
        }
        if (data.type !== 'grass') return;
        const chunk = this.chunks.get(data.key);
        if (!chunk || chunk.grass) return;

        const grass = buildGrassInstancedMeshFromMatrices(
            this.grassGeometry,
            this.grassMaterial,
            data.matrices,
            data.count
        );
        this.scene.add(grass);
        chunk.grass = grass;
    }

    fallbackGrassForChunk(key) {
        const chunk = this.chunks.get(key);
        if (!chunk || chunk.grass) return;
        const groundY = chunk.mesh.position.y;
        const grass = buildGrassInstancedMesh(
            this.grassGeometry,
            this.grassMaterial,
            this.chunkSize,
            chunk.cx,
            chunk.cz,
            groundY
        );
        this.scene.add(grass);
        chunk.grass = grass;
    }

    loadPineTreeModel(humanHeightWorld) {
        const refHuman = Math.max(
            typeof humanHeightWorld === 'number' && !Number.isNaN(humanHeightWorld)
                ? humanHeightWorld
                : 1.65,
            0.08
        );
        const treeHeightMultiplier = 4.75;
        this.referenceHumanHeight = refHuman;
        this.targetTreeHeightWorld = refHuman * treeHeightMultiplier;

        return new Promise((resolve, reject) => {
            const texLoader = new THREE.TextureLoader();
            const loadTex = (url) =>
                new Promise((res, rej) => {
                    texLoader.load(url, res, undefined, rej);
                });

            Promise.all([
                loadTex('/textures/luscious_pine_color.png'),
                loadTex('/textures/luscious_pine_normal.png'),
                loadTex('/textures/luscious_pine_roughness.png'),
                loadTex('/textures/luscious_pine_metallic.png')
            ])
                .then(([map, normalMap, roughnessMap, metalnessMap]) => {
                    map.colorSpace = THREE.SRGBColorSpace;
                    map.anisotropy = 8;
                    normalMap.colorSpace = THREE.LinearSRGBColorSpace;
                    roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
                    metalnessMap.colorSpace = THREE.LinearSRGBColorSpace;

                    this.pineSharedMaterial = new THREE.MeshStandardMaterial({
                        map,
                        normalMap,
                        roughnessMap,
                        metalnessMap,
                        metalness: 1,
                        roughness: 1
                    });

                    const fbxLoader = new FBXLoader();
                    fbxLoader.load(
                        '/models/luscious_pine.fbx',
                        (fbx) => {
                            fbx.traverse((child) => {
                                if (child.isMesh) {
                                    child.material = this.pineSharedMaterial;
                                    child.castShadow = true;
                                    child.receiveShadow = true;
                                }
                            });
                            this.pineTreeProto = fbx;

                            const box = new THREE.Box3().setFromObject(fbx);
                            const size = new THREE.Vector3();
                            box.getSize(size);
                            this.pineTreeScale =
                                this.targetTreeHeightWorld / Math.max(size.y, 0.001);

                            this.pineReady = true;
                            this.backfillPendingTrees();
                            resolve();
                        },
                        undefined,
                        (err) => {
                            console.error('Luscious pine FBX failed:', err);
                            reject(err);
                        }
                    );
                })
                .catch((err) => {
                    console.error('Luscious pine textures failed:', err);
                    reject(err);
                });
        });
    }

    spawnTreesForChunk(cx, cz, groundY, outArray) {
        if (!this.pineReady || !this.pineTreeProto) return;

        const trng = chunkTreeRng(cx, cz);
        const numTrees = 1 + Math.floor(trng() * 3);
        const inset = this.chunkSize * 0.46;

        for (let i = 0; i < numTrees; i++) {
            const tree = this.pineTreeProto.clone(true);
            const scale = this.pineTreeScale * (0.92 + trng() * 0.32);
            tree.scale.setScalar(scale);
            tree.rotation.y = trng() * Math.PI * 2;
            tree.userData.meshyTree = true;
            tree.userData.baseRotY = tree.rotation.y;
            tree.userData.baseRotX = 0;
            tree.userData.baseRotZ = 0;
            tree.userData.windPhase = trng() * Math.PI * 2;

            const tx = (trng() - 0.5) * 2 * inset;
            const tz = (trng() - 0.5) * 2 * inset;
            tree.position.set(cx * this.chunkSize + tx, groundY, cz * this.chunkSize + tz);
            tree.updateMatrixWorld(true);

            const bounds = new THREE.Box3().setFromObject(tree);
            tree.position.y += groundY - bounds.min.y;

            this.scene.add(tree);
            outArray.push(tree);
        }
    }

    backfillPendingTrees() {
        if (!this.pineReady || !this.pineTreeProto) return;
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
        this._waterPromise = new THREE.TextureLoader()
            .loadAsync('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/waternormals.jpg')
            .then((texture) => {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
                this.water = new Water(waterGeometry, {
                    textureWidth: 256,
                    textureHeight: 256,
                    waterNormals: texture,
                    sunDirection: new THREE.Vector3(),
                    sunColor: 0x222222,
                    waterColor: 0x111111,
                    distortionScale: 3.7,
                    fog: this.scene.fog !== undefined
                });
                this.water.rotation.x = -Math.PI / 2;
                this.water.position.y = this.waterLevel;
                this.scene.add(this.water);
            })
            .catch((err) => {
                console.warn('Water normals failed to load:', err);
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
            let h = 0; 
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

        let grass = null;
        if (this.chunkWorker) {
            this.chunkWorker.postMessage({
                type: 'grass',
                key,
                cx,
                cz,
                chunkSize: this.chunkSize,
                groundY
            });
        } else {
            grass = buildGrassInstancedMesh(
                this.grassGeometry,
                this.grassMaterial,
                this.chunkSize,
                cx,
                cz,
                groundY
            );
            this.scene.add(grass);
        }

        const pickupRocks = createPickupRocksForChunk(
            this.scene,
            this.chunkSize,
            cx,
            cz,
            groundY,
            (m) => this.registerPickupRock(m)
        );
        const boulders = createBouldersForChunk(this.scene, this.chunkSize, cx, cz, groundY);

        this.chunks.set(key, {
            mesh,
            heights,
            cx,
            cz,
            objects: chunkTrees,
            grass,
            pickupRocks,
            boulders
        });
        return key;
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

    updateDecorationTime(elapsedSeconds) {
        const shader = this.grassMaterial?.userData?.grassShader;
        if (shader?.uniforms?.uGrassTime) {
            shader.uniforms.uGrassTime.value = elapsedSeconds;
        }
    }

    updateTreeWind(elapsedSeconds) {
        const t = elapsedSeconds;
        this.chunks.forEach((chunk) => {
            if (!chunk.objects) return;
            chunk.objects.forEach((obj) => {
                if (!obj.userData?.meshyTree) return;
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

        if (this.water) {
            this._waterAcc = (this._waterAcc || 0) + 1;
            if (this._waterAcc % 2 === 0) {
                this.water.material.uniforms['time'].value += 1.0 / 30.0;
            }
        }
    }

    getHeightAt(x, z) {
        const cx = Math.floor(x / this.chunkSize);
        const cz = Math.floor(z / this.chunkSize);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (chunk && chunk.mesh) {
            return chunk.mesh.position.y;
        }
        return 0;
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
        });
        this.pickupRocks.length = 0;
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
