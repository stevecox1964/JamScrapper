export default function renderRadial(ctx, data, canvas, mediaAssets) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const { fft, peak } = data;

  if (!fft || fft.length === 0) return;

  // Semi-transparent background for video bleed
  ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
  ctx.fillRect(0, 0, w, h);

  const centerX = w / 2;
  const centerY = h / 2;
  const minDim = Math.min(w, h);
  const baseRadius = minDim * 0.15 + (peak || 0) * minDim * 0.03;
  const maxExtension = minDim * 0.3;
  const now = performance.now() * 0.001;

  const barCount = fft.length;

  // Draw album art clipped to circle at center
  const albumArt = mediaAssets?.albumArt;
  if (albumArt) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
    ctx.clip();
    const artSize = baseRadius * 2;
    ctx.globalAlpha = 0.6 + (peak || 0) * 0.3;
    ctx.drawImage(albumArt, centerX - artSize / 2, centerY - artSize / 2, artSize, artSize);
    ctx.restore();
  }

  // Draw radial lines with glow
  ctx.save();
  ctx.shadowBlur = 10;

  const points = [];

  for (let i = 0; i < barCount; i++) {
    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
    const value = fft[i];
    const length = baseRadius + value * maxExtension;

    const x1 = centerX + Math.cos(angle) * baseRadius;
    const y1 = centerY + Math.sin(angle) * baseRadius;
    const x2 = centerX + Math.cos(angle) * length;
    const y2 = centerY + Math.sin(angle) * length;

    points.push({ x: x2, y: y2 });

    const hue = (i / barCount) * 360;
    const color = `hsl(${hue}, 100%, 60%)`;

    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.restore();

  // Draw connected tips (blob outline)
  if (points.length > 2) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      const cpy = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
    }

    const last = points[points.length - 1];
    const first = points[0];
    const cpx = (last.x + first.x) / 2;
    const cpy = (last.y + first.y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, cpx, cpy);

    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Draw inner circle with radial gradient (overlay on top of album art)
  const innerGradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, baseRadius
  );
  innerGradient.addColorStop(0, 'rgba(0, 229, 255, 0.15)');
  innerGradient.addColorStop(0.7, 'rgba(123, 47, 247, 0.08)');
  innerGradient.addColorStop(1, 'rgba(255, 0, 229, 0.03)');

  ctx.fillStyle = innerGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
  ctx.fill();

  // Draw inner circle border
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Orbiting artist images
  const artists = mediaAssets?.artists;
  if (artists && artists.length > 0) {
    const orbitCount = Math.min(artists.length, 8);
    const orbitBaseRadius = baseRadius * 1.8;

    for (let i = 0; i < orbitCount; i++) {
      const img = artists[i % artists.length];
      const angleOffset = (i / orbitCount) * Math.PI * 2;
      const orbitAngle = now * 0.4 + angleOffset;

      // Modulate orbit radius with FFT
      const fftIdx = Math.floor((i / orbitCount) * (fft.length - 1));
      const fftVal = fft[fftIdx] || 0;
      const radius = orbitBaseRadius + fftVal * maxExtension * 0.4;

      const imgX = centerX + Math.cos(orbitAngle) * radius;
      const imgY = centerY + Math.sin(orbitAngle) * radius;
      const imgSize = 30 + (peak || 0) * 15;

      ctx.save();
      ctx.globalAlpha = 0.5 + (peak || 0) * 0.3;
      ctx.translate(imgX, imgY);
      ctx.rotate(orbitAngle);
      ctx.drawImage(img, -imgSize / 2, -imgSize / 2, imgSize, imgSize);
      ctx.restore();
    }
  }

  // YouTube thumbnail orbiting at outer ring
  const ytThumb = mediaAssets?.ytThumb;
  if (ytThumb) {
    const ytAngle = now * 0.2;
    const ytRadius = baseRadius * 2.5;
    const ytX = centerX + Math.cos(ytAngle) * ytRadius;
    const ytY = centerY + Math.sin(ytAngle) * ytRadius;
    const ytSize = 45 + (peak || 0) * 10;

    ctx.save();
    ctx.globalAlpha = 0.3 + (peak || 0) * 0.2;
    ctx.drawImage(ytThumb, ytX - ytSize / 2, ytY - ytSize / 2, ytSize, ytSize);
    ctx.restore();
  }
}
