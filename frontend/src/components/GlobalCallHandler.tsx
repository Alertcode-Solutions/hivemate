import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Socket } from 'socket.io-client';
import CallModal from './CallModal';
import { useToast } from './Toast';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { acquireSharedSocket, releaseSharedSocket } from '../utils/socketManager';

type ActiveCall = {
  callId: string;
  type: 'voice' | 'video';
  isIncoming: boolean;
  callerName?: string;
  callerId?: string;
};

const normalizeId = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.$oid) return String(value.$oid);
    if (value._id) return normalizeId(value._id);
  }
  return String(value);
};

const GlobalCallHandler = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const socketRef = useRef<Socket | null>(null);
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem('token') || '');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [autoAcceptIncoming, setAutoAcceptIncoming] = useState(false);
  const hasActiveCallRef = useRef(false);
  const activeCallIdRef = useRef<string>('');
  const callStatusFetchInFlightRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    hasActiveCallRef.current = showCallModal && Boolean(activeCall);
    activeCallIdRef.current = activeCall?.callId || '';
    (window as any).__hivemateCallOverlayActive = hasActiveCallRef.current;
  }, [showCallModal, activeCall]);

  const openChatFallback = (callerId?: string) => {
    const normalizedCallerId = normalizeId(callerId);
    if (normalizedCallerId) {
      navigate(`/chat?user=${encodeURIComponent(normalizedCallerId)}`);
      return;
    }
    navigate('/chat');
  };

  const tryOpenCallFromNotification = async (params: {
    callId: string;
    type: 'voice' | 'video';
    callerId?: string;
    callerName?: string;
    autoAnswer?: boolean;
  }) => {
    const { callId, type, callerId = '', callerName = 'Unknown', autoAnswer = false } = params;

    if (!callId) {
      openChatFallback(callerId);
      return;
    }

    if (hasActiveCallRef.current) {
      if (socketRef.current && callerId) {
        socketRef.current.emit('call:reject', {
          callId,
          initiatorId: callerId,
          reason: 'busy'
        });
      }
      return;
    }

    if (callStatusFetchInFlightRef.current[callId]) return;
    callStatusFetchInFlightRef.current[callId] = true;

    try {
      const token = localStorage.getItem('token');
      const API_URL = getApiBaseUrl();
      const response = await fetch(`${API_URL}/api/calls/${callId}/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        openChatFallback(callerId);
        return;
      }

      const data = await response.json();
      const active = Boolean(data?.call?.active);
      if (!active) {
        openChatFallback(callerId);
        return;
      }

      setActiveCall({
        callId,
        type,
        isIncoming: true,
        callerId,
        callerName
      });
      setAutoAcceptIncoming(Boolean(autoAnswer));
      setShowCallModal(true);
    } catch {
      openChatFallback(callerId);
    } finally {
      delete callStatusFetchInFlightRef.current[callId];
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    if (token !== authToken) {
      setAuthToken(token);
    }
  }, [location.pathname, location.search, authToken]);

  useEffect(() => {
    const syncToken = () => {
      const token = localStorage.getItem('token') || '';
      setAuthToken((prev) => (prev === token ? prev : token));
    };
    window.addEventListener('storage', syncToken);
    window.addEventListener('focus', syncToken);
    return () => {
      window.removeEventListener('storage', syncToken);
      window.removeEventListener('focus', syncToken);
    };
  }, []);

  useEffect(() => {
    if (!authToken) {
      if (socketRef.current) {
        releaseSharedSocket();
        socketRef.current = null;
      }
      return;
    }

    const socket = acquireSharedSocket();
    if (!socket) return;

    const handleIncomingCall = (data: any) => {
      const incomingCallId = String(data?.callId || '');
      if (!incomingCallId) return;

      if (activeCallIdRef.current && activeCallIdRef.current === incomingCallId) {
        return;
      }

      const anyOverlayActive = Boolean((window as any).__hivemateCallOverlayActive);
      if (hasActiveCallRef.current || anyOverlayActive) {
        const initiatorId = normalizeId(data.initiatorId);
        if (initiatorId) {
          socket.emit('call:reject', {
            callId: incomingCallId,
            initiatorId,
            reason: 'busy'
          });
        }
        return;
      }

      setActiveCall({
        callId: incomingCallId,
        type: data.type === 'video' ? 'video' : 'voice',
        isIncoming: true,
        callerName: data.initiatorName || 'Unknown',
        callerId: normalizeId(data.initiatorId)
      });
      showToast(`Incoming ${data.type === 'video' ? 'video' : 'voice'} call from ${data.initiatorName || 'Unknown'}`, 'info', 5000);
      setAutoAcceptIncoming(false);
      setShowCallModal(true);
    };

    socket.on('call:incoming', handleIncomingCall);
    socketRef.current = socket;

    return () => {
      (window as any).__hivemateCallOverlayActive = false;
      socket.off('call:incoming', handleIncomingCall);
      releaseSharedSocket();
      socketRef.current = null;
    };
  }, [authToken]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleSwNavigationMessage = (event: MessageEvent) => {
      const message = event.data || {};
      if (message.type !== 'NAVIGATE_TO_CHAT') return;

      const messageUrl = String(message.url || '/chat');
      let nextPath = '/chat';
      try {
        const parsed = new URL(messageUrl, window.location.origin);
        nextPath = `${parsed.pathname}${parsed.search}`;
      } catch {
        nextPath = messageUrl;
      }

      navigate(nextPath);
    };

    navigator.serviceWorker.addEventListener('message', handleSwNavigationMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSwNavigationMessage);
  }, [navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('incomingCall') !== '1') return;

    const callId = params.get('callId') || '';
    const type = params.get('type') === 'video' ? 'video' : 'voice';
    const callerId = params.get('from') || '';
    const callerName = params.get('name') || 'Unknown';
    const autoAnswer = params.get('autoAnswer') === '1';

    if (!callId) return;

    params.delete('incomingCall');
    params.delete('callId');
    params.delete('type');
    params.delete('from');
    params.delete('name');
    params.delete('autoAnswer');
    const nextSearch = params.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true });

    void tryOpenCallFromNotification({
      callId,
      type,
      callerId,
      callerName,
      autoAnswer
    });
  }, [location.pathname, location.search, navigate]);

  const closeModal = () => {
    setShowCallModal(false);
    setActiveCall(null);
    setAutoAcceptIncoming(false);
  };

  const handleEndCall = async () => {
    if (activeCall?.callId) {
      try {
        const token = localStorage.getItem('token');
        const API_URL = getApiBaseUrl();
        await fetch(`${API_URL}/api/calls/${activeCall.callId}/end`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (error) {
        console.error('Failed to end call from global handler:', error);
      }
    }
    closeModal();
  };

  if (!showCallModal || !activeCall) return null;

  return (
    <CallModal
      callId={activeCall.callId}
      callType={activeCall.type}
      isIncoming={activeCall.isIncoming}
      callerName={activeCall.callerName}
      callerId={activeCall.callerId}
      autoAccept={autoAcceptIncoming}
      onAccept={() => undefined}
      onReject={closeModal}
      onEnd={handleEndCall}
      socket={socketRef.current}
    />
  );
};

export default GlobalCallHandler;
