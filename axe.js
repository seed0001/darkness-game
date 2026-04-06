import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const MODEL_PATH = '/models/axe/';
const FILE_PREFIX = 'Meshy_AI_throwing_axe_very_de_0406140629_texture';

export class ThrowingAxe {
    constructor(scene, getPlayerPosition, getPlayerDirection) {
        this.scene = scene;
        this.getPlayerPosition = getPlayerPosition;
        this.getPlayerDirection = getPlayerDirection;
        
        this.model = null;
        this.isLoaded = false;
        
        this.state = 'held';
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.rotationSpeed = 15;
        
        this.throwSpeed = 80;
        this.gravity = 30;
        
        this.groundTimer = 0;
        this.retrieveTimeout = 120;
        this.dogRetrieving = false;
        
        this.character = null;

        this.readyPromise = this.load();
    }

    setCharacter(character) {
        this.character = character;
    }

    async load() {
        const loader = new FBXLoader();
        const textureLoader = new THREE.TextureLoader();

        try {
            const baseTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + '.png');
            const metallicTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + '_metallic.png');
            const normalTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + '_normal.png');
            const roughnessTexture = await textureLoader.loadAsync(MODEL_PATH + FILE_PREFIX + '_roughness.png');

            const fbx = await loader.loadAsync(MODEL_PATH + FILE_PREFIX + '.fbx');
            
            this.model = fbx;
            this.model.scale.set(0.02, 0.02, 0.02);
            
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.material = new THREE.MeshStandardMaterial({
                        map: baseTexture,
                        metalnessMap: metallicTexture,
                        normalMap: normalTexture,
                        roughnessMap: roughnessTexture,
                        metalness: 0.8,
                        roughness: 0.3
                    });
                }
            });

            this.scene.add(this.model);
            this.isLoaded = true;
            console.log('Throwing axe loaded');

        } catch (error) {
            console.error('Error loading axe:', error);
        }
    }

    attachToHand(handBone) {
        this.handBone = handBone;
    }

    throw(direction, playerPos) {
        if (this.state !== 'held' || !this.isLoaded) return false;
        
        this.state = 'flying';
        this.position.copy(playerPos);
        this.position.y += 4;
        
        this.velocity.copy(direction).normalize().multiplyScalar(this.throwSpeed);
        this.velocity.y += 15;
        
        this.groundTimer = 0;
        this.dogRetrieving = false;
        
        return true;
    }

    pickup() {
        if (this.state === 'ground' || this.dogRetrieving) {
            this.state = 'held';
            this.dogRetrieving = false;
            return true;
        }
        return false;
    }

    startDogRetrieval() {
        if (this.state === 'ground' && !this.dogRetrieving) {
            this.dogRetrieving = true;
            return this.position.clone();
        }
        return null;
    }

    dogDelivered() {
        this.state = 'held';
        this.dogRetrieving = false;
    }

    getState() {
        return this.state;
    }

    getPosition() {
        return this.position.clone();
    }

    isOnGround() {
        return this.state === 'ground';
    }

    shouldDogRetrieve() {
        return this.state === 'ground' && this.groundTimer >= this.retrieveTimeout && !this.dogRetrieving;
    }

    update(delta, terrainManager, characterPosition, characterRotation) {
        if (!this.isLoaded || !this.model) return;

        if (this.state === 'held') {
            let handPos = null;
            
            if (this.character && this.character.getRightHandWorldPosition) {
                handPos = this.character.getRightHandWorldPosition();
            }
            
            if (handPos) {
                const handBone = this.character.getRightHandBone();
                if (handBone) {
                    const quaternion = new THREE.Quaternion();
                    handBone.getWorldQuaternion(quaternion);
                    
                    const offset = new THREE.Vector3(0, 1.5, 0);
                    offset.applyQuaternion(quaternion);
                    
                    this.model.position.copy(handPos).add(offset);
                    this.model.setRotationFromQuaternion(quaternion);
                    this.model.rotateZ(Math.PI / 2);
                    this.model.rotateZ(Math.PI);
                } else {
                    this.model.position.copy(handPos);
                }
            } else {
                const pos = characterPosition.clone();
                pos.y += 4.2;
                
                const offset = new THREE.Vector3(1.5, 0, 1.2);
                offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), characterRotation);
                pos.add(offset);
                
                this.model.position.copy(pos);
                this.model.rotation.set(Math.PI / 2, characterRotation, 0);
            }
            
        } else if (this.state === 'flying') {
            this.velocity.y -= this.gravity * delta;
            this.position.addScaledVector(this.velocity, delta);
            
            this.model.rotation.x += this.rotationSpeed * delta;
            this.model.position.copy(this.position);
            
            let groundY = 0;
            if (terrainManager) {
                groundY = terrainManager.getHeightAt(this.position.x, this.position.z);
            }
            
            if (this.position.y <= groundY + 0.5) {
                this.position.y = groundY + 0.5;
                this.state = 'ground';
                this.groundTimer = 0;
                
                const angle = Math.atan2(this.velocity.x, this.velocity.z);
                this.model.rotation.set(-Math.PI / 6, angle, 0);
            }
            
        } else if (this.state === 'ground') {
            this.groundTimer += delta;
            
            let groundY = 0;
            if (terrainManager) {
                groundY = terrainManager.getHeightAt(this.position.x, this.position.z);
            }
            this.position.y = groundY + 0.5;
            this.model.position.copy(this.position);
        }
    }
}
