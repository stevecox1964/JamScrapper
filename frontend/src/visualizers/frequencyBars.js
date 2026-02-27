export default function renderBars(ctx, data, canvas, mediaAssets) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const { fft, peak = 0 } = data;

  if (!fft || fft.length === 0) return;

  // Semi-transparent background for video bleed
  ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
  ctx.fillRect(0, 0, w, h);

  const barCount = fft.length;
  const gap = 1;
  const barWidth = (w - gap * barCount) / barCount;
  const maxBarHeight = h * 0.7;
  const barBaseY = h * 0.65;

  // Draw album art as background at low opacity
  const albumArt = mediaAssets?.albumArt;
  if (albumArt) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    // Draw stretched across full canvas
    ctx.drawImage(albumArt, 0, 0, w, h);
    ctx.restore();
  }

  // Draw artist image floating in center background
  const artists = mediaAssets?.artists;
  if (artists && artists.length > 0) {
    ctx.save();
    const img = artists[0];
    const imgSize = Math.min(w, h) * 0.35;
    const imgX = (w - imgSize) / 2;
    const imgY = (h - imgSize) / 2 - h * 0.05;
    ctx.globalAlpha = 0.08 + peak * 0.04;
    ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
    ctx.restore();
  }

  // Create gradient for bars
  const gradient = ctx.createLinearGradient(0, h, 0, h * 0.1);
  gradient.addColorStop(0, '#00e5ff');
  gradient.addColorStop(0.5, '#7b2ff7');
  gradient.addColorStop(1, '#ff00e5');

  // Draw glow layer
  ctx.save();
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 15;
  ctx.fillStyle = gradient;

  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * maxBarHeight;
    const x = i * (barWidth + gap);
    const y = barBaseY - barHeight;

    ctx.fillRect(x, y, barWidth, barHeight);
  }
  ctx.restore();

  // Draw sharp bars on top — with image revealed underneath
  if (albumArt) {
    // Each bar reveals a brighter slice of the album art
    for (let i = 0; i < barCount; i++) {
      const value = fft[i];
      const barHeight = value * maxBarHeight;
      const x = i * (barWidth + gap);
      const y = barBaseY - barHeight;

      ctx.save();
      ctx.globalAlpha = 0.3 + value * 0.5;
      // Clip to bar rect and draw image slice
      ctx.beginPath();
      ctx.rect(x, y, barWidth, barHeight);
      ctx.clip();
      ctx.drawImage(albumArt, 0, 0, w, h);
      ctx.restore();
    }
  }

  // Draw gradient bars on top
  ctx.fillStyle = gradient;
  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * maxBarHeight;
    const x = i * (barWidth + gap);
    const y = barBaseY - barHeight;

    ctx.globalAlpha = 0.6;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
  ctx.globalAlpha = 1;

  // Draw mirror reflection
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = gradient;
  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * maxBarHeight * 0.35;
    const x = i * (barWidth + gap);
    const y = barBaseY;

    ctx.fillRect(x, y, barWidth, barHeight);
  }
  ctx.restore();

  // Draw a subtle baseline
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barBaseY);
  ctx.lineTo(w, barBaseY);
  ctx.stroke();
}
