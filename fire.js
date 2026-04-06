import * as THREE from 'three';

export class Fire {
    constructor(scene, position) {
        this.scene = scene;
        this.pos = position.clone();
        
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
        this.sourceImage = new Image();
        this.sourceImage.crossOrigin = 'anonymous';
        
        await new Promise((resolve) => {
            this.sourceImage.onload = resolve;
            this.sourceImage.src = '/Fire Spritesheet.png';
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
        mesh1.position.y = 2;
        this.group.add(mesh1);

        const mesh2 = new THREE.Mesh(geo.clone(), this.material);
        mesh2.position.y = 2;
        mesh2.rotation.y = Math.PI / 2;
        this.group.add(mesh2);

        // Second cross (offset 45 degrees) for denser volume
        const mesh3 = new THREE.Mesh(geo.clone(), this.material);
        mesh3.position.y = 2;
        mesh3.rotation.y = Math.PI / 4;
        this.group.add(mesh3);

        const mesh4 = new THREE.Mesh(geo.clone(), this.material);
        mesh4.position.y = 2;
        mesh4.rotation.y = (3 * Math.PI) / 4;
        this.group.add(mesh4);

        const light = new THREE.PointLight(0xff5500, 8, 12);
        light.position.y = 2;
        this.group.add(light);
        this.light = light;

        this.scene.add(this.group);
        this.ready = true;
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
        this.scene.remove(this.group);
    }
}

export class FireManager {
    constructor(scene) {
        this.scene = scene;
        this.fires = [];
    }

    spawnFire(pos) {
        const f = new Fire(this.scene, pos);
        this.fires.push(f);
    }

    update(dt) {
        for (const f of this.fires) f.update(dt);
    }
}
