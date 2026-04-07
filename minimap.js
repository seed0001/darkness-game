import { LAKE_CX, LAKE_CZ, LAKE_RX, LAKE_RZ } from './world.js';
import { AIRBUS_PLACE_X, AIRBUS_PLACE_Z } from './airbus.js';

/**
 * Bottom-right 2D map: lake (blue ellipse), Airbus (red), spawn (outline), player (yellow).
 */
export class WorldMinimap {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {() => { x: number; z: number }} getPlayerXZ
     */
    constructor(canvas, getPlayerXZ) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.getPlayerXZ = getPlayerXZ;
        /** World XZ bounds shown on map (meters). */
        this.minX = -35;
        this.maxX = 95;
        this.minZ = -35;
        this.maxZ = 75;
        this._dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * this._dpr));
        const h = Math.max(1, Math.floor(rect.height * this._dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    }

    worldToCanvas(wx, wz) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const nx = (wx - this.minX) / (this.maxX - this.minX);
        const nz = (wz - this.minZ) / (this.maxZ - this.minZ);
        return {
            x: nx * w,
            y: h - nz * h
        };
    }

    draw() {
        this.resize();
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (w < 2 || h < 2) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0c0e14';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = this._dpr;
        ctx.strokeRect(this._dpr * 0.5, this._dpr * 0.5, w - this._dpr, h - this._dpr);

        const scaleX = w / (this.maxX - this.minX);
        const scaleZ = h / (this.maxZ - this.minZ);
        const c = this.worldToCanvas(LAKE_CX, LAKE_CZ);
        const rx = LAKE_RX * scaleX;
        const ry = LAKE_RZ * scaleZ;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(40, 100, 180, 0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 180, 255, 0.85)';
        ctx.lineWidth = 1.5 * this._dpr;
        ctx.stroke();
        ctx.restore();

        const plane = this.worldToCanvas(AIRBUS_PLACE_X, AIRBUS_PLACE_Z);
        ctx.fillStyle = '#ff2222';
        ctx.strokeStyle = '#ffaaaa';
        ctx.lineWidth = 1.5 * this._dpr;
        const pr = 6 * this._dpr;
        ctx.beginPath();
        ctx.moveTo(plane.x, plane.y - pr);
        ctx.lineTo(plane.x + pr * 0.85, plane.y + pr * 0.55);
        ctx.lineTo(plane.x - pr * 0.85, plane.y + pr * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const spawn = this.worldToCanvas(0, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.25 * this._dpr;
        const sr = 5 * this._dpr;
        ctx.strokeRect(spawn.x - sr, spawn.y - sr, sr * 2, sr * 2);

        const pl = this.getPlayerXZ();
        const you = this.worldToCanvas(pl.x, pl.z);
        ctx.fillStyle = '#ffcc22';
        ctx.strokeStyle = '#332200';
        ctx.lineWidth = 1 * this._dpr;
        ctx.beginPath();
        ctx.arc(you.x, you.y, 5 * this._dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(220, 225, 235, 0.95)';
        ctx.font = `${11 * this._dpr}px system-ui, Segoe UI, sans-serif`;
        ctx.fillText('N +Z', w - 42 * this._dpr, 16 * this._dpr);
        ctx.font = `${10 * this._dpr}px system-ui, Segoe UI, sans-serif`;
        ctx.fillStyle = 'rgba(180, 190, 205, 0.9)';
        ctx.fillText(`Lake (${LAKE_CX}, ${LAKE_CZ})`, 8 * this._dpr, h - 36 * this._dpr);
        ctx.fillText(`Airbus (${AIRBUS_PLACE_X}, ${AIRBUS_PLACE_Z})`, 8 * this._dpr, h - 22 * this._dpr);
        ctx.fillText(`You (${pl.x.toFixed(0)}, ${pl.z.toFixed(0)})`, 8 * this._dpr, h - 8 * this._dpr);
    }
}
