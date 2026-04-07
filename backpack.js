import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const BASE_URL = '/models/backpack/';
const PREFIX = 'Meshy_AI_A_hiking_backpack_wi_0407005713_texture';

const VISUAL_SCALE = 0.034;

/**
 * Hiking backpack: worn on the spine, droppable (B), ground container for rocks/sticks (E).
 */
export class BackpackManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.anchor = new THREE.Group();
        this.anchor.name = 'backpackAnchor';
        this.visual = null;
        /** Hidden holder for deposited item meshes. */
        this.inventoryRoot = new THREE.Group();
        this.inventoryRoot.name = 'backpackInventory';
        this.inventoryRoot.visible = false;
        this.anchor.add(this.inventoryRoot);

        /** @type {'worn' | 'ground'} */
        this.state = 'worn';
        this.enabled = true;
        /** @type {(null | { type: 'rock' | 'stick', mesh: THREE.Mesh })[]} */
        this.slots = new Array(24).fill(null);

        this.loaded = false;
        this.readyPromise = this.load();
    }

    async load() {
        const loader = new FBXLoader();
        const texLoader = new THREE.TextureLoader();

        try {
            const [baseColor, normalMap, metallicMap, roughnessMap, fbx] = await Promise.all([
                texLoader.loadAsync(`${BASE_URL}${PREFIX}.png`),
                texLoader.loadAsync(`${BASE_URL}${PREFIX}_normal.png`),
                texLoader.loadAsync(`${BASE_URL}${PREFIX}_metallic.png`),
                texLoader.loadAsync(`${BASE_URL}${PREFIX}_roughness.png`),
                loader.loadAsync(`${BASE_URL}${PREFIX}.fbx`)
            ]);

            baseColor.colorSpace = THREE.SRGBColorSpace;

            this.visual = fbx;
            this.visual.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: baseColor,
                        normalMap,
                        metalnessMap: metallicMap,
                        roughnessMap: roughnessMap,
                        metalness: 0.4,
                        roughness: 0.55,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            this.visual.scale.setScalar(VISUAL_SCALE);
            this.visual.position.set(0, 0.05, -0.14);
            this.visual.rotation.set(-0.18, Math.PI, 0.05);

            this.anchor.add(this.visual);
            this.loaded = true;
        } catch (err) {
            console.warn('Backpack FBX failed — check public/models/backpack/', err);
        }
    }

    /**
     * Parent anchor to spine bone or torso offset on character root.
     */
    attachToCharacter(character) {
        if (!this.loaded || !character?.model) return;

        this.anchor.removeFromParent();

        if (character.backBone) {
            character.backBone.add(this.anchor);
            this.anchor.position.set(0, 0.12, -0.07);
            this.anchor.rotation.set(0.1, Math.PI, 0);
        } else {
            character.model.add(this.anchor);
            this.anchor.position.set(0, 0.92, -0.16);
            this.anchor.rotation.set(-0.05, Math.PI, 0);
        }
        this.state = 'worn';
        this.anchor.visible = this.enabled;
    }

    drop(character, camera, world) {
        if (!this.loaded || this.state !== 'worn' || !character) return;

        this.anchor.removeFromParent();

        const forward = new THREE.Vector3(0, 0, -1);
        if (camera) forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        else forward.normalize();

        const p = character.getPosition().clone().addScaledVector(forward, 1.05);
        p.y = world.getHeightAt(p.x, p.z) + 0.04;

        this.anchor.position.copy(p);
        this.anchor.rotation.set(0, character.rotation + 0.2, 0);
        this.scene.add(this.anchor);

        this.anchor.userData.backpackContainer = true;
        this.state = 'ground';
    }

    wear(character) {
        if (!this.loaded || this.state !== 'ground') return;
        this.anchor.removeFromParent();
        this.attachToCharacter(character);
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        this.anchor.visible = this.enabled;
    }

    findFirstEmptySlot() {
        return this.slots.findIndex((s) => s === null);
    }

    getSlots() {
        return this.slots;
    }

    storeHeldItem(character, preferredSlot = -1) {
        if (!this.loaded || !this.enabled || !character) return false;
        let mesh = null;
        let type = null;
        if (character.getHeldRock()) {
            mesh = character.stripHeldRock();
            type = 'rock';
            if (mesh) this.world.unregisterPickupRock(mesh);
        } else if (character.getHeldStick()) {
            mesh = character.stripHeldStick();
            type = 'stick';
            if (mesh) this.world.unregisterPickupStick(mesh);
        }
        if (!mesh || !type) return false;

        let idx = preferredSlot;
        if (idx < 0 || idx >= this.slots.length || this.slots[idx] !== null) {
            idx = this.findFirstEmptySlot();
        }
        if (idx < 0) {
            if (type === 'rock') character.attachHeldRock(mesh);
            else character.attachHeldStick(mesh);
            return false;
        }

        const rest = mesh.userData.restScale ?? mesh.scale.x;
        mesh.scale.setScalar(rest * 0.04);
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        this.inventoryRoot.add(mesh);
        this.slots[idx] = { type, mesh };
        return true;
    }

    storeWorldItem(type, mesh, preferredSlot = -1) {
        if (!this.loaded || !this.enabled || !mesh) return false;
        if (type !== 'rock' && type !== 'stick') return false;
        let idx = preferredSlot;
        if (idx < 0 || idx >= this.slots.length || this.slots[idx] !== null) {
            idx = this.findFirstEmptySlot();
        }
        if (idx < 0) return false;

        if (type === 'rock') this.world.unregisterPickupRock(mesh);
        else this.world.unregisterPickupStick(mesh);
        mesh.removeFromParent();
        const rest = mesh.userData.restScale ?? mesh.scale.x;
        mesh.scale.setScalar(rest * 0.04);
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        this.inventoryRoot.add(mesh);
        this.slots[idx] = { type, mesh };
        return true;
    }

    withdrawFromSlot(character, slotIndex) {
        if (!this.loaded || !this.enabled || !character) return false;
        if (slotIndex < 0 || slotIndex >= this.slots.length) return false;
        if (character.getHeldRock() || character.getHeldStick()) return false;
        const entry = this.slots[slotIndex];
        if (!entry) return false;

        this.slots[slotIndex] = null;
        entry.mesh.removeFromParent();
        const rest = entry.mesh.userData.restScale ?? 1;
        entry.mesh.scale.setScalar(rest);

        if (entry.type === 'rock') {
            character.attachHeldRock(entry.mesh);
            this.world.registerPickupRock(entry.mesh);
        } else {
            character.attachHeldStick(entry.mesh);
            this.world.registerPickupStick(entry.mesh);
        }
        return true;
    }

    distanceToPlayer(character) {
        return character.getPosition().distanceTo(this.anchor.position);
    }

    totalStoredCount() {
        let total = 0;
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i]) total++;
        }
        return total;
    }
}
