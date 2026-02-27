import * as THREE from 'three';

export default function init(container, dataRef, mediaManager) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0a0f, 15, 40);

  const camera = new THREE.PerspectiveCamera(
    70,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 5, 12);
  camera.lookAt(0, 0, -5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Create terrain plane
  const SEGMENTS_X = 100;
  const SEGMENTS_Z = 60;
  const WIDTH = 30;
  const DEPTH = 30;

  const geometry = new THREE.PlaneGeometry(WIDTH, DEPTH, SEGMENTS_X, SEGMENTS_Z);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.position.z = -5;
  scene.add(terrain);

  // Second terrain layer for depth
  const geometry2 = geometry.clone();
  const material2 = new THREE.MeshBasicMaterial({
    color: 0xff00e5,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
  });
  const terrain2 = new THREE.Mesh(geometry2, material2);
  terrain2.position.z = -5;
  terrain2.position.y = -0.1;
  scene.add(terrain2);

  // Horizon glow line
  const horizonGeometry = new THREE.PlaneGeometry(40, 0.1);
  const horizonMaterial = new THREE.MeshBasicMaterial({
    color: 0xff00e5,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
  });
  const horizon = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizon.position.set(0, 0.05, -20);
  scene.add(horizon);

  // Album art sun sprite (replaces CircleGeometry)
  const sunMat = new THREE.SpriteMaterial({
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    color: 0xff6600,
  });
  const sun = new THREE.Sprite(sunMat);
  sun.scale.set(6, 6, 1);
  sun.position.set(0, 3, -25);
  scene.add(sun);

  // Floating billboard sprites above the terrain
  const BILLBOARD_COUNT = 10;
  const billboards = [];
  const billboardBaseData = [];

  for (let i = 0; i < BILLBOARD_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 1.5, 1);

    // Scatter across the terrain
    const x = (Math.random() - 0.5) * WIDTH * 0.7;
    const z = -5 + (Math.random() - 0.5) * DEPTH * 0.5;
    sprite.position.set(x, 3, z);

    scene.add(sprite);
    billboards.push(sprite);
    billboardBaseData.push({ x, z });
  }

  // Store base vertex positions
  const positionAttr = geometry.attributes.position;
  const positionAttr2 = geometry2.attributes.position;
  const vertexCount = positionAttr.count;
  const baseY = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    baseY[i] = positionAttr.getY(i);
  }

  let time = 0;
  let animId;
  let scrollOffset = 0;
  let frameCount = 0;
  let texturesAssigned = false;

  function animate() {
    animId = requestAnimationFrame(animate);
    const data = dataRef.current;
    const { fft = [], peak = 0 } = data;

    time += 0.01;
    frameCount++;
    scrollOffset += 0.03 + peak * 0.08;

    // Assign textures
    if (mediaManager && frameCount % 30 === 0) {
      const textures = mediaManager.getAllTextures();
      const albumTex = mediaManager.albumArtTexture;
      if (textures.length > 0 && !texturesAssigned) {
        // Sun gets album art
        if (albumTex) {
          sunMat.map = albumTex;
          sunMat.color.setHex(0xffffff);
          sunMat.needsUpdate = true;
        } else {
          sunMat.map = textures[0];
          sunMat.color.setHex(0xffffff);
          sunMat.needsUpdate = true;
        }
        // Billboards get various textures
        billboards.forEach((s, i) => {
          s.material.map = textures[i % textures.length];
          s.material.needsUpdate = true;
        });
        texturesAssigned = true;
      }
    }

    // Update vertex heights based on FFT
    for (let i = 0; i < vertexCount; i++) {
      const x = positionAttr.getX(i);
      const z = positionAttr.getZ(i);

      const normalizedX = (x + WIDTH / 2) / WIDTH;
      const fftIndex = Math.floor(normalizedX * (fft.length - 1));
      const fftValue = fft[fftIndex] || 0;

      const wave = Math.sin((z + scrollOffset) * 0.5) * 0.3;
      const noise = Math.sin(x * 0.8 + time) * Math.cos(z * 0.5 + time * 0.7) * 0.2;
      const height = fftValue * 3 + wave + noise;

      const edgeFade = 1 - Math.pow(Math.abs(normalizedX - 0.5) * 2, 3);
      positionAttr.setY(i, baseY[i] + height * edgeFade);
      positionAttr2.setY(i, baseY[i] + height * edgeFade * 0.6);
    }

    positionAttr.needsUpdate = true;
    positionAttr2.needsUpdate = true;
    geometry.computeVertexNormals();

    // Pulse terrain color intensity
    const hue = 0.52 + Math.sin(time * 0.3) * 0.05;
    material.color.setHSL(hue, 1, 0.4 + peak * 0.2);
    material.opacity = 0.4 + peak * 0.3;

    // Pulse sun
    sunMat.opacity = 0.3 + peak * 0.4;
    sun.scale.setScalar(5 + peak * 2);

    // Animate billboards — y tracks local terrain height + offset
    for (let i = 0; i < BILLBOARD_COUNT; i++) {
      const sprite = billboards[i];
      const bd = billboardBaseData[i];

      // Sample terrain height at billboard's x/z position
      const normalizedX = (bd.x + WIDTH / 2) / WIDTH;
      const fftIndex = Math.floor(normalizedX * (fft.length - 1));
      const fftValue = fft[fftIndex] || 0;
      const terrainHeight = fftValue * 3;

      sprite.position.y = terrainHeight + 2 + Math.sin(time * 1.5 + i) * 0.3;

      // Scale with peak
      const s = 1.2 + peak * 0.8;
      sprite.scale.setScalar(s);
      sprite.material.opacity = 0.4 + peak * 0.4;
    }

    // Subtle camera movement
    camera.position.x = Math.sin(time * 0.2) * 1;
    camera.position.y = 5 + Math.sin(time * 0.15) * 0.5;

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
      geometry2.dispose();
      material.dispose();
      material2.dispose();
      horizonGeometry.dispose();
      horizonMaterial.dispose();
      sunMat.dispose();
      billboards.forEach(s => s.material.dispose());
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
