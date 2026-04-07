import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { isNearLakeWater } from './world.js';

const BASE_URL = '/models/scorpion/';
const PREFIX = 'Meshy_AI_a_detailed_scorpion__0407005150_texture';

const SCORPION_COUNT = 3;
/** Starting scale — tune after viewing in-world. */
const SCORPION_SCALE = 0.022;

function pickLandPosition(world) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const x = (Math.random() - 0.5) * 110;
        const z = (Math.random() - 0.5) * 110;
        if (isNearLakeWater(x, z, 6)) continue;
        const y = world.getHeightAt(x, z);
        if (y < -0.15) continue;
        return { x, z, y };
    }
    const x = 22 + Math.random() * 8;
    const z = -28 + Math.random() * 10;
    return { x, z, y: world.getHeightAt(x, z) };
}

/**
 * Loads scorpion FBX + PBR maps, spawns {@link SCORPION_COUNT} on dry ground (avoids lake).
 */
export async function loadScorpions(scene, world) {
    if (!world || !scene) return;

    const loader = new FBXLoader();
    const texLoader = new THREE.TextureLoader();

    try {
        const [baseColor, normalMap, metallicMap, roughnessMap, proto] = await Promise.all([
            texLoader.loadAsync(`${BASE_URL}${PREFIX}.png`),
            texLoader.loadAsync(`${BASE_URL}${PREFIX}_normal.png`),
            texLoader.loadAsync(`${BASE_URL}${PREFIX}_metallic.png`),
            texLoader.loadAsync(`${BASE_URL}${PREFIX}_roughness.png`),
            loader.loadAsync(`${BASE_URL}${PREFIX}.fbx`)
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
                        metalness: 0.45,
                        roughness: 0.55,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        };

        applyMaterial(proto);
        proto.scale.setScalar(SCORPION_SCALE);
        proto.rotation.order = 'YXZ';

        for (let i = 0; i < SCORPION_COUNT; i++) {
            const mesh = i === 0 ? proto : cloneSkeleton(proto);
            const { x, z, y } = pickLandPosition(world);
            mesh.position.set(x, y, z);
            mesh.rotation.y = Math.random() * Math.PI * 2;
            scene.add(mesh);
        }
    } catch (err) {
        console.warn('Scorpion FBX failed — check public/models/scorpion/', err);
    }
}
