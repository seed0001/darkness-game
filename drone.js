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
        this.angle = 0;
        this.radius = 120;
        this.height = 35;
        this.speed = 0.4;
        
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

        // Standard AI Update
        if (!this.lastStateChange) this.lastStateChange = 0;
        this.lastStateChange += delta;

        if (this.lastStateChange > 5 + Math.random() * 10) {
            this.isTracking = !this.isTracking;
            this.lastStateChange = 0;
        }

        this.angle += delta * this.speed;
        const targetX = playerPosition.x + Math.cos(this.angle) * this.radius;
        const targetZ = playerPosition.z + Math.sin(this.angle) * this.radius;
        const targetY = this.height + Math.sin(this.angle * 0.8) * 5;

        const targetPos = new THREE.Vector3(targetX, targetY, targetZ);
        this.model.position.lerp(targetPos, 0.03);

        const nextAngle = this.angle + 0.1;
        const lookAtPos = new THREE.Vector3(
            playerPosition.x + Math.cos(nextAngle) * this.radius,
            targetY,
            playerPosition.z + Math.sin(nextAngle) * this.radius
        );
        this.model.lookAt(lookAtPos);

        this.searchLights.forEach((light, i) => {
            const offset = new THREE.Vector3(i === 0 ? -2 : 2, -1, 5);
            offset.applyQuaternion(this.model.quaternion);
            light.position.copy(this.model.position).add(offset);
            
            if (this.isTracking) {
                light.target.position.lerp(playerPosition, 0.1);
            } else {
                const sweepX = Math.sin(this.angle * 2 + i) * 20;
                const sweepZ = Math.cos(this.angle * 2 + i) * 20;
                const searchTarget = new THREE.Vector3(sweepX, -targetY, 30 + sweepZ);
                searchTarget.applyQuaternion(this.model.quaternion);
                light.target.position.copy(light.position).add(searchTarget);
            }
        });
    }
}
