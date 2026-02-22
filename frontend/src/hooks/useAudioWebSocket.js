import { useRef, useEffect, useState, useCallback } from 'react';

export default function useAudioWebSocket(url = 'ws://localhost:8765') {
  const dataRef = useRef({ fft: [], waveform: [], peak: 0, media: null });
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [media, setMedia] = useState(null);
  const reconnectTimer = useRef(null);
  const lastTrackKey = useRef('');

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      dataRef.current = parsed;

      // Only update media state when track changes (avoid re-renders at 30fps)
      if (parsed.media) {
        const key = `${parsed.media.artist}|||${parsed.media.title}`;
        if (key !== lastTrackKey.current) {
          lastTrackKey.current = key;
          setMedia(parsed.media);
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { dataRef, connected, media };
}
