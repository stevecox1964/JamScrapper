export default function renderWaveform(ctx, data, canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const { waveform } = data;

  if (!waveform || waveform.length === 0) return;

  // Dark background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, w, h);

  const centerY = h / 2;
  const amplitude = h * 0.35;

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
