import { Request, Response } from 'express';
import Friendship from '../models/Friendship';
import MatchLike from '../models/MatchLike';
import MatchRelationship from '../models/MatchRelationship';
import MatchUnlikeRequest from '../models/MatchUnlikeRequest';
import Notification from '../models/Notification';
import Message from '../models/Message';
import ChatRoom from '../models/ChatRoom';
import { NotificationService } from '../services/notificationService';

const DAILY_LIKE_LIMIT = 5;
const UNLIKE_COOLDOWN_DAYS = 3;
const REMATCH_BLOCK_DAYS = 15;

const normalizeId = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.toString) return value.toString();
  return String(value);
};

const orderedPair = (user1: string, user2: string) => {
  return user1 < user2
    ? { userAId: user1, userBId: user2 }
    : { userAId: user2, userBId: user1 };
};

const startOfTodayByOffset = (offsetMinutes: number) => {
  const now = new Date();
  const utcNow = now.getTime() + now.getTimezoneOffset() * 60000;
  const targetNow = new Date(utcNow + offsetMinutes * 60000);
  targetNow.setHours(0, 0, 0, 0);
  const targetStartUtc = targetNow.getTime() - offsetMinutes * 60000;
  return new Date(targetStartUtc);
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const clearMatchedPeriodMessages = async (user1Id: string, user2Id: string, matchStart: Date, matchEnd: Date) => {
  const personalRooms = await ChatRoom.find({
    type: 'personal',
    participants: { $all: [user1Id, user2Id] }
  }).select('_id');

  const roomIds = personalRooms.map((room: any) => room._id);

  await Message.deleteMany({
    chatRoomId: { $in: roomIds },
    timestamp: { $gte: matchStart, $lte: matchEnd }
  });

  await Notification.deleteMany({
    userId: { $in: [user1Id, user2Id] },
    type: 'message',
    $or: [{ 'data.chatRoomId': { $in: roomIds } }, { 'data.senderId': { $in: [user1Id, user2Id] } }]
  });
};

const finalizeUnmatch = async (match: any, reason: 'mutual_unlike' | 'auto_unlike_timeout') => {
  if (!match || match.status !== 'active') return;

  const now = new Date();
  const matchedAt = match.matchedAt || match.createdAt || now;

  match.status = 'unmatched';
  match.unmatchedAt = now;
  match.rematchBlockedUntil = addDays(now, REMATCH_BLOCK_DAYS);
  await match.save();

  await clearMatchedPeriodMessages(
    normalizeId(match.userAId),
    normalizeId(match.userBId),
    matchedAt,
    now
  );

  await MatchUnlikeRequest.updateMany(
    { matchId: match._id },
    { $set: { pending: false, autoUnmatchAt: null, nextAllowedAt: null } }
  );

  await MatchLike.updateMany(
    {
      $or: [
        { senderId: normalizeId(match.userAId), receiverId: normalizeId(match.userBId) },
        { senderId: normalizeId(match.userBId), receiverId: normalizeId(match.userAId) }
      ]
    },
    { $set: { isActive: false } }
  );

  return { reason, unmatchedAt: now, rematchBlockedUntil: match.rematchBlockedUntil };
};

const processAutoUnmatchIfNeeded = async (match: any) => {
  if (!match || match.status !== 'active') return null;
  const now = new Date();
  const thirdPending = await MatchUnlikeRequest.findOne({
    matchId: match._id,
    pending: true,
    attemptsUsed: { $gte: 3 },
    autoUnmatchAt: { $lte: now }
  });
  if (!thirdPending) return null;
  return finalizeUnmatch(match, 'auto_unlike_timeout');
};

const ensureConnected = async (userId: string, targetUserId: string) => {
  const friendship = await Friendship.findOne({
    blocked: false,
    $or: [
      { user1Id: userId, user2Id: targetUserId },
      { user1Id: targetUserId, user2Id: userId }
    ]
  }).lean();
  return Boolean(friendship);
};

const toLocalDateString = (req: Request) => {
  const provided = String(req.body?.localDate || req.headers['x-local-date'] || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(provided)) return provided;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const getTimezoneOffsetMinutes = (req: Request) => {
  const raw = Number(req.body?.tzOffsetMinutes ?? req.headers['x-tz-offset-minutes']);
  if (!Number.isFinite(raw)) return -new Date().getTimezoneOffset();
  return raw;
};

export const getMatchStatus = async (req: Request, res: Response) => {
  try {
    const userId = normalizeId((req as any).userId);
    const targetUserId = normalizeId(req.params.userId);

    if (!targetUserId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Target user ID is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (userId === targetUserId) {
      return res.json({
        connected: false,
        canLike: false,
        likedByMe: false,
        likedByOther: false,
        isMatched: false
      });
    }

    const connected = await ensureConnected(userId, targetUserId);
    if (!connected) {
      return res.json({
        connected: false,
        canLike: false,
        likedByMe: false,
        likedByOther: false,
        isMatched: false
      });
    }

    const { userAId, userBId } = orderedPair(userId, targetUserId);
    let match = await MatchRelationship.findOne({ userAId, userBId });
    if (match?.status === 'active') {
      await processAutoUnmatchIfNeeded(match);
      match = await MatchRelationship.findOne({ userAId, userBId });
    }

    const [myLike, theirLike, unlikeRequest] = await Promise.all([
      MatchLike.findOne({ senderId: userId, receiverId: targetUserId, isActive: true }).lean(),
      MatchLike.findOne({ senderId: targetUserId, receiverId: userId, isActive: true }).lean(),
      match?.status === 'active'
        ? MatchUnlikeRequest.findOne({
            matchId: match._id,
            pending: true,
            $or: [{ requesterId: userId }, { responderId: userId }]
          }).lean()
        : Promise.resolve(null as any)
    ]);

    const isMatched = Boolean(match && match.status === 'active');

    return res.json({
      connected: true,
      canLike: true,
      likedByMe: Boolean(myLike),
      likedByOther: isMatched ? Boolean(theirLike) : false,
      isMatched,
      heartVisible: isMatched,
      match: isMatched
        ? {
            matchedAt: match?.matchedAt,
            status: match?.status
          }
        : null,
      unlikeRequest: unlikeRequest
        ? {
            requesterId: normalizeId(unlikeRequest.requesterId),
            responderId: normalizeId(unlikeRequest.responderId),
            attemptsUsed: unlikeRequest.attemptsUsed,
            pending: unlikeRequest.pending,
            nextAllowedAt: unlikeRequest.nextAllowedAt,
            autoUnmatchAt: unlikeRequest.autoUnmatchAt
          }
        : null
    });
  } catch (error: any) {
    console.error('Get match status error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching match status',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const sendLike = async (req: Request, res: Response) => {
  try {
    const userId = normalizeId((req as any).userId);
    const targetUserId = normalizeId(req.params.userId);
    const localDate = toLocalDateString(req);
    const tzOffsetMinutes = getTimezoneOffsetMinutes(req);

    if (!targetUserId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Target user ID is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (userId === targetUserId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'You cannot like your own profile',
          timestamp: new Date().toISOString()
        }
      });
    }

    const connected = await ensureConnected(userId, targetUserId);
    if (!connected) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Like is available only for connected users',
          timestamp: new Date().toISOString()
        }
      });
    }

    const { userAId, userBId } = orderedPair(userId, targetUserId);
    const relationshipRecord = await MatchRelationship.findOne({ userAId, userBId }).lean();
    const now = new Date();
    if (
      relationshipRecord?.status === 'unmatched' &&
      relationshipRecord.rematchBlockedUntil &&
      relationshipRecord.rematchBlockedUntil > now
    ) {
      return res.status(403).json({
        error: {
          code: 'REMATCH_BLOCKED',
          message: 'Rematch is allowed only after cooldown period',
          timestamp: new Date().toISOString()
        }
      });
    }

    const existingLike = await MatchLike.findOne({
      senderId: userId,
      receiverId: targetUserId,
      isActive: true
    }).lean();

    if (!existingLike) {
      const dayStart = startOfTodayByOffset(tzOffsetMinutes);
      const todayCount = await MatchLike.countDocuments({
        senderId: userId,
        isActive: true,
        updatedAt: { $gte: dayStart }
      });

      if (todayCount >= DAILY_LIKE_LIMIT) {
        return res.status(429).json({
          error: {
            code: 'DAILY_LIKE_LIMIT_REACHED',
            message: 'Daily like limit reached (5 profiles per day)',
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    await MatchLike.findOneAndUpdate(
      { senderId: userId, receiverId: targetUserId },
      { $set: { isActive: true, localDate } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const reciprocalLike = await MatchLike.findOne({
      senderId: targetUserId,
      receiverId: userId,
      isActive: true
    }).lean();

    let matchCreated = false;
    let matchData: any = null;

    if (reciprocalLike) {
      const existingMatch = await MatchRelationship.findOne({ userAId, userBId });

      if (existingMatch?.status === 'active') {
        matchData = existingMatch;
      } else if (
        existingMatch?.status === 'unmatched' &&
        existingMatch.rematchBlockedUntil &&
        existingMatch.rematchBlockedUntil > now
      ) {
        return res.status(403).json({
          error: {
            code: 'REMATCH_BLOCKED',
            message: 'Rematch is allowed only after cooldown period',
            timestamp: new Date().toISOString()
          }
        });
      } else {
        const match = await MatchRelationship.findOneAndUpdate(
          { userAId, userBId },
          {
            $set: {
              status: 'active',
              matchedAt: now,
              unmatchedAt: null,
              rematchBlockedUntil: null
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await MatchUnlikeRequest.deleteMany({ matchId: match._id });

        matchCreated = true;
        matchData = match;

        await Promise.all([
          NotificationService.createNotification(
            userId,
            'match',
            'Profile Matched 💖',
            'Profile Matched 💖',
            { withUserId: targetUserId, type: 'match' }
          ),
          NotificationService.createNotification(
            targetUserId,
            'match',
            'Profile Matched 💖',
            'Profile Matched 💖',
            { withUserId: userId, type: 'match' }
          )
        ]);
      }
    }

    return res.json({
      message: reciprocalLike ? 'Mutual like detected' : 'Profile liked privately',
      liked: true,
      matchCreated,
      isMatched: Boolean(matchData && matchData.status === 'active')
    });
  } catch (error: any) {
    console.error('Send like error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while sending like',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const unlikeOrRequestBreak = async (req: Request, res: Response) => {
  try {
    const userId = normalizeId((req as any).userId);
    const targetUserId = normalizeId(req.params.userId);

    if (!targetUserId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Target user ID is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (userId === targetUserId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid unlike request',
          timestamp: new Date().toISOString()
        }
      });
    }

    const { userAId, userBId } = orderedPair(userId, targetUserId);
    const match = await MatchRelationship.findOne({ userAId, userBId });

    if (!match || match.status !== 'active') {
      await MatchLike.findOneAndUpdate(
        { senderId: userId, receiverId: targetUserId },
        { $set: { isActive: false } },
        { new: true }
      );
      return res.json({
        message: 'Like removed',
        isMatched: false,
        unmatchTriggered: false
      });
    }

    const autoResult = await processAutoUnmatchIfNeeded(match);
    if (autoResult) {
      return res.json({
        message: 'Match ended automatically',
        isMatched: false,
        unmatchTriggered: true,
        reason: autoResult.reason
      });
    }

    const reciprocalPending = await MatchUnlikeRequest.findOne({
      matchId: match._id,
      requesterId: targetUserId,
      responderId: userId,
      pending: true
    });

    if (reciprocalPending) {
      const result = await finalizeUnmatch(match, 'mutual_unlike');
      return res.json({
        message: 'Match ended immediately',
        isMatched: false,
        unmatchTriggered: true,
        reason: result?.reason || 'mutual_unlike'
      });
    }

    const now = new Date();
    let requestDoc = await MatchUnlikeRequest.findOne({
      matchId: match._id,
      requesterId: userId,
      responderId: targetUserId
    });

    if (!requestDoc) {
      requestDoc = new MatchUnlikeRequest({
        matchId: match._id,
        requesterId: userId,
        responderId: targetUserId,
        attemptsUsed: 0,
        pending: false
      });
    }

    if (requestDoc.pending) {
      return res.status(409).json({
        error: {
          code: 'UNLIKE_ALREADY_PENDING',
          message: 'Unlike request already pending',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (requestDoc.nextAllowedAt && requestDoc.nextAllowedAt > now) {
      return res.status(429).json({
        error: {
          code: 'UNLIKE_WAIT_REQUIRED',
          message: 'Next unlike request is not available yet',
          details: { nextAllowedAt: requestDoc.nextAllowedAt },
          timestamp: new Date().toISOString()
        }
      });
    }

    const nextAttempt = Number(requestDoc.attemptsUsed || 0) + 1;
    if (nextAttempt > 3) {
      return res.status(429).json({
        error: {
          code: 'UNLIKE_ATTEMPTS_EXHAUSTED',
          message: 'Unlike attempts exhausted',
          timestamp: new Date().toISOString()
        }
      });
    }

    requestDoc.attemptsUsed = nextAttempt;
    requestDoc.pending = true;
    requestDoc.lastRequestedAt = now;
    requestDoc.nextAllowedAt = addDays(now, UNLIKE_COOLDOWN_DAYS);
    requestDoc.autoUnmatchAt = nextAttempt === 3 ? addDays(now, UNLIKE_COOLDOWN_DAYS) : undefined;
    await requestDoc.save();

    await NotificationService.createNotification(
      targetUserId,
      'match_unlike',
      'Match update request',
      'Your match partner wants to end the match',
      {
        requesterId: userId,
        targetUserId,
        attemptsUsed: nextAttempt,
        type: 'match_unlike'
      }
    );

    return res.json({
      message:
        nextAttempt === 3
          ? 'Final unlike request sent. Match will end automatically if ignored.'
          : 'Unlike request sent',
      isMatched: true,
      unlikeRequest: {
        attemptsUsed: nextAttempt,
        pending: true,
        nextAllowedAt: requestDoc.nextAllowedAt,
        autoUnmatchAt: requestDoc.autoUnmatchAt
      }
    });
  } catch (error: any) {
    console.error('Unlike request error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while processing unlike request',
        timestamp: new Date().toISOString()
      }
    });
  }
};
