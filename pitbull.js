import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const MODEL_PATH = '/models/pitbull/';
const FILE_PREFIX = 'Meshy_AI_a_buff_pitbull_that_i_biped_';

export class Pitbull {
    constructor(scene, getPlayerPosition) {
        this.scene = scene;
        this.getPlayerPosition = getPlayerPosition;
        this.model = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.currentState = 'idle';
        this.isLoaded = false;
        
        this.position = new THREE.Vector3(3, 0, 3);
        this.rotation = 0;
        this.targetRotation = 0;
        
        this.state = 'idle';
        this.idleTimer = 0;
        this.wanderTarget = new THREE.Vector3();
        this.targetPosition = new THREE.Vector3();
        
        this.followDistance = 12;
        this.maxFollowDistance = 25;
        this.wanderRadius = 8;
        this.moveSpeed = 12;
        this.runSpeed = 30;
        
        this.load();
    }

    async load() {
        const loader = new FBXLoader();
        const textureLoader = new THREE.TextureLoader();

        try {
            const baseTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + 'texture_0.png');
            const metallicTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + 'texture_0_metallic.png');
            const normalTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + 'texture_0_normal.png');
            const roughnessTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + 'texture_0_roughness.png');

            const baseFBX = await loader.loadAsync(MODEL_PATH + FILE_PREFIX + 'Character_output.fbx');
            
            this.model = baseFBX;
            this.model.scale.set(0.04, 0.04, 0.04);
            
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.material = new THREE.MeshStandardMaterial({
                        map: baseTexture,
                        metalnessMap: metallicTexture,
                        normalMap: normalTexture,
                        roughnessMap: roughnessTexture,
                        metalness: 0.3,
                        roughness: 0.7
                    });
                }
            });

            this.scene.add(this.model);
            
            this.mixer = new THREE.AnimationMixer(this.model);

            const animFBX = await loader.loadAsync(MODEL_PATH + FILE_PREFIX + 'Meshy_AI_Meshy_Merged_Animations.fbx');
            
            if (animFBX.animations.length > 0) {
                this.animations.run = this.mixer.clipAction(animFBX.animations[0]);
                if (animFBX.animations[1]) {
                    this.animations.walk = this.mixer.clipAction(animFBX.animations[1]);
                }
                if (animFBX.animations[2]) {
                    this.animations.idle = this.mixer.clipAction(animFBX.animations[2]);
                }
                
                if (!this.animations.idle) {
                    this.animations.idle = this.animations.walk || this.animations.run;
                }
            }

            if (this.animations.idle) {
                this.animations.idle.play();
                this.currentAction = this.animations.idle;
            }

            this.isLoaded = true;
            console.log('Pitbull loaded successfully');

        } catch (error) {
            console.error('Error loading pitbull:', error);
        }
    }

    setAnimState(newState) {
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

    update(delta, terrainManager, playerIsMoving) {
        if (!this.isLoaded || !this.model) return;

        if (this.mixer) {
            this.mixer.update(delta);
        }

        const playerPos = this.getPlayerPosition();
        const distToPlayer = this.position.distanceTo(playerPos);

        if (distToPlayer > this.maxFollowDistance) {
            this.state = 'following';
            this.targetPosition.copy(playerPos);
        } else if (this.state === 'following' && distToPlayer < this.followDistance) {
            this.state = 'idle';
            this.idleTimer = Math.random() * 2 + 1;
        } else if (this.state === 'idle') {
            if (playerIsMoving && distToPlayer > this.followDistance + 2) {
                this.state = 'following';
                this.targetPosition.copy(playerPos);
            } else {
                this.idleTimer -= delta;
                if (this.idleTimer <= 0) {
                    this.state = 'wandering';
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * this.wanderRadius;
                    this.wanderTarget.set(
                        playerPos.x + Math.cos(angle) * dist,
                        0,
                        playerPos.z + Math.sin(angle) * dist
                    );
                    this.targetPosition.copy(this.wanderTarget);
                }
            }
        } else if (this.state === 'wandering') {
            const distToTarget = this.position.distanceTo(this.wanderTarget);
            if (distToTarget < 2) {
                this.state = 'idle';
                this.idleTimer = Math.random() * 2 + 1;
            }
            
            if (distToPlayer > this.maxFollowDistance) {
                this.state = 'following';
                this.targetPosition.copy(playerPos);
            }
        }

        if (this.state === 'following' || this.state === 'wandering') {
            const direction = new THREE.Vector3();
            direction.subVectors(this.targetPosition, this.position);
            direction.y = 0;
            
            const distToTarget = direction.length();
            
            if (distToTarget > 1) {
                direction.normalize();
                
                let speed, animState;
                if (this.state === 'following') {
                    speed = this.runSpeed;
                    animState = 'run';
                } else {
                    speed = this.moveSpeed;
                    animState = 'walk';
                }
                
                this.position.x += direction.x * speed * delta;
                this.position.z += direction.z * speed * delta;
                
                this.targetRotation = Math.atan2(direction.x, direction.z);
                this.setAnimState(animState);
            } else {
                this.state = 'idle';
                this.idleTimer = Math.random() * 2 + 1;
                this.setAnimState('idle');
            }
        } else {
            this.setAnimState('idle');
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
