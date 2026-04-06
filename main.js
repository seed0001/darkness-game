import * as THREE from 'three';
import { WorldManager } from './world.js';
import { Controls } from './controls.js';
import { SkyDome } from './sky.js';
import { Tank } from './tank.js';
import { Character } from './character.js';
import { Dog } from './dog.js';
import { ChickenSpawner } from './chicken.js';
import { ButterflySpawner } from './butterfly.js';
import { Pitbull } from './pitbull.js';
import { ThrowingAxe } from './axe.js';
import { FireManager } from './fire.js';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);
        this.scene.fog = new THREE.FogExp2(0x111111, 0.002);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
        this.camera.position.set(0, 20, 30);

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
        
        this.character = new Character(this.scene);
        
        this.controls = new Controls(this.camera, this.renderer.domElement, this.character);
        
        this.sky = new SkyDome(this.scene);
        this.tank = new Tank(this.scene);
        
        const getPlayerPos = () => this.character.isLoaded ? this.character.getPosition() : new THREE.Vector3(0, 0, 0);
        
        this.dog = new Dog(this.scene, getPlayerPos);
        this.pitbull = new Pitbull(this.scene, getPlayerPos);
        this.chickenSpawner = new ChickenSpawner(this.scene, getPlayerPos);
        this.butterflySpawner = new ButterflySpawner(this.scene, this.world);
        
        const getPlayerDir = () => {
            const dir = new THREE.Vector3(0, 0, -1);
            dir.applyQuaternion(this.camera.quaternion);
            return dir;
        };
        this.axe = new ThrowingAxe(this.scene, getPlayerPos, getPlayerDir);
        this.axe.setCharacter(this.character);
        this.dog.setAxe(this.axe);
        
        this.fireManager = new FireManager(this.scene);
        
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
        this.clock = new THREE.Clock();

        this.animate();
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

    initLights() {
        this.flashlight = new THREE.SpotLight(0xffffff, 0, 300, Math.PI / 6, 0.4, 1);
        this.flashlight.castShadow = true;
        this.scene.add(this.flashlight);
        this.scene.add(this.flashlight.target);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
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

    spawnFire() {
        if (!this.character.isLoaded) return;
        
        const charPos = this.character.getPosition();
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);
        
        const firePos = charPos.clone();
        firePos.addScaledVector(direction, 5);
        
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
        const delta = this.clock.getDelta();

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
        this.sky.update(this.clock.getElapsedTime(), this.camera.position, this.dayPhase);
        
        if (this.tank) this.tank.update(delta, updatePos);
        
        const playerIsMoving = this.controls.moveForward || this.controls.moveBackward || 
                               this.controls.moveLeft || this.controls.moveRight;
        
        if (this.dog) {
            if (this.axe && this.axe.shouldDogRetrieve()) {
                const axePos = this.axe.startDogRetrieval();
                if (axePos) {
                    this.dog.startAxeRetrieval(axePos);
                }
            }
            this.dog.update(delta, this.world);
        }
        if (this.pitbull) {
            this.pitbull.update(delta, this.world, playerIsMoving);
        }
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

new Game();
