import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { WorldManager } from './world.js';
import { Controls } from './controls.js';
import { SkyDome } from './sky.js';
import { Tank } from './tank.js';
import { Character } from './character.js';
import { ChickenSpawner } from './chicken.js';
import { ButterflySpawner } from './butterfly.js';
import { ThrowingAxe } from './axe.js';
import { FireManager, preloadFireMedia } from './fire.js';
import { AmbientWind } from './ambientWind.js';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);
        this.scene.fog = new THREE.FogExp2(0x111111, 0.002);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
        this.camera.position.set(0, 20, 30);

        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);
        this.ambientWind = new AmbientWind(this.listener);

        this.renderer = new THREE.WebGLRenderer({
            canvas: document.querySelector('#three-canvas'),
            antialias: true
        });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.powerPreference = 'high-performance';

        this.world = new WorldManager(this.scene);

        this.character = new Character(this.scene);
        
        this.controls = new Controls(this.camera, this.renderer.domElement, this.character);
        
        this.sky = new SkyDome(this.scene);
        this.tank = new Tank(this.scene);
        
        const getPlayerPos = () => this.character.isLoaded ? this.character.getPosition() : new THREE.Vector3(0, 0, 0);
        
        this.chickenSpawner = new ChickenSpawner(this.scene, getPlayerPos);
        this.butterflySpawner = new ButterflySpawner(this.scene, this.world);
        
        const getPlayerDir = () => {
            const dir = new THREE.Vector3(0, 0, -1);
            dir.applyQuaternion(this.camera.quaternion);
            return dir;
        };
        this.axe = new ThrowingAxe(this.scene, getPlayerPos, getPlayerDir);
        this.axe.setCharacter(this.character);

        this.fireManager = new FireManager(this.scene, this.listener);
        
        this.bullets = [];
        this.bulletGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        this.bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        
        this.flashlightOn = false;
        this.isDay = false;
        this.dayPhase = 0.0;
        this.targetDayPhase = 0.0;

        this.initLights();
        this.initUI();
        this.initPointerLock();
        this.clock = null;

        window.addEventListener('resize', () => this.onResize());

        setInterval(() => {
            const chunkCount = document.getElementById('chunk-count');
            const playerPos = document.getElementById('player-pos');
            if (chunkCount) chunkCount.textContent = this.world.chunks.size;
            if (playerPos && this.character.isLoaded) {
                const pos = this.character.getPosition();
                playerPos.textContent = `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`;
            }
        }, 100);
    }

    async runInitialLoad() {
        const overlay = document.getElementById('loading-screen');
        const statusEl = document.getElementById('loading-status');
        const fillEl = document.getElementById('loading-bar-fill');

        const setStatus = (text) => {
            if (statusEl) statusEl.textContent = text;
        };
        const setProgress = (t) => {
            if (fillEl) fillEl.style.width = `${Math.round(THREE.MathUtils.clamp(t, 0, 1) * 100)}%`;
        };

        try {
            setStatus('Loading models, textures, and audio…');
            setProgress(0.02);

            await Promise.all([
                this.world.whenCoreAssetsReady(),
                this.character.readyPromise.catch((err) => {
                    console.warn('Character load issue — using default height for tree scale.', err);
                }),
                this.axe.readyPromise.catch((err) => console.warn('Axe load:', err)),
                this.tank.readyPromise.catch((err) => console.warn('Tank load:', err)),
                this.ambientWind.bufferPromise,
                preloadFireMedia(),
                new FBXLoader().loadAsync('/models/butterfly.fbx').catch(() => {}),
                new FBXLoader().loadAsync('/models/chicken.fbx').catch(() => {})
            ]);

            setProgress(0.28);
            const humanH =
                this.character.isLoaded && Number.isFinite(this.character.getHeightWorld())
                    ? this.character.getHeightWorld()
                    : 1.65;

            setStatus('Loading tree model…');
            await this.world.loadPineTreeModel(humanH);
            setProgress(0.34);
            setStatus('Loading terrain, grass, and decorations…');
            await this.world.preloadWorldAt(new THREE.Vector3(0, 0, 0), (p) => {
                setProgress(0.34 + p * 0.6);
            });

            setStatus('Preparing graphics…');
            setProgress(0.94);
            for (let i = 0; i < 2; i++) {
                await new Promise((r) => requestAnimationFrame(r));
                if (typeof this.renderer.compile === 'function') {
                    this.renderer.compile(this.scene, this.camera);
                }
                this.renderer.render(this.scene, this.camera);
            }
        } catch (err) {
            console.error(err);
            setStatus('Loading issue — check console. Starting anyway…');
        }

        setProgress(1);
        setStatus('Ready');
        if (overlay) {
            overlay.classList.add('loading-screen--hidden');
        }
    }

    startGameLoop() {
        if (this.clock) return;
        this.clock = new THREE.Clock();
        this.animate();
    }

    initLights() {
        this.flashlight = new THREE.SpotLight(0xffffff, 0, 300, Math.PI / 6, 0.4, 1);
        this.flashlight.castShadow = true;
        this.flashlight.shadow.mapSize.setScalar(512);
        this.flashlight.shadow.bias = -0.0001;
        this.scene.add(this.flashlight);
        this.scene.add(this.flashlight.target);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
        this.scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 0);
        this.sunLight.position.set(100, 200, -100);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.setScalar(1024);
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 220;
        const sc = 120;
        this.sunLight.shadow.camera.left = -sc;
        this.sunLight.shadow.camera.right = sc;
        this.sunLight.shadow.camera.top = sc;
        this.sunLight.shadow.camera.bottom = -sc;
        this.scene.add(this.sunLight);
    }

    initUI() {
        const startBtn = document.getElementById('start-btn');
        const transitionBtn = document.getElementById('transition-btn');

        startBtn.addEventListener('click', () => {
            this.controls.lock();
            if (THREE.AudioContext.getContext().state !== 'running') {
                THREE.AudioContext.getContext().resume();
            }
            if (this.ambientWind) {
                this.ambientWind.beginAfterUserGesture();
            }
        });

        transitionBtn.addEventListener('click', (e) => {
            this.isDay = !this.isDay;
            this.targetDayPhase = this.isDay ? 1.0 : 0.0;
            e.stopPropagation();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'l') {
                this.toggleFlashlight(!this.flashlightOn);
            }
            if (e.key.toLowerCase() === 'f') {
                this.spawnFire();
            }
            if (e.key === '1') {
                this.isDay = !this.isDay;
                this.targetDayPhase = this.isDay ? 1.0 : 0.0;
            }

            if (e.repeat) return;

            if (e.key.toLowerCase() === 'e') {
                this.tryPickupOrDropRock();
            }

            const playerPos = this.character.isLoaded
                ? this.character.getPosition()
                : new THREE.Vector3();

            if (e.key === '4' && this.butterflySpawner) {
                this.butterflySpawner.spawnOneNear(playerPos, this.world, 2);
            }
            if (e.key === '5' && this.butterflySpawner) {
                this.butterflySpawner.spawnOneNear(playerPos, this.world, 3);
            }
            if (e.key === '6' && this.butterflySpawner) {
                this.butterflySpawner.spawnOneNear(playerPos, this.world, 1);
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (!this.controls.isLocked) return;
            
            if (e.button === 0) {
                this.throwAxe();
            }
        });

        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    throwAxe() {
        if (!this.character.isLoaded || !this.axe) return;
        
        const charPos = this.character.getPosition();
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);
        
        this.axe.throw(direction, charPos);
    }

    tryPickupOrDropRock() {
        if (!this.character.isLoaded) return;
        if (this.character.getHeldRock()) {
            const mesh = this.character.dropHeldRock(this.scene, this.world, this.camera);
            if (mesh && mesh.userData.pickupRock) {
                this.world.registerPickupRock(mesh);
            }
            return;
        }
        const pos = this.character.getPosition();
        let best = null;
        let bestD = 2.9;
        const list = this.world.pickupRocks;
        for (let i = 0; i < list.length; i++) {
            const mesh = list[i];
            if (!mesh.parent) continue;
            const d = pos.distanceTo(mesh.position);
            if (d < bestD) {
                bestD = d;
                best = mesh;
            }
        }
        if (best) {
            this.world.unregisterPickupRock(best);
            this.character.attachHeldRock(best);
        }
    }

    spawnFire() {
        if (!this.character.isLoaded) return;
        
        const charPos = this.character.getPosition();
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);
        
        const firePos = charPos.clone();
        firePos.addScaledVector(direction, 5);
        firePos.y = this.world.getHeightAt(firePos.x, firePos.z) + 0.08;

        this.fireManager.spawnFire(firePos);
    }

    initPointerLock() {
        const startScreen = document.getElementById('start-screen');
        const hud = document.getElementById('hud');

        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === this.renderer.domElement) {
                startScreen.style.display = 'none';
                hud.style.display = 'flex';
                this.toggleFlashlight(true);
            } else {
                startScreen.style.display = 'flex';
                hud.style.display = 'none';
                this.toggleFlashlight(false);
            }
        });
    }

    toggleFlashlight(on) {
        this.flashlightOn = on;
        if (this.flashlight) {
            this.flashlight.intensity = on ? 50.0 : 0;
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    }

    updateBullets(delta) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i];
            bullet.position.addScaledVector(bullet.userData.velocity, delta);
            bullet.userData.lifetime -= delta;

            if (bullet.userData.lifetime <= 0) {
                this.scene.remove(bullet);
                this.bullets.splice(i, 1);
                continue;
            }

            this.checkBulletCollisions(bullet, i);
        }
    }

    checkBulletCollisions(bullet, index) {
        if (this.tank && this.tank.container && !this.tank.isDestroyed) {
            const dist = bullet.position.distanceTo(this.tank.container.position);
            if (dist < 10) {
                this.tank.takeHit();
                this.scene.remove(bullet);
                this.bullets.splice(index, 1);
                return;
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock ? this.clock.getDelta() : 0;

        const transitionSpeed = 0.5;
        if (Math.abs(this.dayPhase - this.targetDayPhase) > 0.01) {
            this.dayPhase = THREE.MathUtils.lerp(this.dayPhase, this.targetDayPhase, delta * transitionSpeed);
            if (this.ambientLight) this.ambientLight.intensity = 0.1 + this.dayPhase * 0.7;
            if (this.sunLight) this.sunLight.intensity = this.dayPhase * 1.5;
            
            const nightFog = new THREE.Color(0x111111);
            const dayFog = new THREE.Color(0x7fbfff);
            this.scene.fog.color.lerpColors(nightFog, dayFog, this.dayPhase);
            this.scene.fog.density = THREE.MathUtils.lerp(0.002, 0.0005, this.dayPhase);
        } else {
            this.dayPhase = this.targetDayPhase;
        }

        this.controls.update(delta, this.world);
        
        const updatePos = this.character.isLoaded ? this.character.getPosition() : this.camera.position;
        this.world.update(updatePos);
        const elapsed = this.clock ? this.clock.getElapsedTime() : 0;
        this.world.updateDecorationTime(elapsed);
        this.world.updateTreeWind(elapsed);
        if (this.character.isLoaded) {
            this.world.updatePickupRockHighlight(updatePos, elapsed);
        }
        this.sky.update(elapsed, this.camera.position, this.dayPhase);
        
        if (this.tank) this.tank.update(delta, updatePos);

        if (this.chickenSpawner) {
            this.chickenSpawner.update(delta, this.world, null);
        }
        if (this.butterflySpawner) {
            this.butterflySpawner.update(delta, updatePos, this.world);
        }
        
        if (this.axe && this.character.isLoaded) {
            const charPos = this.character.getPosition();
            
            if (this.axe.isOnGround() && !this.axe.dogRetrieving) {
                const distToAxe = charPos.distanceTo(this.axe.getPosition());
                if (distToAxe < 3) {
                    this.axe.pickup();
                }
            }
            
            this.axe.update(delta, this.world, charPos, this.character.rotation);
        }
        
        if (this.fireManager) {
            this.fireManager.update(delta);
        }
        
        this.updateBullets(delta);

        if (this.flashlight && this.character.isLoaded) {
            const charPos = this.character.getPosition();
            this.flashlight.position.set(charPos.x, charPos.y + 5, charPos.z);
            
            const targetPos = new THREE.Vector3(0, 0, -1);
            targetPos.applyQuaternion(this.camera.quaternion);
            targetPos.add(this.flashlight.position);
            this.flashlight.target.position.copy(targetPos);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

const game = new Game();
game.runInitialLoad().finally(() => {
    game.startGameLoop();
});
