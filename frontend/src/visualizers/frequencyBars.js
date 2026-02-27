export default function renderBars(ctx, data, canvas, mediaAssets) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const { fft, peak = 0 } = data;

  if (!fft || fft.length === 0) return;

  // Fully transparent — let the video shine through completely
  ctx.clearRect(0, 0, w, h);

  // Subtle dark gradient only at the very bottom so bars are readable
  const fade = ctx.createLinearGradient(0, h, 0, h * 0.65);
  fade.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  fade.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, h * 0.65, w, h * 0.35);

  // Bars live in the bottom 30% of the screen
  const barZone = h * 0.30;
  const barBaseY = h;
  const barCount = fft.length;
  const gap = 1;
  const barWidth = (w - gap * barCount) / barCount;

  // Bar gradient — bright cyan at base, fading to purple at tips
  const gradient = ctx.createLinearGradient(0, barBaseY, 0, barBaseY - barZone);
  gradient.addColorStop(0, 'rgba(0, 229, 255, 0.9)');
  gradient.addColorStop(0.3, 'rgba(0, 229, 255, 0.7)');
  gradient.addColorStop(0.6, 'rgba(123, 47, 247, 0.5)');
  gradient.addColorStop(1, 'rgba(255, 0, 229, 0.2)');

  // Glow layer
  ctx.save();
  ctx.shadowColor = 'rgba(0, 229, 255, 0.6)';
  ctx.shadowBlur = 15;
  ctx.fillStyle = gradient;

  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * barZone;
    const x = i * (barWidth + gap);
    ctx.fillRect(x, barBaseY - barHeight, barWidth, barHeight);
  }
  ctx.restore();

  // Sharp bars on top
  ctx.fillStyle = gradient;
  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * barZone;
    const x = i * (barWidth + gap);
    ctx.fillRect(x, barBaseY - barHeight, barWidth, barHeight);
  }

  // Glowing top-edge line tracing the peaks
  ctx.save();
  ctx.shadowColor = 'rgba(0, 229, 255, 0.8)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = `rgba(0, 229, 255, ${0.5 + peak * 0.5})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < barCount; i++) {
    const value = fft[i];
    const barHeight = value * barZone;
    const x = i * (barWidth + gap) + barWidth / 2;
    const y = barBaseY - barHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}
