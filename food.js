import * as THREE from 'three';

/** Seconds to cook one uncooked item at a lit fire (when in range). */
export const COOK_TIME_SEC = 14;

/** Hunger restored per cooked item eaten (0–100 scale). */
export const HUNGER_PER_MEAL = 28;

/** Health restored per cooked meal (0–100 scale). */
export const HEALTH_PER_MEAL = 24;

/** Hydration restored per cooked meal (0–100 scale). */
export const WATER_PER_MEAL = 12;

/** Mentality (calm) restored per cooked meal (0–100 scale). */
export const MENTALITY_PER_MEAL = 16;

/** Passive hunger drain per second (full → empty in ~20 min). */
export const HUNGER_DRAIN_PER_SEC = 0.083;

/** Passive water drain per second. */
export const WATER_DRAIN_PER_SEC = 0.055;

/** Mentality drain per second at night (extra stress in darkness). */
export const MENTALITY_DRAIN_NIGHT_PER_SEC = 0.07;

/** Mentality recovery per second in daylight when stable. */
export const MENTALITY_RECOVER_DAY_PER_SEC = 0.045;

/** Health lost per second when starving (hunger at 0). */
export const HEALTH_DRAIN_STARVING_PER_SEC = 0.14;

/** Health lost per second when dehydrated (water at 0). */
export const HEALTH_DRAIN_DEHYDRATED_PER_SEC = 0.12;

/** Slow passive health recovery when hunger and water are both adequate. */
export const HEALTH_REGEN_PASSIVE_PER_SEC = 0.018;

/**
 * @param {boolean} cooked
 * @returns {THREE.Mesh}
 */
export function createBerryMesh(cooked = false) {
    const geo = new THREE.SphereGeometry(0.11, 10, 8);
    const mat = new THREE.MeshStandardMaterial({
        color: cooked ? 0x6a1a2e : 0xc41e3a,
        roughness: 0.62,
        metalness: 0.05,
        emissive: cooked ? 0x330810 : 0x000000,
        emissiveIntensity: cooked ? 0.12 : 0
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.pickupFood = true;
    mesh.userData.foodKind = 'berry';
    mesh.userData.cooked = cooked;
    mesh.userData.restScale = 1;
    mesh.userData.collisionRadius = 0.14;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

/**
 * Simple inventory fish (caught); not the animated lake swimmer mesh.
 * @param {boolean} cooked
 */
export function createFishFoodMesh(cooked = false) {
    const geo = new THREE.IcosahedronGeometry(0.16, 1);
    const mat = new THREE.MeshStandardMaterial({
        color: cooked ? 0xc98a4a : 0x3a7ab8,
        roughness: 0.48,
        metalness: 0.12,
        emissive: cooked ? 0x442208 : 0x0a2044,
        emissiveIntensity: cooked ? 0.08 : 0.15,
        flatShading: true
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.pickupFood = true;
    mesh.userData.foodKind = 'fish';
    mesh.userData.cooked = cooked;
    mesh.userData.restScale = 1;
    mesh.userData.collisionRadius = 0.18;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

/**
 * Raw / cooked meat (from wildlife); same cook + eat flow as fish.
 * @param {boolean} cooked
 */
export function createMeatFoodMesh(cooked = false) {
    const geo = new THREE.BoxGeometry(0.22, 0.1, 0.16);
    const mat = new THREE.MeshStandardMaterial({
        color: cooked ? 0x8b4513 : 0xa63d52,
        roughness: cooked ? 0.55 : 0.42,
        metalness: 0.06,
        emissive: cooked ? 0x2a1008 : 0x280810,
        emissiveIntensity: cooked ? 0.06 : 0.04
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.pickupFood = true;
    mesh.userData.foodKind = 'meat';
    mesh.userData.cooked = cooked;
    mesh.userData.restScale = 1;
    mesh.userData.collisionRadius = 0.2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
