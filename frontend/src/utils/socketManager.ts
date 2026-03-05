import { io, Socket } from 'socket.io-client';
import { getWsBaseUrl } from './runtimeConfig';
import { incrementPerfMetric } from './perfMetrics';

let sharedSocket: Socket | null = null;
let socketToken = '';
let retainCount = 0;

const createSocket = (token: string): Socket => {
  const WS_URL = getWsBaseUrl();
  const socket = io(WS_URL, {
    auth: { token },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500
  });

  socket.on('connect', () => {
    incrementPerfMetric('socket_connect');
  });

  socket.on('disconnect', () => {
    incrementPerfMetric('socket_disconnect');
  });

  socket.io.on('reconnect', () => {
    incrementPerfMetric('socket_reconnect');
  });

  socket.onAny(() => {
    incrementPerfMetric('socket_event_received');
  });

  return socket;
};

export const acquireSharedSocket = (): Socket | null => {
  const token = localStorage.getItem('token') || '';
  if (!token) return null;

  if (!sharedSocket || socketToken !== token) {
    if (sharedSocket) {
      sharedSocket.disconnect();
    }
    sharedSocket = createSocket(token);
    socketToken = token;
  }

  retainCount += 1;
  return sharedSocket;
};

export const releaseSharedSocket = () => {
  retainCount = Math.max(0, retainCount - 1);
  if (retainCount === 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    socketToken = '';
  }
};

export const getSharedSocket = (): Socket | null => sharedSocket;

