import * as THREE from 'three';
import { WorldManager } from './world.js';
import { Controls } from './controls.js';
import { SkyDome } from './sky.js';
import { Drone } from './drone.js';
import { Tank } from './tank.js';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);
        this.scene.fog = new THREE.FogExp2(0x111111, 0.002);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
        this.camera.position.set(0, 10, 50);

        // Audio System
        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);

        this.renderer = new THREE.WebGLRenderer({
            canvas: document.querySelector('#three-canvas'),
            antialias: true
        });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;

        this.world = new WorldManager(this.scene);
        this.controls = new Controls(this.camera, this.renderer.domElement);
        this.sky = new SkyDome(this.scene);
        this.drone = new Drone(this.scene, this.listener);
        this.tank = new Tank(this.scene);
        
        // Bullet System
        this.bullets = [];
        this.bulletGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        this.bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        
        this.flashlightOn = false;
        this.isDay = false;
        this.dayPhase = 0.0;
        this.targetDayPhase = 0.0;

        // Rifle HUD State
        this.rifleHUD = document.getElementById('rifle-hud');
        this.rifleState = 'idle';
        this.isReloading = false;
        this.isFiring = false;
        this.isAiming = false;

        this.initLights();
        this.initUI();
        this.initPointerLock();
        this.clock = new THREE.Clock();

        this.animate();
        window.addEventListener('resize', () => this.onResize());

        // Stats updates
        setInterval(() => {
            const chunkCount = document.getElementById('chunk-count');
            const playerPos = document.getElementById('player-pos');
            if (chunkCount) chunkCount.textContent = this.world.chunks.size;
            if (playerPos) {
                const pos = this.camera.position;
                playerPos.textContent = `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`;
            }
        }, 100);
    }

    initLights() {
        this.flashlight = new THREE.SpotLight(0xffffff, 0, 300, Math.PI / 6, 0.4, 1);
        this.flashlight.castShadow = true;
        this.scene.add(this.flashlight);
        this.scene.add(this.flashlight.target);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0);
        this.scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 0);
        this.sunLight.position.set(100, 200, -100);
        this.sunLight.castShadow = true;
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
        });

        transitionBtn.addEventListener('click', (e) => {
            this.isDay = !this.isDay;
            this.targetDayPhase = this.isDay ? 1.0 : 0.0;
            e.stopPropagation();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'f') {
                this.toggleFlashlight(!this.flashlightOn);
            }
            if (e.key === '1') {
                this.isDay = !this.isDay;
                this.targetDayPhase = this.isDay ? 1.0 : 0.0;
            }
            if (e.key.toLowerCase() === 'r' && !this.isReloading) {
                this.reload();
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (!this.controls.controls.isLocked) return;
            
            if (e.button === 0) { // Left Click - Fire
                this.fire();
            } else if (e.button === 2) { // Right Click - Aim
                this.isAiming = true;
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) { // Right Click - Release Aim
                this.isAiming = false;
            }
        });

        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    fire() {
        if (this.isReloading || this.isFiring) return;
        this.isFiring = true;
        
        // Spawn Real Bullet
        const bullet = new THREE.Mesh(this.bulletGeometry, this.bulletMaterial);
        bullet.position.copy(this.camera.position);
        
        // Get camera forward direction
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);
        
        bullet.userData = {
            velocity: direction.multiplyScalar(400), // High Speed
            lifetime: 2.0
        };
        
        this.scene.add(bullet);
        this.bullets.push(bullet);

        setTimeout(() => {
            this.isFiring = false;
        }, 150);
    }

    reload() {
        this.isReloading = true;
        setTimeout(() => {
            this.isReloading = false;
        }, 2000);
    }

    initPointerLock() {
        const startScreen = document.getElementById('start-screen');
        const hud = document.getElementById('hud');

        this.controls.controls.addEventListener('lock', () => {
            startScreen.style.display = 'none';
            hud.style.display = 'flex';
            this.toggleFlashlight(true);
        });

        this.controls.controls.addEventListener('unlock', () => {
            startScreen.style.display = 'flex';
            hud.style.display = 'none';
            this.toggleFlashlight(false);
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
    }

    updateRifleHUD() {
        if (!this.rifleHUD) return;
        
        let newState = 'idle';
        if (this.isReloading) newState = 'reloading';
        else if (this.isFiring) newState = 'firing';
        else if (this.isAiming) newState = 'aiming';

        if (this.rifleState !== newState) {
            this.rifleHUD.className = '';
            this.rifleHUD.classList.add(newState);
            this.rifleState = newState;
        }
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

            // Bullet-to-Entity Collision Detection
            this.checkBulletCollisions(bullet, i);
        }
    }

    checkBulletCollisions(bullet, index) {
        // Drone Hit Test
        if (this.drone && this.drone.model && !this.drone.isDestroyed && !this.drone.isCrashing) {
            const dist = bullet.position.distanceTo(this.drone.model.position);
            if (dist < 8) { // Hitbox radius
                this.drone.takeHit();
                this.scene.remove(bullet);
                this.bullets.splice(index, 1);
                return;
            }
        }

        // Tank Hit Test
        if (this.tank && this.tank.container && !this.tank.isDestroyed) {
            const dist = bullet.position.distanceTo(this.tank.container.position);
            if (dist < 10) { // Hitbox radius
                this.tank.takeHit();
                this.scene.remove(bullet);
                this.bullets.splice(index, 1);
                return;
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock.getDelta();

        const transitionSpeed = 0.5;
        if (Math.abs(this.dayPhase - this.targetDayPhase) > 0.01) {
            this.dayPhase = THREE.MathUtils.lerp(this.dayPhase, this.targetDayPhase, delta * transitionSpeed);
            if (this.ambientLight) this.ambientLight.intensity = this.dayPhase * 0.8;
            if (this.sunLight) this.sunLight.intensity = this.dayPhase * 1.5;
            
            const nightFog = new THREE.Color(0x111111);
            const dayFog = new THREE.Color(0x7fbfff);
            this.scene.fog.color.lerpColors(nightFog, dayFog, this.dayPhase);
            this.scene.fog.density = THREE.MathUtils.lerp(0.002, 0.0005, this.dayPhase);
        } else {
            this.dayPhase = this.targetDayPhase;
        }

        this.controls.update(delta, this.world);
        this.world.update(this.camera.position);
        this.sky.update(this.clock.getElapsedTime(), this.camera.position, this.dayPhase);
        
        if (this.drone) this.drone.update(delta, this.camera.position);
        if (this.tank) this.tank.update(delta, this.camera.position);
        
        this.updateBullets(delta);

        if (this.flashlight) {
            this.flashlight.position.copy(this.camera.position);
            const targetPos = new THREE.Vector3(0, 0, -1);
            targetPos.applyQuaternion(this.camera.quaternion);
            targetPos.add(this.camera.position);
            this.flashlight.target.position.copy(targetPos);
        }

        this.updateRifleHUD();
        this.renderer.render(this.scene, this.camera);
    }
}

new Game();
