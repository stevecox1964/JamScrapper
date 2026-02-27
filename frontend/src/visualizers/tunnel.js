import * as THREE from 'three';

export default function init(container, dataRef, mediaManager) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0a0f, 0.015);

  const camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    0.1,
    200
  );
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Create tunnel rings
  const RING_COUNT = 60;
  const RING_SPACING = 2;
  const rings = [];

  for (let i = 0; i < RING_COUNT; i++) {
    const geometry = new THREE.TorusGeometry(3, 0.06, 8, 64);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL((i / RING_COUNT) * 0.6, 1, 0.5),
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.position.z = -i * RING_SPACING;
    ring.baseZ = ring.position.z;
    scene.add(ring);
    rings.push(ring);
  }

  // Ambient particles inside the tunnel
  const particleCount = 500;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.5 + Math.random() * 2;
    particlePositions[i * 3] = Math.cos(angle) * radius;
    particlePositions[i * 3 + 1] = Math.sin(angle) * radius;
    particlePositions[i * 3 + 2] = -Math.random() * RING_COUNT * RING_SPACING;

    const color = new THREE.Color().setHSL(Math.random() * 0.3 + 0.5, 1, 0.7);
    particleColors[i * 3] = color.r;
    particleColors[i * 3 + 1] = color.g;
    particleColors[i * 3 + 2] = color.b;
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const particleMaterial = new THREE.PointsMaterial({
    size: 0.05,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  // --- Image panels inside the tunnel ---
  const PANEL_COUNT = 16;
  const TUNNEL_RADIUS = 3;
  const panels = [];
  const panelBaseData = [];

  for (let i = 0; i < PANEL_COUNT; i++) {
    const panelGeo = new THREE.PlaneGeometry(1.5, 1.5);
    const panelMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);

    // Position around the tunnel circumference at staggered depths
    const angle = (i / PANEL_COUNT) * Math.PI * 2;
    const depth = -(i / PANEL_COUNT) * RING_COUNT * RING_SPACING;
    const x = Math.cos(angle) * (TUNNEL_RADIUS - 0.3);
    const y = Math.sin(angle) * (TUNNEL_RADIUS - 0.3);

    panel.position.set(x, y, depth);

    // Face inward (toward center axis)
    panel.lookAt(0, 0, depth);

    scene.add(panel);
    panels.push(panel);
    panelBaseData.push({ angle, x, y });
  }

  let time = 0;
  let animId;
  let frameCount = 0;
  let texturesAssigned = false;
  const totalDepth = RING_COUNT * RING_SPACING;

  function animate() {
    animId = requestAnimationFrame(animate);
    const data = dataRef.current;
    const { fft = [], peak = 0 } = data;

    time += 0.01;
    frameCount++;
    const speed = 0.3 + peak * 0.7;

    // Assign textures
    if (mediaManager && frameCount % 30 === 0) {
      const textures = mediaManager.getAllTextures();
      if (textures.length > 0 && !texturesAssigned) {
        panels.forEach((p, i) => {
          p.material.map = textures[i % textures.length];
          p.material.needsUpdate = true;
        });
        texturesAssigned = true;
      }
    }

    // Move camera forward
    camera.position.z -= speed * 0.5;

    // Subtle camera rotation
    camera.rotation.z = Math.sin(time * 0.5) * 0.05;

    // Update rings
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];

      // Recycle rings that pass the camera
      if (ring.position.z > camera.position.z + 5) {
        ring.position.z -= totalDepth;
      }

      // Distance from camera for FFT mapping
      const distFromCamera = camera.position.z - ring.position.z;
      const normalizedDist = Math.max(0, Math.min(1, distFromCamera / totalDepth));

      // Map to FFT bin
      const fftIndex = Math.floor(normalizedDist * (fft.length - 1));
      const fftValue = fft[fftIndex] || 0;

      // Scale ring based on FFT
      const scale = 1 + fftValue * 1.5;
      ring.scale.set(scale, scale, 1);

      // Color shift based on FFT
      const hue = (i / RING_COUNT * 0.6 + time * 0.1) % 1;
      const lightness = 0.4 + fftValue * 0.3;
      ring.material.color.setHSL(hue, 1, lightness);
      ring.material.opacity = 0.4 + fftValue * 0.6;

      // Slight rotation per ring
      ring.rotation.z = time * 0.2 + i * 0.02;
    }

    // Move particles with camera
    const positions = particleGeometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 2] += speed * 0.3;
      if (positions[i * 3 + 2] > camera.position.z + 5) {
        positions[i * 3 + 2] = camera.position.z - totalDepth * 0.8;
      }
    }
    particleGeometry.attributes.position.needsUpdate = true;

    // Update image panels — recycle and animate
    for (let i = 0; i < PANEL_COUNT; i++) {
      const panel = panels[i];

      // Recycle panels that pass the camera
      if (panel.position.z > camera.position.z + 5) {
        panel.position.z -= totalDepth;
        // Reassign random texture on recycle
        if (mediaManager) {
          const textures = mediaManager.getAllTextures();
          if (textures.length > 0) {
            panel.material.map = textures[Math.floor(Math.random() * textures.length)];
            panel.material.needsUpdate = true;
          }
        }
      }

      // Move panels forward with the tunnel flow
      panel.position.z += speed * 0.5;

      // FFT-driven opacity based on panel depth relative to camera
      const distFromCamera = camera.position.z - panel.position.z;
      const normalizedDist = Math.max(0, Math.min(1, distFromCamera / totalDepth));
      const fftIndex = Math.floor(normalizedDist * (fft.length - 1));
      const fftValue = fft[fftIndex] || 0;

      panel.material.opacity = 0.3 + fftValue * 0.6;

      // Gentle rotation around tunnel axis
      const bd = panelBaseData[i];
      const rotAngle = bd.angle + time * 0.1;
      panel.position.x = Math.cos(rotAngle) * (TUNNEL_RADIUS - 0.3);
      panel.position.y = Math.sin(rotAngle) * (TUNNEL_RADIUS - 0.3);

      // Scale with peak
      const s = 1 + peak * 0.5;
      panel.scale.setScalar(s);
    }

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
      rings.forEach(ring => {
        ring.geometry.dispose();
        ring.material.dispose();
      });
      particleGeometry.dispose();
      particleMaterial.dispose();
      panels.forEach(p => {
        p.geometry.dispose();
        p.material.dispose();
      });
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
