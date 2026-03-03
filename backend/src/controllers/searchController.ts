import { Request, Response } from 'express';
import Profile from '../models/Profile';
import Gig from '../models/Gig';
import User from '../models/User';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const searchProfiles = async (req: Request, res: Response) => {
  try {
    const {
      query,
      username,
      skills,
      profession,
      locations,
      niche,
      distance,
      lat,
      lng,
      page = 1,
      limit = 20
    } = req.body;

    // Build filter
    const baseFilter: any = {};

    if (skills && Array.isArray(skills) && skills.length > 0) {
      baseFilter.skills = { $in: skills };
    }

    if (profession) {
      baseFilter.profession = { $regex: profession, $options: 'i' };
    }

    if (Array.isArray(locations) && locations.length > 0) {
      const normalizedLocations = locations
        .map((location: any) => String(location || '').trim())
        .filter(Boolean);

      if (normalizedLocations.length > 0) {
        baseFilter.place = {
          $in: normalizedLocations.map((location: string) => new RegExp(`^${escapeRegex(location)}$`, 'i'))
        };
      }
    }

    if (niche) {
      // Search in optimized keywords
      baseFilter.optimizedKeywords = { $in: [niche] };
    }

    const searchQuery = String(query || '').trim();
    const usernameQuery = String(username || '').trim().toLowerCase();
    const profileTextFilter =
      searchQuery.length === 1
        ? {
            // Keep 1-letter queries narrow and intentional.
            $or: [{ name: { $regex: `^${escapeRegex(searchQuery)}`, $options: 'i' } }]
          }
        : searchQuery.length > 1
          ? {
              $or: [
                { name: { $regex: escapeRegex(searchQuery), $options: 'i' } },
                { profession: { $regex: escapeRegex(searchQuery), $options: 'i' } },
                { place: { $regex: escapeRegex(searchQuery), $options: 'i' } },
                { bio: { $regex: escapeRegex(searchQuery), $options: 'i' } }
              ]
            }
          : {};

    let usernameMatchedUserIds: string[] = [];
    if (usernameQuery) {
      const matchedUsers = await User.find({
        username: { $regex: `^${escapeRegex(usernameQuery)}`, $options: 'i' }
      })
        .select('_id')
        .limit(50)
        .lean();

      usernameMatchedUserIds = matchedUsers.map((user: any) => user._id.toString());
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    let profiles;
    const branchFilters: any[] = [];

    // If distance filter is provided, use geospatial query
    if (distance && lat && lng) {
      const Location = (await import('../models/Location')).default;
      
      // Find nearby users
      const nearbyLocations = await Location.find({
        coordinates: {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(lng), parseFloat(lat)]
            },
            $maxDistance: parseFloat(distance) * 1000 // Convert km to meters
          }
        },
        mode: 'explore'
      }).select('userId').lean();

      const nearbyUserIds = nearbyLocations.map(loc => loc.userId);

      branchFilters.push({
        ...baseFilter,
        ...profileTextFilter,
        userId: { $in: nearbyUserIds }
      });
    } else {
      branchFilters.push({
        ...baseFilter,
        ...profileTextFilter
      });
    }

    // Username search should ignore distance constraints and still return results.
    if (usernameMatchedUserIds.length > 0) {
      branchFilters.push({
        ...baseFilter,
        userId: { $in: usernameMatchedUserIds }
      });
    }

    const finalFilter = branchFilters.length > 1 ? { $or: branchFilters } : branchFilters[0] || {};
    const [fetchedProfiles, total] = await Promise.all([
      Profile.find(finalFilter)
        .select('-__v')
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Profile.countDocuments(finalFilter)
    ]);
    profiles = fetchedProfiles;

    // Promote exact username matches to top
    if (usernameQuery && profiles.length > 0) {
      profiles = profiles.sort((a: any, b: any) => {
        const aUsername = String(a.username || '').toLowerCase();
        const bUsername = String(b.username || '').toLowerCase();
        const aExact = aUsername === usernameQuery ? 2 : aUsername.startsWith(usernameQuery) ? 1 : 0;
        const bExact = bUsername === usernameQuery ? 2 : bUsername.startsWith(usernameQuery) ? 1 : 0;
        return bExact - aExact;
      });
    }

    // Rank by AI-optimized keywords if niche is provided
    if (niche && profiles.length > 0) {
      profiles = profiles.sort((a: any, b: any) => {
        const aScore = a.optimizedKeywords?.filter((k: string) => 
          k.toLowerCase().includes(niche.toLowerCase())
        ).length || 0;
        const bScore = b.optimizedKeywords?.filter((k: string) => 
          k.toLowerCase().includes(niche.toLowerCase())
        ).length || 0;
        return bScore - aScore;
      });
    }

    res.json({
      profiles,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    console.error('Search profiles error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while searching profiles',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const searchGigs = async (req: Request, res: Response) => {
  try {
    const {
      type,
      skills,
      paymentStatus,
      page = 1,
      limit = 20
    } = req.body;

    // Build filter
    const filter: any = { status: 'open' };

    if (type) {
      filter.type = type;
    }

    if (skills && Array.isArray(skills) && skills.length > 0) {
      filter.skillsRequired = { $in: skills };
    }

    if (paymentStatus) {
      filter.paymentStatus = paymentStatus;
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [gigs, total] = await Promise.all([
      Gig.find(filter)
        .populate('creatorId', 'name profession')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Gig.countDocuments(filter)
    ]);

    res.json({
      gigs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    console.error('Search gigs error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while searching gigs',
        timestamp: new Date().toISOString()
      }
    });
  }
};
