import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Socket } from 'socket.io-client';
import CallModal from './CallModal';
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
  const socketRef = useRef<Socket | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [autoAcceptIncoming, setAutoAcceptIncoming] = useState(false);
  const hasActiveCallRef = useRef(false);
  const activeCallIdRef = useRef<string>('');

  useEffect(() => {
    hasActiveCallRef.current = showCallModal && Boolean(activeCall);
    activeCallIdRef.current = activeCall?.callId || '';
    (window as any).__hivemateCallOverlayActive = hasActiveCallRef.current;
  }, [showCallModal, activeCall]);

  useEffect(() => {
    const socket = acquireSharedSocket();
    if (!socket) return;

    const handleIncomingCall = (data: any) => {
      const incomingCallId = String(data?.callId || '');
      if (!incomingCallId) return;

      // Ignore duplicate events for the currently active call.
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
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('incomingCall') !== '1') return;

    const callId = params.get('callId') || '';
    const type = params.get('type') === 'video' ? 'video' : 'voice';
    const callerId = params.get('from') || '';
    const callerName = params.get('name') || 'Unknown';
    const autoAnswer = params.get('autoAnswer') === '1';

    if (!callId) return;
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

    setActiveCall({
      callId,
      type,
      isIncoming: true,
      callerId,
      callerName
    });
    setAutoAcceptIncoming(autoAnswer);
    setShowCallModal(true);

    params.delete('incomingCall');
    params.delete('callId');
    params.delete('type');
    params.delete('from');
    params.delete('name');
    params.delete('autoAnswer');
    const nextSearch = params.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true });
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
