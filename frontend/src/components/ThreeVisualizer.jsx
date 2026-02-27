import { useRef, useEffect } from 'react';
import initTunnel from '../visualizers/tunnel';
import initGalaxy from '../visualizers/particleGalaxy';
import initTerrain from '../visualizers/terrain';
import initStarfield from '../visualizers/starfield';

const initializers = {
  tunnel: initTunnel,
  galaxy: initGalaxy,
  terrain: initTerrain,
  starfield: initStarfield,
};

export default function ThreeVisualizer({ mode, dataRef, mediaManager }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initFn = initializers[mode];
    if (!initFn) return;

    const { cleanup } = initFn(container, dataRef, mediaManager?.current);

    return () => {
      cleanup();
    };
  }, [mode, dataRef]);

  return <div ref={containerRef} className="three-container" />;
}
