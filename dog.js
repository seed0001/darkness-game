import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class Dog {
    constructor(scene, getPlayerPosition) {
        this.scene = scene;
        this.getPlayerPosition = getPlayerPosition;
        this.model = null;
        this.mixer = null;
        this.isLoaded = false;
        
        this.position = new THREE.Vector3(5, 0, 5);
        this.velocity = new THREE.Vector3();
        this.targetPosition = new THREE.Vector3();
        
        this.state = 'idle';
        this.idleTimer = 0;
        this.wanderTarget = new THREE.Vector3();
        
        this.followDistance = 8;
        this.maxFollowDistance = 25;
        this.wanderRadius = 10;
        this.moveSpeed = 15;
        this.runSpeed = 35;
        
        this.axe = null;
        this.axeTarget = null;
        this.hasAxe = false;
        
        this.load();
    }

    setAxe(axe) {
        this.axe = axe;
    }

    startAxeRetrieval(axePosition) {
        this.state = 'fetching_axe';
        this.axeTarget = axePosition.clone();
        this.targetPosition.copy(axePosition);
        this.hasAxe = false;
    }

    async load() {
        const loader = new FBXLoader();

        try {
            const fbx = await loader.loadAsync('/models/dog.fbx');
            
            this.model = fbx;
            this.model.scale.set(0.03, 0.03, 0.03);
            
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            this.scene.add(this.model);
            
            if (fbx.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                const action = this.mixer.clipAction(fbx.animations[0]);
                action.play();
            }

            this.isLoaded = true;
            console.log('Dog loaded successfully');

        } catch (error) {
            console.error('Error loading dog:', error);
        }
    }

    update(delta, terrainManager) {
        if (!this.isLoaded || !this.model) return;

        if (this.mixer) {
            this.mixer.update(delta);
        }

        const playerPos = this.getPlayerPosition();
        const distToPlayer = this.position.distanceTo(playerPos);

        if (this.state === 'fetching_axe') {
            const distToAxe = this.position.distanceTo(this.axeTarget);
            if (distToAxe < 2) {
                this.hasAxe = true;
                this.state = 'returning_axe';
                this.targetPosition.copy(playerPos);
            }
        } else if (this.state === 'returning_axe') {
            this.targetPosition.copy(playerPos);
            if (distToPlayer < 3) {
                this.hasAxe = false;
                if (this.axe) {
                    this.axe.dogDelivered();
                }
                this.state = 'idle';
                this.idleTimer = 2;
            }
        } else if (distToPlayer > this.maxFollowDistance) {
            this.state = 'following';
            this.targetPosition.copy(playerPos);
        } else if (this.state === 'following' && distToPlayer < this.followDistance) {
            this.state = 'idle';
            this.idleTimer = Math.random() * 3 + 1;
        } else if (this.state === 'idle') {
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
        } else if (this.state === 'wandering') {
            const distToTarget = this.position.distanceTo(this.wanderTarget);
            if (distToTarget < 2) {
                this.state = 'idle';
                this.idleTimer = Math.random() * 3 + 1;
            }
            
            if (distToPlayer > this.maxFollowDistance) {
                this.state = 'following';
                this.targetPosition.copy(playerPos);
            }
        }

        if (this.state !== 'idle') {
            const direction = new THREE.Vector3();
            direction.subVectors(this.targetPosition, this.position);
            direction.y = 0;
            
            if (direction.length() > 0.5) {
                direction.normalize();
                
                const isRunning = this.state === 'following' || 
                                  this.state === 'fetching_axe' || 
                                  this.state === 'returning_axe';
                const speed = isRunning ? this.runSpeed : this.moveSpeed;
                
                this.position.x += direction.x * speed * delta;
                this.position.z += direction.z * speed * delta;
                
                const targetAngle = Math.atan2(direction.x, direction.z) + Math.PI;
                this.model.rotation.y = targetAngle;
            }
        }

        if (terrainManager) {
            const terrainHeight = terrainManager.getHeightAt(this.position.x, this.position.z);
            this.position.y = terrainHeight;
        }
        
        this.model.position.copy(this.position);
    }
}
