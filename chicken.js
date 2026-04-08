import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class Chicken {
    constructor(scene, position) {
        this.scene = scene;
        this.model = null;
        this.mixer = null;
        this.isLoaded = false;
        
        this.position = position.clone();
        this.velocity = new THREE.Vector3();
        
        this.state = 'idle';
        this.idleTimer = Math.random() * 3 + 1;
        this.wanderTarget = new THREE.Vector3();
        
        this.moveSpeed = 8;
        this.fleeSpeed = 20;
        this.wanderRadius = 15;
        
        this.isCaught = false;
        this.isDropped = false;
        this.despawnTimer = 0;
        /** Set when killed with axe; spawner removes on next update tick. */
        this._removed = false;

        this.load();
    }

    async load() {
        const loader = new FBXLoader();

        try {
            const fbx = await loader.loadAsync('/models/chicken.fbx');
            
            this.model = fbx;
            this.model.scale.set(0.02, 0.02, 0.02);
            this.model.position.copy(this.position);
            
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

        } catch (error) {
            console.error('Error loading chicken:', error);
        }
    }

    getCaught() {
        this.isCaught = true;
        this.state = 'caught';
    }

    drop(position) {
        this.isCaught = false;
        this.isDropped = true;
        this.position.copy(position);
        this.state = 'dropped';
        this.despawnTimer = 10;
    }

    /**
     * Axe kill: strip model and mark for removal. Returns world position for meat drop, or null.
     * @returns {THREE.Vector3 | null}
     */
    kill() {
        if (this._removed || !this.isLoaded || !this.model) return null;
        this._removed = true;
        const pos = this.position.clone();
        this.model.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            const m = o.material;
            if (m) {
                if (Array.isArray(m)) m.forEach((x) => x.dispose());
                else m.dispose();
            }
        });
        this.scene.remove(this.model);
        this.model = null;
        this.mixer = null;
        return pos;
    }

    checkDogProximity(dogPosition) {
        if (!dogPosition || this.isCaught || this.isDropped) return;

        const dist = this.position.distanceTo(dogPosition);
        if (dist < 20) {
            this.state = 'fleeing';
            const fleeDir = new THREE.Vector3();
            fleeDir.subVectors(this.position, dogPosition);
            fleeDir.y = 0;
            fleeDir.normalize();
            
            this.wanderTarget.set(
                this.position.x + fleeDir.x * 30,
                0,
                this.position.z + fleeDir.z * 30
            );
        }
    }

    update(delta, terrainManager, dogPosition) {
        if (this._removed) return true;
        if (!this.isLoaded || !this.model) return false;

        if (this.mixer) {
            this.mixer.update(delta);
        }

        if (this.isDropped) {
            this.despawnTimer -= delta;
            if (this.despawnTimer <= 0) {
                this.scene.remove(this.model);
                return true;
            }
            
            if (terrainManager) {
                const terrainHeight = terrainManager.getHeightAt(this.position.x, this.position.z);
                this.position.y = terrainHeight;
            }
            this.model.position.copy(this.position);
            return false;
        }

        if (this.isCaught) {
            return false;
        }

        if (dogPosition) {
            this.checkDogProximity(dogPosition);
        }

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
            
            if (distToTarget < 2) {
                this.state = 'idle';
                this.idleTimer = Math.random() * 3 + 1;
            } else {
                direction.normalize();
                
                const speed = this.state === 'fleeing' ? this.fleeSpeed : this.moveSpeed;
                
                this.position.x += direction.x * speed * delta;
                this.position.z += direction.z * speed * delta;
                
                const targetAngle = Math.atan2(direction.x, direction.z);
                this.model.rotation.y = targetAngle;
            }
        }

        if (terrainManager) {
            const terrainHeight = terrainManager.getHeightAt(this.position.x, this.position.z);
            this.position.y = terrainHeight;
        }
        
        this.model.position.copy(this.position);
        return false;
    }

    dispose() {
        if (this.model) {
            this.scene.remove(this.model);
        }
    }
}

export class ChickenSpawner {
    constructor(scene, getPlayerPosition) {
        this.scene = scene;
        this.getPlayerPosition = getPlayerPosition;
        this.chickens = [];
        this.maxChickens = 8;
        this.spawnTimer = 0;
        this.spawnInterval = 5;
        this.spawnRadius = 60;
        this.minSpawnDist = 30;
        /** When true, spawns chickens over time up to maxChickens (enabled from game options). */
        this.autoSpawn = true;
    }

    getChickens() {
        return this.chickens;
    }

    update(delta, terrainManager, dogPosition) {
        this.spawnTimer += delta;
        
        const activeChickens = this.chickens.filter(
            (c) => !c._removed && (!c.isDropped || c.despawnTimer > 0)
        );
        
        if (
            this.autoSpawn &&
            this.spawnTimer >= this.spawnInterval &&
            activeChickens.length < this.maxChickens
        ) {
            this.spawnTimer = 0;
            this.spawnChicken();
        }

        for (let i = this.chickens.length - 1; i >= 0; i--) {
            const chicken = this.chickens[i];
            const shouldRemove = chicken.update(delta, terrainManager, dogPosition);
            
            if (shouldRemove) {
                this.chickens.splice(i, 1);
            }
        }
    }

    spawnChicken() {
        const playerPos = this.getPlayerPosition();
        const angle = Math.random() * Math.PI * 2;
        const dist = this.minSpawnDist + Math.random() * (this.spawnRadius - this.minSpawnDist);
        
        const spawnPos = new THREE.Vector3(
            playerPos.x + Math.cos(angle) * dist,
            0,
            playerPos.z + Math.sin(angle) * dist
        );

        const chicken = new Chicken(this.scene, spawnPos);
        this.chickens.push(chicken);
    }
}
