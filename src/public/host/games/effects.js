import * as THREE from 'three';
import { disposeTree } from '../util.js';

// Effects shared by the lobby arena and the Knockout Arena: sparks, shockwave rings and the
// backgrounds drawn behind the game board (calm space for the lobby, a glowing abyss for the
// Knockout Arena).

const MAX_SPARKS = 400;
const ABYSS_MOTES = 700;

// --- Lobby: calm space ---------------------------------------------------------------

// Starfield with slowly drifting nebula clouds and no floor. Background scene with its own
// camera, for a game's `background`.
export function createSpaceVista() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 3000);
  camera.lookAt(0, -0.25, -1);

  const nebula = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: DIRECTION_VERTEX,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vDirection;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDirection);
          vec3 drift = vec3(uTime * 0.004, uTime * 0.002, 0.0);
          float clouds = fbm(d * 2.2 + drift);
          float wisps = fbm(d * 5.0 - drift * 2.0 + 7.3);
          vec3 color = vec3(0.008, 0.006, 0.025);
          color += vec3(0.30, 0.08, 0.45) * smoothstep(0.42, 0.85, clouds) * 0.55; // violet clouds
          color += vec3(0.05, 0.22, 0.45) * smoothstep(0.50, 0.90, wisps) * 0.40; // blue wisps
          color += vec3(0.55, 0.10, 0.40) * pow(smoothstep(0.62, 0.95, clouds * wisps * 1.6), 2.0) * 0.5; // magenta cores
          gl_FragColor = vec4(color, 1.0);
        }`,
    }),
  );
  nebula.renderOrder = -2;
  const stars = createStars(1400, 1400);
  stars.points.renderOrder = -1;

  const sky = new THREE.Group();
  sky.add(nebula, stars.points);
  scene.add(sky);

  return {
    scene,
    camera,
    update(dt, time) {
      nebula.material.uniforms.uTime.value = time;
      stars.update(time);
      sky.rotation.y += dt * 0.004; // the whole sky turns very slowly
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
}

// --- Knockout Arena: glowing abyss -----------------------------------------------------

// Dark sky above, and far below the platform a deep pit with magenta/cyan light rising out of
// it. Rendered with the game's own camera, so the pit really lies under the platform and fallen
// balls sink into the light. The camera needs a far plane of about 500 to see all of it.
export function createAbyss() {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(320, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: DIRECTION_VERTEX,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vDirection;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDirection);
          // sky: near black at the top, dim violet towards the rim of the pit
          vec3 color = mix(vec3(0.03, 0.01, 0.06), vec3(0.004, 0.002, 0.012), smoothstep(0.0, 0.7, d.y));
          float below = max(0.0, -d.y);
          float theta = acos(clamp(-d.y, -1.0, 1.0)); // angle from straight down
          float angle = atan(d.z, d.x);
          // the pit: brightest in the depth, swirling, with rings of light moving up and out
          float pit = exp(-theta * theta * 5.0); // the light stays deep down the shaft
          float core = exp(-theta * theta * 22.0);
          vec2 polar = vec2(cos(angle + uTime * 0.05), sin(angle + uTime * 0.05)) * theta * 3.0;
          float swirl = fbm(vec3(polar, uTime * 0.08));
          float rings = pow(0.5 + 0.5 * sin(theta * 26.0 - uTime * 1.4 + swirl * 4.0), 8.0);
          vec3 tint = mix(vec3(1.0, 0.17, 0.84), vec3(0.0, 0.94, 1.0), 0.5 + 0.5 * sin(theta * 5.0 - uTime * 0.4 + swirl * 3.0));
          float light = pit * (0.06 + swirl * swirl * 0.35 + rings * 0.22) + core * 0.45;
          color += tint * light * smoothstep(0.0, 0.25, below);
          color += vec3(0.25, 0.05, 0.35) * exp(-abs(d.y) * 14.0) * 0.12; // faint glow along the rim
          gl_FragColor = vec4(color, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -2;

  const stars = createStars(700, 300, { upperOnly: true });
  stars.points.renderOrder = -1;

  // giant halo rings far down the shaft give the pit its depth
  const halos = [-60, -110, -170, -240].map((y, i) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(46 + i * 6, 47.5 + i * 6, 96),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(i % 2 ? '#00f0ff' : '#ff2bd6').multiplyScalar(0.9 - i * 0.15),
        transparent: true,
        opacity: 0.35 - i * 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  });

  const motes = createRisingMotes();
  scene.add(dome, stars.points, motes.points, ...halos);

  return {
    scene,
    update(dt, time) {
      dome.material.uniforms.uTime.value = time;
      stars.update(time);
      motes.update(dt);
      halos.forEach((halo, i) => {
        halo.rotation.z += dt * (i % 2 ? -0.05 : 0.04);
        halo.scale.setScalar(1 + Math.sin(time * 0.8 + i) * 0.03);
      });
    },
  };
}

// Sparks of light drifting up out of the pit, fading in from the depth and out near the top.
function createRisingMotes() {
  const positions = new Float32Array(ABYSS_MOTES * 3);
  const colors = new Float32Array(ABYSS_MOTES * 3);
  const speeds = new Float32Array(ABYSS_MOTES);
  const palette = ['#ff2bd6', '#00f0ff', '#a855ff'].map((c) => new THREE.Color(c));
  const reset = (i, y) => {
    const angle = Math.random() * Math.PI * 2;
    const radius = 8 + Math.random() * 60;
    positions.set([Math.cos(angle) * radius, y, Math.sin(angle) * radius], i * 3);
    speeds[i] = 5 + Math.random() * 12;
  };
  for (let i = 0; i < ABYSS_MOTES; i++) reset(i, -260 + Math.random() * 255);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 1.4,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;

  return {
    points,
    update(dt) {
      for (let i = 0; i < ABYSS_MOTES; i++) {
        const k = i * 3;
        positions[k + 1] += speeds[i] * dt;
        if (positions[k + 1] > -6) reset(i, -260);
        const y = positions[k + 1];
        const fade = THREE.MathUtils.smoothstep(y, -260, -170) * (1 - THREE.MathUtils.smoothstep(y, -40, -6));
        const c = palette[i % palette.length];
        colors[k] = c.r * fade * 1.5;
        colors[k + 1] = c.g * fade * 1.5;
        colors[k + 2] = c.b * fade * 1.5;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

// --- Shared sky pieces -------------------------------------------------------------------

// Twinkling stars on a sphere. upperOnly keeps them above the horizon.
function createStars(count, radius, { upperOnly = false } = {}) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const direction = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    direction.randomDirection();
    if (upperOnly) direction.y = Math.abs(direction.y) * 0.9 + 0.1;
    direction.normalize().multiplyScalar(radius);
    positions.set([direction.x, direction.y, direction.z], i * 3);
    phases[i] = Math.random() * Math.PI * 2;
    sizes[i] = Math.random() < 0.08 ? 3.2 : 1.4 + Math.random() * 1.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float phase;
      attribute float size;
      varying float vBrightness;
      void main() {
        vBrightness = 0.55 + 0.45 * sin(uTime * (0.6 + fract(phase) * 1.4) + phase);
        gl_PointSize = size * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vBrightness;
      void main() {
        float alpha = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(0.85, 0.85, 1.0) * vBrightness, alpha);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    update(time) {
      material.uniforms.uTime.value = time;
    },
  };
}

const DIRECTION_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// 3D value noise and fractal noise, both 0..1.
const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return value;
  }`;

// --- Sparks and shockwaves ------------------------------------------------------------------

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// Pool of spark particles that fly out, fall and fade. They start `height` above the floor.
export function createSparks(height) {
  const positions = new Float32Array(MAX_SPARKS * 3);
  const colors = new Float32Array(MAX_SPARKS * 3);
  const velocities = new Float32Array(MAX_SPARKS * 3);
  const life = new Float32Array(MAX_SPARKS); // remaining seconds, 0 = free
  const base = new Float32Array(MAX_SPARKS * 3); // full-brightness color
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.5,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;
  let next = 0;

  return {
    points,
    emit(position, color, count, speed) {
      for (let n = 0; n < Math.min(count, 120); n++) {
        const i = next;
        next = (next + 1) % MAX_SPARKS;
        const angle = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random());
        positions.set([position.x, height, position.z], i * 3);
        velocities.set([Math.cos(angle) * v, 2 + Math.random() * speed * 0.6, Math.sin(angle) * v], i * 3);
        const white = Math.random() * 0.5;
        base.set([(color.r + white) * 2, (color.g + white) * 2, (color.b + white) * 2], i * 3);
        life[i] = 0.4 + Math.random() * 0.5;
      }
    },
    update(dt) {
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (life[i] <= 0) continue;
        life[i] = Math.max(0, life[i] - dt);
        const k = i * 3;
        velocities[k + 1] -= 25 * dt;
        positions[k] += velocities[k] * dt;
        positions[k + 1] = Math.max(0.05, positions[k + 1] + velocities[k + 1] * dt);
        positions[k + 2] += velocities[k + 2] * dt;
        const fade = Math.min(1, life[i] * 2.5);
        colors[k] = base[k] * fade;
        colors[k + 1] = base[k + 1] * fade;
        colors[k + 2] = base[k + 2] * fade;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

// Expanding rings on the floor (landings, hard hits, knockouts).
export function createWaves(scene) {
  const waves = []; // { mesh, age, duration, maxScale }
  return {
    spawn(position, color, maxScale, duration) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 48),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(2),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(position.x, 0.05, position.z);
      scene.add(mesh);
      waves.push({ mesh, age: 0, duration, maxScale });
    },
    update(dt) {
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.age += dt;
        const t = w.age / w.duration;
        if (t >= 1) {
          scene.remove(w.mesh);
          disposeTree(w.mesh);
          waves.splice(i, 1);
          continue;
        }
        w.mesh.scale.setScalar(0.5 + t * w.maxScale);
        w.mesh.material.opacity = 1 - t;
      }
    },
  };
}
