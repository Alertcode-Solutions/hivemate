import { incrementPerfMetric } from './perfMetrics';

type LaneName = 'critical' | 'high' | 'medium' | 'low';

type LaneConfig = {
  name: LaneName;
  eventName: string;
  visibleMs: number;
  hiddenMs: number;
  metric: Parameters<typeof incrementPerfMetric>[0];
};

const laneConfigs: LaneConfig[] = [
  {
    name: 'critical',
    eventName: 'hivemate:critical-refresh',
    visibleMs: 4000,
    hiddenMs: 7000,
    metric: 'refresh_tick_critical'
  },
  {
    name: 'high',
    eventName: 'hivemate:soft-refresh',
    visibleMs: 7000,
    hiddenMs: 12000,
    metric: 'refresh_tick_high'
  },
  {
    name: 'medium',
    eventName: 'hivemate:radar-refresh',
    visibleMs: 10000,
    hiddenMs: 18000,
    metric: 'refresh_tick_medium'
  },
  {
    name: 'low',
    eventName: 'hivemate:background-refresh',
    visibleMs: 25000,
    hiddenMs: 45000,
    metric: 'refresh_tick_low'
  }
];

type LaneState = {
  timerId: number | null;
  stopped: boolean;
};

const laneStateMap = new Map<LaneName, LaneState>();
let schedulerStarted = false;
let visibilityHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;

const shouldRun = () => Boolean(localStorage.getItem('token'));

const dispatchLaneEvent = (config: LaneConfig) => {
  if (!shouldRun()) return;
  incrementPerfMetric(config.metric);
  window.dispatchEvent(new CustomEvent(config.eventName));
};

const scheduleLane = (config: LaneConfig) => {
  const state = laneStateMap.get(config.name);
  if (!state || state.stopped) return;

  const isVisible = document.visibilityState === 'visible';
  const delay = isVisible ? config.visibleMs : config.hiddenMs;
  const jitter = Math.round(delay * (Math.random() * 0.08));
  const nextDelay = delay + jitter;

  state.timerId = window.setTimeout(() => {
    dispatchLaneEvent(config);
    scheduleLane(config);
  }, nextDelay);
};

const clearAllLaneTimers = () => {
  laneStateMap.forEach((state) => {
    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  });
};

export const startRefreshScheduler = () => {
  if (schedulerStarted || typeof window === 'undefined') return;
  schedulerStarted = true;

  laneConfigs.forEach((config) => {
    laneStateMap.set(config.name, { timerId: null, stopped: false });
    scheduleLane(config);
  });

  visibilityHandler = () => {
    clearAllLaneTimers();
    laneConfigs.forEach((config) => scheduleLane(config));
    if (document.visibilityState === 'visible') {
      window.dispatchEvent(new CustomEvent('hivemate:soft-refresh'));
    }
  };

  focusHandler = () => {
    window.dispatchEvent(new CustomEvent('hivemate:soft-refresh'));
  };

  onlineHandler = () => {
    window.dispatchEvent(new CustomEvent('hivemate:soft-refresh'));
  };

  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('focus', focusHandler);
  window.addEventListener('online', onlineHandler);
};

export const stopRefreshScheduler = () => {
  if (!schedulerStarted) return;
  schedulerStarted = false;

  laneStateMap.forEach((state) => {
    state.stopped = true;
  });
  clearAllLaneTimers();
  laneStateMap.clear();

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (focusHandler) {
    window.removeEventListener('focus', focusHandler);
    focusHandler = null;
  }
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
};

