import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   modelPath: string,
 *   filePrefix: string,
 *   useNormalMap?: boolean,
 *   modelScale?: number,
 *   animations: Record<string, string>,
 *   animationUrls?: Record<string, string>
 * }} CharacterProfile
 * `animationUrls` — optional full URL from site root (e.g. `/models/.../file.fbx`) for clips that are not `modelPath + filePrefix + animations[name]`.
 */

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
            fall: 'Animation_Jump_with_Arms_Open_withSkin.fbx',
            jump: 'Animation_Jump_with_Arms_Open_withSkin.fbx'
        },
        animationUrls: {
            jump: '/models/frontline_soldier/Meshy_AI_Frontline_Soldier_biped_Animation_Regular_Jump_withSkin.fbx'
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
        this.isGrounded = true;
        this.isJumpAnimating = false;
        this.jumpTimer = 0;
        this.jumpDuration = 0.72;
        /** @type {string | null} */
        this.profileId = null;

        this.rightHand = null;
        /** Upper spine / chest bone for backpack attachment (if present in rig). */
        this.backBone = null;
        this.heldRock = null;
        this.heldStick = null;
        this.heldFood = null;
        this.heightWorld = 1.65;

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
            const defaultUrl = profile.modelPath + profile.filePrefix + file;
            const overrideUrl = profile.animationUrls?.[name];
            const cacheKey = overrideUrl ?? file;

            if (!fileToClip.has(cacheKey)) {
                let animFBX = null;
                const tryLoad = async (url) => loader.loadAsync(url);

                if (overrideUrl) {
                    try {
                        animFBX = await tryLoad(overrideUrl);
                    } catch (e) {
                        const alt =
                            name === 'jump'
                                ? [
                                      '/Meshy_AI_Frontline_Soldier_biped/Meshy_AI_Frontline_Soldier_biped_Animation_Regular_Jump_withSkin.fbx',
                                      '/models/frontline_soldier/Meshy_AI_Frontline_Soldier_biped_Animation_Jump_withSkin.fbx',
                                      '/Meshy_AI_Frontline_Soldier_biped/Meshy_AI_Frontline_Soldier_biped_Animation_Jump_withSkin.fbx',
                                      defaultUrl
                                  ]
                                : [defaultUrl];
                        for (let i = 0; i < alt.length && !animFBX; i++) {
                            try {
                                animFBX = await tryLoad(alt[i]);
                            } catch {
                                /* try next */
                            }
                        }
                        if (!animFBX) {
                            console.warn('Animation override failed:', overrideUrl, e);
                            animFBX = await tryLoad(defaultUrl);
                        }
                    }
                } else {
                    animFBX = await tryLoad(defaultUrl);
                }

                if (!animFBX || animFBX.animations.length === 0) continue;
                clip = animFBX.animations[0];
                fileToClip.set(cacheKey, clip);
            } else {
                clip = fileToClip.get(cacheKey).clone();
            }
            clip.name = name;
            this.animations[name] = this.mixer.clipAction(clip);

            if (name === 'fall' || name === 'jump') {
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
            this.heldFood = null;

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

    tryJump() {
        if (!this.isLoaded) return false;
        if (!this.isGrounded || this.isJumpAnimating) return false;
        this.isJumpAnimating = true;
        this.jumpTimer = this.jumpDuration;
        this.isGrounded = false;
        if (this.animations.jump) {
            const action = this.animations.jump;
            action.reset();
            action.timeScale = 1.0;
            action.play();
            const clipDur = action.getClip()?.duration;
            if (clipDur && Number.isFinite(clipDur)) {
                this.jumpDuration = Math.max(0.35, Math.min(1.5, clipDur));
                this.jumpTimer = this.jumpDuration;
            }
            this.setState('jump');
        } else if (this.animations.fall) {
            this.setState('fall');
        }
        return true;
    }

    setState(newState) {
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
        if (!this.isLoaded || !mesh || this.heldRock || this.heldStick || this.heldFood) return false;
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
        if (!this.isLoaded || !mesh || this.heldStick || this.heldRock || this.heldFood) return false;
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

    getHeldFood() {
        return this.heldFood;
    }

    stripHeldFood() {
        if (!this.heldFood) return null;
        const m = this.heldFood;
        this.heldFood = null;
        m.removeFromParent();
        return m;
    }

    attachHeldFood(mesh) {
        if (!this.isLoaded || !mesh || this.heldFood || this.heldRock || this.heldStick) return false;
        if (!mesh.userData.pickupFood) return false;
        this.heldFood = mesh;
        mesh.removeFromParent();
        const rest = mesh.userData.restScale ?? mesh.scale.x;
        const inHand = rest * 0.48;
        if (this.rightHand) {
            this.rightHand.add(mesh);
            mesh.position.set(0.05, 0.1, 0.05);
            mesh.rotation.set(0.2, 0.35, -0.25);
            mesh.scale.setScalar(inHand);
        } else if (this.model) {
            this.model.add(mesh);
            mesh.position.set(0.35, 1.12, 0.12);
            mesh.rotation.set(0.15, 0.4, -0.2);
            mesh.scale.setScalar(inHand);
        } else {
            this.heldFood = null;
            return false;
        }
        return true;
    }

    dropHeldFood(scene, world, camera) {
        if (!this.isLoaded || !this.heldFood || !scene || !world) return null;
        const mesh = this.heldFood;
        this.heldFood = null;
        mesh.removeFromParent();
        const rest = mesh.userData.restScale ?? 1;
        mesh.scale.setScalar(rest);

        const forward = new THREE.Vector3(0, 0, -1);
        if (camera) forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        else forward.normalize();

        const p = this.position.clone().addScaledVector(forward, 1.0);
        p.y = world.getHeightAt(p.x, p.z) + 0.1;
        mesh.position.copy(p);
        mesh.rotation.set(
            (Math.random() - 0.5) * 0.5,
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

        const rotationSpeed = 10;
        let rotationDiff = this.targetRotation - this.rotation;

        while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
        while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

        this.rotation += rotationDiff * Math.min(1, rotationSpeed * delta);
        this.model.rotation.y = this.rotation;
        this.model.rotation.x = 0;

        if (this.isJumpAnimating) {
            this.jumpTimer -= delta;
            if (this.jumpTimer <= 0) {
                this.isJumpAnimating = false;
                this.isGrounded = true;
                this.setState('idle');
            }
        }

        if (terrainManager) {
            const terrainHeight = terrainManager.getHeightAt(this.position.x, this.position.z);
            this.position.y = terrainHeight;
        }

        this.model.position.copy(this.position);
    }
}
