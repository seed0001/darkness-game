import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { LAKE_CX, LAKE_CZ } from './world.js';

const MODEL_URL = '/models/airbus/Airbus_A320.fbx';

/**
 * Right next to spawn (~0,0) on dry ground, a few steps toward the lake (center ~26,12).
 * Chosen so normalized ellipse e > 1 — not inside the lake depression.
 */
export const AIRBUS_PLACE_X = 5;
export const AIRBUS_PLACE_Z = 2;
const PLACE_X = AIRBUS_PLACE_X;
const PLACE_Z = AIRBUS_PLACE_Z;

/** Meters above terrain at (PLACE_X, PLACE_Z) — keeps the mesh out of the ground / z-fight. */
const SKY_CLEARANCE_ABOVE_GROUND = 125;

/**
 * Largest axis in world units (roughly "big jet" readable in this scene).
 */
const TARGET_BODY_LENGTH = 95;

const FLY_RADIUS = 72;
const FLY_ALTITUDE = 96;
const FLY_SPEED = 0.12;

function applyRedGlowToMesh(mesh) {
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((mat) => {
        if (!mat) {
            return new THREE.MeshStandardMaterial({
                color: 0x888888,
                emissive: new THREE.Color(0xff0000),
                emissiveIntensity: 2.5,
                metalness: 0.2,
                roughness: 0.5
            });
        }
        const m = new THREE.MeshStandardMaterial({
            map: mat.map || null,
            normalMap: mat.normalMap || null,
            metalnessMap: mat.metalnessMap || null,
            roughnessMap: mat.roughnessMap || null,
            color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
            metalness: 0.32,
            roughness: 0.42,
            emissive: new THREE.Color(0xff0000),
            emissiveIntensity: 2.4
        });
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        return m;
    });
    mesh.material = next.length === 1 ? next[0] : next;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
}

function createFallbackAirbus() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(2.6, 14, 8, 20),
        new THREE.MeshBasicMaterial({ color: 0xff2222, fog: false })
    );
    body.rotation.z = Math.PI / 2;
    g.add(body);

    const wing = new THREE.Mesh(
        new THREE.BoxGeometry(16, 0.7, 2.6),
        new THREE.MeshBasicMaterial({ color: 0xff3333, fog: false })
    );
    wing.position.set(0, 0, 0);
    g.add(wing);

    const tail = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 3.4, 0.7),
        new THREE.MeshBasicMaterial({ color: 0xff4444, fog: false })
    );
    tail.position.set(-7.6, 1.5, 0);
    g.add(tail);

    const noseBeacon = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false })
    );
    noseBeacon.position.set(8.8, 0, 0);
    g.add(noseBeacon);

    return g;
}

/** Loads a red Airbus and returns update(elapsed) for looping flight. */
export async function loadFlyingAirbus(scene, world) {
    const loader = new FBXLoader();
    let craft = null;
    let usingFallback = false;

    try {
        const fbx = await loader.loadAsync(MODEL_URL);

        fbx.traverse((child) => {
            applyRedGlowToMesh(child);
        });

        fbx.position.set(0, 0, 0);
        fbx.rotation.set(0, 0, 0);
        fbx.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(fbx);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const scale = TARGET_BODY_LENGTH / maxDim;
        fbx.scale.setScalar(scale);
        fbx.updateMatrixWorld(true);

        const groundY = world.getHeightAt(PLACE_X, PLACE_Z);
        const centerY = groundY + SKY_CLEARANCE_ABOVE_GROUND + FLY_ALTITUDE;
        fbx.position.set(PLACE_X + FLY_RADIUS, centerY, PLACE_Z);
        fbx.rotation.order = 'YXZ';
        fbx.rotation.y = Math.PI * 0.8;
        fbx.rotation.x = 0;
        fbx.rotation.z = 0;

        craft = fbx;
    } catch (err) {
        console.warn('Airbus A320 FBX failed; spawning visible fallback flyer.', err);
        craft = createFallbackAirbus();
        usingFallback = true;
    }

    craft.userData.staticAirbus = false;
    craft.userData.flyingAirbus = true;
    craft.name = usingFallback ? 'FlyingAirbusFallback' : 'FlyingAirbusA320';

    const beacon = new THREE.PointLight(0xff2a2a, 12, 520);
    beacon.position.set(0, 8, 0);
    craft.add(beacon);
    scene.add(craft);

    const groundY = world.getHeightAt(PLACE_X, PLACE_Z);
    const centerY = groundY + SKY_CLEARANCE_ABOVE_GROUND + FLY_ALTITUDE;

    return (elapsed) => {
        const t = elapsed * FLY_SPEED;
        const x = PLACE_X + Math.cos(t) * FLY_RADIUS;
        const z = PLACE_Z + Math.sin(t) * FLY_RADIUS;
        const y = centerY + Math.sin(elapsed * 0.75) * 5.5;
        craft.position.set(x, y, z);

        const vx = -Math.sin(t) * FLY_RADIUS * FLY_SPEED;
        const vz = Math.cos(t) * FLY_RADIUS * FLY_SPEED;
        const heading = Math.atan2(vx, vz);
        craft.rotation.order = 'YXZ';
        craft.rotation.y = heading + Math.PI * 0.12;
        craft.rotation.x = Math.sin(elapsed * 0.95) * 0.03;
        craft.rotation.z = Math.sin(elapsed * 0.65) * 0.05;
    };
}
