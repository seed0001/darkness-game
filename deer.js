import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/** Match {@link Dog} companion scale (shoulder/body height in meters). */
export const DEER_TARGET_HEIGHT = 2.65;

const ASSET_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
/** Served from `public/models/` (copied from Meshy export; was under `node_modules/`). */
const MODEL_DIR = `${ASSET_BASE}models/Meshy_AI_A_female_deer_very_r_quadruped/`;
const TEXTURE_STEM = 'Meshy_AI_A_female_deer_very_r_quadruped_texture_0';
const WALK_FBX = 'Meshy_AI_A_female_deer_very_r_quadruped_model_Animation_Walking_withSkin.fbx';

function fitModelToTargetHeight(model, targetH) {
    model.scale.setScalar(1);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const h = Math.max(size.y, 1e-6);
    model.scale.setScalar(targetH / h);
}

function applyDeerMaterials(root, baseTexture, metallicTexture, roughnessTexture, normalMap) {
    root.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const matOpts = {
                map: baseTexture,
                metalnessMap: metallicTexture,
                roughnessMap: roughnessTexture,
                metalness: 0.42,
                roughness: 0.55
            };
            if (normalMap) matOpts.normalMap = normalMap;
            child.material = new THREE.MeshStandardMaterial(matOpts);
        }
    });
}

/** Same rig binding as Chance (dog) — root-only mixer often fails on skinned FBX. */
function tryBindWalkAnimation(model, clip) {
    let skinned = null;
    model.traverse((o) => {
        if (o.isSkinnedMesh && o.skeleton) skinned = o;
    });
    const candidates = [];
    if (skinned?.parent) candidates.push(skinned.parent);
    candidates.push(model);
    if (skinned) candidates.push(skinned);
    for (const root of candidates) {
        try {
            const mixer = new THREE.AnimationMixer(root);
            const action = mixer.clipAction(clip);
            action.setLoop(THREE.LoopRepeat);
            action.clampWhenFinished = false;
            action.reset().play();
            return mixer;
        } catch {
            /* try next */
        }
    }
    return null;
}

export class Deer {
    constructor(scene, position) {
        this.scene = scene;
        this.model = null;
        this.mixer = null;
        this.isLoaded = false;
        /** Cleared from spawner list so failed downloads do not block new spawns. */
        this.loadFailed = false;
        this.position = position.clone();
        this.velocity = new THREE.Vector3();
        this.state = 'idle';
        this.idleTimer = Math.random() * 4 + 1.5;
        this.wanderTarget = new THREE.Vector3();
        this.moveSpeed = 5.5;
        this.fleeSpeed = 18;
        this.wanderRadius = 22;
        this._removed = false;
        this.load();
    }

    async load() {
        const loader = new FBXLoader();
        const texLoader = new THREE.TextureLoader();
        try {
            const baseTexture = await texLoader.loadAsync(`${MODEL_DIR}${TEXTURE_STEM}.png`);
            baseTexture.colorSpace = THREE.SRGBColorSpace;
            const metallicTexture = await texLoader.loadAsync(`${MODEL_DIR}${TEXTURE_STEM}_metallic.png`);
            const roughnessTexture = await texLoader.loadAsync(`${MODEL_DIR}${TEXTURE_STEM}_roughness.png`);
            let normalMap = null;
            try {
                normalMap = await texLoader.loadAsync(`${MODEL_DIR}${TEXTURE_STEM}_normal.png`);
            } catch {
                normalMap = null;
            }

            const fbx = await loader.loadAsync(`${MODEL_DIR}${WALK_FBX}`);
            this.model = fbx;
            applyDeerMaterials(this.model, baseTexture, metallicTexture, roughnessTexture, normalMap);
            fitModelToTargetHeight(this.model, DEER_TARGET_HEIGHT);

            this.model.position.copy(this.position);
            this.model.visible = true;
            this.model.frustumCulled = false;

            const clip = fbx.animations?.length ? fbx.animations[0] : null;
            this.mixer = clip ? tryBindWalkAnimation(this.model, clip) : null;

            this.scene.add(this.model);
            this.isLoaded = true;
        } catch (e) {
            this.loadFailed = true;
            console.warn(
                'Deer model failed to load (expected public/models/Meshy_AI_A_female_deer_very_r_quadruped/):',
                e
            );
        }
    }

    checkThreats(dogPosition, playerPosition) {
        if (!dogPosition && !playerPosition) return;

        if (dogPosition) {
            const d = this.position.distanceTo(dogPosition);
            if (d < 22) {
                this._fleeFrom(dogPosition, 36);
                return;
            }
        }
        if (playerPosition) {
            const d = this.position.distanceTo(playerPosition);
            if (d < 16) {
                this._fleeFrom(playerPosition, 42);
            }
        }
    }

    _fleeFrom(threatPos, runDist) {
        this.state = 'fleeing';
        const fleeDir = new THREE.Vector3();
        fleeDir.subVectors(this.position, threatPos);
        fleeDir.y = 0;
        if (fleeDir.lengthSq() < 1e-6) {
            fleeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        }
        fleeDir.normalize();
        this.wanderTarget.set(
            this.position.x + fleeDir.x * runDist,
            0,
            this.position.z + fleeDir.z * runDist
        );
    }

    update(delta, terrainManager, dogPosition, playerPosition) {
        if (this._removed) return true;
        if (!this.isLoaded || !this.model) return false;

        if (this.mixer) this.mixer.update(delta);

        this.checkThreats(dogPosition, playerPosition);

        if (this.state === 'idle') {
            this.idleTimer -= delta;
            if (this.idleTimer <= 0) {
                this.state = 'wandering';
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * this.wanderRadius;
                this.wanderTarget.set(
                    this.position.x + Math.cos(angle) * dist,
                    0,
                    this.position.z + Math.sin(angle) * dist
                );
            }
        } else if (this.state === 'wandering' || this.state === 'fleeing') {
            const direction = new THREE.Vector3();
            direction.subVectors(this.wanderTarget, this.position);
            direction.y = 0;
            const distToTarget = direction.length();
            if (distToTarget < 2.2) {
                this.state = 'idle';
                this.idleTimer = Math.random() * 4 + 2;
            } else {
                direction.normalize();
                const speed = this.state === 'fleeing' ? this.fleeSpeed : this.moveSpeed;
                this.position.x += direction.x * speed * delta;
                this.position.z += direction.z * speed * delta;
                this.model.rotation.y = Math.atan2(direction.x, direction.z);
            }
        }

        if (terrainManager) {
            this.position.y = terrainManager.getHeightAt(this.position.x, this.position.z);
        }
        this.model.position.copy(this.position);
        this.model.visible = true;
        return false;
    }

    dispose() {
        if (this.model) this.scene.remove(this.model);
    }
}

export class DeerSpawner {
    constructor(scene, getPlayerPosition) {
        this.scene = scene;
        this.getPlayerPosition = getPlayerPosition;
        this.deer = [];
        this.maxDeer = 6;
        this.spawnTimer = 0;
        this.spawnInterval = 4;
        /** Keep spawns close so fog / draw distance does not hide them. */
        this.spawnRadius = 22;
        this.minSpawnDist = 8;
        this.autoSpawn = true;
        this._retryEmptyTimer = 0;
    }

    getDeer() {
        return this.deer;
    }

    _loadedCount() {
        return this.deer.filter((d) => d.isLoaded && d.model && !d._removed && !d.loadFailed).length;
    }

    _pendingCount() {
        return this.deer.filter((d) => !d.isLoaded && !d.loadFailed && !d._removed).length;
    }

    update(delta, terrainManager, dogPosition, playerPosition) {
        for (let i = this.deer.length - 1; i >= 0; i--) {
            if (this.deer[i].loadFailed) {
                this.deer.splice(i, 1);
            }
        }

        this.spawnTimer += delta;
        const loaded = this._loadedCount();
        const pending = this._pendingCount();
        const canSpawnMore = loaded + pending < this.maxDeer;

        if (this.autoSpawn && this.spawnTimer >= this.spawnInterval && canSpawnMore) {
            this.spawnTimer = 0;
            this.spawnDeer();
        }

        if (this.autoSpawn && loaded === 0 && this.deer.length === 0 && canSpawnMore) {
            this._retryEmptyTimer += delta;
            if (this._retryEmptyTimer > 1.5) {
                this._retryEmptyTimer = 0;
                this.spawnDeer();
            }
        } else {
            this._retryEmptyTimer = 0;
        }

        for (let i = this.deer.length - 1; i >= 0; i--) {
            if (this.deer[i].update(delta, terrainManager, dogPosition, playerPosition)) {
                this.deer.splice(i, 1);
            }
        }
    }

    spawnDeer() {
        const playerPos = this.getPlayerPosition();
        const angle = Math.random() * Math.PI * 2;
        const dist = this.minSpawnDist + Math.random() * Math.max(0.1, this.spawnRadius - this.minSpawnDist);
        const spawnPos = new THREE.Vector3(
            playerPos.x + Math.cos(angle) * dist,
            0,
            playerPos.z + Math.sin(angle) * dist
        );
        this.deer.push(new Deer(this.scene, spawnPos));
    }

    /** First-load batch: ring near the player (same radii as normal spawn). */
    seedInitialHerd(n) {
        const cap = Math.min(n, this.maxDeer);
        for (let i = 0; i < cap; i++) {
            this.spawnDeer();
        }
    }

    setAllVisible(visible) {
        for (const d of this.deer) {
            if (d.model) d.model.visible = visible;
        }
    }
}
