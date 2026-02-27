import * as THREE from 'three';

export default function init(container, dataRef, mediaManager) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Galaxy particles
  const PARTICLE_COUNT = 6000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const basePositions = new Float32Array(PARTICLE_COUNT * 3);

  const ARMS = 5;
  const ARM_SPREAD = 0.4;
  const GALAXY_RADIUS = 8;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const armIndex = i % ARMS;
    const armAngle = (armIndex / ARMS) * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.6) * GALAXY_RADIUS;
    const spiralAngle = armAngle + dist * 0.5;

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

    const t = dist / GALAXY_RADIUS;
    const color = new THREE.Color();
    if (t < 0.3) {
      color.setHSL(0.08, 1, 0.7 + (1 - t / 0.3) * 0.3);
    } else if (t < 0.6) {
      color.setHSL(0.7 + (t - 0.3) * 0.5, 0.8, 0.6);
    } else {
      color.setHSL(0.6, 0.7, 0.4 + Math.random() * 0.2);
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

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

  // Album art core sprite (replaces glow sphere)
  const coreMat = new THREE.SpriteMaterial({
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
  });
  const coreSprite = new THREE.Sprite(coreMat);
  coreSprite.scale.set(2.5, 2.5, 1);
  scene.add(coreSprite);

  // Image chips in spiral arms
  const ARM_SPRITE_COUNT = 12;
  const armSprites = [];
  const armSpriteBasePositions = [];

  for (let i = 0; i < ARM_SPRITE_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.8, 0.8, 1);

    const armIndex = i % ARMS;
    const armAngle = (armIndex / ARMS) * Math.PI * 2;
    const dist = 2 + (i / ARM_SPRITE_COUNT) * (GALAXY_RADIUS - 2);
    const spiralAngle = armAngle + dist * 0.5;

    const x = Math.cos(spiralAngle) * dist;
    const z = Math.sin(spiralAngle) * dist;
    sprite.position.set(x, 0.3, z);
    armSpriteBasePositions.push({ x, z, dist });

    scene.add(sprite);
    armSprites.push(sprite);
  }

  let time = 0;
  let animId;
  let frameCount = 0;
  let texturesAssigned = false;

  function animate() {
    animId = requestAnimationFrame(animate);
    const data = dataRef.current;
    const { fft = [], peak = 0 } = data;

    time += 0.005;
    frameCount++;

    // Assign textures
    if (mediaManager && frameCount % 30 === 0) {
      const textures = mediaManager.getAllTextures();
      const albumTex = mediaManager.albumArtTexture;
      if (textures.length > 0 && !texturesAssigned) {
        if (albumTex) {
          coreMat.map = albumTex;
          coreMat.needsUpdate = true;
        } else {
          coreMat.map = textures[0];
          coreMat.needsUpdate = true;
        }
        armSprites.forEach((s, i) => {
          s.material.map = textures[i % textures.length];
          s.material.needsUpdate = true;
        });
        texturesAssigned = true;
      }
    }

    const rotationSpeed = 0.002 + peak * 0.01;
    galaxy.rotation.y += rotationSpeed;

    const bassEnergy = fft.slice(0, 16).reduce((a, b) => a + b, 0) / 16;
    const trebleEnergy = fft.slice(96).reduce((a, b) => a + b, 0) / 32;

    const pos = geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const bx = basePositions[i * 3];
      const by = basePositions[i * 3 + 1];
      const bz = basePositions[i * 3 + 2];

      const dist = Math.sqrt(bx * bx + bz * bz);
      const normalizedDist = dist / GALAXY_RADIUS;

      const pushFactor = 1 + bassEnergy * 0.5 * normalizedDist;
      pos[i * 3] = bx * pushFactor;
      pos[i * 3 + 2] = bz * pushFactor;
      pos[i * 3 + 1] = by + trebleEnergy * (Math.random() - 0.5) * 0.5 * normalizedDist;
    }
    geometry.attributes.position.needsUpdate = true;

    // Pulse core sprite
    coreSprite.scale.setScalar(2 + peak * 3);
    coreMat.opacity = 0.4 + peak * 0.5;

    // Animate arm sprites — rotate with galaxy and scale with bass
    for (let i = 0; i < ARM_SPRITE_COUNT; i++) {
      const sprite = armSprites[i];
      const bp = armSpriteBasePositions[i];
      const pushFactor = 1 + bassEnergy * 0.5 * (bp.dist / GALAXY_RADIUS);

      // Rotate position with galaxy
      const angle = Math.atan2(bp.z, bp.x) + galaxy.rotation.y;
      const dist = bp.dist * pushFactor;
      sprite.position.x = Math.cos(angle) * dist;
      sprite.position.z = Math.sin(angle) * dist;
      sprite.position.y = 0.3 + trebleEnergy * (Math.sin(time * 2 + i) * 0.3);

      const s = 0.6 + bassEnergy * 0.8;
      sprite.scale.setScalar(s);
      sprite.material.opacity = 0.4 + peak * 0.4;
    }

    // Orbit camera
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
      coreMat.dispose();
      armSprites.forEach(s => s.material.dispose());
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
