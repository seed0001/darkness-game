import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LAKE_CX, LAKE_CZ, LAKE_RX, LAKE_RZ } from './world.js';

const FISH_URL = '/models/fish/';
const FISH_PREFIX = 'Meshy_AI_A_fish_bright_colors_0407002732_texture';

const FISH_SCALE = 0.0105;
const LAKE_FISH_Y_BASE = -0.52;

/** Soft blue underwater glow (readable in dark water). */
const GLOW_COLOR = 0x4ab0ff;
const GLOW_INTENSITY = 0.62;

const FISH_COUNT = 3;

/** Pitch vs default bind: was −π/2 (mouth straight up); +90° → 0 for horizontal heading. */
const FISH_PITCH_X = 0;

/**
 * Loads fish FBX, applies blue emissive glow, spawns {@link FISH_COUNT} clones,
 * and returns an update(elapsed) that moves them on elliptical swim paths in the lake.
 */
export async function loadLakeFish(scene) {
    const loader = new FBXLoader();
    const texLoader = new THREE.TextureLoader();

    try {
        const [baseColor, normalMap, metallicMap, roughnessMap, proto] = await Promise.all([
            texLoader.loadAsync(`${FISH_URL}${FISH_PREFIX}.png`),
            texLoader.loadAsync(`${FISH_URL}${FISH_PREFIX}_normal.png`),
            texLoader.loadAsync(`${FISH_URL}${FISH_PREFIX}_metallic.png`),
            texLoader.loadAsync(`${FISH_URL}${FISH_PREFIX}_roughness.png`),
            loader.loadAsync(`${FISH_URL}${FISH_PREFIX}.fbx`)
        ]);

        baseColor.colorSpace = THREE.SRGBColorSpace;

        const applyMaterial = (root) => {
            root.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: baseColor,
                        normalMap,
                        metalnessMap: metallicMap,
                        roughnessMap: roughnessMap,
                        metalness: 0.28,
                        roughness: 0.42,
                        side: THREE.DoubleSide,
                        emissive: new THREE.Color(GLOW_COLOR),
                        emissiveIntensity: GLOW_INTENSITY
                    });
                    child.castShadow = false;
                    child.receiveShadow = true;
                }
            });
        };

        applyMaterial(proto);
        proto.scale.setScalar(FISH_SCALE);
        proto.rotation.order = 'YXZ';
        proto.rotation.x = FISH_PITCH_X;

        /** Ellipse semi-axes + swim params (stay inside lake bowl). */
        const configs = [
            { ax: LAKE_RX * 0.48, bz: LAKE_RZ * 0.44, speed: 0.2, phase: 0, yPhase: 0.0, yAmp: 0.1 },
            { ax: LAKE_RX * 0.4, bz: LAKE_RZ * 0.5, speed: -0.16, phase: 2.15, yPhase: 1.3, yAmp: 0.09 },
            { ax: LAKE_RX * 0.52, bz: LAKE_RZ * 0.38, speed: 0.24, phase: 4.4, yPhase: 2.6, yAmp: 0.11 }
        ];

        const instances = [];

        for (let i = 0; i < FISH_COUNT; i++) {
            const mesh = i === 0 ? proto : cloneSkeleton(proto);
            scene.add(mesh);
            instances.push({ mesh, ...configs[i] });
        }

        return (elapsed) => {
            for (let i = 0; i < instances.length; i++) {
                const { mesh, ax, bz, speed, phase, yPhase, yAmp } = instances[i];
                const u = elapsed * speed + phase;
                const x = LAKE_CX + Math.cos(u) * ax;
                const z = LAKE_CZ + Math.sin(u) * bz;
                const y =
                    LAKE_FISH_Y_BASE + Math.sin(elapsed * 1.15 + yPhase) * yAmp;

                mesh.position.set(x, y, z);

                const vx = -Math.sin(u) * ax * speed;
                const vz = Math.cos(u) * bz * speed;
                const heading = Math.atan2(vx, vz);
                mesh.rotation.y = heading;
                mesh.rotation.x = FISH_PITCH_X;
                mesh.rotation.z = 0;
            }
        };
    } catch (err) {
        console.warn('Lake fish failed to load — check public/models/fish/', err);
        return null;
    }
}
