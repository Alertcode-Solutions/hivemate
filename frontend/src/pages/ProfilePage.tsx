import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AppContainer from '../components/ui/AppContainer';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { fetchJsonCached, invalidateApiCacheByUrl } from '../utils/apiCache';
import BeeLoader from '../components/BeeLoader';
import useSmoothLoader from '../hooks/useSmoothLoader';
import './ProfilePage.css';

type RelationshipStatus = 'none' | 'request_sent' | 'request_received' | 'connected' | 'blocked';
type MatchStatus = {
  connected: boolean;
  canLike: boolean;
  likedByMe: boolean;
  likedByOther: boolean;
  isMatched: boolean;
  heartVisible?: boolean;
  unlikeRequest?: {
    requesterId: string;
    responderId: string;
    attemptsUsed: number;
    pending: boolean;
    nextAllowedAt?: string;
    autoUnmatchAt?: string;
  } | null;
};

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="6" cy="12" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    <circle cx="18" cy="12" r="1.8" fill="currentColor" />
  </svg>
);

const MessageIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 4c-4.6 0-8.4 3.1-8.4 7 0 1.8.8 3.4 2.1 4.6l-.8 3.7 3.8-1.4c1 .4 2.1.6 3.3.6 4.6 0 8.4-3.1 8.4-7S16.6 4 12 4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="9.1" cy="11" r="1.1" fill="currentColor" />
    <circle cx="12" cy="11" r="1.1" fill="currentColor" />
    <circle cx="14.9" cy="11" r="1.1" fill="currentColor" />
  </svg>
);

const ProposeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="m12 20-1.1-1C6.4 15 4 12.9 4 10.2 4 8 5.8 6.2 8 6.2c1.3 0 2.6.6 3.4 1.6.8-1 2.1-1.6 3.4-1.6 2.2 0 4 1.8 4 4 0 2.7-2.4 4.8-6.9 8.8L12 20z"
      fill="currentColor"
    />
    <path d="M6 6 18 18M18 6 6 18" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const UnfriendIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="m12 20-1.1-1C6.4 15 4 12.9 4 10.2 4 8 5.8 6.2 8 6.2c1.3 0 2.6.6 3.4 1.6.8-1 2.1-1.6 3.4-1.6 2.2 0 4 1.8 4 4 0 2.7-2.4 4.8-6.9 8.8L12 20z"
      fill="currentColor"
    />
  </svg>
);

const BlockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 3.8 5.8 6.1v5.7c0 4 2.7 7.7 6.2 8.8 3.5-1.1 6.2-4.8 6.2-8.8V6.1L12 3.8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const EditIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M4 20h3.2l9.9-9.9-3.2-3.2L4 16.8V20zm14.7-11.7 1.6-1.6a1.5 1.5 0 0 0 0-2.1l-.9-.9a1.5 1.5 0 0 0-2.1 0l-1.6 1.6 3 3z"
      fill="currentColor"
    />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M7 10V8a5 5 0 0 1 10 0v2M6.5 10h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M14 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M10 8 6 12l4 4M6 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ProfilePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: paramUserId } = useParams();
  const [profile, setProfile] = useState<any>(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { showLoader, complete, handleLoaderComplete } = useSmoothLoader(loading);
  const [formData, setFormData] = useState<any>({});
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [isPhotoPreviewOpen, setIsPhotoPreviewOpen] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState('');
  const [isCoverMenuOpen, setIsCoverMenuOpen] = useState(false);
  const [isCoverCropOpen, setIsCoverCropOpen] = useState(false);
  const [coverCropSource, setCoverCropSource] = useState<string | null>(null);
  const [coverCropZoom, setCoverCropZoom] = useState(1);
  const [coverCropX, setCoverCropX] = useState(50);
  const [coverCropY, setCoverCropY] = useState(50);
  const [coverCropError, setCoverCropError] = useState('');
  const [coverImageSize, setCoverImageSize] = useState<{ width: number; height: number } | null>(null);
  const [scrollToEditSection, setScrollToEditSection] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordOtpSent, setPasswordOtpSent] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [accessLevel, setAccessLevel] = useState<'own' | 'connected' | 'public' | ''>('');
  const [relationshipStatus, setRelationshipStatus] = useState<RelationshipStatus>('none');
  const [sentRequestId, setSentRequestId] = useState<string>('');
  const [justSentRequest, setJustSentRequest] = useState(false);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipError, setRelationshipError] = useState('');
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [blockedBySelf, setBlockedBySelf] = useState(false);
  const [mutualCount, setMutualCount] = useState(0);
  const [mutualFriends, setMutualFriends] = useState<Array<{ userId: string; name: string }>>([]);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    otp: ''
  });
  const photoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const coverMenuRef = useRef<HTMLDivElement>(null);
  const editSectionRef = useRef<HTMLElement>(null);
  const coverCropPreviewRef = useRef<HTMLCanvasElement>(null);
  const handleUnauthorized = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('privateKey');
    localStorage.removeItem('publicKey');
    navigate('/login');
  };

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

  const formatListInput = (value: any) => {
    if (Array.isArray(value)) return value.join(', ');
    return value || '';
  };

  const parseListInput = (value: any) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : Array.isArray(value)
        ? value
        : [];

  const RELIGION_OPTIONS = [
    'hinduism',
    'muslim',
    'christian',
    'sikh',
    'buddhist',
    'jain',
    'jewish',
    'atheist',
    'agnostic',
    'other'
  ];

  const getInitial = (value: any) => {
    const source = value || profile?.name || formData?.name || 'U';
    return String(source).charAt(0).toUpperCase();
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

  const toSinglePhotoArray = (photos: any) => {
    if (!Array.isArray(photos) || photos.length === 0) return [];
    const first = photos[0];
    return first ? [first] : [];
  };

  const buildProfilePayload = (source: any, overridePhoto?: string | null) => {
    const photoArray = overridePhoto !== undefined ? (overridePhoto ? [overridePhoto] : []) : toSinglePhotoArray(source.photos);
    return {
      ...source,
      age: source.age ? parseInt(source.age, 10) : undefined,
      skills: parseListInput(source.skills),
      achievements: parseListInput(source.achievements),
      photos: photoArray
    };
  };
  const COVER_ASPECT_RATIO = 16 / 5;
  const getCoverCropRect = (
    width: number,
    height: number,
    zoom: number,
    xPercent: number,
    yPercent: number
  ) => {
    const boundedZoom = Math.max(1, Math.min(3, zoom || 1));
    const baseCropWidth = Math.min(width, height * COVER_ASPECT_RATIO);
    const baseCropHeight = baseCropWidth / COVER_ASPECT_RATIO;
    const cropWidth = baseCropWidth / boundedZoom;
    const cropHeight = baseCropHeight / boundedZoom;
    const maxX = Math.max(0, width - cropWidth);
    const maxY = Math.max(0, height - cropHeight);
    const sourceX = (Math.max(0, Math.min(100, xPercent)) / 100) * maxX;
    const sourceY = (Math.max(0, Math.min(100, yPercent)) / 100) * maxY;

    return {
      sourceX,
      sourceY,
      cropWidth,
      cropHeight
    };
  };

  useEffect(() => {
    const currentUserId = normalizeId(localStorage.getItem('userId'));
    const targetIdentifier = normalizeId(paramUserId) || currentUserId;
    const isOwnByRoute = !normalizeId(paramUserId) || targetIdentifier === currentUserId;
    setIsOwnProfile(isOwnByRoute);
    if (targetIdentifier) {
      fetchProfile(targetIdentifier);
    } else {
      setLoading(false);
    }
  }, [paramUserId]);

  useEffect(() => {
    if (!isSettingsMenuOpen) return;

    const closeOnOutside = (event: MouseEvent | TouchEvent) => {
      if (!settingsMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && settingsMenuRef.current.contains(target)) return;
      setIsSettingsMenuOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSettingsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('touchstart', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('touchstart', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isSettingsMenuOpen]);

  useEffect(() => {
    if (!isCoverMenuOpen) return;

    const closeOnOutside = (event: MouseEvent | TouchEvent) => {
      if (!coverMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && coverMenuRef.current.contains(target)) return;
      setIsCoverMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('touchstart', closeOnOutside);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('touchstart', closeOnOutside);
    };
  }, [isCoverMenuOpen]);

  useEffect(() => {
    if (!isEditing || !scrollToEditSection) return;
    const timer = window.setTimeout(() => {
      editSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollToEditSection(false);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isEditing, scrollToEditSection]);

  useEffect(() => {
    if (!isCoverCropOpen || !coverCropSource || !coverImageSize || !coverCropPreviewRef.current) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || !coverCropPreviewRef.current) return;
      const canvas = coverCropPreviewRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = 960;
      canvas.height = 300;
      const rect = getCoverCropRect(
        coverImageSize.width,
        coverImageSize.height,
        coverCropZoom,
        coverCropX,
        coverCropY
      );
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        image,
        rect.sourceX,
        rect.sourceY,
        rect.cropWidth,
        rect.cropHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );
    };
    image.src = coverCropSource;
    return () => {
      cancelled = true;
    };
  }, [isCoverCropOpen, coverCropSource, coverImageSize, coverCropZoom, coverCropX, coverCropY]);

  const fetchRelationship = async (
    targetUserId: string,
    profileAccessLevel?: string,
    forceRefresh = false
  ) => {
    try {
      const token = localStorage.getItem('token');
      if (!token || !targetUserId) return;
      setRelationshipLoading(true);
      setRelationshipError('');

      const [pendingResult, friendsResult, friendshipStatusResult] = await Promise.allSettled([
        fetchJsonCached<any>(
          `${API_URL}/api/connections/pending`,
          {
            headers: { Authorization: `Bearer ${token}` }
          },
          {
            ttlMs: 15000,
            forceRefresh
          }
        ),
        fetchJsonCached<any>(
          `${API_URL}/api/friends`,
          {
            headers: { Authorization: `Bearer ${token}` }
          },
          {
            ttlMs: 15000,
            forceRefresh
          }
        ),
        fetchJsonCached<any>(
          `${API_URL}/api/friends/status/${targetUserId}`,
          {
            headers: { Authorization: `Bearer ${token}` }
          },
          {
            ttlMs: 10000,
            forceRefresh
          }
        )
      ]);

      let resolvedStatus: RelationshipStatus = 'none';
      let resolvedSentRequestId = '';

      const candidateIds = new Set(
        [targetUserId, paramUserId, profile?.userId, profile?.id].filter(Boolean).map((value) => normalizeId(value))
      );

      if (friendsResult.status === 'fulfilled') {
        const friendsData = friendsResult.value;
        const matchedFriendship = (friendsData.friends || []).find(
          (friend: any) => candidateIds.has(normalizeId(friend.friendId))
        );
        if (matchedFriendship) {
          resolvedStatus = 'connected';
        }
      }

      if (resolvedStatus !== 'connected' && (profileAccessLevel === 'connected' || profileAccessLevel === 'own')) {
        resolvedStatus = 'connected';
      }

      if (resolvedStatus !== 'connected' && pendingResult.status === 'fulfilled') {
        const pendingData = pendingResult.value;
        const sentMatch = (pendingData.sent || []).find(
          (req: any) => candidateIds.has(normalizeId(req.receiverId))
        );
        const hasSentRequest = Boolean(sentMatch);
        const hasReceivedRequest = (pendingData.received || []).some(
          (req: any) => candidateIds.has(normalizeId(req.senderId))
        );

        if (hasSentRequest) {
          resolvedStatus = 'request_sent';
          resolvedSentRequestId = normalizeId(sentMatch?.id);
        } else if (hasReceivedRequest) {
          resolvedStatus = 'request_received';
        }
      }

      if (friendshipStatusResult.status === 'fulfilled') {
        const friendshipStatus = friendshipStatusResult.value;
        if (friendshipStatus?.status === 'blocked') {
          resolvedStatus = 'blocked';
          setBlockedBySelf(Boolean(friendshipStatus?.blockedBySelf));
        } else {
          setBlockedBySelf(false);
        }
      } else {
        setBlockedBySelf(false);
      }

      setRelationshipStatus(resolvedStatus);
      setSentRequestId(resolvedSentRequestId);
      setJustSentRequest(false);
    } catch (error: any) {
      if (error?.status === 401) {
        handleUnauthorized();
        return;
      }
      console.error('Failed to fetch relationship:', error);
      setRelationshipError('Failed to load connection status.');
    } finally {
      setRelationshipLoading(false);
    }
  };

  const fetchMatchStatus = async (targetUserId: string, forceRefresh = false) => {
    try {
      const token = localStorage.getItem('token');
      if (!token || !targetUserId) return;
      setMatchLoading(true);
      setMatchError('');
      const data = await fetchJsonCached<any>(
        `${API_URL}/api/match/status/${targetUserId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        },
        {
          ttlMs: 10000,
          forceRefresh
        }
      );
      setMatchStatus(data);
    } catch (error: any) {
      if (error?.status === 401) {
        handleUnauthorized();
        return;
      }
      setMatchStatus(null);
      setMatchError(error?.message || 'Failed to load match status');
    } finally {
      setMatchLoading(false);
    }
  };

  const fetchProfile = async (userId: string, forceRefresh = false) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        handleUnauthorized();
        return;
      }
      const data = await fetchJsonCached<any>(
        `${API_URL}/api/profiles/${userId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        },
        {
          ttlMs: 30000,
          forceRefresh
        }
      );
        const resolvedAccessLevel = data.accessLevel || '';
        const normalizedProfile = {
          ...data.profile,
          photos: toSinglePhotoArray(data.profile?.photos),
          coverPhoto: data.profile?.coverPhoto || ''
        };
        const currentUserId = normalizeId(localStorage.getItem('userId'));
        const resolvedProfileUserId = normalizeId(normalizedProfile?.userId);
        const resolvedIsOwn =
          resolvedAccessLevel === 'own' ||
          (Boolean(currentUserId) && resolvedProfileUserId === currentUserId);

        setProfile(normalizedProfile);
        setFormData(normalizedProfile);
        setAccessLevel(resolvedAccessLevel);
        setIsOwnProfile(resolvedIsOwn);
        setMutualCount(Number(data.mutualCount || 0));
        setMutualFriends(Array.isArray(data.mutualFriends) ? data.mutualFriends : []);

        if (!resolvedIsOwn) {
          await fetchRelationship(userId, resolvedAccessLevel, forceRefresh);
          await fetchMatchStatus(userId, forceRefresh);
        } else {
          setRelationshipStatus('connected');
          setMatchStatus(null);
        }
    } catch (error: any) {
      if (error?.status === 401) {
        handleUnauthorized();
        return;
      }
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setIsSettingsMenuOpen(false);
    setIsCoverMenuOpen(false);
    setIsEditing(true);
    setScrollToEditSection(true);
    setPhotoError('');
    setCoverError('');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormData(profile);
    setPhotoError('');
    setCoverError('');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const compressImageToBase64 = (
    file: File,
    options?: { maxWidth?: number; maxHeight?: number; quality?: number }
  ): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxWidth = options?.maxWidth ?? 720;
          const maxHeight = options?.maxHeight ?? 720;
          const quality = options?.quality ?? 0.78;
          const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
          const width = Math.round(img.width * scale);
          const height = Math.round(img.height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas not supported'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = String(reader.result || '');
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });

  const saveProfilePayload = async (payload: any) => {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');
    if (!token || !userId) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }
    const response = await fetch(`${API_URL}/api/profiles/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized();
      }
      throw new Error('Failed to update profile');
    }
    const data = await response.json();
    const normalizedProfile = {
      ...data.profile,
      photos: toSinglePhotoArray(data.profile?.photos),
      coverPhoto: data.profile?.coverPhoto || ''
    };
    invalidateApiCacheByUrl('/api/profiles/');
    setProfile(normalizedProfile);
    setFormData(normalizedProfile);
    return normalizedProfile;
  };

  const handleProfilePhotoFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
    if (!allowedTypes.includes(file.type)) {
      setPhotoError('Please upload a JPEG, PNG, WebP, GIF, HEIC, or HEIF image.');
      return;
    }

    try {
      setPhotoUploading(true);
      setPhotoError('');
      const compressed = await compressImageToBase64(file);
      setSelectedPhoto(compressed);
      setPendingPhoto(compressed);
      setIsPhotoPreviewOpen(true);
    } catch (error) {
      console.error('Failed to change profile photo:', error);
      setPhotoError('Failed to update profile photo. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleCoverPhotoFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !isOwnProfile) return;
    event.target.value = '';

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
    if (!allowedTypes.includes(file.type)) {
      setCoverError('Please upload a JPEG, PNG, WebP, GIF, HEIC, or HEIF image.');
      return;
    }

    try {
      setCoverError('');
      setCoverCropError('');
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = source;
      });
      setCoverImageSize({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
      setCoverCropSource(source);
      setCoverCropZoom(1);
      setCoverCropX(50);
      setCoverCropY(50);
      setIsCoverCropOpen(true);
      setIsCoverMenuOpen(false);
    } catch (error) {
      console.error('Failed to prepare cover photo:', error);
      setCoverError('Failed to load cover image. Please try again.');
    }
  };

  const handleApplyCoverCrop = async () => {
    if (!coverCropSource || !coverImageSize) return;
    try {
      setCoverUploading(true);
      setCoverCropError('');
      setCoverError('');
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = coverCropSource;
      });

      const outputWidth = 1600;
      const outputHeight = 500;
      const rect = getCoverCropRect(
        coverImageSize.width,
        coverImageSize.height,
        coverCropZoom,
        coverCropX,
        coverCropY
      );

      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      ctx.drawImage(
        image,
        rect.sourceX,
        rect.sourceY,
        rect.cropWidth,
        rect.cropHeight,
        0,
        0,
        outputWidth,
        outputHeight
      );
      const cropped = canvas.toDataURL('image/jpeg', 0.84);
      const payload = buildProfilePayload(formData);
      payload.coverPhoto = cropped;
      await saveProfilePayload(payload);

      setIsCoverCropOpen(false);
      setCoverCropSource(null);
      setCoverImageSize(null);
      setIsCoverMenuOpen(false);
    } catch (error) {
      console.error('Failed to apply cover crop:', error);
      setCoverCropError('Failed to save cover. Please try again.');
    } finally {
      setCoverUploading(false);
    }
  };

  const handleRemoveCoverPhoto = async () => {
    if (!isOwnProfile) return;
    try {
      setCoverUploading(true);
      setCoverError('');
      setCoverCropError('');
      const payload = buildProfilePayload(formData);
      payload.coverPhoto = '';
      await saveProfilePayload(payload);
      setIsCoverMenuOpen(false);
      setIsCoverCropOpen(false);
      setCoverCropSource(null);
      setCoverImageSize(null);
    } catch (error) {
      console.error('Failed to remove cover photo:', error);
      setCoverError('Failed to remove cover photo. Please try again.');
    } finally {
      setCoverUploading(false);
    }
  };

  const handleConfirmProfilePhoto = async () => {
    if (!pendingPhoto) return;

    try {
      setPhotoUploading(true);
      setPhotoError('');
      const payload = buildProfilePayload(formData, pendingPhoto);
      const updated = await saveProfilePayload(payload);
      setSelectedPhoto(updated.photos?.[0] || null);
      setPendingPhoto(null);
      setIsPhotoPreviewOpen(false);
    } catch (error) {
      console.error('Failed to confirm profile photo:', error);
      setPhotoError('Failed to update profile photo. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      const normalizedFormData = {
        ...formData,
        gender: String(formData.gender || '').trim().toLowerCase(),
        religion: String(formData.religion || '').trim().toLowerCase(),
        religionOther:
          String(formData.religion || '').trim().toLowerCase() === 'other'
            ? String(formData.religionOther || '').trim()
            : undefined
      };
      const payload = buildProfilePayload(formData);
      payload.gender = normalizedFormData.gender;
      payload.religion = normalizedFormData.religion;
      payload.religionOther = normalizedFormData.religionOther;
      await saveProfilePayload(payload);
      setIsEditing(false);
      setPhotoError('');
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  const openChatWithUser = () => {
    const targetUserId = normalizeId(profile?.userId || paramUserId);
    if (!targetUserId) return;
    navigate(`/chat?user=${encodeURIComponent(targetUserId)}`, {
      state: { from: `${location.pathname}${location.search}` }
    });
  };

  const openFriendList = () => {
    const targetUserId = normalizeId(profile?.userId || paramUserId);
    if (!targetUserId) return;
    navigate(`/friends/${targetUserId}`);
  };

  const sendConnectionRequest = async () => {
    try {
      setRelationshipLoading(true);
      setRelationshipError('');
      const token = localStorage.getItem('token');
      const targetUserId = normalizeId(profile?.userId || paramUserId);
      if (!token || !targetUserId) return;

      const response = await fetch(`${API_URL}/api/connections/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ receiverId: targetUserId })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = data?.error?.message || 'Failed to send request';
        if (
          data?.error?.code === 'ALREADY_FRIENDS' ||
          message.toLowerCase().includes('already connected') ||
          message.toLowerCase().includes('already friends')
        ) {
          setRelationshipStatus('connected');
          invalidateApiCacheByUrl('/api/connections/pending');
          invalidateApiCacheByUrl('/api/friends');
          invalidateApiCacheByUrl('/api/friends/status/');
          await fetchRelationship(String(targetUserId), accessLevel, true);
          return;
        }
        throw new Error(message);
      }

      invalidateApiCacheByUrl('/api/connections/pending');
      invalidateApiCacheByUrl('/api/friends');
      invalidateApiCacheByUrl('/api/friends/status/');
      setRelationshipStatus('request_sent');
      setSentRequestId('');
      setJustSentRequest(true);
    } catch (error: any) {
      setRelationshipError(error?.message || 'Failed to send request.');
    } finally {
      setRelationshipLoading(false);
    }
  };

  const cancelConnectionRequest = async () => {
    try {
      setRelationshipLoading(true);
      setRelationshipError('');
      const token = localStorage.getItem('token');
      const targetUserId = normalizeId(profile?.userId || paramUserId);
      if (!token || !targetUserId) return;

      let requestId = sentRequestId;
      if (!requestId) {
        const pendingResponse = await fetch(`${API_URL}/api/connections/pending`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (pendingResponse.ok) {
          const pendingData = await pendingResponse.json();
          const candidateIds = new Set(
            [targetUserId, paramUserId, profile?.userId, profile?.id].filter(Boolean).map((value) => normalizeId(value))
          );
          const sentMatch = (pendingData.sent || []).find(
            (req: any) => candidateIds.has(normalizeId(req.receiverId))
          );
          requestId = normalizeId(sentMatch?.id);
        }
      }

      if (!requestId) {
        throw new Error('Pending request not found');
      }

      const response = await fetch(`${API_URL}/api/connections/${requestId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to cancel request');
      }

      invalidateApiCacheByUrl('/api/connections/pending');
      invalidateApiCacheByUrl('/api/friends');
      invalidateApiCacheByUrl('/api/friends/status/');
      setRelationshipStatus('none');
      setSentRequestId('');
      setJustSentRequest(false);
    } catch (error: any) {
      setRelationshipError(error?.message || 'Failed to cancel request.');
    } finally {
      setRelationshipLoading(false);
    }
  };

  const unfriendUser = async () => {
    try {
      setRelationshipLoading(true);
      setRelationshipError('');
      const token = localStorage.getItem('token');
      const targetUserId = normalizeId(profile?.userId || paramUserId);
      if (!token || !targetUserId) return;

      const response = await fetch(`${API_URL}/api/friends/by-user/${targetUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to unfriend user');
      }

      invalidateApiCacheByUrl('/api/profiles/');
      invalidateApiCacheByUrl('/api/friends');
      invalidateApiCacheByUrl('/api/connections/pending');
      invalidateApiCacheByUrl('/api/friends/status/');
      setRelationshipStatus('none');
      setAccessLevel('public');
      setMutualCount(0);
      setMutualFriends([]);
      setSentRequestId('');
      setJustSentRequest(false);
      await fetchProfile(String(targetUserId), true);
    } catch (error: any) {
      setRelationshipError(error?.message || 'Failed to unfriend user.');
    } finally {
      setRelationshipLoading(false);
    }
  };

  const blockUser = async () => {
    try {
      setRelationshipLoading(true);
      setRelationshipError('');
      const token = localStorage.getItem('token');
      const targetUserId = normalizeId(profile?.userId || paramUserId);
      if (!token || !targetUserId) return;

      const response = await fetch(`${API_URL}/api/friends/by-user/${targetUserId}/block`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to block user');
      }

      invalidateApiCacheByUrl('/api/friends');
      invalidateApiCacheByUrl('/api/connections/pending');
      invalidateApiCacheByUrl('/api/friends/status/');
      setRelationshipStatus('blocked');
      setBlockedBySelf(true);
    } catch (error: any) {
      setRelationshipError(error?.message || 'Failed to block user.');
    } finally {
      setRelationshipLoading(false);
    }
  };

  const unblockUser = async () => {
    try {
      setRelationshipLoading(true);
      setRelationshipError('');
      const token = localStorage.getItem('token');
      const targetUserId = normalizeId(profile?.userId || paramUserId);
      if (!token || !targetUserId) return;

      const response = await fetch(`${API_URL}/api/friends/by-user/${targetUserId}/unblock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to unblock user');
      }

      invalidateApiCacheByUrl('/api/friends');
      invalidateApiCacheByUrl('/api/connections/pending');
      invalidateApiCacheByUrl('/api/friends/status/');
      setBlockedBySelf(false);
      setRelationshipStatus('connected');
      await fetchRelationship(String(targetUserId), accessLevel, true);
    } catch (error: any) {
      setRelationshipError(error?.message || 'Failed to unblock user.');
    } finally {
      setRelationshipLoading(false);
    }
  };

  const likeProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const targetUserId = normalizeId(profile?.userId || paramUserId);
      if (!token || !targetUserId) return;
      setMatchLoading(true);
      setMatchError('');

      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const tzOffsetMinutes = -now.getTimezoneOffset();

      const response = await fetch(`${API_URL}/api/match/like/${targetUserId}`, {
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
      await fetchMatchStatus(targetUserId, true);
    } catch (error: any) {
      setMatchError(error?.message || 'Failed to like profile');
    } finally {
      setMatchLoading(false);
    }
  };

  const unlikeProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const targetUserId = normalizeId(profile?.userId || paramUserId);
      if (!token || !targetUserId) return;
      setMatchLoading(true);
      setMatchError('');

      const response = await fetch(`${API_URL}/api/match/unlike/${targetUserId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to unlike profile');
      }

      invalidateApiCacheByUrl('/api/match/status/');
      await fetchMatchStatus(targetUserId, true);
    } catch (error: any) {
      setMatchError(error?.message || 'Failed to unlike profile');
    } finally {
      setMatchLoading(false);
    }
  };

  const handlePasswordChangeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPasswordData((prev) => ({ ...prev, [name]: value }));
    setPasswordError('');
    setPasswordMessage('');
  };

  const requestChangePasswordOtp = async () => {
    try {
      setPasswordLoading(true);
      setPasswordError('');
      setPasswordMessage('');
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/auth/change-password/request-otp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      }).then(async (response) => {
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data?.error?.message || 'Failed to send OTP');
        }
      });

      setPasswordOtpSent(true);
      setPasswordMessage('OTP sent to your email.');
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to send OTP');
    } finally {
      setPasswordLoading(false);
    }
  };

  const confirmChangePassword = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword || !passwordData.otp) {
      setPasswordError('All fields are required.');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    try {
      setPasswordLoading(true);
      setPasswordError('');
      setPasswordMessage('');
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/auth/change-password/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
          otp: passwordData.otp
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to change password');
      }

      if (data.token) {
        localStorage.setItem('token', data.token);
      }

      setPasswordMessage('Password changed successfully.');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        otp: ''
      });
      setPasswordOtpSent(false);
      setShowChangePassword(false);
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const clearSessionData = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('privateKey');
    localStorage.removeItem('publicKey');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('privateKey');
    sessionStorage.removeItem('publicKey');
  };

  const handleLogout = () => {
    setIsSettingsMenuOpen(false);
    setShowChangePassword(false);
    setShowDeleteConfirm(false);
    clearSessionData();
    navigate('/login', { replace: true });
  };

  const handleDeleteAccount = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) return;

    try {
      setDeleteLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/profiles/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to delete account');
      }

      setShowDeleteConfirm(false);
      setIsSettingsMenuOpen(false);
      setShowChangePassword(false);
      clearSessionData();
      navigate('/', { replace: true });
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to delete account');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (showLoader) {
    return <BeeLoader message="Loading profile..." fullscreen complete={complete} onComplete={handleLoaderComplete} />;
  }

  if (!profile) {
    return <div className="profile-error">Profile not found</div>;
  }

  const primaryPhoto = profile.photos?.[0] || '';
  const coverPhoto = String(profile.coverPhoto || '').trim();
  const verified = Boolean(profile.verified || profile.verification);
  const isPublicView = !isOwnProfile;
  const displayReligion = formatReligion(profile.religion, profile.religionOther) || 'Not shared';
  const displayLocation = toTitleCase(profile.place) || 'Not shared';
  const displayGender = toTitleCase(profile.gender) || 'Not shared';
  const displayProfession = profile.profession ? toTitleCase(profile.profession) : 'No profession added';
  const canShowLikeButton = isPublicView && relationshipStatus === 'connected' && Boolean(matchStatus?.canLike);
  const isMatched = Boolean(matchStatus?.isMatched);
  const showHeart = isPublicView && isMatched && Boolean(matchStatus?.heartVisible);
  const infoBlocks = [
    { label: 'Location', value: displayLocation },
    { label: 'Age', value: profile.age ? String(profile.age) : 'Not shared' },
    { label: 'Religion', value: displayReligion },
    { label: 'Phone', value: profile.phone || 'Not shared' },
    { label: 'Gender', value: displayGender },
    { label: 'Company', value: profile.company ? toTitleCase(profile.company) : 'Not shared' },
    { label: 'College', value: profile.college ? toTitleCase(profile.college) : 'Not shared' }
  ];

  const normalizeWebsite = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
  };

  const completionSource = isEditing ? formData : profile;
  const completionPhoto = isEditing
    ? (pendingPhoto || completionSource?.photos?.[0] || primaryPhoto)
    : primaryPhoto;
  const completionChecks = [
    Boolean(completionSource?.name),
    Boolean(completionSource?.profession),
    Boolean(completionSource?.bio),
    Boolean(completionSource?.place),
    Boolean(completionSource?.age),
    Boolean(completionSource?.gender),
    Boolean(completionSource?.websiteUrl),
    Boolean(completionSource?.company || completionSource?.college),
    Array.isArray(completionSource?.skills) && completionSource.skills.length > 0,
    Boolean(completionPhoto)
  ];
  const completionScore = Math.round((completionChecks.filter(Boolean).length / completionChecks.length) * 100);
  const mutualNames = mutualFriends.map((friend) => friend.name).filter(Boolean).join(', ');
  const mutualLine = mutualCount > 0
    ? `${mutualCount} mutual ${mutualCount === 1 ? 'friend' : 'friends'}${mutualNames ? ` | ${mutualNames}` : ''}`
    : 'Connect to discover mutual friends';
  const proposeIsRevert = isMatched || Boolean(matchStatus?.likedByMe);
  const proposeLabel = proposeIsRevert ? (isMatched ? 'Break Up' : 'Withdraw Proposal') : 'Propose';

  return (
    <div className="profile-page">
      <AppContainer className="profile-shell" size="sm">
        <div className="profile-scroll-body">
          <div className="profile-topbar">
            <button className="profile-nav-btn" onClick={() => navigate('/home')} aria-label="Go back">
              <BackIcon />
            </button>
            {isOwnProfile && (
              <div className="profile-settings-wrap" ref={settingsMenuRef}>
                <button
                  className="profile-more-btn"
                  onClick={() => setIsSettingsMenuOpen((prev) => !prev)}
                  aria-label="Profile settings"
                  aria-expanded={isSettingsMenuOpen}
                >
                  <MoreIcon />
                </button>
                {isSettingsMenuOpen && (
                  <div className="profile-settings-menu" role="menu" aria-label="Profile settings">
                    <button
                      type="button"
                      className="profile-settings-item"
                      role="menuitem"
                      onClick={() => {
                        setIsSettingsMenuOpen(false);
                        handleEdit();
                      }}
                    >
                      <EditIcon />
                      <span>Edit Profile</span>
                    </button>
                    <button
                      type="button"
                      className="profile-settings-item"
                      role="menuitem"
                      onClick={() => {
                        setIsSettingsMenuOpen(false);
                        setPasswordError('');
                        setPasswordMessage('');
                        setShowChangePassword(true);
                      }}
                    >
                      <LockIcon />
                      <span>Change Password</span>
                    </button>
                    <button
                      type="button"
                      className="profile-settings-item"
                      role="menuitem"
                      onClick={handleLogout}
                    >
                      <LogoutIcon />
                      <span>Logout</span>
                    </button>
                    <div className="profile-settings-divider" aria-hidden="true" />
                    <button
                      type="button"
                      className="profile-settings-item profile-settings-item-danger"
                      role="menuitem"
                      onClick={() => {
                        setIsSettingsMenuOpen(false);
                        setShowDeleteConfirm(true);
                      }}
                    >
                      <TrashIcon />
                      <span>Delete Account</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <section className="profile-hero">
          <div
            className={`profile-hero-bg${coverPhoto ? ' profile-hero-bg-has-image' : ''}`}
            style={
              coverPhoto
                ? {
                    backgroundImage: `linear-gradient(rgba(12, 35, 72, 0.2), rgba(12, 35, 72, 0.2)), url(${coverPhoto})`
                  }
                : undefined
            }
          >
            {isOwnProfile && (
              <div className="profile-cover-menu-wrap" ref={coverMenuRef}>
                <button
                  type="button"
                  className="profile-cover-edit-btn"
                  onClick={() => {
                    if (coverUploading) return;
                    setCoverError('');
                    setIsCoverMenuOpen((prev) => !prev);
                  }}
                  disabled={coverUploading}
                  aria-label={coverPhoto ? 'Edit cover photo' : 'Add cover photo'}
                  aria-expanded={isCoverMenuOpen}
                >
                  {coverUploading ? 'Saving...' : (coverPhoto ? 'Edit Cover' : 'Add Cover')}
                </button>
                {isCoverMenuOpen && (
                  <div className="profile-cover-menu">
                    <button
                      type="button"
                      className="profile-cover-menu-item"
                      onClick={() => {
                        setIsCoverMenuOpen(false);
                        coverInputRef.current?.click();
                      }}
                      disabled={coverUploading}
                    >
                      {coverPhoto ? 'Change Cover' : 'Upload Cover'}
                    </button>
                    {coverPhoto && (
                      <button
                        type="button"
                        className="profile-cover-menu-item profile-cover-menu-item-danger"
                        onClick={handleRemoveCoverPhoto}
                        disabled={coverUploading}
                      >
                        Remove Cover
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {isOwnProfile && coverError && <p className="profile-cover-error">{coverError}</p>}
          <div
            role="button"
            tabIndex={0}
            className="profile-avatar-button"
            onClick={() => {
              if (!primaryPhoto && !isOwnProfile) return;
              setSelectedPhoto(primaryPhoto || null);
              setPendingPhoto(null);
              setIsPhotoPreviewOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (!primaryPhoto && !isOwnProfile) return;
              setSelectedPhoto(primaryPhoto || null);
              setPendingPhoto(null);
              setIsPhotoPreviewOpen(true);
            }}
            aria-label="Preview profile photo"
          >
            <div className="profile-avatar-wrap">
              {primaryPhoto ? (
                <img src={primaryPhoto} alt={profile.name || 'Profile'} className="profile-avatar" />
              ) : (
                <div className="profile-avatar-fallback">{getInitial(profile.name)}</div>
              )}
              {isOwnProfile && (
                <button
                  type="button"
                  className="profile-avatar-edit-trigger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhotoError('');
                    photoInputRef.current?.click();
                  }}
                  aria-label="Change profile photo"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      d="M4 20h3.2l9.9-9.9-3.2-3.2L4 16.8V20zm14.7-11.7 1.6-1.6a1.5 1.5 0 0 0 0-2.1l-.9-.9a1.5 1.5 0 0 0-2.1 0l-1.6 1.6 3 3z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="profile-identity">
            <h1>
              {profile.name || 'Unknown User'}
              {showHeart && (
                <span className="profile-match-heart" title="Matched" role="img" aria-label="Matched">
                  {'\u2764\uFE0F'}
                </span>
              )}
            </h1>
            {profile.username && <p className="profile-username">@{profile.username}</p>}
            <p className="profile-role">{displayProfession}</p>
            <div className="profile-badges">
              {profile.age && <span className="owner-badge">{profile.age} yrs</span>}
              {displayReligion !== 'Not shared' && <span className="owner-badge">{displayReligion}</span>}
              {verified && <span className="verified-badge">Verified</span>}
            </div>
          </div>

          {isOwnProfile && (
            <div className="profile-completion-card">
              <div className="completion-top">
                <h4>Profile completion</h4>
                {completionScore === 100 ? (
                  <span className="completion-done">
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <circle cx="10" cy="10" r="9" fill="#16a34a" />
                      <path d="M5.2 10.5 8.4 13.7 14.8 7.3" fill="none" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Profile Completed
                  </span>
                ) : (
                  <strong>{completionScore}%</strong>
                )}
              </div>
              <div className="completion-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionScore}>
                <div className="completion-fill" style={{ width: `${completionScore}%` }} />
              </div>
              <p>
                {completionScore === 100
                  ? 'Your profile is fully complete and ready for discovery.'
                  : isEditing
                    ? 'Completion updates live as you edit profile fields.'
                    : 'Complete your profile to improve discoverability on radar and search.'}
              </p>
            </div>
          )}
        </section>

        {isPublicView && (
          <section className="profile-card profile-interaction-card">
            {relationshipStatus === 'connected' ? (
              <>
                <div className="profile-primary-actions">
                  <button type="button" className="profile-primary-btn" onClick={openChatWithUser}>
                    <MessageIcon />
                    <span>Message</span>
                  </button>
                  <button
                    type="button"
                    className="profile-primary-btn profile-primary-btn-special"
                    onClick={proposeIsRevert ? unlikeProfile : likeProfile}
                    disabled={!canShowLikeButton || matchLoading}
                  >
                    <ProposeIcon />
                    <span>{matchLoading ? 'Updating...' : proposeLabel}</span>
                  </button>
                </div>
                <button type="button" className="profile-secondary-btn" onClick={openFriendList}>
                  Friend List
                </button>
                {mutualCount > 0 && <p className="profile-mutuals-inline">{mutualLine}</p>}
              </>
            ) : relationshipStatus === 'blocked' ? (
              blockedBySelf ? (
                <button
                  type="button"
                  className="profile-primary-btn profile-primary-btn-full"
                  onClick={unblockUser}
                  disabled={relationshipLoading}
                >
                  <span>{relationshipLoading ? 'Updating...' : 'Unblock'}</span>
                </button>
              ) : (
                <button type="button" className="profile-muted-btn" disabled>
                  You are blocked
                </button>
              )
            ) : relationshipStatus === 'request_sent' ? (
              justSentRequest ? (
                <button type="button" className="profile-muted-btn" disabled>
                  Request Sent
                </button>
              ) : (
                <button
                  type="button"
                  className="profile-secondary-btn"
                  onClick={cancelConnectionRequest}
                  disabled={relationshipLoading}
                >
                  {relationshipLoading ? 'Cancelling...' : 'Cancel Connection Request'}
                </button>
              )
            ) : relationshipStatus === 'request_received' ? (
              <button type="button" className="profile-primary-btn profile-primary-btn-full" onClick={() => navigate('/connections')}>
                <span>Review Request</span>
              </button>
            ) : (
              <button
                type="button"
                className="profile-primary-btn profile-primary-btn-full"
                onClick={sendConnectionRequest}
                disabled={relationshipLoading}
              >
                <span>{relationshipLoading ? 'Sending...' : '+ Add Friend'}</span>
              </button>
            )}

            {relationshipError && <p className="profile-connection-error">{relationshipError}</p>}
            {matchError && <p className="profile-connection-error">{matchError}</p>}
          </section>
        )}

        {isEditing ? (
          <section className="profile-card profile-edit-form" ref={editSectionRef}>
            <h2>Edit Your Profile</h2>
            <div className="profile-form-grid">
              <div className="profile-form-group">
                <label>Name</label>
                <input type="text" name="name" value={formData.name || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group">
                <label>Username</label>
                <input type="text" name="username" value={formData.username || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group">
                <label>Profession</label>
                <input type="text" name="profession" value={formData.profession || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group">
                <label>Location</label>
                <input type="text" name="place" value={formData.place || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group">
                <label>Age</label>
                <input type="number" name="age" value={formData.age || ''} onChange={handleChange} min={18} max={120} />
              </div>
              <div className="profile-form-group">
                <label>Gender</label>
                <select name="gender" value={String(formData.gender || '').toLowerCase()} onChange={handleChange}>
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="profile-form-group">
                <label>Religion</label>
                <select name="religion" value={String(formData.religion || '').toLowerCase()} onChange={handleChange}>
                  <option value="">Select religion</option>
                  {RELIGION_OPTIONS.map((religion) => (
                    <option key={religion} value={religion}>
                      {toTitleCase(religion)}
                    </option>
                  ))}
                </select>
              </div>
              {(String(formData.religion || '').toLowerCase() === 'other') && (
                <div className="profile-form-group">
                  <label>Religion Other</label>
                  <input type="text" name="religionOther" value={formData.religionOther || ''} onChange={handleChange} />
                </div>
              )}
              <div className="profile-form-group">
                <label>Phone</label>
                <input type="text" name="phone" value={formData.phone || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group">
                <label>Company</label>
                <input type="text" name="company" value={formData.company || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group">
                <label>College</label>
                <input type="text" name="college" value={formData.college || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group">
                <label>Website</label>
                <input type="url" name="websiteUrl" value={formData.websiteUrl || ''} onChange={handleChange} />
              </div>
              <div className="profile-form-group profile-form-group-full">
                <label>Skills (comma-separated)</label>
                <input type="text" name="skills" value={formatListInput(formData.skills)} onChange={handleChange} />
              </div>
              <div className="profile-form-group profile-form-group-full">
                <label>Achievements (comma-separated)</label>
                <input type="text" name="achievements" value={formatListInput(formData.achievements)} onChange={handleChange} />
              </div>
              <div className="profile-form-group profile-form-group-full">
                <label>Bio</label>
                <textarea name="bio" value={formData.bio || ''} onChange={handleChange} rows={4} maxLength={500} />
              </div>
            </div>

            <div className="form-actions">
              <button className="save-button" onClick={handleSave}>Save Changes</button>
              <button className="cancel-button" onClick={handleCancel}>Cancel</button>
            </div>
          </section>
        ) : (
          <div className="profile-layout">
            <section className="profile-card">
              <h3>About</h3>
              <p className="profile-about">{profile.bio || 'No bio added yet.'}</p>
            </section>

            <section className="profile-card">
              <h3>Details</h3>
              <div className="profile-details-grid">
                {isPublicView ? (
                  <>
                    <div className="detail-item">
                      <span>Religion</span>
                      <strong>{displayReligion}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Location</span>
                      <strong>{displayLocation}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Gender</span>
                      <strong>{displayGender}</strong>
                    </div>
                    {profile.company && (
                      <div className="detail-item">
                        <span>Company</span>
                        <strong>{toTitleCase(profile.company)}</strong>
                      </div>
                    )}
                    {profile.college && (
                      <div className="detail-item">
                        <span>College</span>
                        <strong>{toTitleCase(profile.college)}</strong>
                      </div>
                    )}
                    {profile.websiteUrl && (
                      <div className="detail-item detail-item-full">
                        <span>Website</span>
                        <a
                          className="profile-website-btn"
                          href={normalizeWebsite(profile.websiteUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Visit Website
                        </a>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {infoBlocks.map((item) => (
                      <div key={item.label} className="detail-item">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                    <div className="detail-item detail-item-full">
                      <span>Website</span>
                      {profile.websiteUrl ? (
                        <a
                          className="profile-website-btn"
                          href={normalizeWebsite(profile.websiteUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Visit Website
                        </a>
                      ) : (
                        <strong>Not shared</strong>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="profile-card">
              <h3>Skills</h3>
              <div className="skills-container">
                {(profile.skills || []).length > 0 ? (
                  profile.skills.map((skill: string, index: number) => (
                    <span key={index} className="skill-tag">{skill}</span>
                  ))
                ) : (
                  <p className="profile-empty-text">No skills added yet.</p>
                )}
              </div>
            </section>

            <section className="profile-card">
              <h3>Achievements</h3>
              {(profile.achievements || []).length > 0 ? (
                <ul className="achievements-list">
                  {profile.achievements.map((achievement: string, index: number) => (
                    <li key={index}>{achievement}</li>
                  ))}
                </ul>
              ) : (
                <p className="profile-empty-text">No achievements listed yet.</p>
              )}
            </section>
          </div>
        )}
        </div>

        {isPublicView && (
          <footer className="profile-footer">
            <button
              type="button"
              className="profile-footer-action"
              onClick={unfriendUser}
              disabled={relationshipLoading || relationshipStatus !== 'connected'}
            >
              <UnfriendIcon />
              <span>{relationshipLoading && relationshipStatus === 'connected' ? 'Updating...' : 'Unfriend'}</span>
            </button>
            <span className="profile-footer-divider" aria-hidden="true" />
            <button
              type="button"
              className="profile-footer-action"
              onClick={blockedBySelf ? unblockUser : blockUser}
              disabled={relationshipLoading || (relationshipStatus === 'blocked' && !blockedBySelf)}
            >
              <BlockIcon />
              <span>{relationshipLoading ? 'Updating...' : blockedBySelf ? 'Unblock' : 'Block'}</span>
            </button>
          </footer>
        )}
      </AppContainer>

      {showChangePassword && (
        <div
          className="profile-modal-backdrop"
          onClick={() => {
            if (passwordLoading) return;
            setShowChangePassword(false);
          }}
        >
          <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-header">
              <h3>Change Password</h3>
              <button
                type="button"
                className="profile-modal-close"
                onClick={() => setShowChangePassword(false)}
                disabled={passwordLoading}
                aria-label="Close password modal"
              >
                x
              </button>
            </div>

            <div className="change-password-panel profile-change-password-panel">
              <div className="change-password-row">
                <button
                  type="button"
                  className="change-password-otp-btn"
                  onClick={requestChangePasswordOtp}
                  disabled={passwordLoading}
                >
                  {passwordLoading ? 'Sending OTP...' : 'Send OTP'}
                </button>
              </div>

              <div className="change-password-fields">
                <input
                  type="password"
                  name="currentPassword"
                  value={passwordData.currentPassword}
                  onChange={handlePasswordChangeInput}
                  placeholder="Current password"
                />
                <input
                  type="password"
                  name="newPassword"
                  value={passwordData.newPassword}
                  onChange={handlePasswordChangeInput}
                  placeholder="New password"
                />
                <input
                  type="password"
                  name="confirmPassword"
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChangeInput}
                  placeholder="Confirm new password"
                />
                <input
                  type="text"
                  name="otp"
                  value={passwordData.otp}
                  onChange={handlePasswordChangeInput}
                  placeholder="OTP from email"
                  disabled={!passwordOtpSent}
                />
              </div>

              <button
                type="button"
                className="change-password-confirm-btn"
                onClick={confirmChangePassword}
                disabled={passwordLoading || !passwordOtpSent}
              >
                {passwordLoading ? 'Updating...' : 'Confirm Password Change'}
              </button>

              {passwordMessage && <p className="password-message">{passwordMessage}</p>}
              {passwordError && <p className="password-error">{passwordError}</p>}
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="profile-modal-backdrop"
          onClick={() => {
            if (deleteLoading) return;
            setShowDeleteConfirm(false);
          }}
        >
          <div className="profile-modal-card profile-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Account</h3>
            <p>Are you sure? This action is permanent.</p>
            <div className="profile-modal-actions">
              <button
                type="button"
                className="profile-modal-btn profile-modal-btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="profile-modal-btn profile-modal-btn-danger"
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCoverCropOpen && (
        <div
          className="profile-modal-backdrop"
          onClick={() => {
            if (coverUploading) return;
            setIsCoverCropOpen(false);
            setCoverCropSource(null);
            setCoverImageSize(null);
          }}
        >
          <div className="profile-modal-card profile-cover-crop-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-header">
              <h3>Crop Cover Photo</h3>
              <button
                type="button"
                className="profile-modal-close"
                onClick={() => {
                  setIsCoverCropOpen(false);
                  setCoverCropSource(null);
                  setCoverImageSize(null);
                }}
                disabled={coverUploading}
                aria-label="Close cover crop modal"
              >
                x
              </button>
            </div>

            <div className="profile-cover-crop-preview">
              <canvas ref={coverCropPreviewRef} />
            </div>

            <div className="profile-cover-crop-controls">
              <label>
                Zoom
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={coverCropZoom}
                  onChange={(e) => setCoverCropZoom(parseFloat(e.target.value))}
                />
              </label>
              <label>
                Horizontal
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={coverCropX}
                  onChange={(e) => setCoverCropX(parseInt(e.target.value, 10))}
                />
              </label>
              <label>
                Vertical
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={coverCropY}
                  onChange={(e) => setCoverCropY(parseInt(e.target.value, 10))}
                />
              </label>
            </div>

            {coverCropError && <p className="profile-cover-error">{coverCropError}</p>}

            <div className="profile-modal-actions">
              <button
                type="button"
                className="profile-modal-btn profile-modal-btn-secondary"
                onClick={() => {
                  setIsCoverCropOpen(false);
                  setCoverCropSource(null);
                  setCoverImageSize(null);
                }}
                disabled={coverUploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="profile-modal-btn profile-modal-btn-primary"
                onClick={handleApplyCoverCrop}
                disabled={coverUploading}
              >
                {coverUploading ? 'Saving...' : 'Apply Crop'}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
        onChange={handleProfilePhotoFile}
        className="hidden-photo-input"
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
        onChange={handleCoverPhotoFile}
        className="hidden-photo-input"
      />

      {isPhotoPreviewOpen && (
        <div
          className="photo-lightbox"
          onClick={() => {
            setIsPhotoPreviewOpen(false);
            setSelectedPhoto(null);
            setPendingPhoto(null);
          }}
        >
          <button
            type="button"
            className="photo-lightbox-close"
            onClick={() => {
              setIsPhotoPreviewOpen(false);
              setSelectedPhoto(null);
              setPendingPhoto(null);
            }}
            aria-label="Close photo preview"
          >
            x
          </button>
          <div className="photo-lightbox-body" onClick={(e) => e.stopPropagation()}>
            {selectedPhoto ? (
              <img src={selectedPhoto} alt="Profile preview" className="photo-lightbox-image" />
            ) : (
              <div className="photo-lightbox-fallback">{getInitial(profile.name)}</div>
            )}
            {isOwnProfile && pendingPhoto && (
              <button
                type="button"
                className="photo-confirm-btn"
                onClick={handleConfirmProfilePhoto}
                disabled={photoUploading}
              >
                {photoUploading ? 'Updating photo...' : 'Confirm Photo'}
              </button>
            )}
            {photoError && isOwnProfile && (
              <p className="photo-lightbox-error">{photoError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfilePage;
