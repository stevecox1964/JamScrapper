import * as THREE from 'three';

export default function init(container, dataRef) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);
  scene.fog = new THREE.FogExp2(0x0a0a0f, 0.015);

  const camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    0.1,
    200
  );
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
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

  // Add ambient particles inside the tunnel
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

  let time = 0;
  let animId;
  const totalDepth = RING_COUNT * RING_SPACING;

  function animate() {
    animId = requestAnimationFrame(animate);
    const data = dataRef.current;
    const { fft = [], peak = 0 } = data;

    time += 0.01;
    const speed = 0.3 + peak * 0.7;

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
      const baseScale = 1;
      const scale = baseScale + fftValue * 1.5;
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

    renderer.render(scene, camera);
  }

  animate();

  // Handle resize
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
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
