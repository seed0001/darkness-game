import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { LAKE_CX, LAKE_CZ } from './world.js';

/** @typedef {{ id: string, label: string, modelPath: string, filePrefix: string, useNormalMap?: boolean, modelScale?: number, animations: Record<string, string> }} CharacterProfile */

/** @type {Record<string, CharacterProfile>} */
export const CHARACTER_PROFILES = {
    hillbilly: {
        id: 'hillbilly',
        label: 'Hillbilly',
        modelPath: '/models/hillbilly/',
        filePrefix: 'Meshy_AI_t_pose_of_a_hillbilly_biped_',
        useNormalMap: false,
        modelScale: 0.05,
        animations: {
            idle: 'Animation_Idle_withSkin.fbx',
            walk: 'Animation_Walking_withSkin.fbx',
            run: 'Animation_Running_withSkin.fbx',
            runSlow: 'Animation_Run_03_withSkin.fbx',
            fall: 'Animation_Dead_withSkin.fbx'
        }
    },
    frontline_soldier: {
        id: 'frontline_soldier',
        label: 'Frontline Soldier',
        modelPath: '/models/frontline_soldier/',
        filePrefix: 'Meshy_AI_Frontline_Soldier_biped_',
        useNormalMap: true,
        modelScale: 0.05,
        animations: {
            idle: 'Animation_Idle_02_withSkin.fbx',
            walk: 'Animation_Walking_withSkin.fbx',
            run: 'Animation_Running_withSkin.fbx',
            runSlow: 'Animation_Running_withSkin.fbx',
            fall: 'Animation_Jump_with_Arms_Open_withSkin.fbx'
        }
    }
};

export const DEFAULT_CHARACTER_ID = 'hillbilly';

export const CHARACTER_STORAGE_KEY = 'darkness-character';

export class Character {
    constructor(scene) {
        this.scene = scene;
        this.model = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.currentState = 'idle';

        this.position = new THREE.Vector3(0, 0, 0);
        this.rotation = 0;
        this.targetRotation = 0;

        this.velocity = new THREE.Vector3();
        this.isLoaded = false;
        /** @type {string | null} */
        this.profileId = null;

        this.rightHand = null;
        /** Upper spine / chest bone for backpack attachment (if present in rig). */
        this.backBone = null;
        this.heldRock = null;
        this.heldStick = null;
        this.heightWorld = 1.65;

        /** Lying face-down at the lake (E to toggle when near water). */
        this.lyingProne = false;
        this.proneBellyClearance = 0.14;

        /** Resolved immediately; character mesh loads on demand via {@link loadCharacter}. */
        this.readyPromise = Promise.resolve();
    }

    /**
     * Loads or swaps the playable character. Call after the user picks a profile on the start screen.
     * @param {string} profileId key of {@link CHARACTER_PROFILES}
     */
    async loadCharacter(profileId) {
        const profile = CHARACTER_PROFILES[profileId];
        if (!profile) {
            throw new Error(`Unknown character profile: ${profileId}`);
        }

        if (this.isLoaded && this.profileId === profileId) {
            return;
        }

        this.disposeModel();

        const loader = new FBXLoader();
        const textureLoader = new THREE.TextureLoader();

        const baseTexture = await textureLoader.loadAsync(profile.modelPath + profile.filePrefix + 'texture_0.png');
        baseTexture.colorSpace = THREE.SRGBColorSpace;
        const metallicTexture = await textureLoader.loadAsync(profile.modelPath + profile.filePrefix + 'texture_0_metallic.png');
        const roughnessTexture = await textureLoader.loadAsync(profile.modelPath + profile.filePrefix + 'texture_0_roughness.png');

        /** @type {THREE.Texture | null} */
        let normalTexture = null;
        if (profile.useNormalMap) {
            try {
                normalTexture = await textureLoader.loadAsync(profile.modelPath + profile.filePrefix + 'texture_0_normal.png');
            } catch {
                normalTexture = null;
            }
        }

        const baseFBX = await loader.loadAsync(profile.modelPath + profile.filePrefix + 'Character_output.fbx');

        this.model = baseFBX;
        const sc = profile.modelScale ?? 0.05;
        this.model.scale.set(sc, sc, sc);

        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                const matOpts = {
                    map: baseTexture,
                    metalnessMap: metallicTexture,
                    roughnessMap: roughnessTexture,
                    metalness: 0.5,
                    roughness: 0.5
                };
                if (normalTexture) {
                    matOpts.normalMap = normalTexture;
                }
                child.material = new THREE.MeshStandardMaterial(matOpts);
            }

            if (child.isBone) {
                const name = child.name.toLowerCase();
                if (
                    (name.includes('hand') && name.includes('r')) ||
                    (name.includes('right') && name.includes('hand')) ||
                    name.includes('rhand') ||
                    name.includes('hand_r')
                ) {
                    this.rightHand = child;
                    console.log('Found right hand bone:', child.name);
                }
                if (name.includes('spine') && (name.includes('2') || name.includes('02'))) {
                    this.backBone = child;
                }
            }
        });
        if (!this.backBone) {
            this.model.traverse((child) => {
                if (child.isBone) {
                    const name = child.name.toLowerCase();
                    if (name.includes('spine') && (name.includes('1') || name.includes('01'))) {
                        this.backBone = child;
                    }
                }
            });
        }
        if (!this.backBone) {
            this.model.traverse((child) => {
                if (child.isBone && child.name.toLowerCase().includes('spine')) {
                    this.backBone = child;
                }
            });
        }
        if (this.backBone) {
            console.log('Back / spine bone for backpack:', this.backBone.name);
        }

        this.scene.add(this.model);

        this.mixer = new THREE.AnimationMixer(this.model);

        const fileToClip = new Map();
        for (const [name, file] of Object.entries(profile.animations)) {
            let clip;
            if (!fileToClip.has(file)) {
                const animFBX = await loader.loadAsync(profile.modelPath + profile.filePrefix + file);
                if (animFBX.animations.length === 0) continue;
                clip = animFBX.animations[0];
                fileToClip.set(file, clip);
            } else {
                clip = fileToClip.get(file).clone();
            }
            clip.name = name;
            this.animations[name] = this.mixer.clipAction(clip);

            if (name === 'fall') {
                this.animations[name].setLoop(THREE.LoopOnce);
                this.animations[name].clampWhenFinished = true;
            }
        }

        if (this.animations.idle) {
            this.animations.idle.play();
            this.currentAction = this.animations.idle;
        }

        this.model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(this.model);
        const size = new THREE.Vector3();
        bounds.getSize(size);
        this.heightWorld = Math.max(size.y, 0.01);

        this.profileId = profileId;
        this.isLoaded = true;
        console.log('Character loaded successfully:', profile.label);
    }

    disposeModel() {
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
            this.animations = {};
            this.currentAction = null;
            this.currentState = 'idle';
        }

        if (this.model) {
            this.heldRock = null;
            this.heldStick = null;
            this.lyingProne = false;

            this.model.removeFromParent();
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    const mat = child.material;
                    if (Array.isArray(mat)) {
                        mat.forEach((m) => m.dispose());
                    } else {
                        mat?.dispose();
                    }
                }
            });
            this.model = null;
        }

        this.rightHand = null;
        this.backBone = null;
        this.isLoaded = false;
        this.profileId = null;
    }

    setLyingProne(down) {
        if (!this.isLoaded || !this.model) return;
        if (down === this.lyingProne) return;
        if (down) {
            const p = this.position;
            this.targetRotation = Math.atan2(LAKE_CX - p.x, LAKE_CZ - p.z);
            this.rotation = this.targetRotation;
            this.setState('idle');
            this.lyingProne = true;
        } else {
            this.lyingProne = false;
            this.model.rotation.x = 0;
        }
    }

    isLyingProne() {
        return this.lyingProne;
    }

    setState(newState) {
        if (this.lyingProne) return;
        if (!this.isLoaded || newState === this.currentState) return;
        if (!this.animations[newState]) return;

        const prevAction = this.currentAction;
        const nextAction = this.animations[newState];

        if (prevAction) {
            prevAction.fadeOut(0.2);
        }

        nextAction.reset();
        nextAction.fadeIn(0.2);
        nextAction.play();

        this.currentAction = nextAction;
        this.currentState = newState;
    }

    setPosition(x, y, z) {
        this.position.set(x, y, z);
        if (this.model) {
            this.model.position.copy(this.position);
        }
    }

    setRotation(angle) {
        this.targetRotation = angle;
    }

    getPosition() {
        return this.position.clone();
    }

    getHeightWorld() {
        return this.heightWorld;
    }

    getRightHandBone() {
        return this.rightHand;
    }

    getRightHandWorldPosition() {
        if (this.rightHand) {
            const worldPos = new THREE.Vector3();
            this.rightHand.getWorldPosition(worldPos);
            return worldPos;
        }
        return null;
    }

    getHeldRock() {
        return this.heldRock;
    }

    /** Remove held rock from hand without placing in world (e.g. stow in backpack). */
    stripHeldRock() {
        if (!this.heldRock) return null;
        const m = this.heldRock;
        this.heldRock = null;
        m.removeFromParent();
        return m;
    }

    /** Remove held stick from hand without placing in world. */
    stripHeldStick() {
        if (!this.heldStick) return null;
        const m = this.heldStick;
        this.heldStick = null;
        m.removeFromParent();
        return m;
    }

    attachHeldRock(mesh) {
        if (!this.isLoaded || !mesh || this.heldRock || this.heldStick) return false;
        this.heldRock = mesh;
        mesh.removeFromParent();
        const rest = mesh.userData.restScale ?? mesh.scale.x;
        const inHand = rest * 0.52;
        if (this.rightHand) {
            this.rightHand.add(mesh);
            mesh.position.set(0.055, 0.085, 0.048);
            mesh.rotation.set(0.28, 0.42, 0.18);
            mesh.scale.setScalar(inHand);
        } else if (this.model) {
            this.model.add(mesh);
            mesh.position.set(0.32, 1.15, 0.12);
            mesh.rotation.set(0.2, 0.5, 0.15);
            mesh.scale.setScalar(inHand);
        } else {
            this.heldRock = null;
            return false;
        }
        if (mesh.material) {
            mesh.material.emissive.setHex(0x000000);
            mesh.material.emissiveIntensity = 0;
        }
        return true;
    }

    getHeldStick() {
        return this.heldStick;
    }

    attachHeldStick(mesh) {
        if (!this.isLoaded || !mesh || this.heldStick || this.heldRock) return false;
        if (!mesh.userData.pickupStick) return false;
        this.heldStick = mesh;
        mesh.removeFromParent();
        const rest = mesh.userData.restScale ?? mesh.scale.x;
        const inHand = rest * 0.42;
        if (this.rightHand) {
            this.rightHand.add(mesh);
            mesh.position.set(0.06, 0.12, 0.04);
            mesh.rotation.set(0.15, 0.55, 1.25);
            mesh.scale.setScalar(inHand);
        } else if (this.model) {
            this.model.add(mesh);
            mesh.position.set(0.38, 1.1, 0.15);
            mesh.rotation.set(0.2, 0.4, 1.1);
            mesh.scale.setScalar(inHand);
        } else {
            this.heldStick = null;
            return false;
        }
        if (mesh.material) {
            mesh.material.emissive.setHex(0x000000);
            mesh.material.emissiveIntensity = 0;
        }
        return true;
    }

    dropHeldStick(scene, world, camera) {
        if (!this.isLoaded || !this.heldStick || !scene || !world) return null;
        const mesh = this.heldStick;
        this.heldStick = null;
        mesh.removeFromParent();
        const rest = mesh.userData.restScale ?? 1;
        mesh.scale.setScalar(rest);

        const forward = new THREE.Vector3(0, 0, -1);
        if (camera) forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        else forward.normalize();

        const p = this.position.clone().addScaledVector(forward, 1.05);
        p.y = world.getHeightAt(p.x, p.z) + 0.14;
        mesh.position.copy(p);
        mesh.rotation.set(
            Math.PI / 2 + (Math.random() - 0.5) * 0.15,
            this.rotation + (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.2
        );
        scene.add(mesh);
        return mesh;
    }

    dropHeldRock(scene, world, camera) {
        if (!this.isLoaded || !this.heldRock || !scene || !world) return null;
        const mesh = this.heldRock;
        this.heldRock = null;
        mesh.removeFromParent();
        const rest = mesh.userData.restScale ?? 1;
        mesh.scale.setScalar(rest);

        const forward = new THREE.Vector3(0, 0, -1);
        if (camera) forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        else forward.normalize();

        const p = this.position.clone().addScaledVector(forward, 0.95);
        p.y = world.getHeightAt(p.x, p.z) + 0.12;
        mesh.position.copy(p);
        mesh.rotation.set(
            (Math.random() - 0.5) * 0.4,
            this.rotation + (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.4
        );
        scene.add(mesh);
        return mesh;
    }

    update(delta, terrainManager) {
        if (!this.isLoaded || !this.model) return;

        if (this.mixer) {
            this.mixer.update(delta);
        }

        if (this.lyingProne) {
            if (terrainManager) {
                const terrainHeight = terrainManager.getHeightAt(this.position.x, this.position.z);
                this.position.y = terrainHeight + this.proneBellyClearance;
            }
            this.model.rotation.y = this.rotation;
            this.model.rotation.x = Math.PI / 2 * 0.97;
            this.model.position.copy(this.position);
            return;
        }

        const rotationSpeed = 10;
        let rotationDiff = this.targetRotation - this.rotation;

        while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
        while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

        this.rotation += rotationDiff * Math.min(1, rotationSpeed * delta);
        this.model.rotation.y = this.rotation;
        this.model.rotation.x = 0;

        if (terrainManager) {
            const terrainHeight = terrainManager.getHeightAt(this.position.x, this.position.z);
            this.position.y = terrainHeight;
        }

        this.model.position.copy(this.position);
    }
}
