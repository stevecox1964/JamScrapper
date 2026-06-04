import { useEffect, useRef } from 'react';
import { API_BASE } from '../config';

// Synthetic music-video compositor.
//
// When a track has no real YouTube video (or the user forces it on), this turns
// the still images we already fetched (album art, artist photos, YT thumbnail)
// into a slideshow with motion: each image scrolls in from the right, settles
// centered and HOLDS, then scrolls off to the left as the next image scrolls in.
// A blurred full-bleed background crossfades underneath, with vignette + grain.
// No beat reaction — calm and constant.
//
// Canvas 2D, real-time. Loads its OWN images straight from `media` with no
// crossOrigin — we only draw (never read pixels back), so a tainted canvas is
// harmless, and dropping the CORS requirement means remote photos actually load.

const HOLD_SECONDS = 3.5;       // time an image rests centered
const TRANSITION_SECONDS = 1.8; // time to scroll in / out
const CARD_HEIGHT_FRAC = 0.74;  // foreground card height, as a fraction of screen height

// Resolve backend-relative media URLs (e.g. /media/thumbnails/x.jpg) to the
// backend origin; absolute URLs and base64 data URIs pass through untouched.
function resolveUrl(u) {
  return u && u.startsWith('/') ? `${API_BASE}${u}` : u;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Draw an image scaled to cover the canvas (used for the blurred background).
function drawCover(ctx, img, cw, ch, scale, alpha) {
  if (!img || !img.width) return;
  const base = Math.max(cw / img.width, ch / img.height) * scale;
  const dw = img.width * base;
  const dh = img.height * base;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

export default function SyntheticVideo({ media }) {
  const canvasRef = useRef(null);
  const imagesRef = useRef([]);          // loaded HTMLImageElements for current track
  const versionRef = useRef(0);          // bumped on every track change
  const trackKeyRef = useRef('');
  const requestedRef = useRef(new Set()); // URLs already requested this track

  // Load images for the current track — album art first (base64, instant),
  // then YT thumbnail, then artist photos. No crossOrigin: 2D draw only.
  useEffect(() => {
    if (!media) return;
    const key = `${media.artist}|||${media.title}`;
    const trackChanged = key !== trackKeyRef.current;
    if (trackChanged) {
      trackKeyRef.current = key;
      imagesRef.current = [];
      requestedRef.current = new Set();
      versionRef.current += 1;
    }

    const urls = [];
    if (media.albumArt) urls.push(media.albumArt);
    if (media.youtubeThumbnailUrl) urls.push(resolveUrl(media.youtubeThumbnailUrl));
    (media.artistImages || []).forEach(u => urls.push(resolveUrl(u)));

    urls.forEach(url => {
      if (!url || requestedRef.current.has(url)) return;
      requestedRef.current.add(url);
      const img = new Image();
      img.onload = () => { if (img.naturalWidth) imagesRef.current.push(img); };
      img.onerror = () => {};
      img.src = url;
    });
  }, [media?.artist, media?.title, media?.albumArt, media?.youtubeThumbnailUrl, media?.artistImages]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;

    // --- Slideshow state (lives across frames) ---
    let curImg = null;
    let nextImg = null;
    let phase = 'wait';        // 'wait' | 'in' | 'hold' | 'out'
    let phaseStart = 0;
    let order = [];
    let orderPos = 0;
    let lastVersion = -1;
    let frame = 0;

    // Blurred background crossfade.
    let bgImg = null;
    let bgPrev = null;
    let bgFadeStart = -1;

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

    function pickNext() {
      const images = imagesRef.current;
      if (!images.length) return null;
      if (orderPos >= order.length) {
        order = images.map((_, i) => i).sort(() => Math.random() - 0.5);
        orderPos = 0;
      }
      return images[order[orderPos++] % images.length];
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

      const now = performance.now() / 1000;
      frame++;

      // Reset when the track changed.
      if (versionRef.current !== lastVersion) {
        lastVersion = versionRef.current;
        curImg = null;
        nextImg = null;
        phase = 'wait';
        bgImg = null;
        bgPrev = null;
        bgFadeStart = -1;
      }

      const cardH = ch * CARD_HEIGHT_FRAC;
      const wOf = (img) => cardH * (img.width / img.height);
      const centerX = (img) => (cw - wOf(img)) / 2;
      const offRight = cw;
      const offLeft = (img) => -wOf(img);

      // Kick off once the first image is available.
      if (phase === 'wait' && imagesRef.current.length) {
        curImg = pickNext();
        phase = 'in';
        phaseStart = now;
        bgImg = curImg;
        bgPrev = null;
        bgFadeStart = -1;
      }

      // Advance the slideshow state machine and build the draw list.
      const drawList = []; // { img, x }
      if (phase === 'in' && curImg) {
        const p = easeInOut(Math.min(1, (now - phaseStart) / TRANSITION_SECONDS));
        drawList.push({ img: curImg, x: lerp(offRight, centerX(curImg), p) });
        if (p >= 1) { phase = 'hold'; phaseStart = now; }
      } else if (phase === 'hold' && curImg) {
        drawList.push({ img: curImg, x: centerX(curImg) });
        if (now - phaseStart >= HOLD_SECONDS) {
          nextImg = pickNext();
          phase = 'out';
          phaseStart = now;
          bgPrev = bgImg;
          bgImg = nextImg;
          bgFadeStart = now;
        }
      } else if (phase === 'out' && curImg) {
        const p = easeInOut(Math.min(1, (now - phaseStart) / TRANSITION_SECONDS));
        drawList.push({ img: curImg, x: lerp(centerX(curImg), offLeft(curImg), p) });
        if (nextImg) drawList.push({ img: nextImg, x: lerp(offRight, centerX(nextImg), p) });
        if (p >= 1) { curImg = nextImg; nextImg = null; phase = 'hold'; phaseStart = now; }
      }

      // --- Draw ---
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#07070b';
      ctx.fillRect(0, 0, cw, ch);

      // BACKGROUND: blurred, darkened, crossfading with the focused image.
      if (bgImg) {
        let curA = 1;
        let prevA = 0;
        if (bgFadeStart >= 0) {
          const t = (now - bgFadeStart) / TRANSITION_SECONDS;
          if (t >= 1) bgFadeStart = -1;
          else { curA = t; prevA = 1 - t; }
        }
        ctx.save();
        ctx.filter = 'blur(40px) brightness(0.45) saturate(1.3)';
        if (bgPrev && prevA > 0) drawCover(ctx, bgPrev, cw, ch, 1.5, prevA);
        drawCover(ctx, bgImg, cw, ch, 1.5, curA);
        ctx.restore();
      }

      // FOREGROUND: sharp card(s) sliding through center.
      const y = (ch - cardH) / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 40;
      drawList.forEach(({ img, x }) => {
        ctx.drawImage(img, x, y, cardH * (img.width / img.height), cardH);
      });
      ctx.restore();

      // VIGNETTE.
      const vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, cw, ch);

      // FILM GRAIN (constant — no pulsing).
      if (frame % 3 === 0) regrain();
      const gp = ctx.createPattern(grain, 'repeat');
      if (gp) {
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = gp;
        ctx.translate((Math.random() * 20) | 0, (Math.random() * 20) | 0);
        ctx.fillRect(-20, -20, cw + 40, ch + 40);
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    }

    regrain();
    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return <canvas ref={canvasRef} className="synthetic-video-canvas" />;
}
