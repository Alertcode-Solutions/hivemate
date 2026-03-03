import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { acquireSharedSocket, releaseSharedSocket } from '../utils/socketManager';
import AppContainer from '../components/ui/AppContainer';
import PageHeader from '../components/ui/PageHeader';
import { goToProfile } from '../utils/profileRouting';
import { fetchJsonCached, invalidateApiCacheByUrl } from '../utils/apiCache';
import BeeLoader from '../components/BeeLoader';
import useSmoothLoader from '../hooks/useSmoothLoader';
import './ConnectionsPage.css';

interface ConnectionRequest {
  id: string;
  senderId?: string;
  senderName?: string;
  senderProfession?: string;
  senderPhoto?: string;
  receiverId?: string;
  receiverName?: string;
  receiverProfession?: string;
  receiverPhoto?: string;
  createdAt: string;
}

const BackArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5L8 12L15 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ConnectionsPage = () => {
  const navigate = useNavigate();
  const [received, setReceived] = useState<ConnectionRequest[]>([]);
  const [sent, setSent] = useState<ConnectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');
  const { showLoader, complete, handleLoaderComplete } = useSmoothLoader(loading);

  const API_URL = getApiBaseUrl();

  useEffect(() => {
    fetchRequests();
  }, []);

  useEffect(() => {
    const onSoftRefresh = () => {
      fetchRequests();
    };

    window.addEventListener('hivemate:soft-refresh', onSoftRefresh as EventListener);
    return () => {
      window.removeEventListener('hivemate:soft-refresh', onSoftRefresh as EventListener);
    };
  }, []);

  useEffect(() => {
    const socket = acquireSharedSocket();
    if (!socket) return;

    const refresh = () => {
      fetchRequests();
    };
    const onNotification = (notification: any) => {
      if (notification?.type === 'friend_request' || notification?.type === 'friend_accepted') {
        refresh();
      }
    };

    socket.on('connections:pending_updated', refresh);
    socket.on('friendship:established', refresh);
    socket.on('notification:new', onNotification);

    return () => {
      socket.off('connections:pending_updated', refresh);
      socket.off('friendship:established', refresh);
      socket.off('notification:new', onNotification);
      releaseSharedSocket();
    };
  }, []);

  const fetchRequests = async (forceRefresh = false) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setReceived([]);
        setSent([]);
        return;
      }
      const data = await fetchJsonCached<any>(
        `${API_URL}/api/connections/pending`,
        {
          headers: { Authorization: `Bearer ${token}` }
        },
        {
          ttlMs: 15000,
          forceRefresh
        }
      );
      setReceived(data.received || []);
      setSent(data.sent || []);
    } catch (error: any) {
      if (error?.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        localStorage.removeItem('privateKey');
        localStorage.removeItem('publicKey');
        navigate('/login');
        return;
      }
      console.error('Failed to fetch requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (requestId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/connections/${requestId}/accept`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        // Optimistic local update for instant UI response.
        setReceived((prev) => prev.filter((request) => request.id !== requestId));
        invalidateApiCacheByUrl('/api/connections/pending');
        invalidateApiCacheByUrl('/api/friends');
        fetchRequests(true);
      }
    } catch (error) {
      console.error('Failed to accept request:', error);
    }
  };

  const handleDecline = async (requestId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/connections/${requestId}/decline`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        // Optimistic local update for instant UI response.
        setReceived((prev) => prev.filter((request) => request.id !== requestId));
        invalidateApiCacheByUrl('/api/connections/pending');
        fetchRequests(true);
      }
    } catch (error) {
      console.error('Failed to decline request:', error);
    }
  };

  const getInitial = (name?: string) => (name?.charAt(0).toUpperCase() || 'U');

  if (showLoader) {
    return <BeeLoader message="Loading requests..." fullscreen complete={complete} onComplete={handleLoaderComplete} />;
  }

  const renderReceived = () => {
    if (received.length === 0) {
      return <div className="no-requests">No pending requests</div>;
    }

    return received.map((request) => (
      <div key={request.id} className="request-card">
        <div className="request-info">
          <div
            className="request-avatar-wrap clickable"
            role="button"
            tabIndex={0}
            onClick={() => goToProfile(navigate, request.senderId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToProfile(navigate, request.senderId);
              }
            }}
            aria-label={`Open ${request.senderName || 'user'} profile`}
          >
            {request.senderPhoto ? (
              <img src={request.senderPhoto} alt={request.senderName || 'User'} className="request-avatar-img" />
            ) : (
              <div className="request-avatar">{getInitial(request.senderName)}</div>
            )}
          </div>
          <div
            className="request-meta clickable"
            role="button"
            tabIndex={0}
            onClick={() => goToProfile(navigate, request.senderId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToProfile(navigate, request.senderId);
              }
            }}
            aria-label={`Open ${request.senderName || 'user'} profile`}
          >
            <h3>{request.senderName || 'Unknown User'}</h3>
            <p className="profession">{request.senderProfession || 'No profession shared'}</p>
            <p className="date">{new Date(request.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="request-actions">
          <button className="accept-btn ui-btn ui-btn-primary" onClick={() => handleAccept(request.id)}>
            Accept
          </button>
          <button className="decline-btn ui-btn ui-btn-secondary" onClick={() => handleDecline(request.id)}>
            Decline
          </button>
        </div>
      </div>
    ));
  };

  const renderSent = () => {
    if (sent.length === 0) {
      return <div className="no-requests">No pending requests</div>;
    }

    return sent.map((request) => (
      <div key={request.id} className="request-card sent">
        <div className="request-info">
          <div
            className="request-avatar-wrap clickable"
            role="button"
            tabIndex={0}
            onClick={() => goToProfile(navigate, request.receiverId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToProfile(navigate, request.receiverId);
              }
            }}
            aria-label={`Open ${request.receiverName || 'user'} profile`}
          >
            {request.receiverPhoto ? (
              <img src={request.receiverPhoto} alt={request.receiverName || 'User'} className="request-avatar-img" />
            ) : (
              <div className="request-avatar">{getInitial(request.receiverName)}</div>
            )}
          </div>
          <div
            className="request-meta clickable"
            role="button"
            tabIndex={0}
            onClick={() => goToProfile(navigate, request.receiverId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToProfile(navigate, request.receiverId);
              }
            }}
            aria-label={`Open ${request.receiverName || 'user'} profile`}
          >
            <h3>{request.receiverName || 'Unknown User'}</h3>
            <p className="profession">{request.receiverProfession || 'No profession shared'}</p>
            <p className="date">Sent on {new Date(request.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <span className="status-badge pending">Pending</span>
      </div>
    ));
  };

  return (
    <div className="connections-page">
      <AppContainer size="sm">
        <div className="connections-container ui-card">
          <PageHeader
            title="Connection Requests"
            leftSlot={
              <button className="connections-back-button" onClick={() => navigate('/home')} aria-label="Go back">
                <BackArrowIcon />
              </button>
            }
          />

          <div className="connections-tabs">
            <button
              className={`connections-tab ${activeTab === 'received' ? 'active' : ''}`}
              onClick={() => setActiveTab('received')}
            >
              Received ({received.length})
            </button>
            <button
              className={`connections-tab ${activeTab === 'sent' ? 'active' : ''}`}
              onClick={() => setActiveTab('sent')}
            >
              Sent ({sent.length})
            </button>
          </div>

          <div className="requests-list">
            {activeTab === 'received' ? renderReceived() : renderSent()}
          </div>
        </div>
      </AppContainer>
    </div>
  );
};

export default ConnectionsPage;
