import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppContainer from '../components/ui/AppContainer';
import { getApiBaseUrl } from '../utils/runtimeConfig';
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

const ProfilePage = () => {
  const navigate = useNavigate();
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

  const fetchRelationship = async (targetUserId: string, profileAccessLevel?: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token || !targetUserId) return;
      setRelationshipLoading(true);
      setRelationshipError('');

      const [pendingResult, friendsResult, friendshipStatusResult] = await Promise.allSettled([
        fetch(`${API_URL}/api/connections/pending`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/friends`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/friends/status/${targetUserId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      let resolvedStatus: RelationshipStatus = 'none';
      let resolvedSentRequestId = '';

      const candidateIds = new Set(
        [targetUserId, paramUserId, profile?.userId, profile?.id].filter(Boolean).map((value) => normalizeId(value))
      );

      if (friendsResult.status === 'fulfilled' && friendsResult.value.ok) {
        const friendsData = await friendsResult.value.json();
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

      if (resolvedStatus !== 'connected' && pendingResult.status === 'fulfilled' && pendingResult.value.ok) {
        const pendingData = await pendingResult.value.json();
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

      if (friendshipStatusResult.status === 'fulfilled' && friendshipStatusResult.value.ok) {
        const friendshipStatus = await friendshipStatusResult.value.json();
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
    } catch (error) {
      console.error('Failed to fetch relationship:', error);
      setRelationshipError('Failed to load connection status.');
    } finally {
      setRelationshipLoading(false);
    }
  };

  const fetchMatchStatus = async (targetUserId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token || !targetUserId) return;
      setMatchLoading(true);
      setMatchError('');
      const response = await fetch(`${API_URL}/api/match/status/${targetUserId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to load match status');
      }

      const data = await response.json();
      setMatchStatus(data);
    } catch (error: any) {
      setMatchStatus(null);
      setMatchError(error?.message || 'Failed to load match status');
    } finally {
      setMatchLoading(false);
    }
  };

  const fetchProfile = async (userId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        handleUnauthorized();
        return;
      }
      const response = await fetch(`${API_URL}/api/profiles/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        const resolvedAccessLevel = data.accessLevel || '';
        const normalizedProfile = {
          ...data.profile,
          photos: toSinglePhotoArray(data.profile?.photos)
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
          await fetchRelationship(userId, resolvedAccessLevel);
          await fetchMatchStatus(userId);
        } else {
          setRelationshipStatus('connected');
          setMatchStatus(null);
        }
      } else if (response.status === 401) {
        handleUnauthorized();
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setPhotoError('');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormData(profile);
    setPhotoError('');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const compressImageToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxWidth = 720;
          const maxHeight = 720;
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
          resolve(canvas.toDataURL('image/jpeg', 0.78));
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
      photos: toSinglePhotoArray(data.profile?.photos)
    };
    setProfile(normalizedProfile);
    setFormData(normalizedProfile);
    return normalizedProfile;
  };

  const handleProfilePhotoFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setPhotoError('Please upload a JPEG, PNG, WebP, or GIF image.');
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
    navigate(`/chat?user=${encodeURIComponent(targetUserId)}`);
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
          await fetchRelationship(String(targetUserId), accessLevel);
          return;
        }
        throw new Error(message);
      }

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

      setRelationshipStatus('none');
      setAccessLevel('public');
      setMutualCount(0);
      setMutualFriends([]);
      setSentRequestId('');
      setJustSentRequest(false);
      await fetchProfile(String(targetUserId));
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

      setBlockedBySelf(false);
      setRelationshipStatus('connected');
      await fetchRelationship(String(targetUserId), accessLevel);
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

      await fetchMatchStatus(targetUserId);
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

      await fetchMatchStatus(targetUserId);
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

  const handleDeleteAccount = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    const confirmed = window.confirm(
      'Delete your account permanently? This action cannot be undone.'
    );
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/profiles/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to delete account');
      }

      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('privateKey');
      localStorage.removeItem('publicKey');
      navigate('/register');
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to delete account');
    }
  };

  if (showLoader) {
    return <BeeLoader message="Loading profile..." fullscreen complete={complete} onComplete={handleLoaderComplete} />;
  }

  if (!profile) {
    return <div className="profile-error">Profile not found</div>;
  }

  const primaryPhoto = profile.photos?.[0] || '';
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

  return (
    <div className="profile-page">
      <AppContainer className="profile-shell" size="sm">
        <div className="profile-topbar">
          <button className="profile-nav-btn" onClick={() => navigate('/home')} aria-label="Go back">
            <BackIcon />
          </button>
          {isOwnProfile && !isEditing && (
            <button className="profile-edit-btn" onClick={handleEdit}>
              Edit Profile
            </button>
          )}
        </div>

        <section className="profile-hero">
          <div className="profile-hero-bg"></div>
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
              {showHeart && <span className="profile-match-heart" title="Matched">💖</span>}
            </h1>
            {profile.username && <p className="profile-username">@{profile.username}</p>}
            <p>{displayProfession}</p>
            <div className="profile-badges">
              {profile.age && <span className="owner-badge">{profile.age} yrs</span>}
              {displayReligion !== 'Not shared' && <span className="owner-badge">{displayReligion}</span>}
              {verified && <span className="verified-badge">Verified</span>}
            </div>
          </div>

          {isPublicView && (
            <div className="profile-hero-actions">
              {relationshipStatus === 'connected' ? (
                <>
                  <button
                    type="button"
                    className="profile-action-danger"
                    onClick={unfriendUser}
                    disabled={relationshipLoading}
                  >
                    {relationshipLoading ? 'Updating...' : 'Unfriend'}
                  </button>
                  <button type="button" className="profile-action-primary" onClick={openChatWithUser}>
                    Chat
                  </button>
                  <button type="button" className="profile-action-primary" onClick={openFriendList}>
                    Friend List
                  </button>
                  {canShowLikeButton && (
                    (isMatched || Boolean(matchStatus?.likedByMe)) ? (
                      <button
                        type="button"
                        className="profile-action-secondary"
                        onClick={unlikeProfile}
                        disabled={matchLoading}
                      >
                        {matchLoading ? 'Updating...' : (isMatched ? 'Break Up' : 'Withdraw Proposal')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="profile-action-secondary"
                        onClick={likeProfile}
                        disabled={matchLoading}
                      >
                        {matchLoading ? 'Updating...' : 'Propose'}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    className="profile-action-danger"
                    onClick={blockUser}
                    disabled={relationshipLoading}
                  >
                    {relationshipLoading ? 'Updating...' : 'Block'}
                  </button>
                </>
              ) : relationshipStatus === 'blocked' ? (
                blockedBySelf ? (
                  <button
                    type="button"
                    className="profile-action-primary profile-action-full"
                    onClick={unblockUser}
                    disabled={relationshipLoading}
                  >
                    {relationshipLoading ? 'Updating...' : 'Unblock'}
                  </button>
                ) : (
                  <button type="button" className="profile-action-muted profile-action-full" disabled>
                    You are blocked
                  </button>
                )
              ) : relationshipStatus === 'request_sent' ? (
                justSentRequest ? (
                  <button type="button" className="profile-action-muted profile-action-full" disabled>
                    Request Sent
                  </button>
                ) : (
                  <button
                    type="button"
                    className="profile-action-danger profile-action-full"
                    onClick={cancelConnectionRequest}
                    disabled={relationshipLoading}
                  >
                    {relationshipLoading ? 'Cancelling...' : 'Cancel Connection Request'}
                  </button>
                )
              ) : relationshipStatus === 'request_received' ? (
                <button type="button" className="profile-action-primary" onClick={() => navigate('/connections')}>
                  Review Request
                </button>
              ) : (
                <button
                  type="button"
                  className="profile-action-primary profile-action-full"
                  onClick={sendConnectionRequest}
                  disabled={relationshipLoading}
                >
                  {relationshipLoading ? 'Sending...' : '+ Add Friend'}
                </button>
              )}
              {mutualCount > 0 && (
                <p className="profile-mutuals">
                  {mutualCount} mutual {mutualCount === 1 ? 'friend' : 'friends'}
                  {mutualFriends.length > 0 ? ` • ${mutualFriends.map((friend) => friend.name).join(', ')}` : ''}
                </p>
              )}
              {relationshipError && <p className="profile-connection-error">{relationshipError}</p>}
              {matchError && <p className="profile-connection-error">{matchError}</p>}
            </div>
          )}

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

        {isEditing ? (
          <section className="profile-card profile-edit-form">
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

            {isOwnProfile && (
              <section className="profile-card quick-actions">
                <h3>Quick Actions</h3>
                <div className="quick-actions-grid">
                  <button
                    onClick={() => {
                      setShowChangePassword((prev) => !prev);
                      setPasswordError('');
                      setPasswordMessage('');
                    }}
                  >
                    Change Password
                  </button>
                  <button className="danger-action-button" onClick={handleDeleteAccount}>
                    Delete Account Permanently
                  </button>
                </div>

                {showChangePassword && (
                  <div className="change-password-panel">
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
                )}
              </section>
            )}
          </div>
        )}
      </AppContainer>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleProfilePhotoFile}
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
            ×
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
