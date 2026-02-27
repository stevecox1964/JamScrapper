import * as THREE from 'three';

export default function init(container, dataRef, mediaManager) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.z = 0;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Background dust particles (dimmed when images present)
  const STAR_COUNT = 2500;
  const FIELD_DEPTH = 300;
  const FIELD_RADIUS = 50;

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const velocities = new Float32Array(STAR_COUNT);
  const baseColors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * FIELD_RADIUS;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = -Math.random() * FIELD_DEPTH;

    const temp = 0.85 + Math.random() * 0.15;
    baseColors[i * 3] = temp;
    baseColors[i * 3 + 1] = temp;
    baseColors[i * 3 + 2] = 1;
    colors[i * 3] = temp;
    colors[i * 3 + 1] = temp;
    colors[i * 3 + 2] = 1;

    velocities[i] = 0.5 + Math.random() * 0.5;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1,
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const stars = new THREE.Points(geometry, material);
  scene.add(stars);

  // Streak lines
  const streakGeometry = new THREE.BufferGeometry();
  const streakPositions = new Float32Array(STAR_COUNT * 6);
  const streakColors = new Float32Array(STAR_COUNT * 6);
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  streakGeometry.setAttribute('color', new THREE.BufferAttribute(streakColors, 3));

  const streakMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.3,
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

  // --- Flying image cards ---
  const IMAGE_CARD_COUNT = 24;
  const cards = [];
  const cardVelocities = [];

  for (let i = 0; i < IMAGE_CARD_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    const size = 1.5 + Math.random() * 2.5;
    sprite.scale.set(size, size, 1);

    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * FIELD_RADIUS * 0.6;
    sprite.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      -Math.random() * FIELD_DEPTH
    );

    scene.add(sprite);
    cards.push(sprite);
    cardVelocities.push(0.3 + Math.random() * 0.7);
  }

  let time = 0;
  let animId;
  let smoothPeak = 0;
  let frameCount = 0;
  let texturesAssigned = false;

  function animate() {
    animId = requestAnimationFrame(animate);
    const data = dataRef.current;
    const { fft = [], peak = 0 } = data;

    time += 0.01;
    frameCount++;
    smoothPeak += (peak - smoothPeak) * 0.15;

    const baseSpeed = 0.5;
    const audioSpeed = smoothPeak * 4;
    const speed = baseSpeed + audioSpeed;

    // Assign textures from media manager
    if (mediaManager && frameCount % 30 === 0) {
      const textures = mediaManager.getAllTextures();
      if (textures.length > 0 && !texturesAssigned) {
        cards.forEach((card, i) => {
          card.material.map = textures[i % textures.length];
          card.material.needsUpdate = true;
        });
        texturesAssigned = true;
      }
    }

    // Update dust particles
    const pos = geometry.attributes.position.array;
    const col = geometry.attributes.color.array;
    const sPos = streakGeometry.attributes.position.array;
    const sCol = streakGeometry.attributes.color.array;

    for (let i = 0; i < STAR_COUNT; i++) {
      const i3 = i * 3;
      const vel = velocities[i] * speed;

      pos[i3 + 2] += vel;

      if (pos[i3 + 2] > 5) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * FIELD_RADIUS;
        pos[i3] = Math.cos(angle) * radius;
        pos[i3 + 1] = Math.sin(angle) * radius;
        pos[i3 + 2] = -FIELD_DEPTH;
      }

      const intensity = Math.min(1, smoothPeak * 1.5);
      col[i3] = baseColors[i3] * (1 - intensity * 0.7);
      col[i3 + 1] = baseColors[i3 + 1] * (1 - intensity * 0.5);
      col[i3 + 2] = 1;

      const streakLength = Math.min(vel * 2, 8);
      const i6 = i * 6;
      sPos[i6] = pos[i3];
      sPos[i6 + 1] = pos[i3 + 1];
      sPos[i6 + 2] = pos[i3 + 2];
      sPos[i6 + 3] = pos[i3];
      sPos[i6 + 4] = pos[i3 + 1];
      sPos[i6 + 5] = pos[i3 + 2] - streakLength;

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

    material.size = 1 + smoothPeak * 2;
    streakMaterial.opacity = Math.min(0.4, smoothPeak * 1.2);

    // Update flying image cards
    for (let i = 0; i < IMAGE_CARD_COUNT; i++) {
      const card = cards[i];
      const vel = cardVelocities[i] * speed;
      card.position.z += vel;

      if (card.position.z > 5) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * FIELD_RADIUS * 0.6;
        card.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          -FIELD_DEPTH * (0.5 + Math.random() * 0.5)
        );
        // Reassign random texture on recycle
        if (mediaManager) {
          const textures = mediaManager.getAllTextures();
          if (textures.length > 0) {
            card.material.map = textures[Math.floor(Math.random() * textures.length)];
            card.material.needsUpdate = true;
          }
        }
      }

      // Scale up as cards approach camera
      const zNorm = Math.max(0, (card.position.z + FIELD_DEPTH) / FIELD_DEPTH);
      const baseSize = 1.5 + (i % 4) * 0.5;
      card.scale.setScalar(baseSize * (1 + zNorm * 1.5 + smoothPeak * 0.5));
      card.material.opacity = 0.5 + smoothPeak * 0.4;
    }

    // Central glow pulse
    glowMaterial.opacity = smoothPeak * 0.3;
    glow.scale.setScalar(1 + smoothPeak * 5);

    // Camera shake
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
      cards.forEach(c => c.material.dispose());
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
