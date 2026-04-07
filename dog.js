import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/** Vite `public/` is served from `import.meta.env.BASE_URL` (needed for GitHub Pages / subpaths). */
const ASSET_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const MODEL_DIR = `${ASSET_BASE}models/chance/`;
const FILE_PREFIX = 'Meshy_AI_Snowy_Pup_quadruped_';

/**
 * Target shoulder/body height (m) after auto-fit (bounding box Y only).
 */
const TARGET_HEIGHT = 2.65;

/** Dog runs to random points within this radius of the roam anchor (m). */
const ROAM_RADIUS_MIN = 4;
const ROAM_RADIUS_MAX = 17;

/** Start following the player when separation exceeds this (m). */
const FOLLOW_TRIGGER_DIST = 28;

/** Stop following and roam again when closer than this (m) — hysteresis vs FOLLOW_TRIGGER_DIST. */
const FOLLOW_RELEASE_DIST = 16;

/** Horizontal speed caps (m/s) — approached smoothly via velocity blending. */
const MAX_ROAM_SPEED = 8.5;
const MAX_FOLLOW_SPEED = 24;

/** How fast horizontal velocity eases toward desired (higher = snappier, lower = floatier). */
const VELOCITY_EASE = 5.2;

/** Yaw smoothing (rad/s toward facing direction). */
const TURN_EASE = 11;

/** Terrain height follow (reduces foot jitter on uneven ground). */
const HEIGHT_EASE = 14;

/** After reaching a roam waypoint, stand still for this long (seconds). */
const ROAM_REST_MIN = 4;
const ROAM_REST_MAX = 11;

/** Even if not at a waypoint, only pick a new random roam direction this often (seconds). */
const ROAM_REPICK_INTERVAL_MIN = 12;
const ROAM_REPICK_INTERVAL_MAX = 26;

/** Per-model heading tweak from the old dog rig. */
const FACE_OFFSET = Math.PI * 1.12;
/** Quadruped mesh faces −travel; add π so movement matches walk direction. */
const MODEL_FORWARD_YAW = Math.PI;

function applyChanceMaterials(root, baseTexture, metallicTexture, roughnessTexture, normalMap) {
    root.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const matOpts = {
                map: baseTexture,
                metalnessMap: metallicTexture,
                roughnessMap: roughnessTexture,
                metalness: 0.45,
                roughness: 0.52
            };
            if (normalMap) {
                matOpts.normalMap = normalMap;
            }
            child.material = new THREE.MeshStandardMaterial(matOpts);
        }
    });
}

function fitModelToTargetHeight(model, targetH) {
    model.scale.setScalar(1);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const h = Math.max(size.y, 1e-6);
    const fitScale = targetH / h;
    model.scale.setScalar(fitScale);
}

/**
 * Walking clip must target the same skeleton — try armature / root / skin (order matters for FBX).
 */
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
            return { mixer, action, root };
        } catch {
            /* try next */
        }
    }
    return null;
}

export class Dog {
    constructor(scene) {
        this.scene = scene;
        this.model = null;
        this.mixer = null;
        /** @type {THREE.AnimationAction | null} */
        this._walkAction = null;
        this.position = new THREE.Vector3(2.5, 0, 0.5);
        /** Smoothed horizontal velocity (m/s). */
        this._velX = 0;
        this._velZ = 0;
        /** Smoothed yaw for facing (rad). */
        this._yaw = 0;
        /** Smoothed vertical (m) — eases to terrain (set from terrain after load). */
        this._smoothY = 0;
        this._roamAnchor = new THREE.Vector3();
        this._roamTarget = new THREE.Vector3();
        this._hasRoamAnchor = false;
        /** @type {'roam' | 'follow'} */
        this._mode = 'roam';
        this._wanderTimer = 0;
        this._nextRoamPick = 4;
        /** Seconds left standing still in roam (after arriving at a point). */
        this._roamRestRemain = 0;
        this._scratch = new THREE.Vector3();
        this.readyPromise = this.load();
    }

    _pickRoamTarget() {
        const theta = Math.random() * Math.PI * 2;
        const r = ROAM_RADIUS_MIN + Math.random() * (ROAM_RADIUS_MAX - ROAM_RADIUS_MIN);
        this._roamTarget.set(
            this._roamAnchor.x + Math.cos(theta) * r,
            0,
            this._roamAnchor.z + Math.sin(theta) * r
        );
    }

    /**
     * Ease horizontal velocity toward moving at `maxSpeed` in the direction of `target` (XZ),
     * or toward rest when close / no direction.
     */
    _stepSmoothMove(target, delta, maxSpeed) {
        this._scratch.set(target.x - this.position.x, 0, target.z - this.position.z);
        const len = this._scratch.length();
        const minDist = 0.06;
        let desiredVx = 0;
        let desiredVz = 0;
        if (len > minDist) {
            this._scratch.multiplyScalar(1 / len);
            desiredVx = this._scratch.x * maxSpeed;
            desiredVz = this._scratch.z * maxSpeed;
        }

        const t = 1 - Math.exp(-VELOCITY_EASE * delta);
        this._velX = THREE.MathUtils.lerp(this._velX, desiredVx, t);
        this._velZ = THREE.MathUtils.lerp(this._velZ, desiredVz, t);

        this.position.x += this._velX * delta;
        this.position.z += this._velZ * delta;
    }

    _faceMovementOrTarget(target, delta) {
        this._scratch.set(target.x - this.position.x, 0, target.z - this.position.z);
        const lenSq = this._scratch.lengthSq();
        if (lenSq < 1e-6) return;
        this._scratch.multiplyScalar(1 / Math.sqrt(lenSq));
        const targetYaw =
            Math.atan2(this._scratch.x, this._scratch.z) + FACE_OFFSET + MODEL_FORWARD_YAW;
        let diff = targetYaw - this._yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turnT = 1 - Math.exp(-TURN_EASE * delta);
        this._yaw += diff * turnT;
        this.model.rotation.y = this._yaw;
    }

    async load() {
        const loader = new FBXLoader();
        const textureLoader = new THREE.TextureLoader();

        try {
            const baseTexture = await textureLoader.loadAsync(`${MODEL_DIR}${FILE_PREFIX}texture_0.png`);
            baseTexture.colorSpace = THREE.SRGBColorSpace;
            const metallicTexture = await textureLoader.loadAsync(`${MODEL_DIR}${FILE_PREFIX}texture_0_metallic.png`);
            const roughnessTexture = await textureLoader.loadAsync(`${MODEL_DIR}${FILE_PREFIX}texture_0_roughness.png`);

            let normalMap = null;
            try {
                normalMap = await textureLoader.loadAsync(`${MODEL_DIR}${FILE_PREFIX}texture_0_normal.png`);
            } catch {
                normalMap = null;
            }

            const charUrl = `${MODEL_DIR}${FILE_PREFIX}Character_output.fbx`;
            const walkUrl = `${MODEL_DIR}${FILE_PREFIX}model_Animation_Walking_withSkin.fbx`;

            const walkFbx = await loader.loadAsync(walkUrl).catch(() => null);

            const walkUsable =
                walkFbx &&
                walkFbx.animations?.length &&
                (() => {
                    let ok = false;
                    walkFbx.traverse((o) => {
                        if (o.isSkinnedMesh) ok = true;
                    });
                    return ok;
                })();

            /** Walking FBX = skin + walk clip on one rig — avoids broken cross-file retargeting. */
            if (walkUsable) {
                this.model = walkFbx;
            } else {
                this.model = await loader.loadAsync(charUrl);
            }

            applyChanceMaterials(this.model, baseTexture, metallicTexture, roughnessTexture, normalMap);
            fitModelToTargetHeight(this.model, TARGET_HEIGHT);

            this.scene.add(this.model);
            this.model.position.copy(this.position);
            this.model.updateMatrixWorld(true);
            this._yaw = this.model.rotation.y;
            this._smoothY = this.position.y;

            let clip = null;
            if (walkFbx?.animations?.length) clip = walkFbx.animations[0];
            else if (this.model.animations?.length) clip = this.model.animations[0];

            let played = false;
            if (clip) {
                const bound = tryBindWalkAnimation(this.model, clip);
                if (bound) {
                    this.mixer = bound.mixer;
                    if (bound.action) {
                        this._walkAction = bound.action;
                        bound.action.timeScale = 1;
                    }
                    played = true;
                }
            }

            if (!played) {
                console.warn(
                    'Chance: walk clip did not bind — companion may slide without leg motion. Using walking FBX as the mesh usually fixes this.'
                );
            } else {
                console.info('Chance companion loaded with walk animation.');
            }
        } catch (err) {
            console.error(
                'Chance companion failed to load — need textures + FBX under public/models/chance/',
                err
            );
        }
    }

    getPosition() {
        if (!this.model) return null;
        return this.position.clone();
    }

    /**
     * Roams randomly around a world anchor; only runs toward the player when they get too far.
     */
    update(delta, playerPos, playerYaw, terrainManager) {
        if (!this.model || !terrainManager) return;
        if (this.mixer) {
            try {
                this.mixer.update(delta);
            } catch (e) {
                console.warn('Chance: animation mixer error — disabling animation.', e);
                this.mixer = null;
                this._walkAction = null;
            }
        }
        void playerYaw;

        if (!this._hasRoamAnchor) {
            this._roamAnchor.copy(playerPos);
            this._hasRoamAnchor = true;
            this._pickRoamTarget();
        }

        const dx = playerPos.x - this.position.x;
        const dz = playerPos.z - this.position.z;
        const distToPlayer = Math.hypot(dx, dz);

        if (this._mode === 'roam' && distToPlayer > FOLLOW_TRIGGER_DIST) {
            this._mode = 'follow';
        } else if (this._mode === 'follow' && distToPlayer < FOLLOW_RELEASE_DIST) {
            this._mode = 'roam';
            this._roamAnchor.copy(playerPos);
            this._pickRoamTarget();
        }

        if (this._mode === 'follow') {
            this._stepSmoothMove(playerPos, delta, MAX_FOLLOW_SPEED);
            this._faceMovementOrTarget(playerPos, delta);
        } else if (this._roamRestRemain > 0) {
            this._roamRestRemain -= delta;
            this._stepSmoothMove(this.position, delta, MAX_ROAM_SPEED);
            if (this._roamRestRemain <= 0) {
                this._pickRoamTarget();
            }
        } else {
            this._wanderTimer += delta;
            if (this._wanderTimer >= this._nextRoamPick) {
                this._wanderTimer = 0;
                this._nextRoamPick =
                    ROAM_REPICK_INTERVAL_MIN +
                    Math.random() * (ROAM_REPICK_INTERVAL_MAX - ROAM_REPICK_INTERVAL_MIN);
                this._pickRoamTarget();
            }
            const dRoam = Math.hypot(
                this._roamTarget.x - this.position.x,
                this._roamTarget.z - this.position.z
            );
            if (dRoam < 1.35) {
                this._roamRestRemain =
                    ROAM_REST_MIN + Math.random() * (ROAM_REST_MAX - ROAM_REST_MIN);
            }
            this._stepSmoothMove(this._roamTarget, delta, MAX_ROAM_SPEED);
            this._faceMovementOrTarget(this._roamTarget, delta);
        }

        const groundY = terrainManager.getHeightAt(this.position.x, this.position.z);
        const yT = 1 - Math.exp(-HEIGHT_EASE * delta);
        this._smoothY = THREE.MathUtils.lerp(this._smoothY, groundY, yT);
        this.position.y = this._smoothY;
        this.model.position.copy(this.position);

        if (this._walkAction) {
            const sp = Math.hypot(this._velX, this._velZ);
            const maxSp = this._mode === 'follow' ? MAX_FOLLOW_SPEED : MAX_ROAM_SPEED;
            const t = THREE.MathUtils.clamp(sp / Math.max(0.15, maxSp), 0, 1);
            this._walkAction.timeScale = THREE.MathUtils.lerp(0.42, 1.22, t);
        }
    }
}
