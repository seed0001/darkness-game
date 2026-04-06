import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const GLOW_COLORS = [
    new THREE.Color(0x00aaff),
    new THREE.Color(0xff3333),
    new THREE.Color(0x33ff66)
];

export class Butterfly {
    constructor(scene, position, colorIndex) {
        this.scene = scene;
        this.model = null;
        this.mixer = null;
        this.isLoaded = false;
        
        this.position = position.clone();
        this.basePosition = position.clone();
        
        this.glowColor = GLOW_COLORS[colorIndex % GLOW_COLORS.length];
        this.glowLight = null;
        
        this.time = Math.random() * Math.PI * 2;
        this.flySpeed = 0.5 + Math.random() * 0.5;
        this.flyRadius = 3 + Math.random() * 4;
        this.flyHeight = 2 + Math.random() * 3;
        this.verticalOffset = Math.random() * Math.PI * 2;
        
        this.orbitAngle = Math.random() * Math.PI * 2;
        this.orbitSpeed = 0.3 + Math.random() * 0.4;
        
        this.load();
    }

    async load() {
        const loader = new FBXLoader();

        try {
            const fbx = await loader.loadAsync('/models/butterfly.fbx');
            
            this.model = fbx;
            this.model.scale.set(0.01, 0.01, 0.01);
            this.model.position.copy(this.position);
            
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;
                    
                    child.material = new THREE.MeshStandardMaterial({
                        color: this.glowColor,
                        emissive: this.glowColor,
                        emissiveIntensity: 0.8,
                        transparent: true,
                        opacity: 0.9
                    });
                }
            });

            this.glowLight = new THREE.PointLight(this.glowColor, 2, 8);
            this.glowLight.position.copy(this.position);
            this.scene.add(this.glowLight);

            this.scene.add(this.model);
            
            if (fbx.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                const action = this.mixer.clipAction(fbx.animations[0]);
                action.timeScale = 2;
                action.play();
            }

            this.isLoaded = true;

        } catch (error) {
            console.error('Error loading butterfly:', error);
        }
    }

    update(delta, terrainManager) {
        if (!this.isLoaded || !this.model) return;

        if (this.mixer) {
            this.mixer.update(delta);
        }

        this.time += delta * this.flySpeed;
        this.orbitAngle += delta * this.orbitSpeed;

        const x = this.basePosition.x + Math.cos(this.orbitAngle) * this.flyRadius;
        const z = this.basePosition.z + Math.sin(this.orbitAngle) * this.flyRadius;
        
        let baseY = this.basePosition.y;
        if (terrainManager) {
            baseY = terrainManager.getHeightAt(x, z);
        }
        
        const y = baseY + this.flyHeight + Math.sin(this.time * 2 + this.verticalOffset) * 1.5;

        this.position.set(x, y, z);
        this.model.position.copy(this.position);
        
        const tangentAngle = this.orbitAngle + Math.PI / 2;
        this.model.rotation.y = tangentAngle;
        this.model.rotation.z = Math.sin(this.time * 3) * 0.2;

        if (this.glowLight) {
            this.glowLight.position.copy(this.position);
            this.glowLight.intensity = 1.5 + Math.sin(this.time * 4) * 0.5;
        }
    }

    dispose() {
        if (this.model) {
            this.scene.remove(this.model);
        }
        if (this.glowLight) {
            this.scene.remove(this.glowLight);
        }
    }
}

export class ButterflySpawner {
    constructor(scene, worldManager) {
        this.scene = scene;
        this.worldManager = worldManager;
        this.butterflies = [];
        this.spawnedPositions = new Set();
        this.maxButterflies = 30;
        this.spawnRadius = 100;
        this.colorIndex = 0;
    }

    update(delta, playerPosition, terrainManager) {
        if (this.butterflies.length < this.maxButterflies) {
            this.trySpawnNearTrees(playerPosition, terrainManager);
        }

        for (const butterfly of this.butterflies) {
            butterfly.update(delta, terrainManager);
        }

        this.cullDistantButterflies(playerPosition);
    }

    trySpawnNearTrees(playerPosition, terrainManager) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * this.spawnRadius;
        
        const spawnX = playerPosition.x + Math.cos(angle) * dist;
        const spawnZ = playerPosition.z + Math.sin(angle) * dist;
        
        const posKey = `${Math.floor(spawnX / 10)},${Math.floor(spawnZ / 10)}`;
        if (this.spawnedPositions.has(posKey)) return;
        
        let spawnY = 5;
        if (terrainManager) {
            spawnY = terrainManager.getHeightAt(spawnX, spawnZ) + 5;
        }

        const spawnPos = new THREE.Vector3(spawnX, spawnY, spawnZ);
        
        const butterfly = new Butterfly(this.scene, spawnPos, this.colorIndex);
        this.butterflies.push(butterfly);
        this.spawnedPositions.add(posKey);
        this.colorIndex++;
    }

    cullDistantButterflies(playerPosition) {
        const maxDist = this.spawnRadius + 50;
        
        for (let i = this.butterflies.length - 1; i >= 0; i--) {
            const butterfly = this.butterflies[i];
            const dist = butterfly.basePosition.distanceTo(playerPosition);
            
            if (dist > maxDist) {
                butterfly.dispose();
                this.butterflies.splice(i, 1);
                
                const posKey = `${Math.floor(butterfly.basePosition.x / 10)},${Math.floor(butterfly.basePosition.z / 10)}`;
                this.spawnedPositions.delete(posKey);
            }
        }
    }
}
