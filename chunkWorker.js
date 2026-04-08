import { computeGrassInstanceMatrices, BLADE_TARGET } from './chunkGenShared.js';

self.onmessage = (e) => {
    const {
        key,
        cx,
        cz,
        chunkSize,
        groundY,
        bladeTarget = BLADE_TARGET,
        widthScale = 1,
        heightScale = 1,
        grassRequestId
    } = e.data;
    try {
        const { count, matrices, instanceColors } = computeGrassInstanceMatrices(
            chunkSize,
            cx,
            cz,
            groundY,
            bladeTarget,
            widthScale,
            heightScale
        );
        self.postMessage(
            {
                type: 'grass',
                key,
                cx,
                cz,
                grassRequestId,
                count,
                matrices,
                instanceColors,
                bladeTarget
            },
            [matrices.buffer, instanceColors.buffer]
        );
    } catch (err) {
        self.postMessage({
            type: 'error',
            key,
            grassRequestId,
            message: String(err && err.message ? err.message : err)
        });
    }
};
