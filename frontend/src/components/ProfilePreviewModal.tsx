import { useState, useEffect, useRef, type SyntheticEvent, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { goToProfile, resolveProfileTarget } from '../utils/profileRouting';
import { fetchJsonCached, invalidateApiCacheByUrl } from '../utils/apiCache';
import LoadingDots from './LoadingDots';
import './ProfilePreviewModal.css';

interface ProfilePreviewModalProps {
  userId: string;
  initialPhotoUrl?: string;
  initialName?: string;
  onClose: () => void;
}

type RelationshipStatus = 'none' | 'request_sent' | 'request_received' | 'connected';
type MatchStatus = {
  canLike: boolean;
  likedByMe: boolean;
  likedByOther: boolean;
  isMatched: boolean;
  heartVisible?: boolean;
};

const ProfilePreviewModal = ({
  userId,
  initialPhotoUrl,
  initialName,
  onClose
}: ProfilePreviewModalProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [relationshipStatus, setRelationshipStatus] = useState<RelationshipStatus>('none');
  const [accessLevel, setAccessLevel] = useState<'own' | 'connected' | 'public' | ''>('');
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [overlayInsets, setOverlayInsets] = useState({ top: 0, bottom: 0 });
  const requestIdRef = useRef(0);

  const API_URL = getApiBaseUrl();
  const normalizeId = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (value.$oid) return String(value.$oid);
      if (value._id) return normalizeId(value._id);
      if (typeof value.toString === 'function') {
        const text = value.toString();
        if (text && text !== '[object Object]') return text;
      }
    }
    return String(value);
  };
  const toTitleCase = (value: any) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');

  const formatReligion = (religion: any, religionOther?: any) => {
    const normalized = String(religion || '').trim().toLowerCase();
    if (normalized === 'other') return toTitleCase(religionOther || 'Other');
    if (normalized === 'hindu') return 'Hinduism';
    if (normalized === 'hinduism') return 'Hinduism';
    return toTitleCase(normalized);
  };

  useEffect(() => {
    fetchProfileAndRelationship();
  }, [userId]);

  useEffect(() => {
    const computeInsets = () => {
      const topGap = 8;
      const bottomGap = 8;
      let topInset = 0;
      let bottomInset = 0;

      const headerEl = document.querySelector('.homepage-header') as HTMLElement | null;
      if (headerEl) {
        const headerStyle = window.getComputedStyle(headerEl);
        if (headerStyle.display !== 'none' && headerStyle.visibility !== 'hidden') {
          const rect = headerEl.getBoundingClientRect();
          topInset = Math.max(0, Math.round(rect.bottom + topGap));
        }
      }

      const bottomNavEl = document.querySelector('.mobile-bottom-nav') as HTMLElement | null;
      if (bottomNavEl) {
        const navStyle = window.getComputedStyle(bottomNavEl);
        if (navStyle.display !== 'none' && navStyle.visibility !== 'hidden') {
          const rect = bottomNavEl.getBoundingClientRect();
          const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
          bottomInset = Math.max(0, Math.round(viewportHeight - rect.top + bottomGap));
        }
      }

      setOverlayInsets({ top: topInset, bottom: bottomInset });
    };

    computeInsets();
    window.addEventListener('resize', computeInsets);
    window.addEventListener('orientationchange', computeInsets);
    window.visualViewport?.addEventListener('resize', computeInsets);
    window.visualViewport?.addEventListener('scroll', computeInsets);

    return () => {
      window.removeEventListener('resize', computeInsets);
      window.removeEventListener('orientationchange', computeInsets);
      window.visualViewport?.removeEventListener('resize', computeInsets);
      window.visualViewport?.removeEventListener('scroll', computeInsets);
    };
  }, []);

  const fetchProfileAndRelationship = async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Please login again');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      // Phase 1: Load profile first so modal content paints immediately.
      const profileData = await fetchJsonCached<any>(
        `${API_URL}/api/profiles/${userId}`,
        { headers: { Authorization: `Bearer ${token}` } },
        { ttlMs: 30000, forceRefresh }
      );

      if (requestId !== requestIdRef.current) return;
      setProfile(profileData.profile);
      setAccessLevel(profileData.accessLevel || '');
      setLoading(false);

      if (profileData.accessLevel === 'connected' || profileData.accessLevel === 'own') {
        setRelationshipStatus('connected');
      } else {
        setRelationshipStatus('none');
      }

      // Phase 2: Load secondary relationship/match state without blocking UI.
      const [pendingResult, matchResult] = await Promise.allSettled([
        profileData.accessLevel === 'connected' || profileData.accessLevel === 'own'
          ? Promise.resolve(null)
          : fetchJsonCached<any>(
              `${API_URL}/api/connections/pending`,
              { headers: { Authorization: `Bearer ${token}` } },
              { ttlMs: 15000, forceRefresh }
            ),
        fetchJsonCached<any>(
          `${API_URL}/api/match/status/${userId}`,
          { headers: { Authorization: `Bearer ${token}` } },
          { ttlMs: 10000, forceRefresh }
        )
      ]);

      if (requestId !== requestIdRef.current) return;

      if (matchResult.status === 'fulfilled') {
        setMatchStatus(matchResult.value);
      } else {
        setMatchStatus(null);
      }

      if (pendingResult.status === 'fulfilled' && pendingResult.value) {
        const pendingData = pendingResult.value;
        const hasSentRequest = (pendingData.sent || []).some(
          (req: any) => normalizeId(req.receiverId) === normalizeId(userId)
        );
        const hasReceivedRequest = (pendingData.received || []).some(
          (req: any) => normalizeId(req.senderId) === normalizeId(userId)
        );

        if (hasSentRequest) {
          setRelationshipStatus('request_sent');
        } else if (hasReceivedRequest) {
          setRelationshipStatus('request_received');
        } else {
          setRelationshipStatus('none');
        }
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError('Failed to load profile');
      setLoading(false);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const sendConnectionRequest = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/connections/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ receiverId: userId })
      });

      if (response.ok) {
        invalidateApiCacheByUrl('/api/connections/pending');
        invalidateApiCacheByUrl('/api/friends');
        setRelationshipStatus('request_sent');
      } else {
        const data = await response.json();
        const message = data.error?.message || 'Failed to send request';
        if (
          data.error?.code === 'ALREADY_FRIENDS' ||
          message.toLowerCase().includes('already connected') ||
          message.toLowerCase().includes('already friends')
        ) {
          setRelationshipStatus('connected');
          setError('');
          return;
        }
        setError(message);
      }
    } catch (err) {
      setError('Failed to send request');
    }
  };

  const likeProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      setMatchLoading(true);
      setMatchError('');
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const tzOffsetMinutes = -now.getTimezoneOffset();

      const response = await fetch(`${API_URL}/api/match/like/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ localDate, tzOffsetMinutes })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to like profile');
      }

      invalidateApiCacheByUrl('/api/match/status/');
      invalidateApiCacheByUrl('/api/profiles/');
      await fetchProfileAndRelationship(true);
    } catch (err: any) {
      setMatchError(err?.message || 'Failed to like profile');
    } finally {
      setMatchLoading(false);
    }
  };

  const unlikeProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      setMatchLoading(true);
      setMatchError('');
      const response = await fetch(`${API_URL}/api/match/unlike/${userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to unlike profile');
      }

      invalidateApiCacheByUrl('/api/match/status/');
      invalidateApiCacheByUrl('/api/profiles/');
      await fetchProfileAndRelationship(true);
    } catch (err: any) {
      setMatchError(err?.message || 'Failed to unlike profile');
    } finally {
      setMatchLoading(false);
    }
  };

  const openChatWithUser = () => {
    onClose();
    const normalizedUserId = normalizeId(profile?.userId || userId);
    if (!normalizedUserId) return;
    navigate(`/chat?user=${encodeURIComponent(normalizedUserId)}`, {
      state: { from: `${location.pathname}${location.search}` }
    });
  };

  const openProfile = () => {
    onClose();
    goToProfile(navigate, resolveProfileTarget(profile) || userId);
  };

  const openConnections = () => {
    onClose();
    navigate('/connections');
  };

  const profilePhoto = profile?.photos?.[0] || initialPhotoUrl || '';
  const profileName = profile?.name || initialName || 'Unknown User';
  const profileProfession = profile?.profession ? toTitleCase(profile.profession) : '';
  const isConnected = relationshipStatus === 'connected';
  const isMatched = Boolean(matchStatus?.isMatched);
  const canLike = isConnected && Boolean(matchStatus?.canLike);
  const proposeIsRevert = isMatched || Boolean(matchStatus?.likedByMe);
  const proposeLabel = proposeIsRevert ? (isMatched ? 'Breakup' : 'Withdraw Proposal') : 'Propose';
  const requestClose = (event?: SyntheticEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    onClose();
  };
  const overlayStyle = {
    '--profile-preview-top-inset': `${overlayInsets.top}px`,
    '--profile-preview-bottom-inset': `${overlayInsets.bottom}px`
  } as CSSProperties;

  return (
    <div className="modal-overlay" onClick={requestClose} style={overlayStyle}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close"
          onClick={requestClose}
          onTouchEnd={requestClose}
          type="button"
          aria-label="Close profile preview"
        >
          &times;
        </button>

        {loading && (
          <div className="modal-loading">
            <LoadingDots label="Loading profile" centered />
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        {profile && (
          <div className="profile-preview">
            <div className="profile-header">
              <div className="profile-avatar-wrap">
                {profilePhoto ? (
                  <img src={profilePhoto} alt={profileName} className="profile-avatar" />
                ) : (
                  <div className="profile-avatar-fallback">{profileName.charAt(0).toUpperCase()}</div>
                )}
              </div>
              <h2>{profileName}</h2>
              <p className="profession">{profileProfession}</p>
              {isMatched && <span className="connection-pill">Matched 💖</span>}
              <div className="profile-quick-meta">
                {profile?.age && <span>{profile.age} yrs</span>}
                {profile?.gender && <span>{toTitleCase(profile.gender)}</span>}
                {(profile?.religion || profile?.religionOther) && (
                  <span>{formatReligion(profile.religion, profile.religionOther)}</span>
                )}
              </div>
              {isConnected && <span className="connection-pill">Connected</span>}
              {accessLevel === 'public' && !isConnected && (
                <span className="preview-pill">Preview Profile</span>
              )}
            </div>

            <div className="profile-bio">
              <h3>About</h3>
              <p>{profile.bio}</p>
            </div>

            {profile.skills && profile.skills.length > 0 && (
              <div className="profile-skills">
                <h3>Skills</h3>
                <div className="skills-list">
                  {profile.skills.map((skill: string, index: number) => (
                    <span key={index} className="skill-tag">{skill}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="profile-actions dual-actions">
              {relationshipStatus === 'connected' ? (
                <>
                  <button className="view-profile-button" onClick={openProfile} type="button">
                    View Profile
                  </button>
                  <button className="open-chat-button" onClick={openChatWithUser} type="button">
                    Chat
                  </button>
                  {canLike && (
                    <button
                      className="open-chat-button"
                      onClick={proposeIsRevert ? unlikeProfile : likeProfile}
                      type="button"
                      disabled={matchLoading}
                    >
                      {matchLoading ? 'Updating...' : proposeLabel}
                    </button>
                  )}
                </>
              ) : relationshipStatus === 'request_sent' ? (
                <>
                  <button className="view-profile-button" onClick={openProfile} type="button">
                    View Profile
                  </button>
                  <button className="request-sent-button" disabled>
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path d="M4.5 10.4 8.3 14 15.5 6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Request Sent
                  </button>
                </>
              ) : relationshipStatus === 'request_received' ? (
                <>
                  <button className="view-profile-button" onClick={openProfile} type="button">
                    View Profile
                  </button>
                  <button className="pending-review-button" onClick={openConnections} type="button">
                    Review Request
                  </button>
                </>
              ) : (
                <>
                  <button className="view-profile-button" onClick={openProfile} type="button">
                    View Profile
                  </button>
                  <button className="send-request-button" onClick={sendConnectionRequest} type="button">
                    + Add Friend
                  </button>
                </>
              )}
            </div>
            {matchError && <div className="modal-error">{matchError}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfilePreviewModal;
