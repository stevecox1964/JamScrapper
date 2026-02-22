import { useRef, useEffect } from 'react';
import renderBars from '../visualizers/frequencyBars';
import renderWaveform from '../visualizers/waveform';
import renderRadial from '../visualizers/radial';

const renderers = {
  bars: renderBars,
  waveform: renderWaveform,
  radial: renderRadial,
};

export default function Visualizer({ mode, dataRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animId;

    function render() {
      // Resize canvas to match display size
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const data = dataRef.current;
      const renderFn = renderers[mode];

      if (renderFn) {
        renderFn(ctx, data, canvas);
      }

      animId = requestAnimationFrame(render);
    }

    render();

    return () => cancelAnimationFrame(animId);
  }, [mode, dataRef]);

  return <canvas ref={canvasRef} className="visualizer-canvas" />;
}
