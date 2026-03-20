import { useRef, useEffect, useState, useCallback } from 'react';
import { WS_URL, API_BASE } from '../config';

export default function useAudioWebSocket(url = WS_URL) {
  const dataRef = useRef({ fft: [], waveform: [], peak: 0, media: null });
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [media, setMedia] = useState(null);
  const [rawMedia, setRawMedia] = useState(null);
  const reconnectTimer = useRef(null);
  const lastTrackKey = useRef('');
  const lastProfileVersion = useRef(0);
  const lastVideoId = useRef('');
  const lastHistoryVersion = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const rawThrottle = useRef(0);

  const applyMedia = useCallback((nextMedia) => {
    if (!nextMedia) return;
    const key = `${nextMedia.artist}|||${nextMedia.title}`;
    const profileVersion = nextMedia._profileVersion || 0;
    const nextVideoId = nextMedia.youtubeVideoId || '';
    const trackChanged = key !== lastTrackKey.current;
    const profileChanged = profileVersion !== lastProfileVersion.current;
    const videoChanged = nextVideoId !== lastVideoId.current;

    if (trackChanged || profileChanged || videoChanged) {
      lastTrackKey.current = key;
      lastProfileVersion.current = profileVersion;
      lastVideoId.current = nextVideoId;
      setMedia(nextMedia);
    }

    const hv = nextMedia._historyVersion || 0;
    if (hv !== lastHistoryVersion.current) {
      lastHistoryVersion.current = hv;
      setHistoryVersion(hv);
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      dataRef.current = parsed;

      // Throttle raw media updates to once per second for debug panel
      const now = Date.now();
      if (now - rawThrottle.current > 1000) {
        rawThrottle.current = now;
        setRawMedia(parsed.media || null);
      }

      applyMedia(parsed.media);
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 1000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [url, applyMedia]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // HTTP snapshot fallback: ensures first render picks up current track
  // even if websocket arrives late during startup.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/now-playing`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) applyMedia(data.media);
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [applyMedia]);

  return { dataRef, connected, media, rawMedia, historyVersion };
}
