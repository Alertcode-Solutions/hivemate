import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import AppContainer from '../components/ui/AppContainer';
import PageHeader from '../components/ui/PageHeader';
import { goToProfile } from '../utils/profileRouting';
import { fetchJsonCached, invalidateApiCacheByUrl } from '../utils/apiCache';
import BeeLoader from '../components/BeeLoader';
import useSmoothLoader from '../hooks/useSmoothLoader';
import './FriendsPage.css';

interface Friend {
  friendshipId: string;
  friendId: string;
  name: string;
  profession?: string;
  place?: string;
  bio?: string;
  photos?: string[];
  communicationLevel: string;
}

const BackArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5L8 12L15 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FriendsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const { showLoader, complete, handleLoaderComplete } = useSmoothLoader(loading);

  const API_URL = getApiBaseUrl();
  const currentUserId = localStorage.getItem('userId') || '';
  const isOwnList = !userId || String(userId) === String(currentUserId);
  const handleUnauthorized = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('privateKey');
    localStorage.removeItem('publicKey');
    navigate('/login');
  };

  useEffect(() => {
    fetchFriends();
  }, [userId]);

  const fetchFriends = async (forceRefresh = false) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        handleUnauthorized();
        return;
      }
      const endpoint = isOwnList ? `${API_URL}/api/friends` : `${API_URL}/api/friends/user/${userId}`;
      const data = await fetchJsonCached<any>(
        endpoint,
        {
          headers: { Authorization: `Bearer ${token}` }
        },
        {
          ttlMs: 30000,
          forceRefresh
        }
      );
      setFriends(data.friends || []);
      if (!isOwnList && data.owner?.name) {
        setOwnerName(data.owner.name);
      } else {
        setOwnerName('');
      }
    } catch (error: any) {
      if (error?.status === 401) {
        handleUnauthorized();
        return;
      }
      console.error('Failed to fetch friends:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFriend = async (friendshipId: string) => {
    if (!confirm('Are you sure you want to remove this friend?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/friends/${friendshipId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        setFriends((prev) => prev.filter((friend) => friend.friendshipId !== friendshipId));
        invalidateApiCacheByUrl('/api/friends');
        invalidateApiCacheByUrl('/api/connections/pending');
        fetchFriends(true);
      }
    } catch (error) {
      console.error('Failed to remove friend:', error);
    }
  };

  const handleBlockFriend = async (friendshipId: string) => {
    if (!confirm('Are you sure you want to block this user?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/friends/${friendshipId}/block`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        setFriends((prev) => prev.filter((friend) => friend.friendshipId !== friendshipId));
        invalidateApiCacheByUrl('/api/friends');
        invalidateApiCacheByUrl('/api/connections/pending');
        fetchFriends(true);
      }
    } catch (error) {
      console.error('Failed to block friend:', error);
    }
  };

  const filteredFriends = friends.filter((friend) =>
    (friend.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getInitial = (name?: string) => (name?.charAt(0).toUpperCase() || 'U');

  if (showLoader) {
    return <BeeLoader message="Loading friends..." fullscreen complete={complete} onComplete={handleLoaderComplete} />;
  }

  return (
    <div className="friends-page">
      <AppContainer size="sm">
        <div className="friends-container ui-card">
          <PageHeader
            title={isOwnList ? 'Friends' : `${ownerName || 'User'}'s Friends`}
            leftSlot={
              <button className="friends-back-button" onClick={() => navigate('/home')} aria-label="Go back">
                <BackArrowIcon />
              </button>
            }
          />

          <div className="friends-search-wrap">
            <input
              type="text"
              placeholder="Search friends..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="friends-search-input"
            />
          </div>

          {filteredFriends.length === 0 ? (
            <div className="no-friends">
              <p>No friends yet</p>
              <p className="subtitle">Incoming requests are available in Connections.</p>
            </div>
          ) : (
            <div className="friends-list">
              {filteredFriends.map((friend) => (
                <div key={friend.friendshipId} className="friend-card">
                  <div
                    className="friend-info"
                    role="button"
                    tabIndex={0}
                    onClick={() => goToProfile(navigate, friend.friendId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        goToProfile(navigate, friend.friendId);
                      }
                    }}
                  >
                    <div className="friend-avatar-wrap">
                      {friend.photos?.[0] ? (
                        <img src={friend.photos[0]} alt={friend.name} className="friend-avatar" />
                      ) : (
                        <span className="friend-avatar-fallback">{getInitial(friend.name)}</span>
                      )}
                    </div>
                    <div className="friend-meta">
                      <h3>{friend.name}</h3>
                      <p className="profession">{friend.profession || 'No profession shared'}</p>
                      {friend.place && <span className="friend-place">{friend.place}</span>}
                    </div>
                  </div>
                  {isOwnList && (
                    <div className="friend-actions">
                      <button
                        className="message-btn ui-btn ui-btn-primary"
                        onClick={() =>
                          navigate(`/chat/${friend.friendId}`, {
                            state: { from: `${location.pathname}${location.search}` }
                          })
                        }
                      >
                        Message
                      </button>
                      <button className="remove-btn ui-btn ui-btn-secondary" onClick={() => handleRemoveFriend(friend.friendshipId)}>
                        Remove
                      </button>
                      <button className="block-btn ui-btn ui-btn-ghost" onClick={() => handleBlockFriend(friend.friendshipId)}>
                        Block
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </AppContainer>
    </div>
  );
};

export default FriendsPage;
