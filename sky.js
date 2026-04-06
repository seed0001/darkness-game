import * as THREE from 'three';

const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    varying vec3 vWorldPosition;
    uniform float time;
    uniform float dayPhase; // 0.0: Night, 1.0: Day

    // Simple hash function for noise
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    // 3D Noise for Nebulae
    float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }

    // Fractal Brownian Motion for Nebula layers
    float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        vec3 shift = vec3(100);
        for (int i = 0; i < 5; ++i) {
            v += a * noise(p);
            p = p * 2.0 + shift;
            a *= 0.5;
        }
        return v;
    }

    void main() {
        vec3 direction = normalize(vWorldPosition);
        
        // --- Night Sky (Stars & Nebulae) ---
        vec3 starPos = direction * 800.0; 
        float starGrain = hash(floor(starPos));
        float stars = pow(starGrain, 800.0) * 2.0;
        // Reduce star count by 50%
        if (hash(floor(starPos) + 31.0) < 0.5) stars = 0.0;
        stars *= 0.9 + 0.1 * sin(time * 1.5 + starGrain * 20.0);
        
        vec3 nebulaPos = direction * 3.0 + time * 0.005;
        float n = fbm(nebulaPos);
        vec3 blueNebula = vec3(0.01, 0.03, 0.15) * fbm(nebulaPos * 1.5 + 1.0);
        vec3 purpleNebula = vec3(0.08, 0.01, 0.15) * fbm(nebulaPos * 2.0 + 5.0);
        vec3 finalNebula = (blueNebula + purpleNebula) * n * 0.4;
        
        vec3 nightColor = finalNebula + vec3(stars);
        
        // --- Day Sky (Atmospheric Scattering Simulation) ---
        vec3 daySkyTop = vec3(0.1, 0.4, 0.8);
        vec3 daySkyBottom = vec3(0.7, 0.85, 1.0);
        vec3 dayColor = mix(daySkyBottom, daySkyTop, max(direction.y, 0.0));
        
        // Add Sun Disk
        vec3 sunDir = normalize(vec3(0.5, 0.8, -0.3));
        float sunIntensity = pow(max(dot(direction, sunDir), 0.0), 100.0);
        float sunGlow = pow(max(dot(direction, sunDir), 0.0), 5.0) * 0.5;
        dayColor += (sunIntensity + sunGlow) * vec3(1.0, 0.9, 0.8);

        // --- Final Composition ---
        vec3 finalColor = mix(nightColor, dayColor, dayPhase);
        
        // Dynamic Fade at the horizon
        float nightFade = smoothstep(-0.2, 0.3, direction.y + 0.1);
        float dayFade = smoothstep(-0.1, 0.1, direction.y);
        finalColor *= mix(nightFade, dayFade, dayPhase);
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

export class SkyDome {
    constructor(scene) {
        this.scene = scene;
        this.geometry = new THREE.SphereGeometry(2000, 32, 32);
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0.0 },
                dayPhase: { value: 0.0 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.BackSide
        });
        
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.scene.add(this.mesh);
        this.scene.background = new THREE.Color(0x000000);
    }

    update(time, cameraPosition, dayPhase = 0) {
        this.material.uniforms.time.value = time;
        this.material.uniforms.dayPhase.value = dayPhase;
        this.mesh.position.copy(cameraPosition);
    }
}
