import { Request, Response } from 'express';
import Gig from '../models/Gig';
import { validateGig } from '../utils/validation';
import { CacheService } from '../services/cacheService';

const normalizeQueryObject = (query: Request['query']) => {
  const normalized: Record<string, any> = {};
  Object.keys(query)
    .sort()
    .forEach((key) => {
      const value = query[key];
      normalized[key] = Array.isArray(value) ? [...value].sort() : value;
    });
  return normalized;
};

export const createGig = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const gigData = req.body;

    // Validate gig data
    const validation = validateGig(gigData);
    if (!validation.valid) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid gig data',
          details: validation.errors,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Create gig
    const gig = new Gig({
      creatorId: userId,
      title: gigData.title,
      description: gigData.description,
      skillsRequired: gigData.skillsRequired,
      type: gigData.type,
      paymentStatus: gigData.paymentStatus,
      location: gigData.location,
      duration: gigData.duration,
      compensation: gigData.compensation,
      applicationDeadline: gigData.applicationDeadline
    });

    await gig.save();
    await CacheService.invalidateGigLists();
    await CacheService.deletePattern('search:gigs:*');

    res.status(201).json({
      message: 'Gig created successfully',
      gig: {
        id: gig._id,
        title: gig.title,
        description: gig.description,
        skillsRequired: gig.skillsRequired,
        type: gig.type,
        paymentStatus: gig.paymentStatus,
        status: gig.status,
        createdAt: gig.createdAt
      }
    });
  } catch (error: any) {
    console.error('Create gig error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while creating gig',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getGigs = async (req: Request, res: Response) => {
  try {
    const cacheHash = CacheService.generateQueryHash({
      type: 'gig-list',
      query: normalizeQueryObject(req.query)
    });
    const cached = await CacheService.getGigList(cacheHash);
    if (cached) {
      return res.json(cached);
    }

    const { type, paymentStatus, status, skills, page = 1, limit = 20 } = req.query;
    
    // Build filter
    const filter: any = {};
    
    if (type) {
      filter.type = type;
    }
    
    if (paymentStatus) {
      filter.paymentStatus = paymentStatus;
    }
    
    if (status) {
      filter.status = status;
    } else {
      // Default to showing only open gigs
      filter.status = 'open';
    }
    
    if (skills) {
      const skillsArray = typeof skills === 'string' ? skills.split(',') : skills;
      filter.skillsRequired = { $in: skillsArray };
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

    const payload = {
      gigs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    };

    await CacheService.setGigList(cacheHash, payload);
    res.json(payload);
  } catch (error: any) {
    console.error('Get gigs error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching gigs',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getGigById = async (req: Request, res: Response) => {
  try {
    const { gigId } = req.params;
    const gigCacheKey = `gig:${gigId}`;
    const cachedGig = await CacheService.get(gigCacheKey);
    if (cachedGig) {
      return res.json(cachedGig);
    }

    const gig = await Gig.findById(gigId)
      .populate('creatorId', 'name profession bio photo')
      .populate('acceptedApplicants', 'name profession')
      .lean();

    if (!gig) {
      return res.status(404).json({
        error: {
          code: 'GIG_NOT_FOUND',
          message: 'Gig not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const payload = { gig };
    await CacheService.set(gigCacheKey, payload, 120);
    res.json(payload);
  } catch (error: any) {
    console.error('Get gig error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching gig',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const updateGig = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { gigId } = req.params;
    const updates = req.body;

    const gig = await Gig.findById(gigId);

    if (!gig) {
      return res.status(404).json({
        error: {
          code: 'GIG_NOT_FOUND',
          message: 'Gig not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if user is the creator
    if (gig.creatorId.toString() !== userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the gig creator can update this gig',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Update allowed fields
    const allowedUpdates = [
      'title', 'description', 'skillsRequired', 'type', 'paymentStatus',
      'location', 'duration', 'compensation', 'applicationDeadline', 'status'
    ];

    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        (gig as any)[field] = updates[field];
      }
    });

    await gig.save();
    await CacheService.invalidateGigLists();
    await CacheService.delete(`gig:${gigId}`);
    await CacheService.deletePattern('search:gigs:*');

    res.json({
      message: 'Gig updated successfully',
      gig: {
        id: gig._id,
        title: gig.title,
        description: gig.description,
        status: gig.status
      }
    });
  } catch (error: any) {
    console.error('Update gig error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while updating gig',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const deleteGig = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { gigId } = req.params;

    const gig = await Gig.findById(gigId);

    if (!gig) {
      return res.status(404).json({
        error: {
          code: 'GIG_NOT_FOUND',
          message: 'Gig not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if user is the creator
    if (gig.creatorId.toString() !== userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the gig creator can delete this gig',
          timestamp: new Date().toISOString()
        }
      });
    }

    await Gig.findByIdAndDelete(gigId);
    await CacheService.invalidateGigLists();
    await CacheService.delete(`gig:${gigId}`);
    await CacheService.deletePattern('search:gigs:*');

    res.json({
      message: 'Gig deleted successfully'
    });
  } catch (error: any) {
    console.error('Delete gig error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while deleting gig',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getMyGigs = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const gigs = await Gig.find({ creatorId: userId })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ gigs });
  } catch (error: any) {
    console.error('Get my gigs error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching your gigs',
        timestamp: new Date().toISOString()
      }
    });
  }
};


export const applyToGig = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { gigId } = req.params;
    const { coverLetter } = req.body;

    const gig = await Gig.findById(gigId);

    if (!gig) {
      return res.status(404).json({
        error: {
          code: 'GIG_NOT_FOUND',
          message: 'Gig not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if gig is open
    if (gig.status !== 'open') {
      return res.status(400).json({
        error: {
          code: 'GIG_CLOSED',
          message: 'This gig is no longer accepting applications',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if user is the creator
    if (gig.creatorId.toString() === userId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_APPLICATION',
          message: 'Cannot apply to your own gig',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if already applied
    const GigApplication = (await import('../models/GigApplication')).default;
    const existingApplication = await GigApplication.findOne({
      gigId,
      applicantId: userId
    });

    if (existingApplication) {
      return res.status(409).json({
        error: {
          code: 'ALREADY_APPLIED',
          message: 'You have already applied to this gig',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Create application
    const application = new GigApplication({
      gigId,
      applicantId: userId,
      coverLetter,
      status: 'pending'
    });

    await application.save();

    // Add applicant to gig
    gig.applicants.push(userId as any);
    await gig.save();
    await CacheService.invalidateGigLists();
    await CacheService.delete(`gig:${gigId}`);
    await CacheService.deletePattern('search:gigs:*');

    res.status(201).json({
      message: 'Application submitted successfully',
      application: {
        id: application._id,
        status: application.status,
        appliedAt: application.appliedAt
      }
    });
  } catch (error: any) {
    console.error('Apply to gig error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while applying to gig',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getGigApplications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { gigId } = req.params;

    const gig = await Gig.findById(gigId);

    if (!gig) {
      return res.status(404).json({
        error: {
          code: 'GIG_NOT_FOUND',
          message: 'Gig not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if user is the creator
    if (gig.creatorId.toString() !== userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the gig creator can view applications',
          timestamp: new Date().toISOString()
        }
      });
    }

    const GigApplication = (await import('../models/GigApplication')).default;
    const applications = await GigApplication.find({ gigId })
      .populate('applicantId', 'name profession bio photo skills')
      .sort({ appliedAt: -1 })
      .lean();

    res.json({ applications });
  } catch (error: any) {
    console.error('Get applications error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching applications',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const respondToApplication = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { gigId, applicationId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ACTION',
          message: 'Action must be either accept or reject',
          timestamp: new Date().toISOString()
        }
      });
    }

    const gig = await Gig.findById(gigId);

    if (!gig) {
      return res.status(404).json({
        error: {
          code: 'GIG_NOT_FOUND',
          message: 'Gig not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if user is the creator
    if (gig.creatorId.toString() !== userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the gig creator can respond to applications',
          timestamp: new Date().toISOString()
        }
      });
    }

    const GigApplication = (await import('../models/GigApplication')).default;
    const application = await GigApplication.findById(applicationId);

    if (!application || application.gigId.toString() !== gigId) {
      return res.status(404).json({
        error: {
          code: 'APPLICATION_NOT_FOUND',
          message: 'Application not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Update application status
    application.status = action === 'accept' ? 'accepted' : 'rejected';
    application.respondedAt = new Date();
    await application.save();

    // If accepted, add to acceptedApplicants and create group chat
    if (action === 'accept') {
      gig.acceptedApplicants.push(application.applicantId);
      await gig.save();

      // Create group chat room for the gig
      const ChatRoom = (await import('../models/ChatRoom')).default;
      let chatRoom = await ChatRoom.findOne({ gigId: gig._id });

      if (!chatRoom) {
        chatRoom = new ChatRoom({
          type: 'group',
          participants: [gig.creatorId, application.applicantId],
          gigId: gig._id
        });
      } else {
        // Add new participant if not already in the chat
        if (!chatRoom.participants.includes(application.applicantId as any)) {
          chatRoom.participants.push(application.applicantId as any);
        }
      }

      await chatRoom.save();
    }

    await CacheService.invalidateGigLists();
    await CacheService.delete(`gig:${gigId}`);
    await CacheService.deletePattern('search:gigs:*');

    res.json({
      message: `Application ${action}ed successfully`,
      application: {
        id: application._id,
        status: application.status
      }
    });
  } catch (error: any) {
    console.error('Respond to application error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while responding to application',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getMyApplications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const GigApplication = (await import('../models/GigApplication')).default;
    const applications = await GigApplication.find({ applicantId: userId })
      .populate('gigId')
      .sort({ appliedAt: -1 })
      .lean();

    res.json({ applications });
  } catch (error: any) {
    console.error('Get my applications error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching your applications',
        timestamp: new Date().toISOString()
      }
    });
  }
};
