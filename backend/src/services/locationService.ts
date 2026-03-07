import Location from '../models/Location';
import redis from '../config/redis';
import { CacheService } from './cacheService';

const LOCATION_UPDATE_COOLDOWN = 10; // seconds

export class LocationService {
  /**
   * Update user location
   */
  static async updateLocation(
    userId: string,
    latitude: number,
    longitude: number,
    accuracy: number,
    mode: 'explore' | 'vanish'
  ): Promise<void> {
    // Check rate limiting
    const cooldownKey = `location:cooldown:${userId}`;
    const inCooldown = await redis.get(cooldownKey);
    
    if (inCooldown) {
      throw new Error('Location update too frequent. Please wait a few seconds.');
    }

    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
      throw new Error('Invalid latitude. Must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Invalid longitude. Must be between -180 and 180');
    }

    // Update or create location
    await Location.findOneAndUpdate(
      { userId },
      {
        userId,
        coordinates: {
          type: 'Point',
          coordinates: [longitude, latitude] // GeoJSON format: [lng, lat]
        },
        mode,
        timestamp: new Date(),
        accuracy
      },
      { upsert: true, new: true }
    );

    // Nearby cache has a short TTL; invalidate asynchronously to avoid blocking updates.
    void CacheService.deletePattern('nearby:*');

    // Set cooldown
    await redis.setex(cooldownKey, LOCATION_UPDATE_COOLDOWN, '1');
  }

  /**
   * Update only visibility mode without coordinate update cooldown.
   * Used by explicit mode toggles so vanish/explore switches are immediate.
   */
  static async updateVisibilityMode(
    userId: string,
    mode: 'explore' | 'vanish'
  ): Promise<void> {
    await Location.findOneAndUpdate(
      { userId },
      {
        mode,
        timestamp: new Date()
      },
      { new: true }
    );

    // Nearby cache has a short TTL; invalidate asynchronously to avoid blocking mode toggles.
    void CacheService.deletePattern('nearby:*');
  }

  /**
   * Get user's current location
   */
  static async getUserLocation(userId: string) {
    return await Location.findOne({ userId });
  }

  /**
   * Get nearby users within radius (in meters)
   * Uses caching to optimize repeated queries
   */
  static async getNearbyUsers(
    latitude: number,
    longitude: number,
    radiusInMeters: number,
    excludeUserId?: string
  ): Promise<any[]> {
    // Try to get from cache first
    const cacheKey = `nearby:${latitude.toFixed(4)}:${longitude.toFixed(4)}:${radiusInMeters}:${excludeUserId || 'all'}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) {
      return cached as any[];
    }

    // Query database if not in cache
    const query: any = {
      coordinates: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: radiusInMeters
        }
      },
      mode: 'explore' // Only show users in explore mode
    };

    if (excludeUserId) {
      query.userId = { $ne: excludeUserId };
    }

    const results = await Location.find(query)
      .select('userId coordinates mode timestamp')
      .lean() // Use lean() for better performance
      .limit(100); // Limit results to prevent excessive data

    // Cache the results
    await CacheService.set(cacheKey, results, 30); // 30 seconds TTL

    return results;
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  static calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Delete user location (when user deletes account)
   */
  static async deleteUserLocation(userId: string): Promise<void> {
    await Location.deleteOne({ userId });
  }
}
