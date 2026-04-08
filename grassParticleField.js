import * as THREE from 'three';

/**
 * Grass styled after three.js `webgpu_particles` (fire/smoke sprites): soft edges, vertical color mix,
 * time-driven motion — implemented for WebGL via MeshBasicMaterial + shader hooks.
 * @see https://threejs.org/examples/?q=fire#webgpu_particles
 */

const BLADE_W = 0.09;
const BLADE_H = 0.46;
const BLADE_SEGS = 10;

/** Single vertical blade (particle-style quad); UV.y = height for gradient mix. */
export function createGrassParticleBladeGeometry() {
    const geo = new THREE.PlaneGeometry(BLADE_W, BLADE_H, 1, BLADE_SEGS);
    geo.translate(0, BLADE_H * 0.5, 0);
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    colors.fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
}

/**
 * Unlit instanced grass: soft alpha like billboard sprites, tip “glow” like fire color ramp.
 * Requires a `map` so UV varyings are emitted (1×1 white).
 */
export function createGrassParticleMaterial() {
    const whiteMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteMap.needsUpdate = true;
    whiteMap.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
        map: whiteMap,
        color: 0xffffff,
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
        depthWrite: true,
        depthTest: true
    });

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uGrassTime = { value: 0 };
        material.userData.grassUniforms = { uGrassTime: shader.uniforms.uGrassTime };

        shader.vertexShader =
            'uniform float uGrassTime;\n' +
            shader.vertexShader.replace(
                '#include <begin_vertex>',
                /* glsl */ `
#include <begin_vertex>
float _h = max(0.0, transformed.y);
float _bend = _h * _h * (0.24 + _h * 0.07);
#ifdef USE_INSTANCING
vec4 _gw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 _gw = modelMatrix * vec4(transformed, 1.0);
#endif
float _ph = _gw.x * 0.051 + _gw.z * 0.047;
float _gt = uGrassTime;
float _w1 = sin(_gt * 1.7 + _ph) * 0.024;
float _w2 = cos(_gt * 2.35 + _ph * 1.28) * 0.018;
float _w3 = sin(_gt * 4.05 + _ph * 2.05) * 0.012;
float _fl = sin(_gt * 6.8 + _gw.x * 0.11 + _gw.z * 0.08) * _bend * 0.036;
transformed.x += (_w1 + _w2 * 0.85 + _fl) * _bend;
transformed.z += (_w2 + _w3 + _fl * 0.72) * _bend;
`
            );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            /* glsl */ `
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
float _edge = abs(vUv.x - 0.5) * 2.0;
float _soft = smoothstep(1.0, 0.55, _edge);
float _h = clamp(vUv.y, 0.0, 1.0);
vec3 _tip = mix(outgoingLight, vec3(0.78, 0.98, 0.48), pow(_h, 1.85) * 0.55);
vec3 _glow = mix(_tip, vec3(0.55, 0.92, 0.38), pow(_h, 2.6) * 0.35);
outgoingLight = _glow;
float _alpha = _soft * (0.42 + 0.58 * smoothstep(0.0, 0.08, vUv.y));
diffuseColor.a *= _alpha;
if (diffuseColor.a < 0.18) discard;
gl_FragColor = vec4(outgoingLight, diffuseColor.a);
`
        );
    };

    material.customProgramCacheKey = () => 'grassParticleBasic1';
    return material;
}
