import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Socket } from 'socket.io-client';
import ProfilePreviewModal from './ProfilePreviewModal';
import LoadingDots from './LoadingDots';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { acquireSharedSocket, releaseSharedSocket } from '../utils/socketManager';
import { incrementPerfMetric } from '../utils/perfMetrics';
import { fetchJsonCached, invalidateApiCacheByUrl } from '../utils/apiCache';
import './RadarView.css';

interface RadarDot {
  userId: string;
  latitude: number;
  longitude: number;
  distance: number;
  gender?: string;
  name?: string;
  photo?: string;
}

interface RadarFilters {
  skills: string[];
  profession: string;
  gender: string;
}

interface HoverLabel {
  userId: string;
  name: string;
  x: number;
  y: number;
}

interface SelectedRadarUser {
  userId: string;
  name?: string;
  photo?: string;
}

type LocationPromptKind = 'permission' | 'services' | 'unsupported' | 'blocked';

interface LocationPromptState {
  kind: LocationPromptKind;
  title: string;
  message: string;
}

type RadarLoadPhase = 'starting' | 'searching' | 'ready';

const RADAR_SCAN_CYCLE_MS = 700;
const SCROLL_LOG_THROTTLE_MS = 180;
const RADAR_RESPONSE_CACHE_TTL_MS = 2500;
const RADAR_PREFETCH_RADIUS_KM = 1000;
const RADAR_DISTANCE_RINGS_KM = [
  { min: 0, max: 50 },
  { min: 50, max: 300 },
  { min: 300, max: 700 },
  { min: 700, max: 1000 }
];
const RADAR_LAST_LOCATION_KEY = 'radar:last-known-location';
const RADAR_LAST_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;
const RADAR_RECENT_LOCATION_GRACE_MS = 2 * 60 * 1000;

const isScrollDebugEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const forced = window.localStorage.getItem('debug-scroll');
    if (forced === '1') return true;
    if (forced === '0') return false;
  } catch {
    // ignore storage access issues
  }
  return false;
};

const getCurrentPositionAsync = (options: PositionOptions): Promise<{ lat: number; lng: number }> =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }),
      (error) => reject(error),
      options
    );
  });

const queryGeolocationPermissionState = async (): Promise<PermissionState | 'unsupported'> => {
  if (!navigator.permissions?.query) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'unsupported';
  }
};

const getBlockedPermissionPrompt = (): LocationPromptState => ({
  kind: 'blocked',
  title: 'Location Permission Blocked',
  message:
    'Location permission is blocked for this site. Enable it from browser site settings, then try Explore Mode again.'
});

const readLastKnownLocation = (): { lat: number; lng: number } | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RADAR_LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    const at = Number(parsed?.at);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(at)) {
      return null;
    }
    if (Date.now() - at > RADAR_LAST_LOCATION_MAX_AGE_MS) {
      return null;
    }
    return { lat, lng };
  } catch {
    return null;
  }
};

const persistLastKnownLocation = (location: { lat: number; lng: number }) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      RADAR_LAST_LOCATION_KEY,
      JSON.stringify({ lat: location.lat, lng: location.lng, at: Date.now() })
    );
  } catch {
    // Ignore storage errors.
  }
};

const getRadarCachePrecision = (radiusInMeters: number): number => {
  if (radiusInMeters >= 1000000) return 2;
  if (radiusInMeters >= 100000) return 3;
  return 4;
};

const RadarView = () => {
  const navigate = useNavigate();
  const getStoredVisibilityMode = (): 'explore' | 'vanish' => {
    const savedMode = localStorage.getItem('radarVisibilityMode');
    return savedMode === 'explore' || savedMode === 'vanish' ? savedMode : 'vanish';
  };

  const [visibilityMode, setVisibilityMode] = useState<'explore' | 'vanish'>(() => {
    // Keep last user-selected mode; only manual toggle should change this.
    return getStoredVisibilityMode();
  });
  const [nearbyUsers, setNearbyUsers] = useState<RadarDot[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<RadarDot[]>([]);
  const [distanceRange, setDistanceRange] = useState(50); // km
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => readLastKnownLocation());
  const [selectedUser, setSelectedUser] = useState<SelectedRadarUser | null>(null);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isNearbyRefreshing, setIsNearbyRefreshing] = useState(false);
  const [hasFetchedNearbyOnce, setHasFetchedNearbyOnce] = useState(false);
  const [radarLoadPhase, setRadarLoadPhase] = useState<RadarLoadPhase>('starting');
  const [, setLocationIssue] = useState<string>('');
  const [locationPrompt, setLocationPrompt] = useState<LocationPromptState | null>(null);
  const [isExploreActivationPending, setIsExploreActivationPending] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [hoverLabel, setHoverLabel] = useState<HoverLabel | null>(null);
  const [filters, setFilters] = useState<RadarFilters>({
    skills: [],
    profession: '',
    gender: ''
  });
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastLocationAtRef = useRef(0);
  const locationRequestInFlightRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const lastServerSyncAtRef = useRef(0);
  const hasExploreBootstrappedRef = useRef(false);
  const radarContainerRef = useRef<HTMLDivElement | null>(null);
  const nearbyListRef = useRef<HTMLDivElement | null>(null);
  const scrollDebugEnabledRef = useRef(isScrollDebugEnabled());
  const lastScrollLogAtRef = useRef(0);
  const lastInputLogAtRef = useRef(0);
  const visibilityModeRef = useRef<'explore' | 'vanish'>(visibilityMode);
  const distanceRangeRef = useRef(distanceRange);
  const nearbyCountRef = useRef(nearbyUsers.length);
  const filteredCountRef = useRef(filteredUsers.length);
  const nearbyUsersRef = useRef<RadarDot[]>(nearbyUsers);
  const nearbyFetchAbortByRadiusRef = useRef<Map<string, AbortController>>(new Map());
  const nearbyResponseCacheRef = useRef<Map<string, { at: number; users: RadarDot[] }>>(new Map());
  const nearbyFetchRequestIdRef = useRef(0);
  const distanceFetchDebounceRef = useRef<number | null>(null);
  const socketRefreshDebounceRef = useRef<number | null>(null);
  const backgroundRingRefreshInFlightRef = useRef(false);
  const fullRadiusRefreshInFlightRef = useRef(false);
  const locationServicesErrorCountRef = useRef(0);
  const shouldUseRingBootstrapRef = useRef(getStoredVisibilityMode() === 'explore');
  const hasUsedRingBootstrapRef = useRef(false);

  const API_URL = getApiBaseUrl();
  const handleUnauthorized = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('privateKey');
    localStorage.removeItem('publicKey');
    navigate('/login');
  };

  const logRadarDebug = (label: string, extra: Record<string, unknown> = {}) => {
    if (!scrollDebugEnabledRef.current || typeof window === 'undefined') return;
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const scrollingEl = document.scrollingElement as HTMLElement | null;
    console.log('[RadarView][ScrollDebug]', label, {
      path: window.location.pathname,
      mode: visibilityModeRef.current,
      distanceRange: distanceRangeRef.current,
      nearbyCount: nearbyCountRef.current,
      filteredCount: filteredCountRef.current,
      scrollY: window.scrollY,
      scrollingElementTag: scrollingEl?.tagName || null,
      scrollingElementScrollTop: scrollingEl?.scrollTop ?? null,
      innerHeight: window.innerHeight,
      htmlScrollHeight: html.scrollHeight,
      bodyScrollHeight: body.scrollHeight,
      rootScrollHeight: root?.scrollHeight,
      htmlOverflowY: window.getComputedStyle(html).overflowY,
      bodyOverflowY: window.getComputedStyle(body).overflowY,
      rootOverflowY: root ? window.getComputedStyle(root).overflowY : null,
      ...extra
    });
  };

  const logRadarError = (
    context: string,
    error: unknown,
    extra: Record<string, unknown> = {}
  ) => {
    const normalized =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          }
        : { message: String(error) };

    console.error('[RadarView][Error]', {
      context,
      mode: visibilityModeRef.current,
      distanceRange: distanceRangeRef.current,
      nearbyCount: nearbyCountRef.current,
      filteredCount: filteredCountRef.current,
      ...normalized,
      ...extra
    });
  };

  const normalizeWheelDelta = (event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number => {
    if (event.deltaMode === 1) return event.deltaY * 16;
    if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
    return event.deltaY;
  };

  const resolveScrollContainer = (): HTMLElement | null => {
    const isVerticallyScrollable = (element: HTMLElement) => {
      const overflowY = window.getComputedStyle(element).overflowY;
      const allowsScroll =
        overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      return allowsScroll && element.scrollHeight > element.clientHeight + 1;
    };

    const homeWrapper = document.querySelector('.home-screen-wrapper') as HTMLElement | null;
    if (homeWrapper && isVerticallyScrollable(homeWrapper)) {
      return homeWrapper;
    }
    return document.scrollingElement as HTMLElement | null;
  };

  const assistPageScrollFromWheel = (event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>) => {
    if (typeof document === 'undefined') return;
    const scrollingEl = resolveScrollContainer();
    if (!scrollingEl) return;

    const rawDelta = normalizeWheelDelta(event);
    if (!Number.isFinite(rawDelta) || rawDelta === 0) return;

    const before = scrollingEl.scrollTop;
    window.requestAnimationFrame(() => {
      const after = scrollingEl.scrollTop;
      const nativeMoved = Math.abs(after - before) > 0.5;
      if (nativeMoved) return;

      const boosted = Math.sign(rawDelta) * Math.max(Math.abs(rawDelta), 18);
      scrollingEl.scrollTop = before + boosted;
      logRadarDebug('wheel-scroll-assist', {
        containerClass: scrollingEl.className || null,
        rawDelta,
        boosted,
        before,
        after
      });
    });
  };

  const requestCurrentLocation = async (): Promise<{ lat: number; lng: number }> => {
    if (!navigator.geolocation) {
      throw new Error('Geolocation is not supported by your browser.');
    }

    // Mobile-first: get a quick coarse fix first, then fall back to high accuracy.
    try {
      return await getCurrentPositionAsync({
        enableHighAccuracy: false,
        maximumAge: 120000,
        timeout: 4500
      });
    } catch {
      return await getCurrentPositionAsync({
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 12000
      });
    }
  };

  const toLocationPrompt = (error: any): LocationPromptState => {
    if (!navigator.geolocation) {
      return {
        kind: 'unsupported',
        title: 'Location Not Supported',
        message: 'Your browser does not support location access. Please use a modern browser to use Explore Mode.'
      };
    }

    const code = Number(error?.code || 0);
    if (code === 1) {
      return {
        kind: 'permission',
        title: 'Allow Location Permission',
        message:
          'Explore Mode needs your location permission. Allow location access in the browser prompt or site settings.'
      };
    }
    if (code === 2 || code === 3) {
      return {
        kind: 'services',
        title: 'Turn On Device Location',
        message:
          'Location services seem off. Turn on GPS/location services on your device and try again.'
      };
    }
    return {
      kind: 'services',
      title: 'Location Required',
      message: 'Explore Mode needs your current location. Please enable location and try again.'
    };
  };

  useEffect(() => {
    localStorage.setItem('radarVisibilityMode', visibilityMode);
  }, [visibilityMode]);

  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  useEffect(() => {
    visibilityModeRef.current = visibilityMode;
  }, [visibilityMode]);

  useEffect(() => {
    if (visibilityMode !== 'explore') return;
    if (!navigator.geolocation) {
      setLocationPrompt(toLocationPrompt({ code: 0 }));
      return;
    }
    if (!navigator.permissions?.query) return;

    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;
    const syncPermissionPrompt = () => {
      if (!permissionStatus || cancelled) return;
      if (permissionStatus.state === 'denied') {
        setLocationPrompt(toLocationPrompt({ code: 1 }));
      } else if (permissionStatus.state === 'granted') {
        // Clear stale prompts once permission is granted and location can flow again.
        setLocationPrompt(null);
      }
    };

    void navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permissionStatus = status;
        syncPermissionPrompt();
        permissionStatus.onchange = syncPermissionPrompt;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, [visibilityMode]);

  useEffect(() => {
    distanceRangeRef.current = distanceRange;
  }, [distanceRange]);

  useEffect(() => {
    nearbyCountRef.current = nearbyUsers.length;
    nearbyUsersRef.current = nearbyUsers;
    filteredCountRef.current = filteredUsers.length;
  }, [nearbyUsers, filteredUsers.length]);

  useEffect(() => {
    if (typeof window === 'undefined' || !scrollDebugEnabledRef.current) {
      return () => undefined;
    }

    logRadarDebug('mount');

    const onWindowScroll = () => {
      const now = Date.now();
      if (now - lastScrollLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastScrollLogAtRef.current = now;
      logRadarDebug('window-scroll');
    };

    const onWindowWheel = (event: WheelEvent) => {
      const now = Date.now();
      if (now - lastInputLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastInputLogAtRef.current = now;
      const target = event.target as HTMLElement | null;
      logRadarDebug('window-wheel', {
        deltaY: event.deltaY,
        defaultPrevented: event.defaultPrevented,
        targetTag: target?.tagName || null,
        targetClass: target?.className || null
      });
    };

    const onWindowTouchMove = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastInputLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastInputLogAtRef.current = now;
      const touch = event.touches?.[0];
      const target = event.target as HTMLElement | null;
      logRadarDebug('window-touchmove', {
        touches: event.touches.length,
        clientY: touch?.clientY ?? null,
        defaultPrevented: event.defaultPrevented,
        targetTag: target?.tagName || null,
        targetClass: target?.className || null
      });
    };

    const onDocumentWheelCapture = (event: WheelEvent) => {
      const now = Date.now();
      if (now - lastInputLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastInputLogAtRef.current = now;
      const target = event.target as HTMLElement | null;
      logRadarDebug('document-wheel-capture', {
        deltaY: event.deltaY,
        defaultPrevented: event.defaultPrevented,
        cancelable: event.cancelable,
        targetTag: target?.tagName || null,
        targetClass: target?.className || null
      });
    };

    const onDocumentTouchMoveCapture = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastInputLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastInputLogAtRef.current = now;
      const touch = event.touches?.[0];
      const target = event.target as HTMLElement | null;
      logRadarDebug('document-touchmove-capture', {
        touches: event.touches.length,
        clientY: touch?.clientY ?? null,
        defaultPrevented: event.defaultPrevented,
        cancelable: event.cancelable,
        targetTag: target?.tagName || null,
        targetClass: target?.className || null
      });
    };

    const onWindowError = (event: ErrorEvent) => {
      console.error('[RadarView][WindowError]', {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
        error: event.error
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[RadarView][UnhandledRejection]', {
        reason: event.reason
      });
    };

    const radarContainer = radarContainerRef.current;
    const nearbyList = nearbyListRef.current;

    const onRadarContainerWheel = (event: WheelEvent) => {
      assistPageScrollFromWheel(event);

      const now = Date.now();
      if (now - lastInputLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastInputLogAtRef.current = now;
      logRadarDebug('radar-container-wheel', {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        defaultPrevented: event.defaultPrevented
      });
    };

    const onRadarContainerTouchMove = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastInputLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastInputLogAtRef.current = now;
      const touch = event.touches?.[0];
      logRadarDebug('radar-container-touchmove', {
        touches: event.touches.length,
        clientY: touch?.clientY ?? null,
        defaultPrevented: event.defaultPrevented
      });
    };

    const onNearbyListScroll = () => {
      if (!nearbyList) return;
      const now = Date.now();
      if (now - lastScrollLogAtRef.current < SCROLL_LOG_THROTTLE_MS) return;
      lastScrollLogAtRef.current = now;
      logRadarDebug('nearby-list-scroll', {
        nearbyScrollTop: nearbyList.scrollTop,
        nearbyScrollHeight: nearbyList.scrollHeight,
        nearbyClientHeight: nearbyList.clientHeight
      });
    };

    window.addEventListener('scroll', onWindowScroll, { passive: true });
    window.addEventListener('wheel', onWindowWheel, { passive: true });
    window.addEventListener('touchmove', onWindowTouchMove, { passive: true });
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    document.addEventListener('wheel', onDocumentWheelCapture, { passive: true, capture: true });
    document.addEventListener('touchmove', onDocumentTouchMoveCapture, { passive: true, capture: true });

    radarContainer?.addEventListener('wheel', onRadarContainerWheel, { passive: true });
    radarContainer?.addEventListener('touchmove', onRadarContainerTouchMove, { passive: true });
    nearbyList?.addEventListener('scroll', onNearbyListScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onWindowScroll);
      window.removeEventListener('wheel', onWindowWheel);
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      document.removeEventListener('wheel', onDocumentWheelCapture, { capture: true } as EventListenerOptions);
      document.removeEventListener('touchmove', onDocumentTouchMoveCapture, { capture: true } as EventListenerOptions);

      radarContainer?.removeEventListener('wheel', onRadarContainerWheel);
      radarContainer?.removeEventListener('touchmove', onRadarContainerTouchMove);
      nearbyList?.removeEventListener('scroll', onNearbyListScroll);
      logRadarDebug('unmount');
    };
  }, []);

  useEffect(() => {
    const syncVisibilityMode = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const data = await fetchJsonCached<any>(
          `${API_URL}/api/location/visibility/mode`,
          {
            headers: { Authorization: `Bearer ${token}` }
          },
          {
            ttlMs: 15000
          }
        );

        // Visibility mode is controlled by local startup checks and user toggles.
        // Keep this request for auth validation/cache warm-up only.
        void data;
      } catch (error: any) {
        if (error?.status === 401) {
          handleUnauthorized();
          return;
        }
      logRadarError('syncVisibilityMode', error);
    }
  };

    syncVisibilityMode();
  }, [API_URL]);

  useEffect(() => {
    const sharedSocket = acquireSharedSocket();
    if (sharedSocket) {
      const triggerRealtimeRefresh = () => {
        if (visibilityModeRef.current !== 'explore') return;
        if (!userLocationRef.current) return;
        if (socketRefreshDebounceRef.current !== null) {
          window.clearTimeout(socketRefreshDebounceRef.current);
        }
        socketRefreshDebounceRef.current = window.setTimeout(() => {
          socketRefreshDebounceRef.current = null;
          void refreshNearbyUsersFullRadiusAtomic(userLocationRef.current, { forceRefresh: true });
        }, 120);
      };

      const handleRadarUpdate = (data?: any) => {
        const changedUserId = String(data?.userId || '');
        const changedMode = data?.mode === 'vanish' ? 'vanish' : data?.mode === 'explore' ? 'explore' : '';
        if (changedUserId && changedMode === 'vanish') {
          setNearbyUsers((prev) => prev.filter((user) => user.userId !== changedUserId));
        }
        triggerRealtimeRefresh();
      };
      const handleNearbyNotification = () => {
        triggerRealtimeRefresh();
      };
      const handleVisibilityChanged = (data?: any) => {
        const changedUserId = String(data?.userId || '');
        const changedMode = data?.mode === 'vanish' ? 'vanish' : data?.mode === 'explore' ? 'explore' : '';
        if (changedUserId && changedMode === 'vanish') {
          // Remove vanished users immediately from the current radar view.
          setNearbyUsers((prev) => prev.filter((user) => user.userId !== changedUserId));
        }
        triggerRealtimeRefresh();
      };
      sharedSocket.on('radar:update', handleRadarUpdate);
      sharedSocket.on('nearby:notification', handleNearbyNotification);
      sharedSocket.on('user:visibility:changed', handleVisibilityChanged);
      socketRef.current = sharedSocket;

      return () => {
        sharedSocket.off('radar:update', handleRadarUpdate);
        sharedSocket.off('nearby:notification', handleNearbyNotification);
        sharedSocket.off('user:visibility:changed', handleVisibilityChanged);
        if (socketRefreshDebounceRef.current !== null) {
          window.clearTimeout(socketRefreshDebounceRef.current);
          socketRefreshDebounceRef.current = null;
        }
        releaseSharedSocket();
      };
    }
    return () => undefined;
  }, []);

  useEffect(() => {
    const syncRadarData = async () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        const currentLocation = userLocationRef.current;
        if (!currentLocation) return;
        const now = Date.now();
        if (now - lastServerSyncAtRef.current > 20000) {
          await Promise.all([
            updateLocationOnServer(currentLocation, 'explore'),
            refreshNearbyUsersFullRadiusAtomic(currentLocation, { forceRefresh: true })
          ]);
          lastServerSyncAtRef.current = now;
          return;
        }
        await refreshNearbyUsersFullRadiusAtomic(currentLocation, { forceRefresh: false });
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const onRadarRefresh = () => {
      if (visibilityMode === 'explore' && userLocationRef.current) {
        syncRadarData();
      }
    };

    window.addEventListener('hivemate:radar-refresh', onRadarRefresh as EventListener);

    if (visibilityMode === 'explore' && userLocationRef.current) {
      if (distanceFetchDebounceRef.current !== null) {
        window.clearTimeout(distanceFetchDebounceRef.current);
      }
      distanceFetchDebounceRef.current = window.setTimeout(() => {
        syncRadarData();
        distanceFetchDebounceRef.current = null;
      }, 120);
    }

    return () => {
      window.removeEventListener('hivemate:radar-refresh', onRadarRefresh as EventListener);
      if (distanceFetchDebounceRef.current !== null) {
        window.clearTimeout(distanceFetchDebounceRef.current);
        distanceFetchDebounceRef.current = null;
      }
    };
  }, [visibilityMode]);

  useEffect(() => {
    if (visibilityMode !== 'vanish') return;
    if (!userLocationRef.current) return;

    const currentLocation = userLocationRef.current;
    if (!currentLocation) return;
    // Warm nearby cache immediately while vanished; periodic refresh is handled by the shared 30s loop.
    void refreshNearbyUsersFullRadiusAtomic(currentLocation, {
      forceRefresh: false,
      applyData: false
    });
    return () => undefined;
  }, [visibilityMode, userLocation]);

  useEffect(() => {
    if (!userLocationRef.current) return;
    if (visibilityMode !== 'explore' && visibilityMode !== 'vanish') return;

    let cancelled = false;
    const runBackgroundRefresh = async () => {
      if (cancelled || backgroundRingRefreshInFlightRef.current) return;
      const currentLocation = userLocationRef.current;
      if (!currentLocation) return;
      backgroundRingRefreshInFlightRef.current = true;
      try {
        const effectiveLocation = await requestLocationAccess().catch(() => currentLocation);
        await Promise.all([
          updateLocationOnServer(effectiveLocation, visibilityModeRef.current),
          refreshNearbyUsersFullRadiusAtomic(effectiveLocation, {
            forceRefresh: true,
            applyData: visibilityModeRef.current === 'explore'
          })
        ]);
      } finally {
        backgroundRingRefreshInFlightRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void runBackgroundRefresh();
    }, 30000);
    void runBackgroundRefresh();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [visibilityMode, userLocation]);

  useEffect(() => {
    if (visibilityMode !== 'explore') {
      hasExploreBootstrappedRef.current = false;
      setHasFetchedNearbyOnce(false);
      setRadarLoadPhase('ready');
      return;
    }
    setRadarLoadPhase('starting');
    if (hasExploreBootstrappedRef.current) return;
    hasExploreBootstrappedRef.current = true;

    let cancelled = false;
    const startExploreMode = async () => {
      try {
        const freshLocation = userLocationRef.current
          ? { ...userLocationRef.current }
          : await requestLocationAccess();
        if (cancelled) return;
        const shouldUseRingBootstrap =
          shouldUseRingBootstrapRef.current && !hasUsedRingBootstrapRef.current;
        hasUsedRingBootstrapRef.current = true;
        await Promise.all([
          updateLocationOnServer(freshLocation, 'explore'),
          shouldUseRingBootstrap
            ? fetchNearbyUsersStaged(freshLocation)
            : refreshNearbyUsersFullRadiusAtomic(freshLocation, { forceRefresh: true })
        ]);
        lastServerSyncAtRef.current = Date.now();
      } catch (error) {
        if (cancelled) return;
        logRadarError('startExploreMode', error, { cancelled });
        setLocationIssue('Location permission is required for Explore Mode.');
      }
    };

    startExploreMode();
    return () => {
      cancelled = true;
    };
  }, [visibilityMode]);

  useEffect(() => {
    // Apply filters to nearby users
    let filtered = [...nearbyUsers];

    if (filters.gender) {
      filtered = filtered.filter(user => user.gender === filters.gender);
    }

    setFilteredUsers(filtered);
  }, [nearbyUsers, filters]);

  useEffect(() => {
    if (visibilityMode !== 'explore') {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const animate = () => {
      incrementPerfMetric('radar_frame_draw');
      drawRadar();
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [filteredUsers, distanceRange, hoverLabel, focusedUserId, userLocation, visibilityMode]);

  useEffect(() => {
    if (!focusedUserId) return;
    const stillVisible = filteredUsers.some((u) => u.userId === focusedUserId);
    if (!stillVisible) {
      setFocusedUserId(null);
    }
  }, [filteredUsers, focusedUserId]);

  useEffect(() => {
    return () => {
      nearbyFetchAbortByRadiusRef.current.forEach((controller) => controller.abort());
      nearbyFetchAbortByRadiusRef.current.clear();
      if (distanceFetchDebounceRef.current !== null) {
        window.clearTimeout(distanceFetchDebounceRef.current);
        distanceFetchDebounceRef.current = null;
      }
      if (socketRefreshDebounceRef.current !== null) {
        window.clearTimeout(socketRefreshDebounceRef.current);
        socketRefreshDebounceRef.current = null;
      }
    };
  }, []);

  const mergeNearbyUsers = (existing: RadarDot[], incoming: RadarDot[]): RadarDot[] => {
    const mergedByUserId = new Map<string, RadarDot>();
    existing.forEach((user) => {
      mergedByUserId.set(user.userId, user);
    });
    incoming.forEach((user) => {
      mergedByUserId.set(user.userId, user);
    });
    return Array.from(mergedByUserId.values());
  };

  const applyNearbyUsersSnapshot = (users: RadarDot[]) => {
    setNearbyUsers(users);
    nearbyUsersRef.current = users;
    setHasFetchedNearbyOnce(true);
    setRadarLoadPhase('ready');
    setIsNearbyRefreshing(false);
  };

  const fetchNearbyUsers = async (
    location = userLocation,
    options: {
      silent?: boolean;
      forceRefresh?: boolean;
      radiusKm?: number;
      minRadiusKm?: number;
      merge?: boolean;
      applyData?: boolean;
      throwOnError?: boolean;
    } = {}
  ) => {
    if (!location) return [] as RadarDot[];
    const radiusInMeters = (options.radiusKm ?? RADAR_PREFETCH_RADIUS_KM) * 1000;
    const minRadiusInMeters = Math.max(0, (options.minRadiusKm ?? 0) * 1000);
    const requestCacheTtlMs = radiusInMeters >= 1000000 ? 12000 : 3000;
    const precision = getRadarCachePrecision(radiusInMeters);
    const cacheKey = `${location.lat.toFixed(precision)}:${location.lng.toFixed(precision)}:${minRadiusInMeters}:${radiusInMeters}`;
    const shouldApplyData = options.applyData !== false;
    const cached = nearbyResponseCacheRef.current.get(cacheKey);
    const now = Date.now();
    if (!options.forceRefresh && cached && now - cached.at < RADAR_RESPONSE_CACHE_TTL_MS) {
      if (shouldApplyData) {
        if (options.merge) {
          setNearbyUsers((prev) => mergeNearbyUsers(prev, cached.users));
        } else {
          setNearbyUsers(cached.users);
        }
        setHasFetchedNearbyOnce(true);
        setRadarLoadPhase('ready');
        setIsNearbyRefreshing(false);
      }
      return cached.users;
    }

    const requestId = shouldApplyData ? ++nearbyFetchRequestIdRef.current : nearbyFetchRequestIdRef.current;
    if (shouldApplyData) {
      setRadarLoadPhase('searching');
      setIsNearbyRefreshing(true);
    }
    let controller: AbortController | undefined;

    if (shouldApplyData && !options.silent) {
      setLoading(true);
    }
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        handleUnauthorized();
        return [] as RadarDot[];
      }
      const requestKey = `${minRadiusInMeters}:${radiusInMeters}`;
      nearbyFetchAbortByRadiusRef.current.get(requestKey)?.abort();
      controller = new AbortController();
      nearbyFetchAbortByRadiusRef.current.set(requestKey, controller);
      const data = await fetchJsonCached<any>(
        `${API_URL}/api/location/nearby?lat=${location.lat}&lng=${location.lng}&radius=${radiusInMeters}&minRadius=${minRadiusInMeters}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        },
        {
          ttlMs: requestCacheTtlMs,
          forceRefresh: Boolean(options.forceRefresh)
        }
      );
      const users = data.nearbyUsers || [];
      // Map the response to match RadarDot interface
      const mappedUsers = users.map((user: any) => ({
        userId: user.userId,
        latitude: user.coordinates?.latitude || 0,
        longitude: user.coordinates?.longitude || 0,
        distance: user.distance || 0,
        gender: user.gender,
          name: user.name,
          photo: user.photo || ''
      }));
      nearbyResponseCacheRef.current.set(cacheKey, { at: Date.now(), users: mappedUsers });
      if (shouldApplyData) {
        if (options.merge) {
          setNearbyUsers((prev) => mergeNearbyUsers(prev, mappedUsers));
        } else {
          setNearbyUsers(mappedUsers);
        }
        setHasFetchedNearbyOnce(true);
      }
      return mappedUsers;
    } catch (error: any) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (options.throwOnError) throw error;
        return [] as RadarDot[];
      }
      if (error?.status === 401) {
        handleUnauthorized();
        if (options.throwOnError) throw error;
        return [] as RadarDot[];
      }
      logRadarError('fetchNearbyUsers', error, {
        lat: location?.lat,
        lng: location?.lng,
        silent: Boolean(options.silent),
        minRadiusInMeters,
        radiusInMeters
      });
      if (options.throwOnError) throw error;
      return [] as RadarDot[];
    } finally {
      const key = `${minRadiusInMeters}:${radiusInMeters}`;
      const activeController = nearbyFetchAbortByRadiusRef.current.get(key);
      if (controller && activeController?.signal === controller.signal) {
        nearbyFetchAbortByRadiusRef.current.delete(key);
      }
      if (shouldApplyData && !options.silent && requestId === nearbyFetchRequestIdRef.current) {
        setLoading(false);
      }
      if (shouldApplyData && requestId === nearbyFetchRequestIdRef.current) {
        setIsNearbyRefreshing(false);
        setRadarLoadPhase('ready');
      }
    }
  };

  const fetchNearbyUsersStaged = async (
    location = userLocation,
    options: { silent?: boolean; forceRefresh?: boolean } = {}
  ) => {
    if (!location) return;
    setRadarLoadPhase('searching');
    setIsNearbyRefreshing(true);
    try {
      let mergedUsers: RadarDot[] = [];
      for (let index = 0; index < RADAR_DISTANCE_RINGS_KM.length; index += 1) {
        const ring = RADAR_DISTANCE_RINGS_KM[index];
        const ringUsers = await fetchNearbyUsers(location, {
          silent: index === 0 ? options.silent : true,
          forceRefresh: options.forceRefresh,
          minRadiusKm: ring.min,
          radiusKm: ring.max,
          applyData: false,
          throwOnError: true
        });
        mergedUsers = mergeNearbyUsers(mergedUsers, ringUsers);
      }
      applyNearbyUsersSnapshot(mergedUsers);
    } catch (error) {
      logRadarError('fetchNearbyUsersStaged', error, {
        lat: location?.lat,
        lng: location?.lng
      });
      setIsNearbyRefreshing(false);
      setRadarLoadPhase('ready');
    }
  };

  const refreshNearbyUsersFullRadiusAtomic = async (
    location = userLocation,
    options: { forceRefresh?: boolean; applyData?: boolean } = {}
  ) => {
    if (!location) return;
    if (fullRadiusRefreshInFlightRef.current) return;
    fullRadiusRefreshInFlightRef.current = true;
    if (options.applyData !== false) {
      setRadarLoadPhase((prev) => (prev === 'starting' ? 'starting' : 'searching'));
      setIsNearbyRefreshing(true);
    }
    try {
      const users = await fetchNearbyUsers(location, {
        silent: true,
        forceRefresh: options.forceRefresh,
        minRadiusKm: 0,
        radiusKm: RADAR_PREFETCH_RADIUS_KM,
        applyData: false,
        throwOnError: true
      });
      if (options.applyData !== false) {
        applyNearbyUsersSnapshot(users);
      }
    } catch (error) {
      logRadarError('refreshNearbyUsersFullRadiusAtomic', error, {
        lat: location?.lat,
        lng: location?.lng
      });
      if (options.applyData !== false) {
        setIsNearbyRefreshing(false);
        setRadarLoadPhase('ready');
      }
    } finally {
      fullRadiusRefreshInFlightRef.current = false;
    }
  };

  const updateLocationOnServer = async (
    location = userLocation,
    mode: 'explore' | 'vanish' = visibilityMode
  ) => {
    if (!location) return;

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        handleUnauthorized();
        return;
      }
      const response = await fetch(`${API_URL}/api/location/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          latitude: location.lat,
          longitude: location.lng,
          mode
        })
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      // Emit location update via WebSocket
      if (socketRef.current) {
        socketRef.current.emit('location:update', {
          latitude: location.lat,
          longitude: location.lng,
          mode
        });
      }
    } catch (error) {
      logRadarError('updateLocationOnServer', error, {
        lat: location?.lat,
        lng: location?.lng,
        mode
      });
    }
  };

  const requestLocationAccess = async (
    options: { forceFresh?: boolean } = {}
  ): Promise<{ lat: number; lng: number }> => {
    const now = Date.now();
    if (!options.forceFresh && userLocationRef.current && now - lastLocationAtRef.current < 45000) {
      return userLocationRef.current;
    }
    if (locationRequestInFlightRef.current) {
      if (!options.forceFresh && userLocationRef.current) return userLocationRef.current;
      // Allow a forceFresh user-initiated call to proceed so browser permission UI can appear.
    }

    locationRequestInFlightRef.current = true;
    setRadarLoadPhase('starting');
    try {
      const freshLocation = await requestCurrentLocation();
      setUserLocation(freshLocation);
      userLocationRef.current = freshLocation;
      lastLocationAtRef.current = Date.now();
      persistLastKnownLocation(freshLocation);
      setLocationIssue('');
      setLocationPrompt(null);
      locationServicesErrorCountRef.current = 0;
      return freshLocation;
    } catch (error) {
      const code = Number((error as GeolocationPositionError)?.code || 0);
      const hasRecentValidLocation =
        Boolean(userLocationRef.current) &&
        Date.now() - lastLocationAtRef.current < RADAR_RECENT_LOCATION_GRACE_MS;
      if ((code === 2 || code === 3) && hasRecentValidLocation && userLocationRef.current) {
        // Avoid false "turn on location" prompts when location is already available.
        setLocationPrompt(null);
        locationServicesErrorCountRef.current = 0;
        return userLocationRef.current;
      }
      if (code === 2 || code === 3) {
        locationServicesErrorCountRef.current += 1;
        const permissionState = await queryGeolocationPermissionState();
        const shouldShowServicesPrompt =
          locationServicesErrorCountRef.current >= 2 &&
          (permissionState !== 'granted' || !userLocationRef.current);
        if (!shouldShowServicesPrompt) {
          if (userLocationRef.current) {
            setLocationPrompt(null);
            return userLocationRef.current;
          }
          throw error;
        }
      }
      setLocationIssue('Location permission is required for Explore Mode.');
      setLocationPrompt(toLocationPrompt(error));
      throw error;
    } finally {
      locationRequestInFlightRef.current = false;
    }
  };

  const requestLocationForExploreFlow = async (): Promise<{ lat: number; lng: number }> => {
    // Always attempt direct geolocation first from the user action path.
    // This gives the browser the best chance to show the native permission popup.
    try {
      return await requestLocationAccess({ forceFresh: true });
    } catch (error: any) {
      const code = Number(error?.code || 0);
      if (code === 1) {
        const permissionState = await queryGeolocationPermissionState();
        if (permissionState === 'denied') {
          setLocationPrompt(getBlockedPermissionPrompt());
          throw error;
        }
      }
      if (code === 2 || code === 3) {
        const hasRecentValidLocation =
          Boolean(userLocationRef.current) &&
          Date.now() - lastLocationAtRef.current < RADAR_RECENT_LOCATION_GRACE_MS;
        const permissionState = await queryGeolocationPermissionState();
        if (hasRecentValidLocation || permissionState === 'granted') {
          throw error;
        }
      }
      setLocationPrompt(toLocationPrompt(error));
      throw error;
    }
  };

  const refreshExploreWithLiveLocation = async () => {
    try {
      const liveLocation = await requestLocationForExploreFlow();
      await Promise.all([
        updateLocationOnServer(liveLocation, 'explore'),
        refreshNearbyUsersFullRadiusAtomic(liveLocation, { forceRefresh: true })
      ]);
      lastServerSyncAtRef.current = Date.now();
    } catch (error) {
      logRadarError('refreshExploreWithLiveLocation', error);
    }
  };

  const setServerVisibilityMode = async (mode: 'explore' | 'vanish') => {
    const token = localStorage.getItem('token');
    if (!token) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    const response = await fetch(`${API_URL}/api/location/visibility/mode`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ mode })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || 'Failed to update visibility mode');
    }

    invalidateApiCacheByUrl('/api/location/visibility/mode');
    invalidateApiCacheByUrl('/api/location/nearby');
    if (socketRef.current) {
      socketRef.current.emit('visibility:toggle', { mode });
    }
  };

  const activateExploreMode = async (freshLocation: { lat: number; lng: number }) => {
    hasExploreBootstrappedRef.current = true;
    setVisibilityMode('explore');
    await Promise.all([
      setServerVisibilityMode('explore'),
      updateLocationOnServer(freshLocation, 'explore')
    ]);
    lastServerSyncAtRef.current = Date.now();
    await refreshNearbyUsersFullRadiusAtomic(freshLocation, { forceRefresh: true });
  };

  const activateVanishMode = async (options: { keepLocationPrompt?: boolean } = {}) => {
    const { keepLocationPrompt = false } = options;
    setVisibilityMode('vanish');
    if (!keepLocationPrompt) {
      setLocationPrompt(null);
    }
    // Keep nearby users/cache warm in vanish mode so explore can render instantly.
    setHoverLabel(null);
    setFocusedUserId(null);
    try {
      await setServerVisibilityMode('vanish');
    } catch (error) {
      logRadarError('activateVanishMode', error);
      setVisibilityMode('explore');
    }
  };

  useEffect(() => {
    if (!navigator.geolocation) return;

    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (cancelled) return;
        const liveLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(liveLocation);
        userLocationRef.current = liveLocation;
        lastLocationAtRef.current = Date.now();
        persistLastKnownLocation(liveLocation);
        if (visibilityModeRef.current === 'explore') {
          setLocationPrompt(null);
          locationServicesErrorCountRef.current = 0;
        }
      },
      async (error) => {
        if (cancelled) return;
        if (visibilityModeRef.current !== 'explore') return;
        const code = Number((error as GeolocationPositionError)?.code || 0);
        const hasRecentValidLocation =
          Boolean(userLocationRef.current) &&
          Date.now() - lastLocationAtRef.current < RADAR_RECENT_LOCATION_GRACE_MS;

        if ((code === 2 || code === 3) && hasRecentValidLocation) {
          // Ignore transient availability/timeout errors while we still have a fresh location fix.
          locationServicesErrorCountRef.current = 0;
          return;
        }
        if (code === 2 || code === 3) {
          locationServicesErrorCountRef.current += 1;
          const permissionState = await queryGeolocationPermissionState();
          const shouldShowServicesPrompt =
            locationServicesErrorCountRef.current >= 2 &&
            (permissionState !== 'granted' || !userLocationRef.current);
          if (!shouldShowServicesPrompt) {
            return;
          }
        }

        if (code === 1) {
          const permissionState = await queryGeolocationPermissionState();
          if (permissionState === 'denied') {
            setLocationPrompt(getBlockedPermissionPrompt());
          } else {
            setLocationPrompt(toLocationPrompt(error));
          }
        } else {
          setLocationPrompt(toLocationPrompt(error));
        }
        if (!hasRecentValidLocation) {
          setLocationIssue('Location permission is required for Explore Mode.');
          setNearbyUsers([]);
        }
      },
      {
        enableHighAccuracy: false,
        maximumAge: 10000,
        timeout: 10000
      }
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const toggleVisibilityMode = async () => {
    if (isExploreActivationPending) return;
    const newMode = visibilityMode === 'explore' ? 'vanish' : 'explore';

    if (newMode === 'vanish') {
      try {
        await activateVanishMode();
      } catch (error) {
        logRadarError('toggleVisibilityMode:vanish', error);
      }
      return;
    }

    try {
      setIsExploreActivationPending(true);
      const cachedLocation = userLocationRef.current || readLastKnownLocation();
      if (cachedLocation) {
        setUserLocation(cachedLocation);
        userLocationRef.current = cachedLocation;
        lastLocationAtRef.current = Date.now();
        await activateExploreMode(cachedLocation);
        void refreshExploreWithLiveLocation();
      } else {
        const freshLocation = await requestLocationForExploreFlow();
        await activateExploreMode(freshLocation);
      }
    } catch (error) {
      logRadarError('toggleVisibilityMode:explore', error);
      // Keep user in vanish until both permission and live location are available.
      setVisibilityMode('vanish');
      setLocationIssue('Location permission is required for Explore Mode.');
      setNearbyUsers([]);
    } finally {
      setIsExploreActivationPending(false);
    }
  };

  const handleLocationPromptAction = async () => {
    try {
      const freshLocation = await requestLocationForExploreFlow();
      if (visibilityMode === 'explore') {
        await Promise.all([
          updateLocationOnServer(freshLocation, 'explore'),
          refreshNearbyUsersFullRadiusAtomic(freshLocation, { forceRefresh: true })
        ]);
        lastServerSyncAtRef.current = Date.now();
      } else {
        await activateExploreMode(freshLocation);
      }
      setLocationPrompt(null);
    } catch (error) {
      logRadarError('handleLocationPromptAction', error);
    }
  };

  const drawRadar = () => {
    const canvas = canvasRef.current;
    if (!canvas || !userLocation) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2 - 20;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw radar circles with subtle colors
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, (maxRadius / 3) * i, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw crosshair
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.stroke();

    // Draw scanning line with gradient
    const currentTime = Date.now();
    const scanAngle = ((currentTime % RADAR_SCAN_CYCLE_MS) / RADAR_SCAN_CYCLE_MS) * 360;
    const scanRad = (scanAngle * Math.PI) / 180;
    
    const gradient = ctx.createLinearGradient(
      centerX,
      centerY,
      centerX + Math.cos(scanRad) * maxRadius,
      centerY + Math.sin(scanRad) * maxRadius
    );
    gradient.addColorStop(0, 'rgba(0, 150, 255, 0)');
    gradient.addColorStop(0.5, 'rgba(0, 150, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 150, 255, 0.6)');

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(scanRad) * maxRadius,
      centerY + Math.sin(scanRad) * maxRadius
    );
    ctx.stroke();

    // Draw scan arc (trail effect)
    ctx.fillStyle = 'rgba(0, 150, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, maxRadius, scanRad - 0.5, scanRad);
    ctx.closePath();
    ctx.fill();

    // Draw center point (user)
    ctx.fillStyle = '#0096ff';
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#0096ff';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    const sortedUsers = [...filteredUsers].sort((a, b) => a.distance - b.distance);
    const drawableUsers: Array<{
      user: RadarDot;
      x: number;
      y: number;
    }> = [];

    sortedUsers.forEach((user) => {
      const distanceRatio = user.distance / (distanceRange * 1000);
      if (distanceRatio > 1) return;

      const latDiff = user.latitude - userLocation.lat;
      const lngDiff = user.longitude - userLocation.lng;
      const angle = Math.atan2(lngDiff, latDiff);
      
      const radius = distanceRatio * maxRadius;
      const x = centerX + Math.sin(angle) * radius;
      const y = centerY - Math.cos(angle) * radius;
      drawableUsers.push({ user, x, y });
    });

    const isMobile = window.innerWidth <= 768;
    const minimumSpacing = isMobile ? 46 : 38;
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < drawableUsers.length; i++) {
        for (let j = i + 1; j < drawableUsers.length; j++) {
          const a = drawableUsers[i];
          const b = drawableUsers[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          if (distance < minimumSpacing) {
            const push = (minimumSpacing - distance) / 2;
            const nx = dx / distance;
            const ny = dy / distance;
            a.x -= nx * push;
            a.y -= ny * push;
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
    }

    const clampToRadar = (point: { x: number; y: number }, padding: number) => {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      const allowedRadius = Math.max(0, maxRadius - padding);
      if (distanceFromCenter > allowedRadius && distanceFromCenter > 0) {
        const scale = allowedRadius / distanceFromCenter;
        point.x = centerX + dx * scale;
        point.y = centerY + dy * scale;
      }
    };

    // Draw nearby users
    drawableUsers.forEach(({ user, x, y }) => {
      const isFocused = focusedUserId === user.userId;
      const isHovered = hoverLabel?.userId === user.userId;
      const isMobile = window.innerWidth <= 768;
      const baseRadius = isMobile ? 22 : 17;
      const avatarRadius = isHovered || isFocused ? baseRadius + 4 : baseRadius;
      const drawPoint = { x, y };
      clampToRadar(drawPoint, avatarRadius + 2);
      const drawX = drawPoint.x;
      const drawY = drawPoint.y;

      const color = user.gender === 'female' ? '#ff0080' : user.gender === 'male' ? '#0096ff' : '#9ca3af';
      const hasFocusMode = Boolean(focusedUserId);
      ctx.globalAlpha = hasFocusMode && !isFocused ? 0.28 : 1;
      ctx.filter = hasFocusMode && !isFocused ? 'blur(1.5px)' : 'none';

      const avatarImage = getAvatarImage(user);
      ctx.beginPath();
      ctx.arc(drawX, drawY, avatarRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.save();
      ctx.clip();

      if (avatarImage && avatarImage.complete && avatarImage.naturalWidth > 0) {
        ctx.drawImage(avatarImage, drawX - avatarRadius, drawY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(drawX - avatarRadius, drawY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
      }
      ctx.restore();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isMobile ? 3 : 2;
      ctx.beginPath();
      ctx.arc(drawX, drawY, avatarRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = isMobile ? 16 : 12;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(drawX, drawY, avatarRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.filter = 'none';

      (user as any)._canvasX = drawX;
      (user as any)._canvasY = drawY;
      (user as any)._hitRadius = avatarRadius + 8;
    });

    if (focusedUserId) {
      const focusedUser = sortedUsers.find((u) => u.userId === focusedUserId);
      if (focusedUser && (focusedUser as any)._canvasX !== undefined) {
        const x = (focusedUser as any)._canvasX;
        const y = (focusedUser as any)._canvasY;
        const ringColor = focusedUser.gender === 'female' ? '#ff0080' : focusedUser.gender === 'male' ? '#0096ff' : '#64748b';

        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (hoverLabel) {
      const label = hoverLabel.name || 'Unknown User';
      ctx.font = 'bold 12px Arial';
      const textWidth = ctx.measureText(label).width;
      const paddingX = 8;
      const labelWidth = textWidth + paddingX * 2;
      const labelHeight = 22;
      const labelX = hoverLabel.x - labelWidth / 2;
      const labelY = hoverLabel.y - 30;

      ctx.fillStyle = 'rgba(0, 150, 255, 0.95)';
      ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, labelX + paddingX, labelY + 15);
    }

  };

  const getAvatarImage = (user: RadarDot): HTMLImageElement | null => {
    const photoUrl = (user.photo || '').trim();
    if (!photoUrl) return null;

    const cached = imageCacheRef.current.get(user.userId);
    if (cached !== undefined) {
      return cached;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => drawRadar();
    img.onerror = () => {
      imageCacheRef.current.set(user.userId, null);
      drawRadar();
    };
    img.src = photoUrl;
    imageCacheRef.current.set(user.userId, img);
    return img;
  };

  const getCanvasCoordinates = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const findUserAtPoint = (x: number, y: number, hitRadius: number): RadarDot | null => {
    let nearestUser: RadarDot | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const user of filteredUsers) {
      const dotX = (user as any)._canvasX;
      const dotY = (user as any)._canvasY;
      const userHitRadius = (user as any)._hitRadius || hitRadius;
      if (dotX === undefined || dotY === undefined) continue;

      const distance = Math.sqrt((x - dotX) ** 2 + (y - dotY) ** 2);
      if (distance <= Math.max(hitRadius, userHitRadius) && distance < nearestDistance) {
        nearestDistance = distance;
        nearestUser = user;
      }
    }

    return nearestUser;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coords = getCanvasCoordinates(e.clientX, e.clientY);
    if (!coords) return;

    const hitRadius = window.innerWidth <= 768 ? 35 : 22;
    const tappedUser = findUserAtPoint(coords.x, coords.y, hitRadius);
    if (tappedUser) {
      console.log('Clicked on user:', tappedUser.userId, 'Name:', tappedUser.name);
      setSelectedUser({
        userId: tappedUser.userId,
        name: tappedUser.name,
        photo: tappedUser.photo
      });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coords = getCanvasCoordinates(e.clientX, e.clientY);
    if (!coords) return;

    const hitRadius = window.innerWidth <= 768 ? 35 : 28;
    const hoveredUser = findUserAtPoint(coords.x, coords.y, hitRadius);

    // Update cursor and show tooltip
    if (hoveredUser) {
      canvas.style.cursor = 'pointer';
      canvas.title = hoveredUser.name || 'Unknown User';
      const dotX = (hoveredUser as any)._canvasX;
      const dotY = (hoveredUser as any)._canvasY;
      setHoverLabel({
        userId: hoveredUser.userId,
        name: hoveredUser.name || 'Unknown User',
        x: dotX,
        y: dotY
      });
    } else {
      canvas.style.cursor = 'default';
      canvas.title = '';
      setHoverLabel(null);
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') {
      return;
    }

    logRadarDebug('canvas-pointerdown', {
      pointerType: e.pointerType,
      clientX: e.clientX,
      clientY: e.clientY
    });

    const coords = getCanvasCoordinates(e.clientX, e.clientY);
    if (!coords) return;

    const hitRadius = window.innerWidth <= 768 ? 40 : 28;
    const tappedUser = findUserAtPoint(coords.x, coords.y, hitRadius);
    if (tappedUser) {
      setSelectedUser({
        userId: tappedUser.userId,
        name: tappedUser.name,
        photo: tappedUser.photo
      });
    }
  };

  const handleCanvasMouseLeave = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'default';
      canvas.title = '';
    }
    setHoverLabel(null);
  };

  const clearFilters = () => {
    setFilters({
      skills: [],
      profession: '',
      gender: ''
    });
  };

  const usersInRange = [...filteredUsers]
    .filter((user) => user.distance <= distanceRange * 1000)
    .sort((a, b) => a.distance - b.distance);

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.skills.length > 0) count++;
    if (filters.profession) count++;
    if (filters.gender) count++;
    return count;
  };

  return (
    <div className="radar-view">
      {locationPrompt && (
        <div className="radar-location-prompt" role="alertdialog" aria-live="assertive">
          <div className="radar-location-prompt-card">
            <h4>{locationPrompt.title}</h4>
            <p>{locationPrompt.message}</p>
            {locationPrompt.kind === 'blocked' && (
              <div className="radar-permission-settings-hint">
                <span className="radar-permission-settings-icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" focusable="false">
                    <path d="M16 12h18" />
                    <circle cx="26" cy="12" r="4" />
                    <path d="M14 24h20" />
                    <circle cx="19" cy="24" r="4" />
                    <path d="M17 36h17" />
                    <circle cx="29" cy="36" r="4" />
                  </svg>
                </span>
                <span>Site settings -&gt; Permissions -&gt; Location -&gt; Allow</span>
              </div>
            )}
            <div className="radar-location-prompt-actions">
              {locationPrompt.kind !== 'unsupported' && (
                <button type="button" onClick={() => void handleLocationPromptAction()}>
                  {locationPrompt.kind === 'blocked'
                    ? 'Retry After Allow'
                    : visibilityMode === 'explore'
                      ? 'Turn On Location'
                      : 'Retry Explore'}
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => void toggleVisibilityMode()}
              >
                {visibilityMode === 'explore' ? 'Switch to Vanish' : 'Stay in Vanish'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="radar-unified-container">
        {/* Controls Section */}
        <div className="radar-controls">
          <div className="visibility-toggle">
            <label className="toggle-label">
              <span className={visibilityMode === 'explore' || isExploreActivationPending ? 'active' : ''}>
                {isExploreActivationPending
                  ? 'Checking Location...'
                  : visibilityMode === 'explore'
                    ? 'Explore Mode'
                    : 'Vanish Mode'}
              </span>
              <input
                type="checkbox"
                checked={visibilityMode === 'explore' || isExploreActivationPending}
                onChange={toggleVisibilityMode}
                disabled={isExploreActivationPending}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="distance-control">
            <label>
              Distance: {distanceRange} km
              <input
                type="range"
                min="1"
                max="1000"
                value={distanceRange}
                onChange={(e) => setDistanceRange(parseInt(e.target.value))}
                disabled={visibilityMode === 'vanish'}
              />
            </label>
          </div>

          <button
            className="filter-toggle-btn"
            onClick={() => setShowFilters(!showFilters)}
            disabled={visibilityMode === 'vanish'}
          >
            Filters {getActiveFilterCount() > 0 && `(${getActiveFilterCount()})`}
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && visibilityMode === 'explore' && (
          <div className="radar-filter-panel">
            <div className="filter-header">
              <h4>Filter Nearby Users</h4>
              {getActiveFilterCount() > 0 && (
                <button className="clear-filters-btn" onClick={clearFilters}>
                  Clear All
                </button>
              )}
            </div>

            <div className="filter-group">
              <label>Gender</label>
              <select
                value={filters.gender}
                onChange={(e) => setFilters({ ...filters, gender: e.target.value })}
              >
                <option value="">All</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>

            <div className="filter-results-info">
              Showing {filteredUsers.length} of {nearbyUsers.length} users
            </div>
          </div>
        )}

        {/* Radar Canvas Section */}
        <div className="radar-container" ref={radarContainerRef}>
          {visibilityMode === 'vanish' ? (
            <div className="vanish-message">
              <div className="vanish-bee-scene" aria-hidden="true">
                <div className="vanish-bee-aura" />
                <div className="vanish-hex-ripple" />
                <img src="/logo.svg" alt="" className="vanish-bee-logo" />
                <div className="vanish-spark vanish-spark--1" />
                <div className="vanish-spark vanish-spark--2" />
                <div className="vanish-spark vanish-spark--3" />
                <div className="vanish-particle vanish-particle--1" />
                <div className="vanish-particle vanish-particle--2" />
                <div className="vanish-particle vanish-particle--3" />
                <div className="vanish-particle vanish-particle--4" />
                <div className="vanish-particle vanish-particle--5" />
                <div className="vanish-particle vanish-particle--6" />
              </div>
              <div className="vanish-copy">
                <h3>You are in Vanish Mode</h3>
                <p>Switch to Explore Mode when you want to discover people nearby.</p>
              </div>
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                width={700}
                height={700}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMouseMove}
                onPointerDown={handleCanvasPointerDown}
                onMouseLeave={handleCanvasMouseLeave}
                className="radar-canvas"
              />
              {loading && (
                <div className="radar-loading">
                  <LoadingDots label="Updating" />
                </div>
              )}
              {!loading && (radarLoadPhase === 'starting' || isNearbyRefreshing) && (
                <div className="radar-loading">
                  <LoadingDots
                    label={radarLoadPhase === 'starting' ? 'Starting radar' : 'Searching nearby profiles'}
                    className={radarLoadPhase === 'searching' ? 'loading-dots--nowrap' : ''}
                  />
                </div>
              )}
              {!loading && !isNearbyRefreshing && hasFetchedNearbyOnce && filteredUsers.length === 0 && nearbyUsers.length > 0 && (
                <div className="no-users-message">
                  No users match your filters
                </div>
              )}
              {!loading &&
                !isNearbyRefreshing &&
                hasFetchedNearbyOnce &&
                userLocation &&
                usersInRange.length === 0 &&
                getActiveFilterCount() === 0 && (
                <div className="no-users-message">
                  No available profiles. Try increasing distance.
                </div>
              )}
            </>
          )}
        </div>

        {/* Nearby List Section */}
        {visibilityMode === 'explore' && (
          <div className="nearby-list-section">
            <div className="nearby-list-header">
              <h4>Profiles In Range ({usersInRange.length})</h4>
              {focusedUserId && (
                <button
                  className="clear-focus-btn"
                  onClick={() => setFocusedUserId(null)}
                  type="button"
                >
                  Clear Focus
                </button>
              )}
            </div>

            {hasFetchedNearbyOnce && !isNearbyRefreshing && usersInRange.length === 0 ? (
              <div className="nearby-empty">No profiles within current filter and distance.</div>
            ) : (
              <div className="nearby-list" ref={nearbyListRef}>
                {usersInRange.map((user) => {
                  const isFocused = focusedUserId === user.userId;
                  return (
                    <div
                      key={user.userId}
                      className={`nearby-row ${isFocused ? 'focused' : ''}`}
                      onClick={() =>
                        setSelectedUser({
                          userId: user.userId,
                          name: user.name,
                          photo: user.photo
                        })
                      }
                    >
                      <div className="nearby-main">
                        <div className={`nearby-dot ${user.gender === 'female' ? 'female' : user.gender === 'male' ? 'male' : 'other'}`}></div>
                        <div className="nearby-meta">
                          <div className="nearby-name">{user.name || 'Unknown User'}</div>
                          <div className="nearby-distance">{(user.distance / 1000).toFixed(2)} km away</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`eye-focus-btn ${isFocused ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedUserId((prev) => (prev === user.userId ? null : user.userId));
                        }}
                        aria-label={isFocused ? 'Remove focus' : 'Focus on this user'}
                        title={isFocused ? 'Remove Focus' : 'Focus On Radar'}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                          <path
                            d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                          />
                          <circle cx="12" cy="12" r="3.1" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedUser && (
        <ProfilePreviewModal
          userId={selectedUser.userId}
          initialName={selectedUser.name}
          initialPhotoUrl={selectedUser.photo}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
};

export default RadarView;
