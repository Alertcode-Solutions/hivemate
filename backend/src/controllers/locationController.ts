import { Request, Response } from 'express';
import { LocationService } from '../services/locationService';
import Profile from '../models/Profile';
import { getWebSocketServer } from '../websocket/server';
import { CacheService } from '../services/cacheService';

const extractUserId = (locationUserId: any): string => {
  if (!locationUserId) return '';
  if (typeof locationUserId === 'string') return locationUserId;
  if (locationUserId._id) return locationUserId._id.toString();
  return locationUserId.toString();
};

const getRadarResponseCachePrecision = (radiusInMeters: number): number => {
  if (radiusInMeters >= 1000000) return 2; // 1000km fetches
  if (radiusInMeters >= 100000) return 3;
  return 4;
};

const getRadarResponseCacheTtlSeconds = (radiusInMeters: number): number => {
  if (radiusInMeters >= 1000000) return 45;
  if (radiusInMeters >= 100000) return 25;
  return 20;
};

const buildRadarResponseCacheKey = (
  userId: string,
  latitude: number,
  longitude: number,
  minRadiusInMeters: number,
  radiusInMeters: number
): string => {
  const precision = getRadarResponseCachePrecision(radiusInMeters);
  return [
    'nearby:response',
    userId,
    latitude.toFixed(precision),
    longitude.toFixed(precision),
    minRadiusInMeters,
    radiusInMeters
  ].join(':');
};

export const updateLocation = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { latitude, longitude, accuracy, mode } = req.body;


    // Validation
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Latitude and longitude are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (!mode || !['explore', 'vanish'].includes(mode)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MODE',
          message: 'Mode must be either "explore" or "vanish"',
          timestamp: new Date().toISOString()
        }
      });
    }

    const profile = await Profile.findOne({ userId })
      .select('name gender photos')
      .lean();

    // Update location
    await LocationService.updateLocation(
      userId,
      latitude,
      longitude,
      accuracy || 0,
      mode,
      {
        name: profile?.name || '',
        gender: profile?.gender || '',
        photo: Array.isArray(profile?.photos) && profile.photos.length > 0 ? profile.photos[0] : ''
      }
    );


    res.json({
      message: 'Location updated successfully',
      location: {
        latitude,
        longitude,
        mode,
        timestamp: new Date()
      }
    });

    // Broadcast location update in background so API response is not delayed.
    void (async () => {
      try {
        const wsServer = getWebSocketServer();

        const nearbyLocations = await LocationService.getNearbyUsers(
          latitude,
          longitude,
          5000, // 5km radius for notifications
          userId
        );

        const nearbyUserIds = nearbyLocations
          .map(loc => extractUserId(loc.userId))
          .filter(Boolean);

        wsServer.emitToUsers(nearbyUserIds, 'radar:update', {
          userId,
          latitude,
          longitude,
          mode,
          timestamp: new Date()
        });
      } catch (wsError) {
        console.error('WebSocket broadcast error:', wsError);
      }
    })();
  } catch (error: any) {
    if (error.message.includes('too frequent')) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }

    console.error('Location update error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while updating location',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getNearbyUsers = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { lat, lng, radius, minRadius } = req.query;


    // Validation
    if (!lat || !lng) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Latitude (lat) and longitude (lng) are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const radiusInMeters = radius ? parseInt(radius as string) : 5000; // Default 5km
    const minRadiusInMeters = minRadius ? Math.max(0, parseInt(minRadius as string)) : 0;

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_COORDINATES',
          message: 'Invalid latitude or longitude',
          timestamp: new Date().toISOString()
        }
      });
    }

    const responseCacheKey = buildRadarResponseCacheKey(
      String(userId),
      latitude,
      longitude,
      minRadiusInMeters,
      radiusInMeters
    );
    const cachedResponse = await CacheService.get<{
      nearbyUsers: any[];
      total: number;
      radius: number;
    }>(responseCacheKey);
    if (cachedResponse) {
      return res.json(cachedResponse);
    }


    // Get nearby users
    const nearbyLocations = await LocationService.getNearbyUsers(
      latitude,
      longitude,
      radiusInMeters,
      userId,
      minRadiusInMeters
    );

    const missingProfileUserIds = nearbyLocations
      .filter((location: any) => !String(location.profileName || '').trim())
      .map((location: any) => extractUserId(location.userId))
      .filter(Boolean);
    const fallbackProfiles = missingProfileUserIds.length
      ? await Profile.find(
          { userId: { $in: missingProfileUserIds } },
          { userId: 1, name: 1, gender: 1, photos: 1 }
        ).lean()
      : [];
    const fallbackProfileByUserId = new Map(
      fallbackProfiles.map((profile: any) => [String(profile.userId), profile])
    );


    // Build radar dots
    const radarDots = nearbyLocations.map((location: any) => {
      const locationUserId = extractUserId(location.userId);
      if (!locationUserId) return null;
      const fallbackProfile = fallbackProfileByUserId.get(locationUserId);
      const resolvedName = String(location.profileName || fallbackProfile?.name || '').trim();
      if (!resolvedName) {
        // Drop entries without a valid profile name instead of showing "Unknown User".
        return null;
      }
      const [lng, lat] = location.coordinates.coordinates;
      const distance = LocationService.calculateDistance(
        latitude,
        longitude,
        lat,
        lng
      );

      return {
        userId: locationUserId, // Properly converted to string
        distance: Math.round(distance),
        gender: location.profileGender || fallbackProfile?.gender || 'other',
        coordinates: {
          latitude: lat,
          longitude: lng
        },
        name: resolvedName,
        photo:
          location.profilePhoto ||
          (Array.isArray(fallbackProfile?.photos) && fallbackProfile.photos.length > 0
            ? fallbackProfile.photos[0]
            : '')
      };
    }).filter(Boolean);

    const responsePayload = {
      nearbyUsers: radarDots,
      total: radarDots.length,
      minRadius: minRadiusInMeters,
      radius: radiusInMeters
    };

    // Keep short-lived payload cache for rapid radar refreshes.
    await CacheService.set(
      responseCacheKey,
      responsePayload,
      getRadarResponseCacheTtlSeconds(radiusInMeters)
    );
    res.json(responsePayload);
  } catch (error: any) {
    console.error('Get nearby users error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching nearby users',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const toggleVisibilityMode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { mode } = req.body;

    if (!mode || !['explore', 'vanish'].includes(mode)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MODE',
          message: 'Mode must be either "explore" or "vanish"',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Get current location
    const location = await LocationService.getUserLocation(userId);
    
    if (!location) {
      return res.status(404).json({
        error: {
          code: 'LOCATION_NOT_FOUND',
          message: 'Please update your location first',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Update mode immediately without location cooldown blocking this change
    const [lng, lat] = location.coordinates.coordinates;
    await LocationService.updateVisibilityMode(userId, mode);

    res.json({
      message: 'Visibility mode updated successfully',
      mode,
      timestamp: new Date()
    });

    // Notify clients in background so mode toggle itself remains immediate.
    void (async () => {
      try {
        const wsServer = getWebSocketServer();
        wsServer.broadcast('user:visibility:changed', {
          userId,
          mode,
          timestamp: new Date()
        });

        if (mode !== 'explore') {
          return;
        }

        const nearbyLocations = await LocationService.getNearbyUsers(
          lat,
          lng,
          5000, // 5km radius
          userId
        );

        const profile = await Profile.findOne({ userId }).select('name').lean();
        const nearbyUserIds = nearbyLocations
          .map(loc => extractUserId(loc.userId))
          .filter(Boolean);

        wsServer.emitToUsers(nearbyUserIds, 'nearby:notification', {
          userId,
          name: profile?.name || 'Someone',
          distance: 'nearby',
          timestamp: new Date()
        });
      } catch (wsError) {
        console.error('WebSocket notification error:', wsError);
      }
    })();
  } catch (error: any) {
    console.error('Toggle visibility error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while updating visibility mode',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getCurrentVisibilityMode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const location = await LocationService.getUserLocation(userId);

    if (!location) {
      return res.status(404).json({
        error: {
          code: 'LOCATION_NOT_FOUND',
          message: 'Location not found for user',
          timestamp: new Date().toISOString()
        }
      });
    }

    res.json({
      mode: location.mode,
      updatedAt: location.timestamp
    });
  } catch (error: any) {
    console.error('Get current visibility mode error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching visibility mode',
        timestamp: new Date().toISOString()
      }
    });
  }
};
