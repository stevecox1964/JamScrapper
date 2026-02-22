export default function renderBars(ctx, data, canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const { fft } = data;

  if (!fft || fft.length === 0) return;

  // Dark background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, w, h);

  const barCount = fft.length;
  const gap = 1;
  const barWidth = (w - gap * barCount) / barCount;
  const maxBarHeight = h * 0.7;

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
    const y = h * 0.65 - barHeight;

    ctx.fillRect(x, y, barWidth, barHeight);
  }
  ctx.restore();

  // Draw sharp bars on top
  ctx.fillStyle = gradient;
  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * maxBarHeight;
    const x = i * (barWidth + gap);
    const y = h * 0.65 - barHeight;

    ctx.fillRect(x, y, barWidth, barHeight);
  }

  // Draw mirror reflection
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = gradient;
  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * maxBarHeight * 0.35;
    const x = i * (barWidth + gap);
    const y = h * 0.65;

    ctx.fillRect(x, y, barWidth, barHeight);
  }
  ctx.restore();

  // Draw a subtle baseline
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.65);
  ctx.lineTo(w, h * 0.65);
  ctx.stroke();
}
