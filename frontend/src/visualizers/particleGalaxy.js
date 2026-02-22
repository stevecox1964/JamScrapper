import * as THREE from 'three';

export default function init(container, dataRef) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);

  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Create galaxy particles
  const PARTICLE_COUNT = 6000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const basePositions = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);

  const ARMS = 5;
  const ARM_SPREAD = 0.4;
  const GALAXY_RADIUS = 8;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const armIndex = i % ARMS;
    const armAngle = (armIndex / ARMS) * Math.PI * 2;

    // Distance from center with bias toward center
    const dist = Math.pow(Math.random(), 0.6) * GALAXY_RADIUS;

    // Spiral angle increases with distance
    const spiralAngle = armAngle + dist * 0.5;

    // Add spread
    const spreadX = (Math.random() - 0.5) * ARM_SPREAD * dist;
    const spreadZ = (Math.random() - 0.5) * ARM_SPREAD * dist;
    const spreadY = (Math.random() - 0.5) * 0.3 * (1 - dist / GALAXY_RADIUS);

    const x = Math.cos(spiralAngle) * dist + spreadX;
    const y = spreadY;
    const z = Math.sin(spiralAngle) * dist + spreadZ;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    basePositions[i * 3] = x;
    basePositions[i * 3 + 1] = y;
    basePositions[i * 3 + 2] = z;

    // Color: warm core (orange/yellow) → cool edges (blue/purple)
    const t = dist / GALAXY_RADIUS;
    const color = new THREE.Color();
    if (t < 0.3) {
      color.setHSL(0.08, 1, 0.7 + (1 - t / 0.3) * 0.3); // orange/yellow core
    } else if (t < 0.6) {
      color.setHSL(0.7 + (t - 0.3) * 0.5, 0.8, 0.6); // purple mid
    } else {
      color.setHSL(0.6, 0.7, 0.4 + Math.random() * 0.2); // blue edges
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = 0.03 + Math.random() * 0.06;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const galaxy = new THREE.Points(geometry, material);
  scene.add(galaxy);

  // Center glow
  const glowGeometry = new THREE.SphereGeometry(0.5, 16, 16);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  scene.add(glow);

  let time = 0;
  let animId;

  function animate() {
    animId = requestAnimationFrame(animate);
    const data = dataRef.current;
    const { fft = [], peak = 0 } = data;

    time += 0.005;

    // Base rotation + peak boost
    const rotationSpeed = 0.002 + peak * 0.01;
    galaxy.rotation.y += rotationSpeed;

    // Compute bass (first 16 bins) and treble (last 32 bins) energy
    const bassEnergy = fft.slice(0, 16).reduce((a, b) => a + b, 0) / 16;
    const trebleEnergy = fft.slice(96).reduce((a, b) => a + b, 0) / 32;

    // Update particle positions based on audio
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const bx = basePositions[i * 3];
      const by = basePositions[i * 3 + 1];
      const bz = basePositions[i * 3 + 2];

      const dist = Math.sqrt(bx * bx + bz * bz);
      const normalizedDist = dist / GALAXY_RADIUS;

      // Bass pushes particles outward
      const pushFactor = 1 + bassEnergy * 0.5 * normalizedDist;
      pos[i * 3] = bx * pushFactor;
      pos[i * 3 + 2] = bz * pushFactor;

      // Treble adds vertical scatter
      pos[i * 3 + 1] = by + trebleEnergy * (Math.random() - 0.5) * 0.5 * normalizedDist;
    }
    geometry.attributes.position.needsUpdate = true;

    // Pulse center glow
    glow.scale.setScalar(1 + peak * 2);
    glowMaterial.opacity = 0.3 + peak * 0.5;

    // Orbit camera slightly
    camera.position.x = Math.sin(time * 0.3) * 3;
    camera.position.z = 12 + Math.cos(time * 0.3) * 3;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  animate();

  function onResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener('resize', onResize);

  return {
    cleanup() {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      geometry.dispose();
      material.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
