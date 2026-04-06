import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const MODEL_PATH = '/models/hillbilly/';
const FILE_PREFIX = 'Meshy_AI_t_pose_of_a_hillbilly_biped_';

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
        
        this.rightHand = null;
        
        this.load();
    }

    async load() {
        const loader = new FBXLoader();
        const textureLoader = new THREE.TextureLoader();

        try {
            const baseTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + 'texture_0.png');
            const metallicTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + 'texture_0_metallic.png');
            const roughnessTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + 'texture_0_roughness.png');

            const baseFBX = await loader.loadAsync(MODEL_PATH + FILE_PREFIX + 'Character_output.fbx');
            
            this.model = baseFBX;
            this.model.scale.set(0.05, 0.05, 0.05);
            
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.material = new THREE.MeshStandardMaterial({
                        map: baseTexture,
                        metalnessMap: metallicTexture,
                        roughnessMap: roughnessTexture,
                        metalness: 0.5,
                        roughness: 0.5
                    });
                }
                
                if (child.isBone) {
                    const name = child.name.toLowerCase();
                    if (name.includes('hand') && name.includes('r') || 
                        name.includes('right') && name.includes('hand') ||
                        name.includes('rhand') || name.includes('hand_r')) {
                        this.rightHand = child;
                        console.log('Found right hand bone:', child.name);
                    }
                }
            });

            this.scene.add(this.model);
            
            this.mixer = new THREE.AnimationMixer(this.model);

            const animationFiles = {
                idle: 'Animation_Idle_withSkin.fbx',
                walk: 'Animation_Walking_withSkin.fbx',
                run: 'Animation_Running_withSkin.fbx',
                runSlow: 'Animation_Run_03_withSkin.fbx',
                fall: 'Animation_Dead_withSkin.fbx'
            };

            for (const [name, file] of Object.entries(animationFiles)) {
                const animFBX = await loader.loadAsync(MODEL_PATH + FILE_PREFIX + file);
                if (animFBX.animations.length > 0) {
                    const clip = animFBX.animations[0];
                    clip.name = name;
                    this.animations[name] = this.mixer.clipAction(clip);
                    
                    if (name === 'fall') {
                        this.animations[name].setLoop(THREE.LoopOnce);
                        this.animations[name].clampWhenFinished = true;
                    }
                }
            }

            if (this.animations.idle) {
                this.animations.idle.play();
                this.currentAction = this.animations.idle;
            }

            this.isLoaded = true;
            console.log('Character loaded successfully');

        } catch (error) {
            console.error('Error loading character:', error);
        }
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

        if (terrainManager) {
            const terrainHeight = terrainManager.getHeightAt(this.position.x, this.position.z);
            this.position.y = terrainHeight;
        }
        
        this.model.position.copy(this.position);
    }
}
