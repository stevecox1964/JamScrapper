export default function renderRadial(ctx, data, canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const { fft, peak } = data;

  if (!fft || fft.length === 0) return;

  // Dark background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, w, h);

  const centerX = w / 2;
  const centerY = h / 2;
  const minDim = Math.min(w, h);
  const baseRadius = minDim * 0.15 + (peak || 0) * minDim * 0.03; // Breathing effect
  const maxExtension = minDim * 0.3;

  const barCount = fft.length;

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

    // Hue rotates around the circle
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

    // Close the path
    const last = points[points.length - 1];
    const first = points[0];
    const cpx = (last.x + first.x) / 2;
    const cpy = (last.y + first.y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, cpx, cpy);

    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Draw inner circle with radial gradient
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
}
