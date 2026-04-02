// In production (served from Python backend), use same origin.
// In dev (Vite), proxy through vite.config.js to the backend.
const isDev = import.meta.env.DEV;

export const API_BASE = isDev ? 'http://localhost:8766' : '';
export const WS_URL = isDev
  ? 'ws://localhost:8765'
  : `ws://${window.location.hostname}:8765`;

export function mediaUrl(path) {
  return `${API_BASE}/media/${path}`;
}

export function thumbnailUrl(videoId) {
  return `${API_BASE}/media/thumbnails/${videoId}.jpg`;
}
