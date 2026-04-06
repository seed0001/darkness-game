import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class Tank {
    constructor(scene) {
        this.scene = scene;
        this.loader = new FBXLoader();
        this.textureLoader = new THREE.TextureLoader();
        
        // Main container to handle position and lookAt
        this.container = new THREE.Group();
        this.scene.add(this.container);
        
        this.model = null;
        
        // Combat state
        this.isDestroyed = false;
        this.respawnTimer = 0;
        this.explosionFlash = null;
        
        // Movement parameters
        this.angle = 1.5; 
        this.radius = 80;
        this.speed = 0.2;
        
        this.loadModel();
    }

    loadModel() {
        const path = '/tank/';
        const prefix = 'Meshy_AI_a_tank_ATV_thing_that_0406065337_texture';
        
        const baseColor = this.textureLoader.load(`${path}${prefix}.png`);
        baseColor.colorSpace = THREE.SRGBColorSpace;
        const normalMap = this.textureLoader.load(`${path}${prefix}_normal.png`);
        const metallicMap = this.textureLoader.load(`${path}${prefix}_metallic.png`);
        const roughnessMap = this.textureLoader.load(`${path}${prefix}_roughness.png`);

        this.loader.load(`${path}${prefix}.fbx`, (fbx) => {
            this.model = fbx;
            
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: baseColor,
                        normalMap: normalMap,
                        metalnessMap: metallicMap,
                        roughnessMap: roughnessMap,
                        metalness: 1.0,
                        roughness: 0.4,
                        emissive: 0x0055ff, 
                        emissiveIntensity: 0.2
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            this.model.scale.set(0.01, 0.01, 0.01);
            this.model.rotation.y = -Math.PI / 2; 
            
            this.container.add(this.model);
            this.initGlow();
            console.log('AI Tank Refined: Resized and Repositioned');
        });
    }

    initGlow() {
        this.underGlow = new THREE.PointLight(0x00ffff, 10, 30);
        this.container.add(this.underGlow);
        this.underGlow.position.set(0, 0.5, 0);

        // Explosion light
        this.explosionFlash = new THREE.PointLight(0xffaa00, 0, 100);
        this.container.add(this.explosionFlash);
    }

    takeHit() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
        this.respawnTimer = 0;
        this.model.visible = false;
        this.underGlow.visible = false;
        
        // Trigger Explosion Flash
        this.explosionFlash.intensity = 100;
        setTimeout(() => {
            if (this.explosionFlash) this.explosionFlash.intensity = 0;
        }, 300);
        
        console.log('Tank hit! Exploding...');
    }

    respawn() {
        this.isDestroyed = false;
        this.respawnTimer = 0;
        this.model.visible = true;
        this.underGlow.visible = true;
        this.explosionFlash.intensity = 0;
        console.log('Tank respawned');
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

        this.angle += delta * this.speed;
        const targetX = playerPosition.x + Math.cos(this.angle) * this.radius;
        const targetZ = playerPosition.z + Math.sin(this.angle * 1.2) * (this.radius * 0.8);
        const targetY = 1.0; 

        const targetPos = new THREE.Vector3(targetX, targetY, targetZ);
        
        const nextAngle = this.angle + 0.05;
        const lookAtPos = new THREE.Vector3(
            playerPosition.x + Math.cos(nextAngle) * this.radius,
            targetY,
            playerPosition.z + Math.sin(nextAngle * 1.2) * (this.radius * 0.8)
        );
        
        this.container.position.lerp(targetPos, 0.05);
        this.container.lookAt(lookAtPos);

        if (this.underGlow) {
            this.underGlow.intensity = 10 + Math.random() * 5;
        }
    }
}
