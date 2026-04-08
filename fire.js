import * as THREE from 'three';

const FIRE_CRACKLE_URL = '/audio/fire_crackling.wav';
const FIRE_SPRITESHEET = '/Fire Spritesheet.png';

/** Decode fire spritesheet + crackle audio so first campfire spawn does not hitch. */
export function preloadFireMedia() {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const sheetP = new Promise((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = FIRE_SPRITESHEET;
    });
    const crackleP = new THREE.AudioLoader()
        .loadAsync(FIRE_CRACKLE_URL)
        .catch(() => {});
    return Promise.all([sheetP, crackleP]);
}

const FLAME_Y = 2.55;
const ASH_RADIUS = 1.05;
const ASH_HEIGHT = 0.14;
const STONE_RING_RADIUS = 1.78;
const STONE_COUNT = 12;

function buildCampfireRing(group) {
    const stoneMat = new THREE.MeshStandardMaterial({
        color: 0x6a6560,
        roughness: 0.94,
        metalness: 0.04
    });
    const ashMat = new THREE.MeshStandardMaterial({
        color: 0x1e1a18,
        roughness: 1,
        metalness: 0
    });

    const ash = new THREE.Mesh(
        new THREE.CylinderGeometry(ASH_RADIUS, ASH_RADIUS * 0.92, ASH_HEIGHT, 24, 1, false),
        ashMat
    );
    ash.position.y = ASH_HEIGHT * 0.5 + 0.02;
    ash.receiveShadow = true;
    ash.castShadow = false;
    group.add(ash);

    const innerRim = new THREE.Mesh(
        new THREE.TorusGeometry(ASH_RADIUS + 0.06, 0.09, 8, 24),
        stoneMat
    );
    innerRim.rotation.x = Math.PI / 2;
    innerRim.position.y = ASH_HEIGHT + 0.04;
    innerRim.receiveShadow = true;
    innerRim.castShadow = true;
    group.add(innerRim);

    for (let i = 0; i < STONE_COUNT; i++) {
        const t = (i / STONE_COUNT) * Math.PI * 2;
        const jitter = (Math.random() - 0.5) * 0.12;
        const r = STONE_RING_RADIUS + jitter;
        const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.28 + Math.random() * 0.12, 0),
            stoneMat
        );
        rock.position.set(Math.cos(t) * r, 0.26 + Math.random() * 0.08, Math.sin(t) * r);
        rock.rotation.set(
            0.35 + Math.random() * 0.45,
            t + (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.5
        );
        rock.scale.setScalar(0.82 + Math.random() * 0.38);
        rock.castShadow = true;
        rock.receiveShadow = true;
        group.add(rock);
    }
}

export class Fire {
    constructor(scene, position, audioListener = null) {
        this.scene = scene;
        this.pos = position.clone();
        this.audioListener = audioListener;
        this.sound = null;
        this.audioLoader = new THREE.AudioLoader();
        
        // Measured from actual file size 3072x2816 => 12x11 cells of 256x256.
        this.cols = 12;
        this.rows = 11;
        this.frame = 0;
        this.maxFrames = this.cols * this.rows;
        this.elapsed = 0;
        this.speed = 1 / 20;
        
        this.group = new THREE.Group();
        this.group.position.copy(this.pos);
        
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvasTexture = null;
        this.material = null;
        this.sourceImage = null;
        this.frameW = 0;
        this.frameH = 0;
        this.ready = false;
        
        this.setup();
    }

    async setup() {
        buildCampfireRing(this.group);

        this.sourceImage = new Image();
        this.sourceImage.crossOrigin = 'anonymous';
        
        await new Promise((resolve) => {
            this.sourceImage.onload = resolve;
            this.sourceImage.src = FIRE_SPRITESHEET;
        });
        
        this.frameW = this.sourceImage.width / this.cols;
        this.frameH = this.sourceImage.height / this.rows;

        this.canvas.width = this.frameW;
        this.canvas.height = this.frameH;
        this.drawFrame(0);

        this.canvasTexture = new THREE.CanvasTexture(this.canvas);
        this.canvasTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.canvasTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.canvasTexture.magFilter = THREE.LinearFilter;
        this.canvasTexture.minFilter = THREE.LinearFilter;
        this.canvasTexture.needsUpdate = true;
        
        this.material = new THREE.MeshBasicMaterial({
            map: this.canvasTexture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            alphaTest: 0.3
        });

        const geo = new THREE.PlaneGeometry(3, 4);

        // First cross
        const mesh1 = new THREE.Mesh(geo, this.material);
        mesh1.position.y = FLAME_Y;
        this.group.add(mesh1);

        const mesh2 = new THREE.Mesh(geo.clone(), this.material);
        mesh2.position.y = FLAME_Y;
        mesh2.rotation.y = Math.PI / 2;
        this.group.add(mesh2);

        // Second cross (offset 45 degrees) for denser volume
        const mesh3 = new THREE.Mesh(geo.clone(), this.material);
        mesh3.position.y = FLAME_Y;
        mesh3.rotation.y = Math.PI / 4;
        this.group.add(mesh3);

        const mesh4 = new THREE.Mesh(geo.clone(), this.material);
        mesh4.position.y = FLAME_Y;
        mesh4.rotation.y = (3 * Math.PI) / 4;
        this.group.add(mesh4);

        const light = new THREE.PointLight(0xff5500, 8, 12);
        light.position.y = FLAME_Y;
        this.group.add(light);
        this.light = light;

        this.scene.add(this.group);
        this.initCrackleAudio();
        this.ready = true;
    }

    initCrackleAudio() {
        if (!this.audioListener) return;

        this.sound = new THREE.PositionalAudio(this.audioListener);
        this.sound.position.set(0, FLAME_Y, 0);

        this.audioLoader.load(
            FIRE_CRACKLE_URL,
            (buffer) => {
                if (!this.sound) return;
                this.sound.setBuffer(buffer);
                this.sound.setLoop(true);
                this.sound.setVolume(0.65);
                this.sound.setRefDistance(8);
                this.sound.setRolloffFactor(1.2);
                this.sound.setMaxDistance(42);
                this.sound.setDistanceModel('inverse');
                this.group.add(this.sound);
                this.sound.play();
            },
            undefined,
            (err) => console.warn('Fire crackling audio failed to load:', err)
        );
    }

    drawFrame(frameIndex) {
        const col = frameIndex % this.cols;
        const row = Math.floor(frameIndex / this.cols);
        
        const sx = col * this.frameW;
        const sy = row * this.frameH;

        // Hard replace: clear then draw exactly one frame cell.
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(
            this.sourceImage,
            sx, sy, this.frameW, this.frameH,
            0, 0, this.canvas.width, this.canvas.height
        );
    }

    update(dt) {
        if (!this.ready) return;

        this.elapsed += dt;
        if (this.elapsed >= this.speed) {
            this.elapsed = 0;
            this.frame = (this.frame + 1) % this.maxFrames;
            this.drawFrame(this.frame);
            this.canvasTexture.needsUpdate = true;
        }

        if (this.light) {
            this.light.intensity = 6 + Math.random() * 4;
        }
    }

    dispose() {
        if (this.sound) {
            if (this.sound.isPlaying) this.sound.stop();
            this.group.remove(this.sound);
            this.sound.disconnect();
            this.sound = null;
        }
        this.scene.remove(this.group);
    }
}

export class FireManager {
    constructor(scene, audioListener = null) {
        this.scene = scene;
        this.audioListener = audioListener;
        this.fires = [];
    }

    spawnFire(pos) {
        const f = new Fire(this.scene, pos, this.audioListener);
        this.fires.push(f);
    }

    update(dt) {
        for (const f of this.fires) f.update(dt);
    }

    /**
     * @param {THREE.Vector3} worldPos
     * @param {number} maxDist horizontal distance
     * @returns {Fire | null}
     */
    findNearestLitFire(worldPos, maxDist = 4.5) {
        if (!worldPos) return null;
        const px = worldPos.x;
        const pz = worldPos.z;
        let best = null;
        let bestD = maxDist;
        for (let i = 0; i < this.fires.length; i++) {
            const f = this.fires[i];
            if (!f.ready) continue;
            const dx = f.pos.x - px;
            const dz = f.pos.z - pz;
            const d = Math.hypot(dx, dz);
            if (d < bestD) {
                bestD = d;
                best = f;
            }
        }
        return best;
    }
}
