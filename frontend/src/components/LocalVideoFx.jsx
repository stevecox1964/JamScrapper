import { useEffect, useRef } from 'react';
import { API_BASE } from '../config';

// MTV-style compositor for locally saved videos.
//
// When the YouTube embed can't show (embed-blocked, removed, region-locked)
// but we have the video file saved, this plays the ACTUAL video full-bleed
// (muted — Pandora supplies the audio) and layers music-television FX on top:
//   - glitch bursts that displace horizontal slices of the real video frames
//   - RGB-split ghost copies during glitches (chromatic aberration)
//   - a diagonal color sweep tinted with the track's own dominant colors
//   - CRT scanlines + film grain + vignette
//   - a classic MTV-style chyron (artist / "title" / album) at track start
//
// All FX are time-based, not audio-reactive. The canvas only DRAWS the video
// (never reads pixels back), so cross-origin tainting is harmless.

const CHYRON_SECONDS = 8;       // how long the lower-third stays up per track
const GLITCH_MIN_GAP = 4;       // seconds between glitch bursts (min)
const GLITCH_MAX_GAP = 9;       // seconds between glitch bursts (max)
const GLITCH_SECONDS = 0.22;    // duration of one glitch burst
const SWEEP_PERIOD = 11;        // seconds for one color sweep across the screen
const SWEEP_ALPHA = 0.13;       // sweep band opacity

const FALLBACK_PALETTE = [[255, 0, 229], [0, 229, 255], [123, 47, 247]];

function resolveUrl(u) {
  return u && u.startsWith('/') ? `${API_BASE}${u}` : u;
}

// Destination rect that makes the video cover the canvas (like object-fit: cover).
function coverRect(vw, vh, cw, ch) {
  const s = Math.max(cw / vw, ch / vh);
  return { dx: (cw - vw * s) / 2, dy: (ch - vh * s) / 2, dw: vw * s, dh: vh * s };
}

function rgba([r, g, b], a) {
  return `rgba(${r},${g},${b},${a})`;
}

export default function LocalVideoFx({ media }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRef = useRef(media);
  mediaRef.current = media;

  // Restart the chyron clock whenever the track changes.
  const trackKeyRef = useRef('');
  const trackStartRef = useRef(performance.now() / 1000);
  const key = `${media?.artist}|||${media?.title}`;
  if (key !== trackKeyRef.current) {
    trackKeyRef.current = key;
    trackStartRef.current = performance.now() / 1000;
  }

  const src = resolveUrl(media?.localVideoUrl);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let frame = 0;

    // Glitch scheduling.
    let nextGlitch = performance.now() / 1000 + 2;
    let glitchEnd = 0;

    // Pre-rendered scanline pattern (1px dark line every 3px).
    const scan = document.createElement('canvas');
    scan.width = 1;
    scan.height = 3;
    const sctx = scan.getContext('2d');
    sctx.fillStyle = 'rgba(0,0,0,0.28)';
    sctx.fillRect(0, 2, 1, 1);

    // Film grain tile, re-randomized every few frames.
    const grain = document.createElement('canvas');
    grain.width = grain.height = 128;
    const gctx = grain.getContext('2d');
    function regrain() {
      const id = gctx.createImageData(128, 128);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = Math.random() * 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 22;
      }
      gctx.putImageData(id, 0, 0);
    }

    function palette() {
      const cols = mediaRef.current?.dominantColors;
      return cols && cols.length ? cols : FALLBACK_PALETTE;
    }

    function drawGlitch(video, cw, ch, r) {
      // Horizontal slice displacement of the actual video frame.
      const strips = 6;
      const stripH = ch / strips;
      for (let i = 0; i < strips; i++) {
        if (Math.random() < 0.4) continue; // leave some strips untouched
        const off = (Math.random() - 0.5) * cw * 0.1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, i * stripH, cw, stripH);
        ctx.clip();
        ctx.drawImage(video, r.dx + off, r.dy, r.dw, r.dh);
        ctx.restore();
      }
      // RGB-split ghost copies.
      const split = 6 + Math.random() * 8;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28;
      ctx.filter = 'saturate(3) hue-rotate(-60deg)';
      ctx.drawImage(video, r.dx - split, r.dy, r.dw, r.dh);
      ctx.filter = 'saturate(3) hue-rotate(150deg)';
      ctx.drawImage(video, r.dx + split, r.dy, r.dw, r.dh);
      ctx.restore();
    }

    function drawSweep(cw, ch, now) {
      // Diagonal band of the track's own colors drifting across the screen.
      const pal = palette();
      const t = (now % SWEEP_PERIOD) / SWEEP_PERIOD;
      const bandW = cw * 0.55;
      const x = -bandW + t * (cw + bandW * 2);
      const c = pal[Math.floor(now / SWEEP_PERIOD) % pal.length];
      const g = ctx.createLinearGradient(x - bandW / 2, 0, x + bandW / 2, ch * 0.35);
      g.addColorStop(0, rgba(c, 0));
      g.addColorStop(0.5, rgba(c, SWEEP_ALPHA));
      g.addColorStop(1, rgba(c, 0));
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    function drawChyron(cw, ch, now) {
      const m = mediaRef.current;
      if (!m?.artist && !m?.title) return;
      const age = now - trackStartRef.current;
      if (age > CHYRON_SECONDS) return;

      // Slide in over 0.6s, fade out over the last second.
      const slide = Math.min(1, age / 0.6);
      const fade = Math.min(1, (CHYRON_SECONDS - age) / 1);
      const ease = 1 - Math.pow(1 - slide, 3);
      const alpha = Math.min(ease, fade);
      if (alpha <= 0) return;

      const pal = palette();
      const accent = pal[0] || FALLBACK_PALETTE[0];
      const pad = Math.max(36, ch * 0.05);
      const baseX = cw - pad - 320 + (1 - ease) * 80;
      let y = ch - pad - 96;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      // Accent bar — MTV lower-thirds always had one.
      ctx.fillStyle = rgba(accent, 1);
      ctx.fillRect(baseX - 16, y - 8, 5, 96);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'italic 700 26px "Arial Black", "Segoe UI", sans-serif';
      ctx.fillText(m.artist || '', baseX, y + 16, 340);
      y += 32;
      ctx.font = 'italic 400 20px Georgia, serif';
      ctx.fillText(`“${m.title || ''}”`, baseX, y + 16, 340);
      y += 28;
      if (m.album) {
        ctx.font = '400 15px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(m.album, baseX, y + 14, 340);
        y += 22;
      }
      ctx.font = '700 11px "Segoe UI", sans-serif';
      ctx.fillStyle = rgba(accent, 0.9);
      ctx.fillText('VISUALAUDIO ♪', baseX, y + 12);
      ctx.restore();
    }

    function render() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const now = performance.now() / 1000;
      frame++;

      const video = videoRef.current;
      const videoReady = video && video.readyState >= 2 && video.videoWidth;

      // GLITCH BURSTS sampling the real video frames.
      if (now >= nextGlitch && videoReady) {
        glitchEnd = now + GLITCH_SECONDS;
        nextGlitch = now + GLITCH_MIN_GAP + Math.random() * (GLITCH_MAX_GAP - GLITCH_MIN_GAP);
      }
      if (now < glitchEnd && videoReady) {
        drawGlitch(video, cw, ch, coverRect(video.videoWidth, video.videoHeight, cw, ch));
      }

      // COLOR SWEEP from the track's palette.
      drawSweep(cw, ch, now);

      // SCANLINES.
      const sp = ctx.createPattern(scan, 'repeat');
      if (sp) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = sp;
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
      }

      // FILM GRAIN.
      if (frame % 3 === 0) regrain();
      const gp = ctx.createPattern(grain, 'repeat');
      if (gp) {
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = gp;
        ctx.translate((Math.random() * 20) | 0, (Math.random() * 20) | 0);
        ctx.fillRect(-20, -20, cw + 40, ch + 40);
        ctx.restore();
      }

      // VIGNETTE.
      const vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, cw, ch);

      // MTV CHYRON.
      drawChyron(cw, ch, now);

      animId = requestAnimationFrame(render);
    }

    regrain();
    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="local-video-layer">
      <video
        ref={videoRef}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        onLoadedData={(e) => e.currentTarget.play().catch(() => {})}
      />
      <canvas ref={canvasRef} className="local-video-fx" />
    </div>
  );
}
