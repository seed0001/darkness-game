import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const BASE_URL = '/models/backpack/';
const PREFIX = 'Meshy_AI_A_hiking_backpack_wi_0407005713_texture';

const VISUAL_SCALE = 0.034;
const INTERACT_DIST = 2.85;

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
        /** @type {THREE.Mesh[]} */
        this.inventoryRocks = [];
        /** @type {THREE.Mesh[]} */
        this.inventorySticks = [];

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

    distanceToPlayer(character) {
        return character.getPosition().distanceTo(this.anchor.position);
    }

    /**
     * E near dropped backpack: deposit held item, or withdraw if hands empty.
     * @returns {boolean} true if handled
     */
    tryGroundInteract(character) {
        if (!this.loaded || this.state !== 'ground' || !character) return false;
        if (character.isLyingProne()) return false;
        if (this.distanceToPlayer(character) > INTERACT_DIST) return false;

        if (character.getHeldRock()) {
            const m = character.stripHeldRock();
            if (!m) return false;
            this.world.unregisterPickupRock(m);
            const rest = m.userData.restScale ?? m.scale.x;
            m.scale.setScalar(rest * 0.04);
            m.position.set(0, 0, 0);
            m.rotation.set(0, 0, 0);
            this.inventoryRoot.add(m);
            this.inventoryRocks.push(m);
            return true;
        }

        if (character.getHeldStick()) {
            const m = character.stripHeldStick();
            if (!m) return false;
            this.world.unregisterPickupStick(m);
            const rest = m.userData.restScale ?? m.scale.x;
            m.scale.setScalar(rest * 0.04);
            m.position.set(0, 0, 0);
            m.rotation.set(0, 0, 0);
            this.inventoryRoot.add(m);
            this.inventorySticks.push(m);
            return true;
        }

        if (this.inventoryRocks.length > 0) {
            const m = this.inventoryRocks.pop();
            m.removeFromParent();
            const rest = m.userData.restScale ?? 1;
            m.scale.setScalar(rest);
            character.attachHeldRock(m);
            this.world.registerPickupRock(m);
            return true;
        }

        if (this.inventorySticks.length > 0) {
            const m = this.inventorySticks.pop();
            m.removeFromParent();
            const rest = m.userData.restScale ?? 1;
            m.scale.setScalar(rest);
            character.attachHeldStick(m);
            this.world.registerPickupStick(m);
            return true;
        }

        return false;
    }

    totalStoredCount() {
        return this.inventoryRocks.length + this.inventorySticks.length;
    }
}
