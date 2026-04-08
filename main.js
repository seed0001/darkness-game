import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { WorldManager, sampleLakeDepth } from './world.js';
import { Controls } from './controls.js';
import { SkyDome } from './sky.js';
import { Dog } from './dog.js';
import {
    Character,
    CHARACTER_PROFILES,
    CHARACTER_STORAGE_KEY,
    DEFAULT_CHARACTER_ID
} from './character.js';
import { ChickenSpawner } from './chicken.js';
import { ButterflySpawner } from './butterfly.js';
import { ThrowingAxe } from './axe.js';
import { FireManager, preloadFireMedia } from './fire.js';
import { AmbientWind } from './ambientWind.js';
import { loadLakeFish } from './lakeFish.js';
import { loadScorpions } from './scorpion.js';
import { loadFlyingAirbus } from './airbus.js';
import { WorldMinimap } from './minimap.js';
import { BackpackManager } from './backpack.js';
import { grassSettings, saveGrassSettings, GRASS_BLADE_MAX } from './grassSettings.js';
import {
    COOK_TIME_SEC,
    HUNGER_DRAIN_PER_SEC,
    HUNGER_PER_MEAL,
    HEALTH_PER_MEAL,
    WATER_PER_MEAL,
    MENTALITY_PER_MEAL,
    WATER_DRAIN_PER_SEC,
    MENTALITY_DRAIN_NIGHT_PER_SEC,
    MENTALITY_RECOVER_DAY_PER_SEC,
    HEALTH_DRAIN_STARVING_PER_SEC,
    HEALTH_DRAIN_DEHYDRATED_PER_SEC,
    HEALTH_REGEN_PASSIVE_PER_SEC,
    createFishFoodMesh,
    createMeatFoodMesh
} from './food.js';

function inventoryFoodSlotClass(foodKind) {
    if (foodKind === 'berry') return 'inventory-slot--food-berry';
    if (foodKind === 'meat') return 'inventory-slot--food-meat';
    return 'inventory-slot--food-fish';
}

function displayFoodName(foodKind) {
    if (foodKind === 'berry') return 'Berry';
    if (foodKind === 'meat') return 'Meat';
    return 'Fish';
}

/** Persisted start-screen options (animation / world extras). */
const OPT = {
    performance: 'darkness-opt-performance',
    lakeFish: 'darkness-opt-lake-fish',
    chickens: 'darkness-opt-chickens',
    butterflies: 'darkness-opt-butterflies',
    scorpions: 'darkness-opt-scorpions',
    airbus: 'darkness-opt-airbus',
};

function readStoredBool(key, defaultValue) {
    const v = localStorage.getItem(key);
    if (v === null) return defaultValue;
    return v === 'true';
}

const AXE_CHOP_SFX_URLS = ['/712100__birdswkaren__axe-cut-6.wav', '/audio/axe-cut-6.wav'];
const AXE_MINING_STONE_SFX_URLS = [
    '/audio/240801__ryanconway__pickaxe-mining-stone.wav',
    '/240801__ryanconway__pickaxe-mining-stone.wav'
];
const INVENTORY_ZIP_SFX_URLS = ['/790043__ishaanbidaye01__bag-zip.mp3', '/audio/bag-zip.mp3'];
const NIGHT_FOREST_AMBIENCE_URLS = ['/651341__iliyabylich04__forest-1.mp3', '/audio/forest-1.mp3'];
const DAY_BIRDSONG_URLS = ['/424251__seenms__bird-songs-in-forest.wav', '/audio/bird-songs-in-forest.wav'];
const BRUSH_FOOTSTEP_URLS = ['/132735__ciccarelli__walking-in-the-brush.wav', '/audio/walking-in-the-brush.wav'];
const WET_FOOTSTEP_URLS = ['/583756__bia12__wet-footsteps.mp3', '/audio/wet-footsteps.mp3'];
const STICK_BUNDLE_ICON_URL_CANDIDATES = [
    '/icons/stick-bundle.png',
    '/Meshy_AI_small_bundle_of_stick_0407134049_texture_fbx/Screenshot 2026-04-07 101554.png',
    '/Meshy_AI_small_bundle_of_stick_0407134049_texture_fbx/Meshy_AI_small_bundle_of_stick_0407134049_texture.png'
];
const ROCK_ICON_URL_CANDIDATES = [
    '/icons/rock.png',
    '/Meshy_AI_small_bundle_of_stick_0407134049_texture_fbx/Screenshot 2026-04-07 103627.png'
];

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        const nightHorizon = 0x252b26;
        this.scene.background = new THREE.Color(nightHorizon);
        this.scene.fog = new THREE.FogExp2(nightHorizon, 0.00175);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500000);
        this.camera.position.set(0, 20, 30);

        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);
        this.ambientWind = new AmbientWind(this.listener);

        this.renderer = new THREE.WebGLRenderer({
            canvas: document.querySelector('#three-canvas'),
            antialias: false,
            powerPreference: 'high-performance'
        });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(1.0, window.devicePixelRatio || 1));
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.info.autoReset = true;
        this.reportGraphicsBackend();

        this.world = new WorldManager(this.scene, this.renderer);

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
            const p = this.character.getPosition();
            const kind = this.world.tryMeleeAxeHit(p, forward);
            if (kind === 'boulder') {
                this.playAxeMiningStoneSound();
            } else if (!kind && this.tryMeleeHitChicken(p, forward)) {
                this.playAxeChopSound();
            } else if (!kind && this.tryCatchLakeFish(p, forward)) {
                this.playAxeChopSound();
            }
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
        this.inventoryOpen = false;
        this.settingsOpen = false;
        this.dogEnabled = true;
        this.backpackEnabled = true;
        /** Chunk radius + shadow reduction; read before first preload (next session reflects start-screen toggle). */
        this.performanceMode = readStoredBool(OPT.performance, true);
        /** Updated when the player clicks Start; gates spawner tick / keyboard spawns. */
        this.chickensEnabled = false;
        this.butterfliesEnabled = false;
        this._scorpionsPlaced = false;
        this.axeChopSound = null;
        this.axeMiningStoneSound = null;
        this.inventoryZipSound = null;
        this.craftOpen = false;
        this.placingFireKit = false;
        this.pendingFireToLight = null;
        this.craftGhost = null;
        this.hunger = 100;
        this.health = 100;
        this.water = 100;
        this.mentality = 100;
        this.cookOpen = false;
        /** @type {(null | { foodKind: string, cooked: boolean, progress: number, mesh: import('three').Mesh })[]} */
        this.cookSlots = new Array(12).fill(null);
        this.cookItemRoot = new THREE.Group();
        this.cookItemRoot.name = 'cookItems';
        this.scene.add(this.cookItemRoot);
        this._fKeyDownAt = 0;
        this._fIgniteTimer = null;
        this.stickIconUrl = STICK_BUNDLE_ICON_URL_CANDIDATES[1];
        this.rockIconUrl = ROCK_ICON_URL_CANDIDATES[1];
        this.nightForestSound = null;
        this.dayBirdsongSound = null;
        this.brushFootstepSound = null;
        this.wetFootstepSound = null;
        this.lastFootstepPos = null;
        this.activeFootstepSurface = null;

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
        this.applyPerformanceMode();
        this.resolveStickIconUrl();
        this.resolveRockIconUrl();
        this.initUiSounds();
        this.initFootstepSounds();
        this.initUI();
        this.initPointerLock();
        this.clock = null;
        this.lakeFishUpdate = null;
        /** @type {{ mesh: import('three').Object3D, alive: boolean }[]} */
        this.lakeFishInstances = [];
        this.airbusUpdate = null;
        this.worldMinimap = null;

        const minimapCanvas = document.getElementById('world-minimap');
        if (minimapCanvas) {
            this.worldMinimap = new WorldMinimap(minimapCanvas, () => {
                if (this.character?.isLoaded) {
                    const p = this.character.getPosition();
                    return { x: p.x, z: p.z };
                }
                return { x: 0, z: 0 };
            });
        }

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
                this.axe.readyPromise.catch((err) => console.warn('Axe load:', err)),
                this.dog.readyPromise.catch((err) => console.warn('Dog load:', err)),
                this.backpackManager.readyPromise.catch((err) => console.warn('Backpack load:', err)),
                this.ambientWind.bufferPromise,
                preloadFireMedia(),
                new FBXLoader().loadAsync('/models/butterfly.fbx').catch(() => {}),
                new FBXLoader().loadAsync('/models/chicken.fbx').catch(() => {})
            ]);

            this.applyFeatureToggles();

            setProgress(0.26);

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

    /**
     * Loads lake fish, scorpions, and/or Airbus after the player confirms start-screen toggles.
     */
    async loadOptionalAnimatedContent({ lakeFish, scorpions, airbus }) {
        const tasks = [];
        if (lakeFish && !this.lakeFishUpdate) {
            tasks.push(
                loadLakeFish(this.scene).then((result) => {
                    if (result && typeof result.update === 'function') {
                        this.lakeFishUpdate = result.update;
                        this.lakeFishInstances = result.instances || [];
                    }
                })
            );
        }
        if (scorpions && !this._scorpionsPlaced) {
            tasks.push(
                loadScorpions(this.scene, this.world)
                    .then(() => {
                        this._scorpionsPlaced = true;
                    })
                    .catch((err) => console.warn('Scorpions:', err))
            );
        }
        if (airbus && !this.airbusUpdate) {
            tasks.push(
                loadFlyingAirbus(this.scene, this.world)
                    .then((update) => {
                        this.airbusUpdate = update;
                    })
                    .catch((err) => {
                        console.warn('Airbus:', err);
                    })
            );
        }
        await Promise.all(tasks);
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

    applyPerformanceMode() {
        if (!this.performanceMode) return;
        this.renderer.setPixelRatio(Math.min(1.0, window.devicePixelRatio || 1));
        if (this.world) {
            this.world.baseChunkRadius = 1;
            this.world.chunkStreamRadius = 1;
            this.world.preloadChunkRadius = 2;
            this.world.chunkGenBudgetPerFrame = 2;
        }
        if (this.flashlight) this.flashlight.castShadow = false;
        if (this.sunLight) this.sunLight.castShadow = false;
    }

    initUI() {
        const startBtn = document.getElementById('start-btn');
        const transitionBtn = document.getElementById('transition-btn');
        const dogToggle = document.getElementById('toggle-dog');
        const backpackToggle = document.getElementById('toggle-backpack');
        const perfToggle = document.getElementById('toggle-performance');
        const lakeFishToggle = document.getElementById('toggle-lake-fish');
        const chickensToggle = document.getElementById('toggle-chickens');
        const butterfliesToggle = document.getElementById('toggle-butterflies');
        const scorpionsToggle = document.getElementById('toggle-scorpions');
        const airbusToggle = document.getElementById('toggle-airbus');

        if (perfToggle) perfToggle.checked = this.performanceMode;
        if (lakeFishToggle) lakeFishToggle.checked = readStoredBool(OPT.lakeFish, false);
        if (chickensToggle) chickensToggle.checked = readStoredBool(OPT.chickens, false);
        if (butterfliesToggle) butterfliesToggle.checked = readStoredBool(OPT.butterflies, false);
        if (scorpionsToggle) scorpionsToggle.checked = readStoredBool(OPT.scorpions, false);
        if (airbusToggle) airbusToggle.checked = readStoredBool(OPT.airbus, false);

        const characterRadios = document.querySelectorAll('input[name="character"]');
        const savedChar = localStorage.getItem(CHARACTER_STORAGE_KEY);
        if (savedChar && CHARACTER_PROFILES[savedChar]) {
            characterRadios.forEach((r) => {
                if (r instanceof HTMLInputElement) r.checked = r.value === savedChar;
            });
        }
        const invGrid = document.getElementById('inventory-grid');
        if (invGrid && invGrid.children.length === 0) {
            for (let i = 0; i < 24; i++) {
                const slot = document.createElement('button');
                slot.type = 'button';
                slot.className = 'inventory-slot';
                slot.dataset.slot = String(i);
                slot.textContent = '';
                invGrid.appendChild(slot);
            }
        }
        this.refreshInventoryUI();
        this.refreshCraftUI();
        this.applyFeatureToggles();

        startBtn.addEventListener('click', async () => {
            const selected =
                document.querySelector('input[name="character"]:checked')?.value ?? DEFAULT_CHARACTER_ID;
            this.dogEnabled = !!dogToggle?.checked;
            this.backpackEnabled = !!backpackToggle?.checked;

            if (perfToggle) {
                localStorage.setItem(OPT.performance, perfToggle.checked ? 'true' : 'false');
            }
            const lakeFishOn = !!lakeFishToggle?.checked;
            const chickensOn = !!chickensToggle?.checked;
            const butterfliesOn = !!butterfliesToggle?.checked;
            const scorpionsOn = !!scorpionsToggle?.checked;
            const airbusOn = !!airbusToggle?.checked;
            localStorage.setItem(OPT.lakeFish, lakeFishOn ? 'true' : 'false');
            localStorage.setItem(OPT.chickens, chickensOn ? 'true' : 'false');
            localStorage.setItem(OPT.butterflies, butterfliesOn ? 'true' : 'false');
            localStorage.setItem(OPT.scorpions, scorpionsOn ? 'true' : 'false');
            localStorage.setItem(OPT.airbus, airbusOn ? 'true' : 'false');

            this.chickensEnabled = chickensOn;
            this.butterfliesEnabled = butterfliesOn;

            const prevLabel = startBtn.textContent;
            startBtn.disabled = true;
            startBtn.textContent = 'Loading character…';
            try {
                await this.character.loadCharacter(selected);
                localStorage.setItem(CHARACTER_STORAGE_KEY, selected);
                if (this.backpackManager.loaded) {
                    this.backpackManager.attachToCharacter(this.character);
                }
            } catch (err) {
                console.error('Character load failed:', err);
                this.showHelpPopup(
                    'Could not load that character. Check that model files exist under public/models/.',
                    7000
                );
                startBtn.disabled = false;
                startBtn.textContent = prevLabel;
                return;
            }

            startBtn.textContent = 'Loading world extras…';
            try {
                await this.loadOptionalAnimatedContent({
                    lakeFish: lakeFishOn,
                    scorpions: scorpionsOn,
                    airbus: airbusOn,
                });
            } catch (err) {
                console.warn('Optional world content:', err);
            }

            this.applyFeatureToggles();
            this.controls.lock();
            if (THREE.AudioContext.getContext().state !== 'running') {
                THREE.AudioContext.getContext().resume();
            }
            if (this.ambientWind) {
                this.ambientWind.beginAfterUserGesture();
            }
            this.beginDayNightAmbience();
            startBtn.disabled = false;
            startBtn.textContent = prevLabel;
        });

        if (invGrid) {
            invGrid.addEventListener('click', (e) => {
                const target = e.target;
                if (!(target instanceof HTMLElement)) return;
                const slot = target.closest('.inventory-slot');
                if (!slot) return;
                const index = Number(slot.dataset.slot);
                if (!Number.isFinite(index)) return;
                this.onInventorySlotClick(index);
            });
            invGrid.addEventListener('contextmenu', (e) => {
                if (!this.inventoryOpen) return;
                const target = e.target;
                if (!(target instanceof HTMLElement)) return;
                const slot = target.closest('.inventory-slot');
                if (!slot) return;
                const index = Number(slot.dataset.slot);
                if (!Number.isFinite(index)) return;
                e.preventDefault();
                this.tryConsumeCookedFoodFromSlot(index);
            });
        }

        const craftFireSlot = document.getElementById('craft-fire-slot');
        if (craftFireSlot) {
            craftFireSlot.addEventListener('click', () => this.armFirePlacement());
        }

        const cookGrid = document.getElementById('cook-grid');
        if (cookGrid && cookGrid.children.length === 0) {
            for (let i = 0; i < 12; i++) {
                const slot = document.createElement('button');
                slot.type = 'button';
                slot.className = 'inventory-slot';
                slot.dataset.cookSlot = String(i);
                slot.textContent = '';
                cookGrid.appendChild(slot);
            }
        }
        if (cookGrid) {
            cookGrid.addEventListener('click', (e) => {
                const target = e.target;
                if (!(target instanceof HTMLElement)) return;
                const slot = target.closest('.inventory-slot');
                if (!slot || slot.dataset.cookSlot === undefined) return;
                const index = Number(slot.dataset.cookSlot);
                if (!Number.isFinite(index)) return;
                this.onCookSlotClick(index);
            });
        }
        this.refreshCookUI();
        this.refreshVitalsHud();

        this.initGrassSettingsUI();

        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() !== 'f' || e.repeat) return;
            this._fKeyDownAt = performance.now();
            if (this._fIgniteTimer) clearTimeout(this._fIgniteTimer);
            this._fIgniteTimer = setTimeout(() => {
                this.tryIgnitePlacedFire();
                this._fIgniteTimer = null;
            }, 1000);
        });
        window.addEventListener('keyup', (e) => {
            if (e.key.toLowerCase() !== 'f') return;
            if (this._fIgniteTimer) {
                clearTimeout(this._fIgniteTimer);
                this._fIgniteTimer = null;
            }
            const elapsed = performance.now() - this._fKeyDownAt;
            if (elapsed < 1000) {
                this.tryToggleCookNearLitFire();
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
                this.tryPickupOrInteract();
            }

            if (e.key.toLowerCase() === 'i') {
                this.toggleInventory();
            }
            if (e.key.toLowerCase() === 'o') {
                this.toggleSettings();
            }
            if (e.key.toLowerCase() === 'c') {
                this.toggleCraft();
            }
            const playerPos = this.character.isLoaded
                ? this.character.getPosition()
                : new THREE.Vector3();

            if (e.key === '4' && this.butterfliesEnabled && this.butterflySpawner) {
                this.butterflySpawner.spawnOneNear(playerPos, this.world, 2);
            }
            if (e.key === '5' && this.butterfliesEnabled && this.butterflySpawner) {
                this.butterflySpawner.spawnOneNear(playerPos, this.world, 3);
            }
            if (e.key === '6' && this.butterfliesEnabled && this.butterflySpawner) {
                this.butterflySpawner.spawnOneNear(playerPos, this.world, 1);
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (!this.controls.isLocked) return;
            
            if (e.button === 0) {
                if (this.tryPlaceCraftFire()) return;
                if (this.tryClickChoppableLog()) return;
                this.swingAxe();
            }
        });

        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    reportGraphicsBackend() {
        const gpuEl = document.getElementById('gpu-status');
        const gl = this.renderer.getContext();
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown';
        const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown renderer';
        const low = `${vendor} ${renderer}`.toLowerCase();
        const software = low.includes('swiftshader') || low.includes('software') || low.includes('llvmpipe');
        const backendText = software ? 'Software renderer detected' : `${vendor} / ${renderer}`;

        if (gpuEl) {
            gpuEl.textContent = backendText;
            gpuEl.style.color = software ? '#ffb3a5' : '#95d8a6';
        }
        if (software) {
            this.showHelpPopup('Browser is using software rendering. Enable hardware acceleration in browser settings.', 6500);
            console.warn('Software renderer detected:', vendor, renderer);
        } else {
            console.info('GPU backend:', vendor, renderer);
        }
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
        if (!this.axe.startSwing()) return;
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(this.camera.quaternion);
        if (this.world.isTreeOnlyNearForChop(this.character.getPosition(), forward)) {
            this.playAxeChopSound();
        }
    }

    throwAxe() {
        if (!this.character.isLoaded || !this.axe) return;

        const charPos = this.character.getPosition();
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);

        this.axe.throw(direction, charPos);
    }

    tryPickupOrInteract() {
        if (!this.character.isLoaded) return;
        if (this.inventoryOpen && this.backpackEnabled && this.backpackManager?.loaded) {
            if (this.backpackManager.storeHeldItem(this.character)) {
                this.refreshInventoryUI();
                this.refreshCraftUI();
                this.showHelpPopup('Stored item in backpack.', 1600);
            } else {
                this.showHelpPopup('Hold a rock, stick, or food to store it.', 1800);
            }
            return;
        }

        this.tryPickupOrDropRock();
    }

    applyFeatureToggles() {
        if (this.dog?.model) {
            this.dog.model.visible = this.dogEnabled;
        }
        if (this.backpackManager) {
            this.backpackManager.setEnabled(this.backpackEnabled);
        }
        if (this.chickenSpawner) {
            this.chickenSpawner.autoSpawn = !!this.chickensEnabled;
            if (
                this.chickensEnabled &&
                this.character?.isLoaded &&
                this.chickenSpawner.chickens.length === 0
            ) {
                const cap = Math.min(4, this.chickenSpawner.maxChickens);
                for (let i = 0; i < cap; i++) {
                    this.chickenSpawner.spawnChicken();
                }
            }
        }
        if (!this.backpackEnabled) {
            this.inventoryOpen = false;
            this.craftOpen = false;
            this.cookOpen = false;
            this.placingFireKit = false;
            if (this.craftGhost) this.craftGhost.visible = false;
            this.refreshInventoryUI();
            this.refreshCraftUI();
            this.refreshCookUI();
            this.updateUiInteractionMode();
        }
    }

    initGrassSettingsUI() {
        const panel = document.getElementById('settings-panel');
        const openBtn = document.getElementById('settings-btn');
        const closeBtn = document.getElementById('settings-close');
        const density = document.getElementById('grass-density');
        const widthEl = document.getElementById('grass-width');
        const heightEl = document.getElementById('grass-height');
        const densityVal = document.getElementById('grass-density-val');
        const widthVal = document.getElementById('grass-width-val');
        const heightVal = document.getElementById('grass-height-val');
        const bladeEst = document.getElementById('grass-blades-estimate');
        const applyBtn = document.getElementById('grass-apply');

        const updateEstimates = () => {
            const d = density ? Number(density.value) : grassSettings.density;
            if (densityVal) densityVal.textContent = String(d);
            if (widthVal && widthEl) widthVal.textContent = String(widthEl.value);
            if (heightVal && heightEl) heightVal.textContent = String(heightEl.value);
            if (bladeEst) {
                const n = Math.round(GRASS_BLADE_MAX * Math.max(0, Math.min(100, d)) * 0.01);
                bladeEst.textContent = `~${n} blades per chunk at this density`;
            }
        };

        density?.addEventListener('input', updateEstimates);
        widthEl?.addEventListener('input', updateEstimates);
        heightEl?.addEventListener('input', updateEstimates);

        applyBtn?.addEventListener('click', () => {
            if (density) grassSettings.density = Math.max(0, Math.min(100, Number(density.value)));
            if (widthEl) grassSettings.width = Math.max(25, Math.min(200, Number(widthEl.value)));
            if (heightEl) grassSettings.height = Math.max(25, Math.min(200, Number(heightEl.value)));
            saveGrassSettings();
            if (this.world) {
                this.world.regenerateAllGrass();
                this.showHelpPopup('Grass settings applied to loaded terrain.', 2600);
            } else {
                this.showHelpPopup('Grass settings saved. They apply when the world loads.', 2400);
            }
            updateEstimates();
        });

        openBtn?.addEventListener('click', () => this.toggleSettings());
        closeBtn?.addEventListener('click', () => this.toggleSettings());
        updateEstimates();
    }

    syncGrassSettingsSliders() {
        const density = document.getElementById('grass-density');
        const widthEl = document.getElementById('grass-width');
        const heightEl = document.getElementById('grass-height');
        if (density) density.value = String(grassSettings.density);
        if (widthEl) widthEl.value = String(grassSettings.width);
        if (heightEl) heightEl.value = String(grassSettings.height);
        const densityVal = document.getElementById('grass-density-val');
        const widthVal = document.getElementById('grass-width-val');
        const heightVal = document.getElementById('grass-height-val');
        const bladeEst = document.getElementById('grass-blades-estimate');
        if (densityVal) densityVal.textContent = String(grassSettings.density);
        if (widthVal) widthVal.textContent = String(grassSettings.width);
        if (heightVal) heightVal.textContent = String(grassSettings.height);
        if (bladeEst) {
            const n = Math.round(GRASS_BLADE_MAX * Math.max(0, Math.min(100, grassSettings.density)) * 0.01);
            bladeEst.textContent = `~${n} blades per chunk at this density`;
        }
    }

    toggleSettings() {
        const next = !this.settingsOpen;
        if (next) {
            this.inventoryOpen = false;
            this.craftOpen = false;
            this.cookOpen = false;
            this.refreshInventoryUI();
            this.refreshCraftUI();
            this.refreshCookUI();
        }
        this.settingsOpen = next;
        const panel = document.getElementById('settings-panel');
        if (panel) {
            panel.classList.toggle('inventory-panel--open', this.settingsOpen);
            panel.setAttribute('aria-hidden', this.settingsOpen ? 'false' : 'true');
        }
        if (this.settingsOpen) {
            this.syncGrassSettingsSliders();
        }
        this.updateUiInteractionMode();
    }

    toggleInventory() {
        if (!this.backpackEnabled || !this.backpackManager?.loaded) {
            this.showHelpPopup('Backpack inventory is disabled on the start screen.', 2600);
            return;
        }
        this.inventoryOpen = !this.inventoryOpen;
        if (this.inventoryOpen) {
            this.settingsOpen = false;
            const sp = document.getElementById('settings-panel');
            if (sp) {
                sp.classList.remove('inventory-panel--open');
                sp.setAttribute('aria-hidden', 'true');
            }
        }
        this.playInventoryZipSound();
        if (this.inventoryOpen && this.backpackManager.storeHeldItem(this.character)) {
            this.refreshCraftUI();
            this.showHelpPopup('Stored item in backpack.', 1800);
        }
        this.refreshInventoryUI();
        this.refreshCraftUI();
        this.updateUiInteractionMode();
    }

    refreshInventoryUI() {
        const panel = document.getElementById('inventory-panel');
        const count = document.getElementById('inventory-count');
        const grid = document.getElementById('inventory-grid');
        if (!panel || !count || !grid) return;

        panel.classList.toggle('inventory-panel--open', this.inventoryOpen);
        panel.setAttribute('aria-hidden', this.inventoryOpen ? 'false' : 'true');
        const slots = this.backpackManager?.getSlots?.() || [];
        let usedSlots = 0;
        for (let i = 0; i < slots.length; i++) if (slots[i]) usedSlots++;
        count.textContent = `${usedSlots} / 24`;

        const kids = Array.from(grid.children);
        for (let i = 0; i < kids.length; i++) {
            const el = kids[i];
            if (!(el instanceof HTMLElement)) continue;
            const item = slots[i];
            el.classList.remove(
                'inventory-slot--filled',
                'inventory-slot--rock',
                'inventory-slot--stick',
                'inventory-slot--food-berry',
                'inventory-slot--food-fish',
                'inventory-slot--food-meat',
                'inventory-slot--food-cooked'
            );
            const existingCount = el.querySelector('.inventory-slot__count');
            if (existingCount) existingCount.remove();
            if (!item) {
                el.textContent = '';
                el.style.backgroundImage = '';
                el.style.backgroundSize = '';
                el.style.backgroundPosition = '';
                el.style.backgroundRepeat = '';
                continue;
            }
            el.classList.add('inventory-slot--filled');
            if (item.type === 'food') {
                el.style.backgroundImage = '';
                el.style.backgroundSize = '';
                el.style.backgroundPosition = '';
                el.style.backgroundRepeat = '';
                el.classList.add(inventoryFoodSlotClass(item.foodKind));
                if (item.cooked) el.classList.add('inventory-slot--food-cooked');
                const fn = displayFoodName(item.foodKind);
                el.textContent = item.cooked ? `${fn}·cooked` : fn;
            } else {
                el.classList.add(item.type === 'rock' ? 'inventory-slot--rock' : 'inventory-slot--stick');
                if (item.type === 'stick') {
                    el.textContent = '';
                    el.style.backgroundImage = `url("${this.stickIconUrl}")`;
                    el.style.backgroundSize = '84% 84%';
                    el.style.backgroundPosition = 'center';
                    el.style.backgroundRepeat = 'no-repeat';
                } else {
                    el.textContent = '';
                    el.style.backgroundImage = `url("${this.rockIconUrl}")`;
                    el.style.backgroundSize = '82% 82%';
                    el.style.backgroundPosition = 'center';
                    el.style.backgroundRepeat = 'no-repeat';
                }
            }
            const countBadge = document.createElement('span');
            countBadge.className = 'inventory-slot__count';
            countBadge.textContent = String(item.meshes.length);
            el.appendChild(countBadge);
        }
    }

    initUiSounds() {
        const mk = (urls, volume) => {
            const audio = new Audio(urls[0]);
            audio.preload = 'auto';
            audio.volume = volume;
            audio.addEventListener('error', () => {
                if (audio.src.includes(urls[0]) && urls[1]) {
                    audio.src = urls[1];
                    audio.load();
                }
            });
            return audio;
        };
        this.axeChopSound = mk(AXE_CHOP_SFX_URLS, 0.6);
        this.axeMiningStoneSound = mk(AXE_MINING_STONE_SFX_URLS, 0.58);
        this.inventoryZipSound = mk(INVENTORY_ZIP_SFX_URLS, 0.62);

        const mkLoop = (urls, volume) => {
            const audio = new Audio(urls[0]);
            audio.preload = 'auto';
            audio.loop = true;
            audio.volume = volume;
            audio.addEventListener('error', () => {
                if (audio.src.includes(urls[0]) && urls[1]) {
                    audio.src = urls[1];
                    audio.load();
                }
            });
            return audio;
        };
        this.nightForestSound = mkLoop(NIGHT_FOREST_AMBIENCE_URLS, 0.3);
        this.dayBirdsongSound = mkLoop(DAY_BIRDSONG_URLS, 0.38);
    }

    resolveStickIconUrl() {
        const tryNext = (idx) => {
            if (idx >= STICK_BUNDLE_ICON_URL_CANDIDATES.length) return;
            const test = new Image();
            const url = STICK_BUNDLE_ICON_URL_CANDIDATES[idx];
            test.onload = () => {
                this.stickIconUrl = url;
                this.refreshInventoryUI();
            };
            test.onerror = () => tryNext(idx + 1);
            test.src = url;
        };
        tryNext(0);
    }

    resolveRockIconUrl() {
        const tryNext = (idx) => {
            if (idx >= ROCK_ICON_URL_CANDIDATES.length) return;
            const test = new Image();
            const url = ROCK_ICON_URL_CANDIDATES[idx];
            test.onload = () => {
                this.rockIconUrl = url;
                this.refreshInventoryUI();
            };
            test.onerror = () => tryNext(idx + 1);
            test.src = url;
        };
        tryNext(0);
    }

    playAxeChopSound() {
        if (!this.axeChopSound) return;
        try {
            this.axeChopSound.currentTime = 0;
            void this.axeChopSound.play();
        } catch (e) {
            console.warn('Axe chop SFX play failed:', e);
        }
    }

    playAxeMiningStoneSound() {
        if (!this.axeMiningStoneSound) return;
        try {
            this.axeMiningStoneSound.currentTime = 0;
            void this.axeMiningStoneSound.play();
        } catch (e) {
            console.warn('Axe mining stone SFX play failed:', e);
        }
    }

    playInventoryZipSound() {
        if (!this.inventoryZipSound) return;
        try {
            this.inventoryZipSound.currentTime = 0;
            void this.inventoryZipSound.play();
        } catch (e) {
            console.warn('Inventory zip SFX play failed:', e);
        }
    }

    initFootstepSounds() {
        const mk = (urls, volume) => {
            const audio = new Audio(urls[0]);
            audio.preload = 'auto';
            audio.loop = false;
            audio.volume = volume;
            audio.addEventListener('error', () => {
                if (audio.src.includes(urls[0]) && urls[1]) {
                    audio.src = urls[1];
                    audio.load();
                }
            });
            return audio;
        };
        this.brushFootstepSound = mk(BRUSH_FOOTSTEP_URLS, 0.28);
        this.wetFootstepSound = mk(WET_FOOTSTEP_URLS, 0.72);
    }

    playFootstepClip(audio) {
        if (!audio) return;
        try {
            audio.currentTime = 0;
            void audio.play();
        } catch (e) {
            console.warn('Footstep SFX play failed:', e);
        }
    }

    updateFootsteps(delta) {
        if (!this.character?.isLoaded || !this.controls?.isLocked) return;
        if (!this.character.isGrounded) {
            this.stopFootsteps();
            return;
        }

        const p = this.character.getPosition();
        if (!this.lastFootstepPos) {
            this.lastFootstepPos = p.clone();
            return;
        }
        const dx = p.x - this.lastFootstepPos.x;
        const dz = p.z - this.lastFootstepPos.z;
        const movedDist = Math.hypot(dx, dz);
        this.lastFootstepPos.copy(p);
        const moveSpeed = delta > 0 ? movedDist / delta : 0;
        const moving = moveSpeed > 0.65;
        if (!moving) {
            this.stopFootsteps();
            return;
        }

        const inWater = sampleLakeDepth(p.x, p.z) < -0.14;
        const surface = inWater ? 'water' : 'land';
        if (surface !== this.activeFootstepSurface) {
            this.stopFootsteps();
            this.activeFootstepSurface = surface;
            this.playFootstepClip(surface === 'water' ? this.wetFootstepSound : this.brushFootstepSound);
        }
    }

    stopFootsteps() {
        const stop = (audio) => {
            if (!audio) return;
            audio.pause();
            audio.currentTime = 0;
        };
        stop(this.brushFootstepSound);
        stop(this.wetFootstepSound);
        this.activeFootstepSurface = null;
    }

    beginDayNightAmbience() {
        const safePlay = (a) => {
            if (!a) return;
            if (a.paused) {
                try {
                    void a.play();
                } catch (e) {
                    console.warn('Ambient play failed:', e);
                }
            }
        };
        safePlay(this.nightForestSound);
        safePlay(this.dayBirdsongSound);
        this.updateDayNightAmbienceVolumes();
    }

    updateDayNightAmbienceVolumes() {
        if (!this.nightForestSound || !this.dayBirdsongSound) return;
        const dayMix = THREE.MathUtils.clamp(this.dayPhase, 0, 1);
        const nightMix = 1 - dayMix;
        this.nightForestSound.volume = 0.3 * nightMix;
        this.dayBirdsongSound.volume = 0.38 * dayMix;
    }

    /**
     * Right-click cooked food in inventory: consume (restore hunger, health, water, mentality).
     * @returns {boolean} true if food was consumed (caller may preventDefault on contextmenu).
     */
    tryConsumeCookedFoodFromSlot(slotIndex) {
        if (!this.inventoryOpen || !this.backpackEnabled) return false;
        if (!this.character?.isLoaded || !this.backpackManager?.loaded) return false;
        const slots = this.backpackManager.getSlots();
        const entry = slots[slotIndex];
        if (!entry || entry.type !== 'food' || !entry.cooked) return false;

        const mesh = this.backpackManager.popFoodMeshFromSlot(slotIndex);
        if (!mesh) return false;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (mat) {
            if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
            else mat.dispose();
        }
        this.hunger = Math.min(100, this.hunger + HUNGER_PER_MEAL);
        this.health = Math.min(100, this.health + HEALTH_PER_MEAL);
        this.water = Math.min(100, this.water + WATER_PER_MEAL);
        this.mentality = Math.min(100, this.mentality + MENTALITY_PER_MEAL);
        this.refreshVitalsHud();
        this.showHelpPopup('Consumed meal — health, hunger, water, and mind improved.', 2600);
        this.refreshInventoryUI();
        this.refreshCraftUI();
        return true;
    }

    onInventorySlotClick(slotIndex) {
        if (!this.inventoryOpen || !this.backpackEnabled) return;
        if (!this.character?.isLoaded || !this.backpackManager?.loaded) return;

        const slots = this.backpackManager.getSlots();
        const entry = slots[slotIndex];
        const clickedFilled = !!entry;

        let changed = false;

        if (clickedFilled) {
            changed = this.backpackManager.withdrawFromSlot(this.character, slotIndex);
            if (!changed) {
                this.showHelpPopup('Hands are full. Drop or stash held item first.', 1800);
            }
        } else {
            changed = this.backpackManager.storeHeldItem(this.character, slotIndex);
            if (!changed) {
                this.showHelpPopup('No held item to store (or slot is unavailable).', 1800);
            }
        }

        if (changed) {
            this.refreshInventoryUI();
            this.refreshCraftUI();
        }
    }

    toggleCraft() {
        if (!this.backpackEnabled || !this.backpackManager?.loaded) {
            this.showHelpPopup('Backpack is disabled, cannot open build grid.', 2200);
            return;
        }
        this.craftOpen = !this.craftOpen;
        if (this.craftOpen) {
            this.settingsOpen = false;
            const sp = document.getElementById('settings-panel');
            if (sp) {
                sp.classList.remove('inventory-panel--open');
                sp.setAttribute('aria-hidden', 'true');
            }
        }
        this.refreshCraftUI();
        this.updateUiInteractionMode();
    }

    refreshCraftUI() {
        const panel = document.getElementById('craft-panel');
        const count = document.getElementById('craft-fire-count');
        const fireSlot = document.getElementById('craft-fire-slot');
        if (!panel || !count || !fireSlot || !this.backpackManager) return;
        panel.classList.toggle('inventory-panel--open', this.craftOpen);
        panel.setAttribute('aria-hidden', this.craftOpen ? 'false' : 'true');

        const rocks = this.backpackManager.getTotalByType('rock');
        const sticks = this.backpackManager.getTotalByType('stick');
        const canBuild = rocks >= 10 && sticks >= 5;
        count.textContent = `Rocks ${rocks}/10 · Sticks ${sticks}/5`;
        fireSlot.style.opacity = canBuild ? '1' : '0.45';
    }

    armFirePlacement() {
        if (!this.backpackManager) return;
        const rocks = this.backpackManager.getTotalByType('rock');
        const sticks = this.backpackManager.getTotalByType('stick');
        if (rocks < 10 || sticks < 5) {
            this.showHelpPopup('Need at least 10 rocks and 5 sticks to place a fire.', 2600);
            return;
        }
        this.placingFireKit = true;
        this.ensureCraftFireGhost();
        if (this.craftGhost) this.craftGhost.visible = true;
        this.showHelpPopup('Fire placement armed. Left click ground to place.', 2300);
    }

    tryPlaceCraftFire() {
        if (!this.placingFireKit || !this.character?.isLoaded || !this.backpackManager) return false;
        const pos = this.character.getPosition();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        else forward.normalize();
        const place = pos.clone().addScaledVector(forward, 2.0);
        place.y = this.world.getHeightAt(place.x, place.z);

        const ok = this.backpackManager.consume('rock', 10) && this.backpackManager.consume('stick', 5);
        if (!ok) {
            this.showHelpPopup('Not enough materials to place fire.', 2200);
            this.placingFireKit = false;
            if (this.craftGhost) this.craftGhost.visible = false;
            return true;
        }
        this.pendingFireToLight = place;
        this.placingFireKit = false;
        if (this.craftGhost) this.craftGhost.visible = false;
        this.refreshInventoryUI();
        this.refreshCraftUI();
        this.showHelpPopup('Fire placed. Hold F about 1 second to light it.', 2800);
        return true;
    }

    tryIgnitePlacedFire() {
        if (!this.pendingFireToLight || !this.character?.isLoaded) return;
        const p = this.character.getPosition();
        if (p.distanceTo(this.pendingFireToLight) > 4.2) {
            this.showHelpPopup('Move closer to the placed fire to light it.', 2200);
            return;
        }
        const firePos = this.pendingFireToLight.clone();
        firePos.y = this.world.getHeightAt(firePos.x, firePos.z) + 0.08;
        this.fireManager.spawnFire(firePos);
        this.pendingFireToLight = null;
        this.showHelpPopup('Fire lit!', 1800);
    }

    tryToggleCookNearLitFire() {
        if (!this.character?.isLoaded || !this.fireManager) return;
        const p = this.character.getPosition();
        const fire = this.fireManager.findNearestLitFire(p, 4.5);
        if (!fire) {
            if (!this.cookOpen) {
                this.showHelpPopup('Stand near a lit fire to open cooking.', 2200);
            }
            return;
        }
        this.cookOpen = !this.cookOpen;
        if (this.cookOpen) {
            this.settingsOpen = false;
            const sp = document.getElementById('settings-panel');
            if (sp) {
                sp.classList.remove('inventory-panel--open');
                sp.setAttribute('aria-hidden', 'true');
            }
        }
        this.refreshCookUI();
        this.updateUiInteractionMode();
    }

    refreshVitalsHud() {
        const setBar = (fillId, value, rowAttr) => {
            const fill = document.getElementById(fillId);
            const v = THREE.MathUtils.clamp(value, 0, 100);
            if (fill) fill.style.width = `${v}%`;
            const row = document.querySelector(`.vitals-hud__row[data-vital="${rowAttr}"]`);
            if (row) {
                row.classList.toggle('vitals-hud__row--low', v < 28);
                const track = row.querySelector('.vitals-hud__track');
                if (track) track.setAttribute('aria-valuenow', String(Math.round(v)));
            }
        };
        setBar('health-bar-fill', this.health, 'health');
        setBar('hunger-bar-fill', this.hunger, 'hunger');
        setBar('water-bar-fill', this.water, 'water');
        setBar('mentality-bar-fill', this.mentality, 'mentality');
    }

    applyCookedVisualToMesh(mesh) {
        if (!mesh?.material) return;
        mesh.userData.cooked = true;
        const fk = mesh.userData.foodKind;
        if (fk === 'berry') {
            mesh.material.color.setHex(0x6a1a2e);
            mesh.material.emissive.setHex(0x330810);
            mesh.material.emissiveIntensity = 0.12;
        } else if (fk === 'fish') {
            mesh.material.color.setHex(0xc98a4a);
            mesh.material.emissive.setHex(0x442208);
            mesh.material.emissiveIntensity = 0.08;
        } else if (fk === 'meat') {
            mesh.material.color.setHex(0x8b4513);
            mesh.material.emissive.setHex(0x2a1008);
            mesh.material.emissiveIntensity = 0.06;
        }
    }

    updateSurvival(delta) {
        this.hunger = Math.max(0, this.hunger - HUNGER_DRAIN_PER_SEC * delta);
        this.water = Math.max(0, this.water - WATER_DRAIN_PER_SEC * delta);

        const day = THREE.MathUtils.clamp(this.dayPhase ?? 0, 0, 1);
        if (day > 0.4) {
            this.mentality = Math.min(
                100,
                this.mentality + MENTALITY_RECOVER_DAY_PER_SEC * day * delta
            );
        } else {
            this.mentality = Math.max(
                0,
                this.mentality - MENTALITY_DRAIN_NIGHT_PER_SEC * (1 - day) * delta
            );
        }

        if (this.hunger <= 0) {
            this.health = Math.max(0, this.health - HEALTH_DRAIN_STARVING_PER_SEC * delta);
        }
        if (this.water <= 0) {
            this.health = Math.max(0, this.health - HEALTH_DRAIN_DEHYDRATED_PER_SEC * delta);
        }
        if (this.hunger > 30 && this.water > 30 && this.health < 100) {
            this.health = Math.min(100, this.health + HEALTH_REGEN_PASSIVE_PER_SEC * delta);
        }

        this.refreshVitalsHud();

        const p = this.character?.isLoaded ? this.character.getPosition() : null;
        const nearFire = p && this.fireManager ? this.fireManager.findNearestLitFire(p, 4.5) : null;

        for (let i = 0; i < this.cookSlots.length; i++) {
            const slot = this.cookSlots[i];
            if (!slot || slot.cooked || !slot.mesh) continue;
            if (!nearFire) continue;
            slot.progress += delta / COOK_TIME_SEC;
            if (slot.progress >= 1) {
                slot.progress = 1;
                slot.cooked = true;
                this.applyCookedVisualToMesh(slot.mesh);
            }
        }
        if (this.cookOpen) this.refreshCookUI();
    }

    refreshCookUI() {
        const panel = document.getElementById('cook-panel');
        const grid = document.getElementById('cook-grid');
        if (!panel || !grid) return;
        panel.classList.toggle('inventory-panel--open', this.cookOpen);
        panel.setAttribute('aria-hidden', this.cookOpen ? 'false' : 'true');

        const kids = Array.from(grid.children);
        for (let i = 0; i < kids.length; i++) {
            const el = kids[i];
            if (!(el instanceof HTMLElement)) continue;
            const slot = this.cookSlots[i];
            el.classList.remove(
                'inventory-slot--filled',
                'inventory-slot--food-berry',
                'inventory-slot--food-fish',
                'inventory-slot--food-meat',
                'inventory-slot--food-cooked'
            );
            const prog = el.querySelector('.cook-slot__progress');
            if (prog) prog.remove();
            const labOld = el.querySelector('.cook-slot__label');
            if (labOld) labOld.remove();
            if (!slot) {
                el.textContent = '';
                continue;
            }
            el.classList.add('inventory-slot--filled');
            el.classList.add(inventoryFoodSlotClass(slot.foodKind));
            if (slot.cooked) el.classList.add('inventory-slot--food-cooked');
            el.innerHTML = '';
            const lab = document.createElement('span');
            lab.className = 'cook-slot__label';
            lab.textContent = displayFoodName(slot.foodKind);
            el.appendChild(lab);
            const span = document.createElement('span');
            span.className = 'cook-slot__progress';
            span.textContent = slot.cooked ? 'done' : `${Math.floor(slot.progress * 100)}%`;
            el.appendChild(span);
        }
    }

    onCookSlotClick(slotIndex) {
        if (!this.cookOpen || !this.character?.isLoaded || !this.backpackManager?.loaded) return;
        const slot = this.cookSlots[slotIndex];
        if (slot && slot.mesh) {
            if (this.character.getHeldRock() || this.character.getHeldStick() || this.character.getHeldFood()) {
                this.showHelpPopup('Hands full.', 1600);
                return;
            }
            const mesh = slot.mesh;
            this.cookSlots[slotIndex] = null;
            mesh.removeFromParent();
            const rest = mesh.userData.restScale ?? 1;
            mesh.scale.setScalar(rest);
            this.character.attachHeldFood(mesh);
            this.world.registerPickupFood(mesh);
            this.refreshCookUI();
            return;
        }
        const held = this.character.stripHeldFood();
        if (!held) {
            this.showHelpPopup('Hold food to place in a cook slot.', 2000);
            return;
        }
        this.world.unregisterPickupFood(held);
        held.removeFromParent();
        const rest = held.userData.restScale ?? 1;
        held.scale.setScalar(rest * 0.04);
        this.cookItemRoot.add(held);
        held.position.set((slotIndex % 4) * 0.08 - 0.12, 0, Math.floor(slotIndex / 4) * 0.08 - 0.04);
        const cooked = !!held.userData.cooked;
        this.cookSlots[slotIndex] = {
            foodKind: held.userData.foodKind,
            cooked,
            progress: cooked ? 1 : 0,
            mesh: held
        };
        this.refreshCookUI();
    }

    tryCatchLakeFish(playerPos, forwardXZ) {
        if (!this.lakeFishInstances?.length) return false;
        const f = forwardXZ.clone();
        f.y = 0;
        if (f.lengthSq() < 1e-8) return false;
        f.normalize();
        const reach = 3.2;
        const minDot = 0.12;
        let best = null;
        let bestD = reach;
        for (let i = 0; i < this.lakeFishInstances.length; i++) {
            const inst = this.lakeFishInstances[i];
            if (!inst.alive) continue;
            const mesh = inst.mesh;
            const dx = mesh.position.x - playerPos.x;
            const dz = mesh.position.z - playerPos.z;
            const dist = Math.hypot(dx, dz);
            if (dist > reach || dist < 0.06) continue;
            const toFish = new THREE.Vector3(dx, 0, dz).normalize();
            if (f.dot(toFish) < minDot) continue;
            if (dist < bestD) {
                bestD = dist;
                best = inst;
            }
        }
        if (!best) return false;
        best.alive = false;
        const dead = best.mesh;
        this.scene.remove(dead);
        dead.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            const m = o.material;
            if (m) {
                if (Array.isArray(m)) m.forEach((x) => x.dispose());
                else m.dispose();
            }
        });

        const foodMesh = createFishFoodMesh(false);
        const gx = playerPos.x;
        const gz = playerPos.z;
        foodMesh.position.set(gx, this.world.getHeightAt(gx, gz) + 0.14, gz);
        this.scene.add(foodMesh);
        this.world.registerPickupFood(foodMesh);
        this.showHelpPopup('You caught a fish! Press E to pick up.', 2800);
        return true;
    }

    tryMeleeHitChicken(playerPos, forwardXZ) {
        if (!this.chickensEnabled || !this.chickenSpawner) return false;
        const f = forwardXZ.clone();
        f.y = 0;
        if (f.lengthSq() < 1e-8) return false;
        f.normalize();
        const reach = 2.85;
        const minDot = 0.16;
        const list = this.chickenSpawner.getChickens();
        let best = null;
        let bestD = reach;
        for (let i = 0; i < list.length; i++) {
            const ch = list[i];
            if (!ch.isLoaded || ch._removed || ch.isDropped || ch.isCaught) continue;
            const dx = ch.position.x - playerPos.x;
            const dz = ch.position.z - playerPos.z;
            const dist = Math.hypot(dx, dz);
            if (dist > reach || dist < 0.06) continue;
            const toC = new THREE.Vector3(dx, 0, dz).normalize();
            if (f.dot(toC) < minDot) continue;
            if (dist < bestD) {
                bestD = dist;
                best = ch;
            }
        }
        if (!best) return false;
        const dropPos = best.kill();
        if (!dropPos) return false;
        const foodMesh = createMeatFoodMesh(false);
        foodMesh.position.set(
            dropPos.x,
            this.world.getHeightAt(dropPos.x, dropPos.z) + 0.14,
            dropPos.z
        );
        this.scene.add(foodMesh);
        this.world.registerPickupFood(foodMesh);
        this.showHelpPopup('Meat on the ground — press E to pick up.', 2600);
        return true;
    }

    updateUiInteractionMode() {
        const uiOpen = this.inventoryOpen || this.craftOpen || this.cookOpen || this.settingsOpen;
        document.body.classList.toggle('ui-cursor-mode', uiOpen);
        if (uiOpen) {
            if (this.controls.isLocked) this.controls.unlock();
            return;
        }
        if (!this.controls.isLocked) this.controls.lock();
    }

    ensureCraftFireGhost() {
        if (this.craftGhost) return;
        const g = new THREE.Group();
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(1.4, 1.95, 36),
            new THREE.MeshBasicMaterial({
                color: 0xffb366,
                transparent: true,
                opacity: 0.45,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        g.add(ring);
        const center = new THREE.Mesh(
            new THREE.CircleGeometry(1.15, 30),
            new THREE.MeshBasicMaterial({
                color: 0xff8844,
                transparent: true,
                opacity: 0.22,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        center.rotation.x = -Math.PI / 2;
        center.position.y = 0.02;
        g.add(center);
        g.visible = false;
        this.scene.add(g);
        this.craftGhost = g;
    }

    updateCraftFireGhost() {
        if (!this.placingFireKit || !this.craftGhost || !this.character?.isLoaded) return;
        const pos = this.character.getPosition();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        else forward.normalize();
        const place = pos.clone().addScaledVector(forward, 2.0);
        place.y = this.world.getHeightAt(place.x, place.z) + 0.01;
        this.craftGhost.position.copy(place);
    }

    tryPickupOrDropRock() {
        if (!this.character.isLoaded) return;

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

        if (this.character.getHeldFood()) {
            const mesh = this.character.dropHeldFood(this.scene, this.world, this.camera);
            if (mesh && mesh.userData.pickupFood) {
                this.world.registerPickupFood(mesh);
            }
            return;
        }

        const pos = this.character.getPosition();
        let best = null;
        let bestD = 2.9;
        /** @type {'rock' | 'stick' | 'food' | null} */
        let bestKind = null;

        const rocks = this.world.pickupRocks;
        for (let i = 0; i < rocks.length; i++) {
            const mesh = rocks[i];
            if (!mesh.parent) continue;
            const d = pos.distanceTo(mesh.position);
            if (d < bestD) {
                bestD = d;
                best = mesh;
                bestKind = 'rock';
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
                bestKind = 'stick';
            }
        }
        const foods = this.world.pickupFoods;
        for (let i = 0; i < foods.length; i++) {
            const mesh = foods[i];
            if (!mesh.parent) continue;
            const d = pos.distanceTo(mesh.position);
            if (d < bestD) {
                bestD = d;
                best = mesh;
                bestKind = 'food';
            }
        }

        if (best && bestKind) {
            if (bestKind === 'food') {
                if (this.backpackEnabled && this.backpackManager?.loaded && this.backpackManager.storeWorldItem('food', best)) {
                    this.refreshInventoryUI();
                    this.refreshCraftUI();
                    this.showHelpPopup('Food added to inventory.');
                    return;
                }
                this.world.unregisterPickupFood(best);
                this.character.attachHeldFood(best);
                this.showHelpPopup('Food picked up.');
                return;
            }
            if (bestKind === 'rock') {
                if (this.backpackEnabled && this.backpackManager?.loaded && this.backpackManager.storeWorldItem('rock', best)) {
                    this.refreshInventoryUI();
                    this.refreshCraftUI();
                    this.showHelpPopup('Rock added to inventory.');
                    return;
                }
                this.world.unregisterPickupRock(best);
                this.character.attachHeldRock(best);
                const remaining = 10 - this.rockRing.length;
                this.showHelpPopup(`Rock picked up! Need ${remaining} more to build a fire ring.`);
            } else {
                if (this.backpackEnabled && this.backpackManager?.loaded && this.backpackManager.storeWorldItem('stick', best)) {
                    this.refreshInventoryUI();
                    this.refreshCraftUI();
                    this.showHelpPopup('Stick added to inventory.');
                    return;
                }
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
            this.showHelpPopup('Nothing to pick up nearby. Find rocks, sticks, berries, fish, or meat and press E.');
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
                const survivalHud = document.getElementById('survival-hud');
                if (survivalHud) {
                    survivalHud.style.display = 'block';
                    survivalHud.setAttribute('aria-hidden', 'false');
                }
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
                const survivalHud = document.getElementById('survival-hud');
                if (survivalHud) {
                    survivalHud.style.display = 'none';
                    survivalHud.setAttribute('aria-hidden', 'true');
                }
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
        this.renderer.setPixelRatio(Math.min(1.0, window.devicePixelRatio || 1));
        if (this.worldMinimap) this.worldMinimap.resize();
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
            
            const nightFog = new THREE.Color(0x252b26);
            const dayFog = new THREE.Color(0x7fbfff);
            this.scene.fog.color.lerpColors(nightFog, dayFog, this.dayPhase);
            this.scene.fog.density = THREE.MathUtils.lerp(0.00175, 0.0005, this.dayPhase);
        } else {
            this.dayPhase = this.targetDayPhase;
        }

        this.controls.update(delta, this.world);
        
        const updatePos = this.character.isLoaded ? this.character.getPosition() : this.camera.position;
        this.world.update(updatePos);
        const elapsed = this.clock ? this.clock.getElapsedTime() : 0;
        if (this.lakeFishUpdate) this.lakeFishUpdate(elapsed);
        if (this.airbusUpdate) this.airbusUpdate(elapsed);
        this.world.updateDecorationTime(elapsed, delta, {
            sunPosition: this.sunLight.position,
            dayPhase: this.dayPhase
        });
        this.world.updateTreeWind(elapsed);
        if (this.character.isLoaded) {
            this.world.updatePickupRockHighlight(updatePos, elapsed);
        }
        this.sky.update(elapsed, this.camera.position, this.dayPhase);
        
        const dogPos = this.dogEnabled && this.dog && typeof this.dog.getPosition === 'function'
            ? this.dog.getPosition()
            : null;

        if (this.chickensEnabled && this.chickenSpawner) {
            this.chickenSpawner.update(delta, this.world, dogPos);
        }
        if (this.butterfliesEnabled && this.butterflySpawner) {
            this.butterflySpawner.update(delta, updatePos, this.world);
        }
        
        // Chance must update whenever the companion is enabled — not only after the player character
        // finishes loading (character loads on Start). Otherwise Y never snaps to terrain and the dog stays underground.
        if (this.dogEnabled && this.dog?.model) {
            const dogPlayerPos = this.character.isLoaded
                ? this.character.getPosition()
                : new THREE.Vector3(0, this.world.getHeightAt(0, 0), 0);
            const dogYaw = this.character.isLoaded ? this.character.rotation : 0;
            this.dog.update(delta, dogPlayerPos, dogYaw, this.world);
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
                const projKind = this.world.tryAxeHitTree(this.axe.getPosition(), this.axe.flightHitTreeIds);
                if (projKind === 'boulder') {
                    this.playAxeMiningStoneSound();
                } else if (projKind === 'tree') {
                    this.playAxeChopSound();
                }
            }
        }
        
        if (this.fireManager) {
            this.fireManager.update(delta);
        }

        this.updateFireRingPreviewPulse(elapsed);
        this.updateCraftFireGhost();
        
        this.updateBullets(delta);

        if (this.flashlight && this.character.isLoaded) {
            const charPos = this.character.getPosition();
            this.flashlight.position.set(charPos.x, charPos.y + 5, charPos.z);
            
            const targetPos = new THREE.Vector3(0, 0, -1);
            targetPos.applyQuaternion(this.camera.quaternion);
            targetPos.add(this.flashlight.position);
            this.flashlight.target.position.copy(targetPos);
        }

        if (this.worldMinimap) this.worldMinimap.draw();
        this.updateFootsteps(delta);
        this.updateDayNightAmbienceVolumes();
        this.updateSurvival(delta);

        this.renderer.render(this.scene, this.camera);
    }
}

const game = new Game();
game.runInitialLoad().finally(() => {
    game.startGameLoop();
});
