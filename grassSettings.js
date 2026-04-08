/** Persisted grass tuning (density / blade size). */

export const GRASS_SETTINGS_STORAGE_KEY = 'darkness-grass-settings';

/** Upper cap for instanced blades per chunk (matches historical BLADE_TARGET). */
export const GRASS_BLADE_MAX = 12000;

export const grassSettings = {
    /** 0–100 (% of {@link GRASS_BLADE_MAX} blades attempted per chunk). */
    density: 100,
    /** 25–200 (%), scales blade thickness (XZ). */
    width: 100,
    /** 25–200 (%), scales blade height (Y). */
    height: 100
};

function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}

try {
    const raw = localStorage.getItem(GRASS_SETTINGS_STORAGE_KEY);
    if (raw) {
        const o = JSON.parse(raw);
        if (typeof o.density === 'number') grassSettings.density = clamp(o.density, 0, 100);
        if (typeof o.width === 'number') grassSettings.width = clamp(o.width, 25, 200);
        if (typeof o.height === 'number') grassSettings.height = clamp(o.height, 25, 200);
    }
} catch {
    /* ignore */
}

export function saveGrassSettings() {
    try {
        localStorage.setItem(
            GRASS_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                density: grassSettings.density,
                width: grassSettings.width,
                height: grassSettings.height
            })
        );
    } catch {
        /* ignore */
    }
}

/**
 * Values for grass placement (worker + main thread).
 * @returns {{ bladeTarget: number, widthScale: number, heightScale: number }}
 */
export function getGrassGenerationParams() {
    const densityT = clamp(grassSettings.density, 0, 100) / 100;
    const bladeTarget = Math.round(GRASS_BLADE_MAX * densityT);
    const widthScale = clamp(grassSettings.width, 25, 200) / 100;
    const heightScale = clamp(grassSettings.height, 25, 200) / 100;
    return { bladeTarget, widthScale, heightScale };
}
