import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Simple Simplex-like noise for terrain
class Noise {
    constructor(seed = 0) {
        this.p = new Uint8Array(256);
        this.permutation = new Uint8Array(512);
        for (let i = 0; i < 256; i++) this.p[i] = i;
        for (let i = 255; i > 0; i--) {
            const r = Math.floor(Math.random() * (i + 1));
            [this.p[i], this.p[r]] = [this.p[r], this.p[i]];
        }
        for (let i = 0; i < 512; i++) this.permutation[i] = this.p[i & 255];
    }

    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(t, a, b) { return a + t * (b - a); }
    grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise(x, y, z = 0) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);
        const A = this.permutation[X] + Y, AA = this.permutation[A] + Z, AB = this.permutation[A + 1] + Z;
        const B = this.permutation[X + 1] + Y, BA = this.permutation[B] + Z, BB = this.permutation[B + 1] + Z;

        return this.lerp(w, this.lerp(v, this.lerp(u, this.grad(this.permutation[AA], x, y, z),
            this.grad(this.permutation[BA], x - 1, y, z)),
            this.lerp(u, this.grad(this.permutation[AB], x, y - 1, z),
                this.grad(this.permutation[BB], x - 1, y - 1, z))),
            this.lerp(v, this.lerp(u, this.grad(this.permutation[AA + 1], x, y, z - 1),
                this.grad(this.permutation[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad(this.permutation[AB + 1], x, y - 1, z - 1),
                    this.grad(this.permutation[BB + 1], x - 1, y - 1, z - 1))));
    }
}

export class WorldManager {
    constructor(scene) {
        this.scene = scene;
        this.chunkSize = 64;
        this.resolution = 64;
        this.chunks = new Map();
        this.noise = new Noise();
        this.activeChunks = new Set();
        this.waterLevel = -10.0;
        
        // Tree Loading Setup
        this.modelLoader = new FBXLoader();
        this.treeModels = [];
        this.modelsLoaded = false;
        this.loadModels();

        // Load premium ground texture
        const textureLoader = new THREE.TextureLoader();
        const groundTexture = textureLoader.load('/ground.png', (tex) => {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(8, 8);
            tex.colorSpace = THREE.SRGBColorSpace;
        });

        this.terrainMaterial = new THREE.MeshStandardMaterial({
            map: groundTexture,
            color: 0x888888,
            metalness: 0,
            roughness: 1.0,
            flatShading: false
        });

        this.initWater();
    }

    async loadModels() {
        const textureLoader = new THREE.TextureLoader();
        const modelFiles = [
            'tree01.fbx', 'tree05.fbx', 'tree10.fbx'
        ];

        const loadPromises = modelFiles.map(file => {
            return new Promise((resolve) => {
                const texName = file.replace('.fbx', '.png');
                const treeTexture = textureLoader.load(`/textures/${texName}`);
                treeTexture.colorSpace = THREE.SRGBColorSpace;

                this.modelLoader.load(`/models/${file}`, (fbx) => {
                    fbx.traverse((child) => {
                        if (child.isMesh) {
                            child.material = new THREE.MeshStandardMaterial({
                                map: treeTexture,
                                roughness: 1.0,
                                metalness: 0
                            });
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                    this.treeModels.push(fbx);
                    resolve();
                });
            });
        });

        await Promise.all(loadPromises);
        this.modelsLoaded = true;
        console.log('Selected 3 textured trees loaded successfully');
    }

    initWater() {
        const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
        this.water = new Water(waterGeometry, {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: new THREE.TextureLoader().load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/waternormals.jpg', function (texture) {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            }),
            sunDirection: new THREE.Vector3(),
            sunColor: 0x222222,
            waterColor: 0x111111,
            distortionScale: 3.7,
            fog: this.scene.fog !== undefined
        });
        this.water.rotation.x = -Math.PI / 2;
        this.water.position.y = this.waterLevel;
        this.scene.add(this.water);
    }

    generateChunk(cx, cz, savedData = null) {
        const key = `${cx},${cz}`;
        if (this.chunks.has(key)) return;

        const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, this.resolution, this.resolution);
        geometry.rotateX(-Math.PI / 2);

        const position = geometry.attributes.position;
        const heights = [];

        for (let i = 0; i < position.count; i++) {
            let h = 0; 
            position.setY(i, h);
            heights.push(h);
        }

        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        
        this.scene.add(mesh);
        
        // Scatter Trees (Selected 3)
        const chunkTrees = [];
        if (this.modelsLoaded) {
            const numTrees = 2 + Math.floor(Math.random() * 5); // Fewer trees
            for (let i = 0; i < numTrees; i++) {
                const model = this.treeModels[Math.floor(Math.random() * this.treeModels.length)].clone();
                
                const tx = (Math.random() - 0.5) * this.chunkSize;
                const tz = (Math.random() - 0.5) * this.chunkSize;
                
                model.position.set(cx * this.chunkSize + tx, 0, cz * this.chunkSize + tz);
                model.rotation.y = Math.random() * Math.PI * 2;
                const scale = 0.01 + Math.random() * 0.02; // Even smaller scale
                model.scale.set(scale, scale, scale);
                
                this.scene.add(model);
                chunkTrees.push(model);
            }
        }

        this.chunks.set(key, { mesh, heights, cx, cz, objects: chunkTrees });
        return key;
    }

    update(playerPosition) {
        const px = Math.floor(playerPosition.x / this.chunkSize);
        const pz = Math.floor(playerPosition.z / this.chunkSize);
        const radius = 2; 

        for (let x = px - radius; x <= px + radius; x++) {
            for (let z = pz - radius; z <= pz + radius; z++) {
                this.generateChunk(x, z);
            }
        }
        
        if (this.water) {
            this.water.material.uniforms['time'].value += 1.0 / 60.0;
        }
    }

    getHeightAt(x, z) {
        return 0;
    }

    save() {
        const data = {
            chunks: Array.from(this.chunks.entries()).map(([key, chunk]) => ({
                key,
                cx: chunk.cx,
                cz: chunk.cz,
                heights: chunk.heights
            })),
            waterLevel: this.waterLevel
        };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'darkness_world.json';
        a.click();
    }

    import(json) {
        this.chunks.forEach(c => {
            this.scene.remove(c.mesh);
            if (c.objects) c.objects.forEach(obj => this.scene.remove(obj));
        });
        this.chunks.clear();

        const data = JSON.parse(json);
        data.chunks.forEach(c => {
            this.generateChunk(c.cx, c.cz, c.heights);
        });
        this.waterLevel = data.waterLevel;
        this.water.position.y = this.waterLevel;
    }
}
