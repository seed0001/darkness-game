import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { WorldManager, isNearLakeWater } from './world.js';
import { Controls } from './controls.js';
import { SkyDome } from './sky.js';
import { Dog } from './dog.js';
import { Character } from './character.js';
import { ChickenSpawner } from './chicken.js';
import { ButterflySpawner } from './butterfly.js';
import { ThrowingAxe } from './axe.js';
import { FireManager, preloadFireMedia } from './fire.js';
import { AmbientWind } from './ambientWind.js';
import { loadLakeFish } from './lakeFish.js';
import { loadScorpions } from './scorpion.js';
import { BackpackManager } from './backpack.js';

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
        this.dog = new Dog(this.scene);
        this.backpackManager = new BackpackManager(this.scene, this.world);
        
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
        this.axe.onMeleeImpact = () => {
            if (!this.character.isLoaded) return;
            const forward = new THREE.Vector3(0, 0, -1);
            forward.applyQuaternion(this.camera.quaternion);
            this.world.tryMeleeAxeHit(this.character.getPosition(), forward);
        };

        this.fireManager = new FireManager(this.scene, this.listener);

        this.rockRing = [];
        this.fireRingCenter = null;
        this.fireRingRadius = 2.2;
        this.fireRingPreviewGroup = null;
        this.fireRingPreviewMaterials = [];
        this.fireRingPreviewLight = null;
        this._helpTimeout = null;

        this.awaitingSticks = false;
        this.stickPit = [];
        this.firePitInnerRadius = 1.9;

        this.raycaster = new THREE.Raycaster();
        this.ndcCenter = new THREE.Vector2(0, 0);

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
        this.lakeFishUpdate = null;

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
                this.dog.readyPromise.catch((err) => console.warn('Dog load:', err)),
                this.backpackManager.readyPromise.catch((err) => console.warn('Backpack load:', err)),
                this.ambientWind.bufferPromise,
                preloadFireMedia(),
                new FBXLoader().loadAsync('/models/butterfly.fbx').catch(() => {}),
                new FBXLoader().loadAsync('/models/chicken.fbx').catch(() => {})
            ]);

            if (this.backpackManager.loaded) {
                this.backpackManager.attachToCharacter(this.character);
            }

            setProgress(0.26);
            setStatus('Loading lake fish…');
            this.lakeFishUpdate = await loadLakeFish(this.scene).catch((err) => {
                console.warn('Lake fish:', err);
                return null;
            });

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
                setProgress(0.34 + p * 0.58);
            });

            setStatus('Placing scorpions…');
            setProgress(0.93);
            await loadScorpions(this.scene, this.world).catch((err) =>
                console.warn('Scorpions:', err)
            );

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
            if (e.key === '1') {
                this.isDay = !this.isDay;
                this.targetDayPhase = this.isDay ? 1.0 : 0.0;
            }

            if (e.repeat) return;

            if (e.key.toLowerCase() === 'q') {
                this.throwAxe();
            }

            if (e.key.toLowerCase() === 'e') {
                this.tryLyingProneOrPickup();
            }

            if (e.key.toLowerCase() === 'b') {
                this.tryBackpackDropOrWear();
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
                if (this.tryClickChoppableLog()) return;
                this.swingAxe();
            }
        });

        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    tryClickChoppableLog() {
        if (!this.character.isLoaded || !this.world.choppableLogs.length) return false;
        this.raycaster.setFromCamera(this.ndcCenter, this.camera);
        const hits = this.raycaster.intersectObjects(this.world.choppableLogs, false);
        if (hits.length === 0) return false;
        const log = hits[0].object;
        if (!log.userData?.interactiveLog) return false;
        const p = this.character.getPosition();
        if (p.distanceTo(log.position) > 5.8) return false;
        this.world.breakLogIntoSticks(log);
        return true;
    }

    swingAxe() {
        if (!this.character.isLoaded || !this.axe) return;
        if (this.character.isLyingProne()) return;
        this.axe.startSwing();
    }

    throwAxe() {
        if (!this.character.isLoaded || !this.axe) return;
        if (this.character.isLyingProne()) return;

        const charPos = this.character.getPosition();
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);

        this.axe.throw(direction, charPos);
    }

    tryLyingProneOrPickup() {
        if (!this.character.isLoaded) return;

        if (this.character.isLyingProne()) {
            this.character.setLyingProne(false);
            return;
        }

        const p = this.character.getPosition();
        if (isNearLakeWater(p.x, p.z)) {
            if (this.character.getHeldRock() || this.character.getHeldStick()) {
                this.showHelpPopup('Drop what you are holding first to lie down by the water.', 3200);
                return;
            }
            this.character.setLyingProne(true);
            return;
        }

        this.tryPickupOrDropRock();
    }

    tryBackpackDropOrWear() {
        if (!this.character.isLoaded || !this.backpackManager?.loaded) return;
        if (this.character.isLyingProne()) return;

        if (this.backpackManager.state === 'worn') {
            this.backpackManager.drop(this.character, this.camera, this.world);
            this.showHelpPopup('Backpack on the ground — E to store/take items, B to wear again.', 5200);
            return;
        }

        if (this.character.getHeldRock() || this.character.getHeldStick()) {
            this.showHelpPopup('Put items away or drop them before picking up the backpack (B).', 3800);
            return;
        }

        if (this.backpackManager.distanceToPlayer(this.character) < 2.85) {
            this.backpackManager.wear(this.character);
            this.showHelpPopup('Backpack equipped.', 2200);
        }
    }

    tryPickupOrDropRock() {
        if (!this.character.isLoaded) return;

        if (this.backpackManager?.loaded && this.backpackManager.tryGroundInteract(this.character)) {
            return;
        }

        if (this.character.getHeldStick()) {
            const mesh = this.character.dropHeldStick(this.scene, this.world, this.camera);
            if (mesh && mesh.userData.pickupStick) {
                if (
                    this.awaitingSticks &&
                    this.stickPit.length < 5 &&
                    this.fireRingCenter
                ) {
                    const dx = mesh.position.x - this.fireRingCenter.x;
                    const dz = mesh.position.z - this.fireRingCenter.z;
                    if (Math.hypot(dx, dz) > this.firePitInnerRadius) {
                        this.showHelpPopup(
                            'Place the stick in the fire pit — stand in the center of the rock ring and drop (E).',
                            4200
                        );
                        this.world.registerPickupStick(mesh);
                        return;
                    }
                    this.stickPit.push(mesh);
                    this.positionStickInFirePit(mesh, this.stickPit.length - 1);
                    this.updateFirePitHud();
                    this.showHelpPopup(
                        this.stickPit.length < 5
                            ? `Stick in the pit — ${this.stickPit.length} / 5`
                            : null
                    );
                    if (this.stickPit.length === 5) {
                        this.completeFirePitAndIgnite();
                    }
                    return;
                }
                this.world.registerPickupStick(mesh);
            }
            return;
        }

        if (this.character.getHeldRock()) {
            const mesh = this.character.dropHeldRock(this.scene, this.world, this.camera);
            if (mesh && mesh.userData.pickupRock) {
                // Check if this rock is being placed in a ring
                if (this.rockRing.length < 10) {
                    this.rockRing.push(mesh);
                    if (this.rockRing.length === 1) {
                        const p = this.character.getPosition();
                        this.fireRingCenter = new THREE.Vector3(
                            p.x,
                            this.world.getHeightAt(p.x, p.z),
                            p.z
                        );
                        this.ensureFireRingPreview();
                    }
                    this.addRockPlacementShadow(mesh);
                    this.updateFirePitHud();
                    this.showHelpPopup(
                        this.rockRing.length < 10
                            ? `Rock placed! ${this.rockRing.length}/10 — ring marks where the fire will be.`
                            : null
                    );
                    if (this.rockRing.length === 10) {
                        this.arrangeRockRing();
                    }
                } else {
                    this.world.registerPickupRock(mesh);
                }
            }
            return;
        }

        const pos = this.character.getPosition();
        let best = null;
        let bestD = 2.9;
        let bestIsRock = true;

        const rocks = this.world.pickupRocks;
        for (let i = 0; i < rocks.length; i++) {
            const mesh = rocks[i];
            if (!mesh.parent) continue;
            const d = pos.distanceTo(mesh.position);
            if (d < bestD) {
                bestD = d;
                best = mesh;
                bestIsRock = true;
            }
        }
        const sticks = this.world.pickupSticks;
        for (let i = 0; i < sticks.length; i++) {
            const mesh = sticks[i];
            if (!mesh.parent) continue;
            const d = pos.distanceTo(mesh.position);
            if (d < bestD) {
                bestD = d;
                best = mesh;
                bestIsRock = false;
            }
        }

        if (best) {
            if (bestIsRock) {
                this.world.unregisterPickupRock(best);
                this.character.attachHeldRock(best);
                const remaining = 10 - this.rockRing.length;
                this.showHelpPopup(`Rock picked up! Need ${remaining} more to build a fire ring.`);
            } else {
                this.world.unregisterPickupStick(best);
                this.character.attachHeldStick(best);
                if (this.awaitingSticks) {
                    const need = 5 - this.stickPit.length;
                    this.showHelpPopup(
                        `Stick picked up. Place ${need} stick${need !== 1 ? 's' : ''} in the fire pit (center of the ring).`
                    );
                } else {
                    this.showHelpPopup(
                        'Stick picked up. Need wood? Melee a tree 3× → log → left-click to split into sticks.'
                    );
                }
            }
        } else {
            this.showHelpPopup('Nothing to pick up nearby. Find a rock or stick and press E.');
        }
    }

    ensureFireRingPreview() {
        if (!this.fireRingCenter || this.fireRingPreviewGroup) return;

        const r = this.fireRingRadius;
        const g = new THREE.Group();

        const innerGeo = new THREE.CircleGeometry(r * 0.82, 40);
        const innerMat = new THREE.MeshBasicMaterial({
            color: 0x060504,
            transparent: true,
            opacity: 0.62,
            depthWrite: false
        });
        const inner = new THREE.Mesh(innerGeo, innerMat);
        inner.rotation.x = -Math.PI / 2;
        inner.position.y = 0.015;
        inner.renderOrder = 1;
        g.add(inner);

        const ringGeo = new THREE.RingGeometry(r * 0.86, r * 1.08, 56);
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0x141008,
            emissive: 0x4a2810,
            emissiveIntensity: 0.32,
            roughness: 0.94,
            metalness: 0.06,
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        ring.renderOrder = 2;
        g.add(ring);

        const light = new THREE.PointLight(0xff9030, 0.38, 18, 2);
        light.position.set(0, 0.55, 0);
        g.add(light);

        g.position.copy(this.fireRingCenter);
        this.scene.add(g);
        this.fireRingPreviewGroup = g;
        this.fireRingPreviewMaterials = [ringMat];
        this.fireRingPreviewLight = light;
    }

    addRockPlacementShadow(mesh) {
        const gx = mesh.position.x;
        const gz = mesh.position.z;
        const gy = this.world.getHeightAt(gx, gz) + 0.028;
        const geo = new THREE.CircleGeometry(0.52, 20);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        const shadow = new THREE.Mesh(geo, mat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(gx, gy, gz);
        shadow.renderOrder = 0;
        this.scene.add(shadow);
        mesh.userData.placementShadow = shadow;
    }

    arrangeRockRing() {
        if (!this.character.isLoaded || !this.fireRingCenter) return;

        const center = this.fireRingCenter.clone();
        center.y = this.world.getHeightAt(center.x, center.z);
        const radius = this.fireRingRadius;

        this.rockRing.forEach((mesh, i) => {
            const angle = (i / 10) * Math.PI * 2;
            const x = center.x + Math.cos(angle) * radius;
            const z = center.z + Math.sin(angle) * radius;
            const y = this.world.getHeightAt(x, z) + 0.16;
            mesh.position.set(x, y, z);
            mesh.rotation.set(mesh.rotation.x, angle, mesh.rotation.z);
            if (!mesh.parent) this.scene.add(mesh);
        });

        this.clearRockPlacementShadowsOnly();
        this.rockRing = [];
        this.awaitingSticks = true;
        this.stickPit = [];

        this.updateFirePitHud();
        this.showHelpPopup(
            'Ring complete! Now you need sticks. Go find sticks or cut down a tree — place 5 sticks in the fire pit (stand in the ring center and press E to drop).',
            10000
        );
    }

    positionStickInFirePit(mesh, index) {
        if (!this.fireRingCenter) return;
        const center = this.fireRingCenter;
        const angle = (index / 5) * Math.PI * 2 + 0.35;
        const rad = 0.28 + index * 0.1;
        const x = center.x + Math.cos(angle) * rad;
        const z = center.z + Math.sin(angle) * rad;
        const y = this.world.getHeightAt(x, z) + 0.1;
        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.PI / 2 + 0.15, angle + 0.4, 0.12);
    }

    completeFirePitAndIgnite() {
        for (let i = 0; i < this.stickPit.length; i++) {
            const stick = this.stickPit[i];
            this.scene.remove(stick);
            stick.geometry?.dispose();
            if (stick.material && typeof stick.material.dispose === 'function') {
                stick.material.dispose();
            }
        }
        this.stickPit = [];
        const center = this.fireRingCenter
            ? this.fireRingCenter.clone()
            : new THREE.Vector3();
        this.clearFireRingVisuals();
        this.igniteFireAtRingCenter(center);
        this.awaitingSticks = false;
        this.fireRingCenter = null;
        this.updateFirePitHud();
        this.showHelpPopup('🔥 Fire lit!', 3500);
    }

    clearRockPlacementShadowsOnly() {
        for (let i = 0; i < this.rockRing.length; i++) {
            const mesh = this.rockRing[i];
            const sh = mesh.userData.placementShadow;
            if (sh) {
                this.scene.remove(sh);
                if (sh.geometry) sh.geometry.dispose();
                if (sh.material) sh.material.dispose();
                mesh.userData.placementShadow = null;
            }
        }
    }

    clearFireRingVisuals() {
        this.clearRockPlacementShadowsOnly();

        if (this.fireRingPreviewGroup) {
            this.scene.remove(this.fireRingPreviewGroup);
            this.fireRingPreviewGroup.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                const m = obj.material;
                if (m) {
                    if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
                    else m.dispose();
                }
            });
            this.fireRingPreviewGroup = null;
        }
        this.fireRingPreviewMaterials = [];
        this.fireRingPreviewLight = null;
    }

    igniteFireAtRingCenter(centerVec) {
        const c = centerVec || this.fireRingCenter;
        if (!c) return;
        const firePos = c.clone();
        firePos.y = this.world.getHeightAt(firePos.x, firePos.z) + 0.08;
        this.fireManager.spawnFire(firePos);
    }

    updateFireRingPreviewPulse(elapsed) {
        if (!this.fireRingPreviewMaterials.length) return;
        const p = 0.26 + 0.1 * Math.sin(elapsed * 2.15);
        this.fireRingPreviewMaterials[0].emissiveIntensity = p;
        if (this.fireRingPreviewLight) {
            this.fireRingPreviewLight.intensity = 0.3 + 0.14 * Math.sin(elapsed * 2.15);
        }
    }

    showHelpPopup(message, duration = 3000) {
        const el = document.getElementById('help-popup');
        if (!el) return;
        if (this._helpTimeout) clearTimeout(this._helpTimeout);
        el.textContent = message;
        el.classList.add('help-popup--visible');
        this._helpTimeout = setTimeout(() => {
            el.classList.remove('help-popup--visible');
        }, duration);
    }

    updateFirePitHud() {
        const el = document.getElementById('rock-counter');
        const stickEl = document.getElementById('stick-counter');
        const hud = document.getElementById('fire-ring-hud');
        const fill = document.getElementById('fire-ring-progress-fill');
        const bar = document.querySelector('.fire-ring-progress');
        if (!el) return;

        if (this.awaitingSticks) {
            el.textContent = '✓ Rocks 10/10';
            el.classList.add('rock-counter--complete');
            if (stickEl) {
                stickEl.hidden = false;
                stickEl.textContent = `🪵 ${this.stickPit.length} / 5`;
                stickEl.classList.toggle('stick-counter--complete', this.stickPit.length === 5);
            }
            if (fill) fill.style.width = `${(this.stickPit.length / 5) * 100}%`;
            if (bar) {
                bar.setAttribute('aria-valuemax', '5');
                bar.setAttribute('aria-valuenow', String(this.stickPit.length));
            }
            if (hud) hud.classList.add('fire-ring-hud--visible');
            return;
        }

        if (stickEl) {
            stickEl.textContent = '';
            stickEl.hidden = true;
            stickEl.classList.remove('stick-counter--complete');
        }

        const count = this.rockRing.length;
        if (count === 0) {
            el.textContent = '';
            el.classList.remove('rock-counter--complete');
            if (fill) fill.style.width = '0%';
        } else {
            el.textContent = `🪨 ${count} / 10`;
            if (fill) fill.style.width = `${(count / 10) * 100}%`;
        }
        el.classList.toggle('rock-counter--complete', count === 10);
        if (bar) {
            bar.setAttribute('aria-valuemax', '10');
            bar.setAttribute('aria-valuenow', String(count));
        }
        if (hud) hud.classList.toggle('fire-ring-hud--visible', count > 0);
    }

    initPointerLock() {
        const startScreen = document.getElementById('start-screen');
        const hud = document.getElementById('hud');

        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === this.renderer.domElement) {
                startScreen.style.display = 'none';
                hud.style.display = 'flex';
                this.toggleFlashlight(true);
                setTimeout(() => {
                    this.showHelpPopup(
                        'Build a fire: 10 rocks in a ring (E), then 5 sticks in the pit — find sticks or chop a tree for wood.',
                        6200
                    );
                }, 800);
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

    checkBulletCollisions() {
        /* Reserved for future hit targets */
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
        if (this.lakeFishUpdate) this.lakeFishUpdate(elapsed);
        this.world.updateDecorationTime(elapsed);
        this.world.updateTreeWind(elapsed);
        if (this.character.isLoaded) {
            this.world.updatePickupRockHighlight(updatePos, elapsed);
        }
        this.sky.update(elapsed, this.camera.position, this.dayPhase);
        
        const dogPos = this.dog && typeof this.dog.getPosition === 'function' ? this.dog.getPosition() : null;

        if (this.chickenSpawner) {
            this.chickenSpawner.update(delta, this.world, dogPos);
        }
        if (this.butterflySpawner) {
            this.butterflySpawner.update(delta, updatePos, this.world);
        }
        
        if (this.dog && this.character.isLoaded) {
            this.dog.update(delta, this.character.getPosition(), this.character.rotation, this.world);
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

            if (this.axe.getState() === 'flying') {
                this.world.tryAxeHitTree(this.axe.getPosition(), this.axe.flightHitTreeIds);
            }
        }
        
        if (this.fireManager) {
            this.fireManager.update(delta);
        }

        this.updateFireRingPreviewPulse(elapsed);
        
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
