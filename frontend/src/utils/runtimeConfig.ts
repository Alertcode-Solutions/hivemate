const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const normalizeIceServer = (input: unknown): RTCIceServer | null => {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;
  const urls = source.urls;
  if (!urls || (typeof urls !== 'string' && !Array.isArray(urls))) return null;

  const normalized: RTCIceServer = { urls: urls as string | string[] };
  if (typeof source.username === 'string' && source.username.trim()) {
    normalized.username = source.username.trim();
  }
  if (typeof source.credential === 'string' && source.credential.trim()) {
    normalized.credential = source.credential.trim();
  }
  return normalized;
};

const parseIceServersJson = (raw: string): RTCIceServer[] => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => normalizeIceServer(entry))
        .filter((entry): entry is RTCIceServer => Boolean(entry));
    }
    const single = normalizeIceServer(parsed);
    return single ? [single] : [];
  } catch {
    return [];
  }
};

export const getApiBaseUrl = (): string => {
  const envApiUrl = import.meta.env.VITE_API_URL;
  const envApi = envApiUrl && envApiUrl.trim() ? stripTrailingSlash(envApiUrl.trim()) : '';

  if (typeof window === 'undefined') {
    return envApi || 'http://localhost:5000';
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const host = window.location.hostname;
  const isDevTunnelHost = host.includes('devtunnels.ms');
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  // If app is opened on localhost, prefer local backend to avoid stale tunnel URLs.
  if (isLocalHost) {
    return `${protocol}//${host}:5000`;
  }

  if (envApi) {
    return envApi;
  }

  // DevTunnel mapping: frontend host usually carries `-5173`, backend uses `-5000`.
  if (isDevTunnelHost && host.includes('-5173.')) {
    return `${protocol}//${host.replace('-5173.', '-5000.')}`;
  }

  // Local/dev fallback
  return `${protocol}//${host}:5000`;
};

export const getWsBaseUrl = (): string => {
  const envWsUrl = import.meta.env.VITE_WS_URL;
  const envWs = envWsUrl && envWsUrl.trim() ? stripTrailingSlash(envWsUrl.trim()) : '';
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    if (isLocalHost) {
      return getApiBaseUrl();
    }
  }

  if (envWs) {
    const normalized = envWs;
    if (normalized.startsWith('ws://')) {
      return normalized.replace(/^ws:\/\//, 'http://');
    }
    if (normalized.startsWith('wss://')) {
      return normalized.replace(/^wss:\/\//, 'https://');
    }
    return normalized;
  }

  // socket.io client prefers http(s) origin.
  return getApiBaseUrl();
};

export const getWebRtcIceServers = (): RTCIceServer[] => {
  const rawIceServers = String(import.meta.env.VITE_WEBRTC_ICE_SERVERS_JSON || '').trim();
  if (rawIceServers) {
    const parsed = parseIceServersJson(rawIceServers);
    if (parsed.length > 0) return parsed;
  }

  const stunUrlsRaw = String(import.meta.env.VITE_WEBRTC_STUN_URLS || '').trim();
  const turnUrlRaw = String(import.meta.env.VITE_WEBRTC_TURN_URL || '').trim();
  const turnUsernameRaw = String(import.meta.env.VITE_WEBRTC_TURN_USERNAME || '').trim();
  const turnCredentialRaw = String(import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL || '').trim();

  const servers: RTCIceServer[] = [];
  if (stunUrlsRaw) {
    const stunUrls = stunUrlsRaw.split(',').map((item) => item.trim()).filter(Boolean);
    if (stunUrls.length > 0) {
      servers.push({ urls: stunUrls });
    }
  }

  if (turnUrlRaw && turnUsernameRaw && turnCredentialRaw) {
    const turnUrls = turnUrlRaw.split(',').map((item) => item.trim()).filter(Boolean);
    if (turnUrls.length > 0) {
      servers.push({
        urls: turnUrls,
        username: turnUsernameRaw,
        credential: turnCredentialRaw
      });
    }
  }

  if (servers.length > 0) return servers;
  return DEFAULT_ICE_SERVERS;
};
