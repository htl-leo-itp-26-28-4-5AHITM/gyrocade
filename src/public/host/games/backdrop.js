import * as THREE from 'three';
import { sunTexture } from './race-textures.js';

// Synthwave sky of the race: gradient dome, stars and a striped sun.
// It follows the camera, so it always looks infinitely far away.

const SKY_RADIUS = 2000;
const SUN_SIZE = 560;

export const SKY_COLORS = {
  top: new THREE.Color('#02020c'),
  horizon: new THREE.Color('#3b0c55'),
  bottom: new THREE.Color('#0a0214'),
};

// sunDirection: world direction towards the sun (it sits just above the horizon), also the
// centre of the horizon glow. sun: false leaves only the glowing horizon (lobby).
export function createSky(sunDirection, { sun: withSun = true, horizonGlow = 0 } = {}) {
  const towards = sunDirection.clone().setY(0).normalize();
  const sky = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: SKY_COLORS.top },
        horizon: { value: SKY_COLORS.horizon },
        bottom: { value: SKY_COLORS.bottom },
        glowColor: { value: new THREE.Color('#ff3d8a') },
        glowCore: { value: new THREE.Color('#ffb070') },
        glowStrength: { value: horizonGlow },
        towards: { value: towards },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 bottom;
        uniform vec3 glowColor;
        uniform vec3 glowCore;
        uniform float glowStrength;
        uniform vec3 towards;
        varying vec3 vDirection;
        void main() {
          vec3 direction = normalize(vDirection);
          float h = direction.y;
          vec3 color = h > 0.0
            ? mix(horizon, top, pow(min(h * 2.5, 1.0), 0.6))
            : mix(horizon, bottom, min(-h * 6.0, 1.0));
          // glowing band along the horizon, brightest straight ahead
          float ahead = 0.3 + 0.7 * max(0.0, dot(normalize(direction.xz), towards.xz));
          float band = exp(-abs(h) * 22.0) * 0.3 + exp(-abs(h) * 90.0) * 0.9;
          color += mix(glowColor, glowCore, exp(-abs(h) * 60.0) * ahead) * band * ahead * glowStrength;
          gl_FragColor = vec4(color, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -3;

  const starPositions = [];
  const direction = new THREE.Vector3();
  for (let i = 0; i < 1400; i++) {
    direction.randomDirection();
    direction.y = Math.abs(direction.y) + 0.04;
    direction.normalize().multiplyScalar(SKY_RADIUS * 0.95);
    starPositions.push(direction.x, direction.y, direction.z);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xc8c0ff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false }),
  );
  stars.renderOrder = -2;

  sky.add(dome, stars);
  if (withSun) {
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(SUN_SIZE, SUN_SIZE),
      new THREE.MeshBasicMaterial({
        map: sunTexture(),
        color: new THREE.Color(1.4, 1.4, 1.4),
        alphaTest: 0.5,
        fog: false,
        depthWrite: false,
      }),
    );
    sun.position.copy(sunDirection).normalize().multiplyScalar(SKY_RADIUS * 0.9);
    sun.lookAt(0, 0, 0);
    sun.renderOrder = -1;
    sky.add(sun);
  }

  return {
    object: sky,
    update(camera) {
      sky.position.copy(camera.position);
    },
  };
}
