import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class Drone {
    constructor(scene, audioListener) {
        this.scene = scene;
        this.audioListener = audioListener;
        this.loader = new FBXLoader();
        this.textureLoader = new THREE.TextureLoader();
        this.audioLoader = new THREE.AudioLoader();
        this.model = null;
        
        // Flight parameters
        this.height = 35;
        this.speed = 45;
        
        // Waypoint patrol system
        this.currentWaypoint = new THREE.Vector3(0, this.height, 0);
        this.nextWaypoint = new THREE.Vector3(0, this.height, 0);
        this.waypointProgress = 0;
        this.patrolRadius = 200;
        this.minWaypointDist = 80;
        this.maxWaypointDist = 250;
        
        // Combat state
        this.isCrashing = false;
        this.crashVelocity = new THREE.Vector3();
        this.isDestroyed = false;
        this.respawnTimer = 0;
        
        // Searchlight parameters
        this.searchLights = [];
        this.searchTargets = [];
        
        this.isVisible = false;
        
        this.loadModel();
    }

    loadModel() {
        const path = '/drone/';
        const prefix = 'Meshy_AI_a_drone_that_is_half__0406061812_texture';
        
        // Load PBR Textures
        const baseColor = this.textureLoader.load(`${path}${prefix}.png`);
        baseColor.colorSpace = THREE.SRGBColorSpace;
        const normalMap = this.textureLoader.load(`${path}${prefix}_normal.png`);
        const metallicMap = this.textureLoader.load(`${path}${prefix}_metallic.png`);
        const roughnessMap = this.textureLoader.load(`${path}${prefix}_roughness.png`);

        this.loader.load(`${path}${prefix}.fbx`, (fbx) => {
            this.model = fbx;
            
            // Apply Realistic PBR Material
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: baseColor,
                        normalMap: normalMap,
                        metalnessMap: metallicMap,
                        roughnessMap: roughnessMap,
                        metalness: 1.0,
                        roughness: 0.5
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // Add Dual "Eye" Searchlights
            this.initSearchlights();

            // Initialize Spatial Audio
            this.initAudio();

            this.model.scale.set(0.1, 0.1, 0.1);
            this.scene.add(this.model);
            this.isVisible = true;
            console.log('AI Drone loaded with Spatial Audio and Searchlights');
        });
    }

    initAudio() {
        if (!this.audioListener) return;

        // Create PositionalAudio child for the drone
        this.sound = new THREE.PositionalAudio(this.audioListener);
        
        // Load hovering sound
        this.audioLoader.load('/audio/drone_hover.mp3', (buffer) => {
            if (this.sound) {
                this.sound.setBuffer(buffer);
                this.sound.setLoop(true);
                this.sound.setVolume(1.0);
                this.sound.setRefDistance(20); 
                this.sound.setRolloffFactor(2.5); 
                this.sound.play();
                console.log('Drone spatial audio started');
            }
        });

        // Attach audio source to the drone model
        this.model.add(this.sound);
    }

    initSearchlights() {
        for (let i = 0; i < 2; i++) {
            const light = new THREE.SpotLight(0xffffff, 20, 150, Math.PI / 6, 0.5, 1);
            light.castShadow = true;
            
            const target = new THREE.Object3D();
            this.scene.add(target);
            light.target = target;
            
            this.scene.add(light);
            this.searchLights.push(light);
            this.searchTargets.push(target);
        }
    }

    pickNewWaypoint(playerPosition) {
        const angle = Math.random() * Math.PI * 2;
        const dist = this.minWaypointDist + Math.random() * (this.maxWaypointDist - this.minWaypointDist);
        
        // Pick a random point, sometimes near player, sometimes far
        const centerX = Math.random() > 0.3 ? playerPosition.x : this.model.position.x;
        const centerZ = Math.random() > 0.3 ? playerPosition.z : this.model.position.z;
        
        this.nextWaypoint.set(
            centerX + Math.cos(angle) * dist,
            this.height,
            centerZ + Math.sin(angle) * dist
        );
    }

    takeHit() {
        if (this.isCrashing || this.isDestroyed) return;
        this.isCrashing = true;
        this.crashVelocity.set(
            (Math.random() - 0.5) * 0.5,
            -0.5,
            (Math.random() - 0.5) * 0.5
        );
        
        // Kill lights immediately
        this.searchLights.forEach(light => light.intensity = 0);
        if (this.sound) this.sound.stop();
        console.log('Drone hit! Crashing...');
    }

    respawn() {
        this.isCrashing = false;
        this.isDestroyed = false;
        this.respawnTimer = 0;
        this.isVisible = true;
        this.model.scale.set(0.1, 0.1, 0.1);
        this.model.visible = true;
        this.searchLights.forEach(light => {
            light.intensity = 20;
            light.visible = true;
        });
        if (this.sound) this.sound.play();
        console.log('Drone respawned');
    }

    update(delta, playerPosition) {
        if (!this.model) return;

        if (this.isDestroyed) {
            this.respawnTimer += delta;
            if (this.respawnTimer >= 30) {
                this.respawn();
            }
            return;
        }

        if (this.isCrashing) {
            // Crash Physics
            this.model.position.addScaledVector(this.crashVelocity, delta * 100);
            this.model.rotation.x += delta * 10;
            this.model.rotation.z += delta * 5;
            this.crashVelocity.y -= delta * 0.5; // Gravity

            if (this.model.position.y <= 0) {
                this.model.position.y = 0;
                this.isCrashing = false;
                this.isDestroyed = true;
                this.model.visible = false;
                this.searchLights.forEach(light => light.visible = false);
            }
            return;
        }

        // Tracking state toggle
        if (!this.lastStateChange) this.lastStateChange = 0;
        this.lastStateChange += delta;

        if (this.lastStateChange > 5 + Math.random() * 10) {
            this.isTracking = !this.isTracking;
            this.lastStateChange = 0;
        }

        // Waypoint patrol system
        const distToWaypoint = this.model.position.distanceTo(this.nextWaypoint);
        
        if (distToWaypoint < 15 || !this.waypointInitialized) {
            this.waypointInitialized = true;
            this.currentWaypoint.copy(this.model.position);
            this.pickNewWaypoint(playerPosition);
            this.waypointProgress = 0;
        }

        // Move toward waypoint
        const direction = new THREE.Vector3();
        direction.subVectors(this.nextWaypoint, this.model.position);
        direction.normalize();
        
        this.model.position.addScaledVector(direction, this.speed * delta);
        
        // Add some height variation based on time
        const heightVariation = Math.sin(Date.now() * 0.001) * 5;
        this.model.position.y = this.height + heightVariation;

        // Face movement direction
        const lookTarget = this.model.position.clone().add(direction.multiplyScalar(10));
        lookTarget.y = this.model.position.y;
        this.model.lookAt(lookTarget);

        // Update searchlights
        const time = Date.now() * 0.001;
        this.searchLights.forEach((light, i) => {
            const offset = new THREE.Vector3(i === 0 ? -2 : 2, -1, 5);
            offset.applyQuaternion(this.model.quaternion);
            light.position.copy(this.model.position).add(offset);
            
            if (this.isTracking) {
                light.target.position.lerp(playerPosition, 0.1);
            } else {
                const sweepX = Math.sin(time * 2 + i * Math.PI) * 30;
                const sweepZ = Math.cos(time * 1.5 + i * Math.PI) * 30;
                const searchTarget = new THREE.Vector3(sweepX, -this.height, 40 + sweepZ);
                searchTarget.applyQuaternion(this.model.quaternion);
                light.target.position.copy(light.position).add(searchTarget);
            }
        });
    }
}
