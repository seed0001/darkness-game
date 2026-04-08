import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';

/**
 * Procedural evergreens from @dgreenheck/ez-tree (MIT). https://github.com/dgreenheck/ez-tree
 * Presets are bundled in the library; we vary seed and scale to world height.
 */
export function createProceduralTree(trng, targetTreeHeightWorld) {
    const tree = new Tree();
    tree.loadPreset('Pine Medium');
    tree.options.seed = (trng() * 0xffffffff) >>> 0;
    // Match the gray-scale world look
    tree.options.bark.tint = 0x989898;
    tree.options.leaves.tint = 0x878787;
    tree.generate();

    tree.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tree);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = Math.max(size.y, 0.01);
    const baseScale = targetTreeHeightWorld / h;
    const scale = baseScale * (1.0 + trng() * 0.45);
    tree.scale.setScalar(scale);

    tree.rotation.y = trng() * Math.PI * 2;

    tree.updateMatrixWorld(true);
    const boxFoot = new THREE.Box3().setFromObject(tree);
    const footSize = new THREE.Vector3();
    boxFoot.getSize(footSize);
    /** Trunk-sized only — full canopy radius kept players farther than melee reach. */
    const halfFoot = Math.max(footSize.x, footSize.z) * 0.5;
    tree.userData.collisionRadius = Math.min(2.55, Math.max(1.02, halfFoot * 0.26));

    tree.userData.meshyTree = true;
    tree.userData.ezTree = true;
    tree.userData.treePhase = 'standing';
    tree.userData.chopStandingHits = 0;
    tree.userData.windPhase = trng() * Math.PI * 2;
    tree.userData.baseRotY = tree.rotation.y;
    tree.userData.baseRotX = 0;
    tree.userData.baseRotZ = 0;

    tree.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    return tree;
}
