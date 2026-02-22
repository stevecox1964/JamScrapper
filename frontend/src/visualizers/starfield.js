import * as THREE from 'three';

export default function init(container, dataRef) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020208);

  const camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.z = 0;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Create stars
  const STAR_COUNT = 2500;
  const FIELD_DEPTH = 300;
  const FIELD_RADIUS = 50;

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const velocities = new Float32Array(STAR_COUNT);
  const baseColors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    // Distribute in a cylinder
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * FIELD_RADIUS;

    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = -Math.random() * FIELD_DEPTH;

    // Default white-ish color with slight variation
    const temp = 0.85 + Math.random() * 0.15;
    baseColors[i * 3] = temp;
    baseColors[i * 3 + 1] = temp;
    baseColors[i * 3 + 2] = 1;
    colors[i * 3] = temp;
    colors[i * 3 + 1] = temp;
    colors[i * 3 + 2] = 1;

    sizes[i] = 0.5 + Math.random() * 1.5;
    velocities[i] = 0.5 + Math.random() * 0.5;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const stars = new THREE.Points(geometry, material);
  scene.add(stars);

  // Streak lines for high speed
  const streakGeometry = new THREE.BufferGeometry();
  const streakPositions = new Float32Array(STAR_COUNT * 6); // 2 vertices per line
  const streakColors = new Float32Array(STAR_COUNT * 6);
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  streakGeometry.setAttribute('color', new THREE.BufferAttribute(streakColors, 3));

  const streakMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
  });

  const streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
  scene.add(streaks);

  // Central glow
  const glowGeometry = new THREE.PlaneGeometry(2, 2);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x4444ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.z = -1;
  camera.add(glow);
  scene.add(camera);

  let time = 0;
  let animId;
  let smoothPeak = 0;

  function animate() {
    animId = requestAnimationFrame(animate);
    const data = dataRef.current;
    const { fft = [], peak = 0 } = data;

    time += 0.01;

    // Smooth the peak for less jittery movement
    smoothPeak += (peak - smoothPeak) * 0.15;

    // Speed based on audio intensity
    const baseSpeed = 0.5;
    const audioSpeed = smoothPeak * 4;
    const speed = baseSpeed + audioSpeed;

    // Compute overall energy
    const energy = fft.reduce((a, b) => a + b, 0) / Math.max(fft.length, 1);

    const pos = geometry.attributes.position.array;
    const col = geometry.attributes.color.array;
    const sPos = streakGeometry.attributes.position.array;
    const sCol = streakGeometry.attributes.color.array;

    for (let i = 0; i < STAR_COUNT; i++) {
      const i3 = i * 3;
      const vel = velocities[i] * speed;

      // Move star toward camera
      pos[i3 + 2] += vel;

      // Recycle stars that pass the camera
      if (pos[i3 + 2] > 5) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * FIELD_RADIUS;
        pos[i3] = Math.cos(angle) * radius;
        pos[i3 + 1] = Math.sin(angle) * radius;
        pos[i3 + 2] = -FIELD_DEPTH;
      }

      // Color shift at high intensity: white → blue → purple
      const intensity = Math.min(1, smoothPeak * 1.5);
      col[i3] = baseColors[i3] * (1 - intensity * 0.7);
      col[i3 + 1] = baseColors[i3 + 1] * (1 - intensity * 0.5);
      col[i3 + 2] = 1;

      // Streaks: line from star position backward proportional to speed
      const streakLength = Math.min(vel * 2, 8);
      const i6 = i * 6;
      sPos[i6] = pos[i3];
      sPos[i6 + 1] = pos[i3 + 1];
      sPos[i6 + 2] = pos[i3 + 2];
      sPos[i6 + 3] = pos[i3];
      sPos[i6 + 4] = pos[i3 + 1];
      sPos[i6 + 5] = pos[i3 + 2] - streakLength;

      // Streak color (faded)
      sCol[i6] = col[i3] * 0.3;
      sCol[i6 + 1] = col[i3 + 1] * 0.3;
      sCol[i6 + 2] = col[i3 + 2] * 0.3;
      sCol[i6 + 3] = 0;
      sCol[i6 + 4] = 0;
      sCol[i6 + 5] = 0;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    streakGeometry.attributes.position.needsUpdate = true;
    streakGeometry.attributes.color.needsUpdate = true;

    // Star size increases with speed
    material.size = 1 + smoothPeak * 2;
    streakMaterial.opacity = Math.min(0.6, smoothPeak * 1.5);

    // Central glow pulse
    glowMaterial.opacity = smoothPeak * 0.3;
    glow.scale.setScalar(1 + smoothPeak * 5);

    // Subtle camera shake at high intensity
    camera.rotation.z = Math.sin(time * 3) * smoothPeak * 0.02;
    camera.rotation.x = Math.cos(time * 2.5) * smoothPeak * 0.01;

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
      streakGeometry.dispose();
      streakMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
