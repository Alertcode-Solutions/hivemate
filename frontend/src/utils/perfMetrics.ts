type MetricName =
  | 'socket_connect'
  | 'socket_disconnect'
  | 'socket_reconnect'
  | 'socket_event_received'
  | 'refresh_tick_critical'
  | 'refresh_tick_high'
  | 'refresh_tick_medium'
  | 'refresh_tick_low'
  | 'radar_frame_draw';

type PerfStore = {
  counters: Record<string, number>;
  lastUpdatedAt: number;
};

declare global {
  interface Window {
    __hivematePerf?: PerfStore;
  }
}

const isDev = import.meta.env.DEV;

const ensureStore = (): PerfStore => {
  if (!window.__hivematePerf) {
    window.__hivematePerf = {
      counters: {},
      lastUpdatedAt: Date.now()
    };
  }

  return window.__hivematePerf;
};

export const incrementPerfMetric = (name: MetricName, by = 1) => {
  if (!isDev || typeof window === 'undefined') return;
  const store = ensureStore();
  store.counters[name] = (store.counters[name] || 0) + by;
  store.lastUpdatedAt = Date.now();
};

