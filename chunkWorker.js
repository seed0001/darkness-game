import { computeGrassInstanceMatrices, BLADE_TARGET } from './chunkGenShared.js';

self.onmessage = (e) => {
    const { key, cx, cz, chunkSize, groundY } = e.data;
    try {
        const { count, matrices, instanceColors } = computeGrassInstanceMatrices(
            chunkSize,
            cx,
            cz,
            groundY,
            BLADE_TARGET
        );
        self.postMessage(
            { type: 'grass', key, cx, cz, count, matrices, instanceColors },
            [matrices.buffer, instanceColors.buffer]
        );
    } catch (err) {
        self.postMessage({ type: 'error', key, message: String(err && err.message ? err.message : err) });
    }
};
