import { computeGrassInstanceMatrices, BLADE_TARGET } from './chunkGenShared.js';

self.onmessage = (e) => {
    const { key, cx, cz, chunkSize, groundY } = e.data;
    try {
        const { count, matrices } = computeGrassInstanceMatrices(
            chunkSize,
            cx,
            cz,
            groundY,
            BLADE_TARGET
        );
        self.postMessage(
            { type: 'grass', key, cx, cz, count, matrices },
            [matrices.buffer]
        );
    } catch (err) {
        self.postMessage({ type: 'error', key, message: String(err && err.message ? err.message : err) });
    }
};
