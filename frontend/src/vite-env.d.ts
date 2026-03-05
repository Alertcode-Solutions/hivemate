/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_WEBRTC_ICE_SERVERS_JSON?: string;
  readonly VITE_WEBRTC_STUN_URLS?: string;
  readonly VITE_WEBRTC_TURN_URL?: string;
  readonly VITE_WEBRTC_TURN_USERNAME?: string;
  readonly VITE_WEBRTC_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
