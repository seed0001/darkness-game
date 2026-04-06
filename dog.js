import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/** Place `dog.fbx` under `public/models/` (Vite serves `/models/dog.fbx`). */
const DOG_MODEL_URL = '/models/dog.fbx';

/** Dog runs to random points within this radius of the roam anchor (m). */
const ROAM_RADIUS_MIN = 4;
const ROAM_RADIUS_MAX = 17;

/** Start following the player when separation exceeds this (m). */
const FOLLOW_TRIGGER_DIST = 28;

/** Stop following and roam again when closer than this (m) — hysteresis vs FOLLOW_TRIGGER_DIST. */
const FOLLOW_RELEASE_DIST = 16;

const ROAM_MOVE_SPEED = 9;
const FOLLOW_MOVE_SPEED = 26;

const FACE_OFFSET = Math.PI * 1.12;

export class Dog {
    constructor(scene) {
        this.scene = scene;
        this.model = null;
        this.mixer = null;
        this.position = new THREE.Vector3(2.5, 0, 0.5);
        this._roamAnchor = new THREE.Vector3();
        this._roamTarget = new THREE.Vector3();
        this._hasRoamAnchor = false;
        /** @type {'roam' | 'follow'} */
        this._mode = 'roam';
        this._wanderTimer = 0;
        this._nextRoamPick = 0.6;
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

    _moveTowardXZ(target, delta, speed) {
        this._scratch.set(target.x - this.position.x, 0, target.z - this.position.z);
        const len = this._scratch.length();
        if (len < 0.04) return;
        this._scratch.multiplyScalar(1 / len);
        const step = Math.min(len, speed * delta);
        this.position.x += this._scratch.x * step;
        this.position.z += this._scratch.z * step;
    }

    _faceMovementOrTarget(target) {
        this._scratch.set(target.x - this.position.x, 0, target.z - this.position.z);
        if (this._scratch.lengthSq() < 1e-5) return;
        const yaw = Math.atan2(this._scratch.x, this._scratch.z);
        this.model.rotation.y = yaw + FACE_OFFSET;
    }

    async load() {
        const loader = new FBXLoader();
        try {
            const fbx = await loader.loadAsync(DOG_MODEL_URL);
            this.model = fbx;
            this.model.scale.setScalar(0.055);
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            if (fbx.animations && fbx.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                const action = this.mixer.clipAction(fbx.animations[0]);
                action.play();
            }
            this.scene.add(this.model);
            this.model.position.copy(this.position);
        } catch (err) {
            console.warn('Dog FBX missing or failed — add models/dog.fbx to public/models/', err);
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
        if (this.mixer) this.mixer.update(delta);
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
            this._moveTowardXZ(playerPos, delta, FOLLOW_MOVE_SPEED);
            this._faceMovementOrTarget(playerPos);
        } else {
            this._wanderTimer += delta;
            if (this._wanderTimer >= this._nextRoamPick) {
                this._wanderTimer = 0;
                this._nextRoamPick = 0.45 + Math.random() * 1.85;
                this._pickRoamTarget();
            }
            const dRoam = Math.hypot(
                this._roamTarget.x - this.position.x,
                this._roamTarget.z - this.position.z
            );
            if (dRoam < 1.1) {
                this._pickRoamTarget();
            }
            this._moveTowardXZ(this._roamTarget, delta, ROAM_MOVE_SPEED);
            this._faceMovementOrTarget(this._roamTarget);
        }

        this.position.y = terrainManager.getHeightAt(this.position.x, this.position.z);
        this.model.position.copy(this.position);
    }
}
