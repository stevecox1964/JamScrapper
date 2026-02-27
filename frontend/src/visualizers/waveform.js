export default function renderWaveform(ctx, data, canvas, mediaAssets) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const { waveform, peak = 0 } = data;

  if (!waveform || waveform.length === 0) return;

  // Semi-transparent background for video bleed
  ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
  ctx.fillRect(0, 0, w, h);

  const centerY = h / 2;
  const amplitude = h * 0.35;
  const now = performance.now() * 0.001;

  // Draw album art as centered backdrop
  const albumArt = mediaAssets?.albumArt;
  if (albumArt) {
    ctx.save();
    const imgSize = Math.min(w, h) * 0.5;
    const imgX = (w - imgSize) / 2;
    const imgY = (h - imgSize) / 2;
    ctx.globalAlpha = 0.1 + peak * 0.04;
    ctx.drawImage(albumArt, imgX, imgY, imgSize, imgSize);
    ctx.restore();
  }

  // Draw center line
  ctx.strokeStyle = 'rgba(0, 255, 136, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(w, centerY);
  ctx.stroke();

  // Draw glow layer
  ctx.save();
  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur = 20;
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let i = 0; i < waveform.length; i++) {
    const x = (i / (waveform.length - 1)) * w;
    const y = centerY + waveform[i] * amplitude;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.restore();

  // Draw sharp waveform on top
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let i = 0; i < waveform.length; i++) {
    const x = (i / (waveform.length - 1)) * w;
    const y = centerY + waveform[i] * amplitude;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();

  // Draw a filled area under the waveform
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#00ff88';
  ctx.lineTo(w, centerY);
  ctx.lineTo(0, centerY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Draw artist images riding the waveform
  const artists = mediaAssets?.artists;
  if (artists && artists.length > 0) {
    const imageCount = Math.min(artists.length, 10);
    const spacing = w / (imageCount + 1);

    for (let i = 0; i < imageCount; i++) {
      const img = artists[i % artists.length];
      const imgX = spacing * (i + 1);

      // Sample waveform value at this x position
      const waveIndex = Math.floor((imgX / w) * (waveform.length - 1));
      const waveValue = waveform[waveIndex] || 0;
      const imgY = centerY + waveValue * amplitude;

      // Size and rotation
      const baseSize = 40;
      const scale = 1 + Math.abs(waveValue) * 0.5;
      const size = baseSize * scale;
      const rotation = now + i * 0.5;

      ctx.save();
      ctx.translate(imgX, imgY);
      ctx.rotate(Math.sin(rotation) * 0.15);
      ctx.globalAlpha = 0.5 + peak * 0.3;
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  // Draw YouTube thumbnail riding the wave at center
  const ytThumb = mediaAssets?.ytThumb;
  if (ytThumb) {
    const ytX = w / 2;
    const waveIndex = Math.floor((ytX / w) * (waveform.length - 1));
    const waveValue = waveform[waveIndex] || 0;
    const ytY = centerY + waveValue * amplitude - 50;
    const ytSize = 60 + peak * 15;

    ctx.save();
    ctx.globalAlpha = 0.25 + peak * 0.15;
    ctx.drawImage(ytThumb, ytX - ytSize / 2, ytY - ytSize / 2, ytSize, ytSize);
    ctx.restore();
  }

  // Draw subtle grid lines
  ctx.strokeStyle = 'rgba(0, 255, 136, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}
