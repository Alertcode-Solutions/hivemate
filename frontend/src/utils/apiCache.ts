type ApiCacheEntry = {
  expiresAt: number;
  data: unknown;
};

type FetchJsonCachedOptions = {
  ttlMs?: number;
  forceRefresh?: boolean;
  cacheKey?: string;
};

type ApiRequestError = Error & {
  status?: number;
  responseData?: unknown;
};

const apiCache = new Map<string, ApiCacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

const getHeaderValue = (headers: HeadersInit | undefined, key: string): string => {
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get(key) || '';
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === key.toLowerCase());
    return found ? String(found[1]) : '';
  }
  const record = headers as Record<string, string>;
  return record[key] || record[key.toLowerCase()] || '';
};

const buildCacheKey = (url: string, init?: RequestInit, customCacheKey?: string): string => {
  if (customCacheKey) return customCacheKey;
  const method = String(init?.method || 'GET').toUpperCase();
  const auth = getHeaderValue(init?.headers, 'Authorization');
  const body = typeof init?.body === 'string' ? init.body : '';
  return `${method}:${url}:${auth}:${body}`;
};

export const fetchJsonCached = async <T>(
  url: string,
  init?: RequestInit,
  options?: FetchJsonCachedOptions
): Promise<T> => {
  const ttlMs = Math.max(0, options?.ttlMs ?? 15000);
  const cacheKey = buildCacheKey(url, init, options?.cacheKey);
  const now = Date.now();

  if (!options?.forceRefresh) {
    const cached = apiCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }
  }

  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    return existing as Promise<T>;
  }

  const requestPromise = (async () => {
    const response = await fetch(url, init);
    let parsedData: unknown = null;
    try {
      parsedData = await response.json();
    } catch {
      parsedData = null;
    }

    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`) as ApiRequestError;
      error.status = response.status;
      error.responseData = parsedData;
      throw error;
    }

    apiCache.set(cacheKey, {
      expiresAt: now + ttlMs,
      data: parsedData
    });
    return parsedData as T;
  })();

  inFlightRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
};

export const invalidateApiCacheByUrl = (urlPart: string): void => {
  if (!urlPart) return;
  Array.from(apiCache.keys()).forEach((key) => {
    if (key.includes(urlPart)) {
      apiCache.delete(key);
    }
  });
  Array.from(inFlightRequests.keys()).forEach((key) => {
    if (key.includes(urlPart)) {
      inFlightRequests.delete(key);
    }
  });
};

export const clearApiCache = (): void => {
  apiCache.clear();
  inFlightRequests.clear();
};
