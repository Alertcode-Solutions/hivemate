import { useEffect, useRef, useState } from 'react';
import { BrowserCompatibility } from '../utils/browserCompatibility';
import './CallModal.css';

interface CallModalProps {
  callId: string;
  callType: 'voice' | 'video';
  isIncoming: boolean;
  callerName?: string;
  callerId?: string;
  autoAccept?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  socket: any;
}

type OutputMode = 'speaker' | 'earpiece' | 'bluetooth';
type OutputOption = {
  mode: OutputMode;
  label: string;
  sinkId: string;
  available: boolean;
};

const buildIceServers = (): RTCIceServer[] => {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const turnUrl = String(import.meta.env.VITE_TURN_URL || '').trim();
  const turnUsername = String(import.meta.env.VITE_TURN_USERNAME || '').trim();
  const turnCredential = String(import.meta.env.VITE_TURN_CREDENTIAL || '').trim();

  if (turnUrl) {
    servers.unshift({
      urls: turnUrl,
      username: turnUsername || undefined,
      credential: turnCredential || undefined
    });
  }

  return servers;
};

const isCallDebugEnabled = () => {
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem('debug-call') === '1';
  } catch {
    return false;
  }
};

const SpeakerIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 10h4l5-4v12l-5-4H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M16 9.5a4 4 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M18.8 7a7.2 7.2 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const EarpieceIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15.7 8.6a3.7 3.7 0 0 0-7.4 0v1.2c0 1.3-.5 2.5-1.3 3.4L6 14.4h12l-1-1.2a5 5 0 0 1-1.3-3.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M10.5 17.4a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const BluetoothIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M10 4v16l7-6-5-4 5-4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m4.6 7.2 5 4.8-5 4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CallModal = ({
  callId,
  callType,
  isIncoming,
  callerName,
  callerId,
  autoAccept = false,
  onAccept,
  onReject,
  onEnd,
  socket
}: CallModalProps) => {
  const [callStatus, setCallStatus] = useState<'ringing' | 'connecting' | 'active' | 'ended'>(
    isIncoming ? 'ringing' : 'connecting'
  );
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(callType === 'video');
  const [hasLocalVideoTrack, setHasLocalVideoTrack] = useState(callType === 'video');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [selectedOutputMode, setSelectedOutputMode] = useState<OutputMode>('speaker');
  const [audioOutputOptions, setAudioOutputOptions] = useState<OutputOption[]>([
    { mode: 'speaker', label: 'Speaker', sinkId: 'default', available: true },
    { mode: 'earpiece', label: 'Earpiece', sinkId: '', available: false },
    { mode: 'bluetooth', label: 'Bluetooth', sinkId: '', available: false }
  ]);
  const [error, setError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<any | null>(null);
  const pendingIceCandidatesRef = useRef<any[]>([]);
  const hasAcceptedIncomingRef = useRef(!isIncoming);
  const autoAcceptTriggeredRef = useRef(false);
  const audioOutputSupportedRef = useRef(false);
  const disconnectGraceTimerRef = useRef<number | null>(null);
  const unansweredTimeoutRef = useRef<number | null>(null);
  const hasConnectedOnceRef = useRef(false);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const vibrationIntervalRef = useRef<number | null>(null);
  const ringtoneAudioContextRef = useRef<AudioContext | null>(null);
  const [audioOutputSupported, setAudioOutputSupported] = useState(false);
  const callDebugRef = useRef<boolean>(isCallDebugEnabled());
  const logCallDebug = (label: string, extra: Record<string, unknown> = {}) => {
    if (!callDebugRef.current) return;
    console.log('[CallDebug]', label, {
      callId,
      callType,
      isIncoming,
      callStatus,
      ...extra
    });
  };

  const normalizeUserId = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value._id) return String(value._id);
    return String(value);
  };

  useEffect(() => {
    loadAudioOutputOptions();

    if (socket) {
      socket.on('webrtc:offer', handleOffer);
      socket.on('webrtc:answer', handleAnswer);
      socket.on('webrtc:ice-candidate', handleIceCandidate);
      socket.on('call:accepted', handleCallAccepted);
      socket.on('call:rejected', handleCallRejected);
      socket.on('call:ended', handleCallEnded);
      logCallDebug('socket-listeners-attached');
    }

    if (!isIncoming && callStatus === 'connecting') {
      initializeCall();
    }

    return () => {
      cleanup();
      if (socket) {
        socket.off('webrtc:offer', handleOffer);
        socket.off('webrtc:answer', handleAnswer);
        socket.off('webrtc:ice-candidate', handleIceCandidate);
        socket.off('call:accepted', handleCallAccepted);
        socket.off('call:rejected', handleCallRejected);
        socket.off('call:ended', handleCallEnded);
        logCallDebug('socket-listeners-detached');
      }
    };
  }, []);

  useEffect(() => {
    if (audioOutputSupported) {
      applySelectedAudioOutput(selectedOutputMode);
    }
  }, [selectedOutputMode, callStatus, audioOutputOptions]);

  useEffect(() => {
    if (!isIncoming || !autoAccept || callStatus !== 'ringing' || autoAcceptTriggeredRef.current) return;
    autoAcceptTriggeredRef.current = true;
    handleAcceptCall();
  }, [autoAccept, isIncoming, callStatus]);

  useEffect(() => {
    const videoEl = localVideoRef.current;
    if (!videoEl || callType !== 'video') return;

    if (localStream && hasLocalVideoTrack) {
      if (videoEl.srcObject !== localStream) {
        videoEl.srcObject = localStream;
      }
      videoEl
        .play()
        .catch(() => undefined);
      return;
    }

    if (videoEl.srcObject) {
      videoEl.srcObject = null;
    }
  }, [localStream, hasLocalVideoTrack, callType]);

  useEffect(() => {
    const audioEl = remoteAudioRef.current;
    const videoEl = remoteVideoRef.current;

    if (audioEl) {
      if (remoteStream) {
        if (audioEl.srcObject !== remoteStream) {
          audioEl.srcObject = remoteStream;
        }
        audioEl.play().catch(() => undefined);
      } else if (audioEl.srcObject) {
        audioEl.srcObject = null;
      }
    }

    if (videoEl && callType === 'video') {
      if (remoteStream) {
        if (videoEl.srcObject !== remoteStream) {
          videoEl.srcObject = remoteStream;
        }
        videoEl
          .play()
          .catch(() => undefined);
      } else if (videoEl.srcObject) {
        videoEl.srcObject = null;
      }
    }
  }, [remoteStream, callType]);

  useEffect(() => {
    if (unansweredTimeoutRef.current !== null) {
      window.clearTimeout(unansweredTimeoutRef.current);
      unansweredTimeoutRef.current = null;
    }

    if (callStatus === 'active' || callStatus === 'ended') return;

    if (isIncoming && callStatus === 'ringing') {
      unansweredTimeoutRef.current = window.setTimeout(() => {
        if (hasAcceptedIncomingRef.current) return;
        const initiatorId = normalizeUserId(callerId);
        if (initiatorId) {
          socket.emit('call:reject', { callId, initiatorId, reason: 'no_answer' });
        }
        setCallStatus('ended');
        setError('Missed call');
        setTimeout(() => onReject(), 600);
      }, 50000);
      return;
    }

    if (!isIncoming && callStatus === 'connecting') {
      unansweredTimeoutRef.current = window.setTimeout(() => {
        emitSocketCallEnd('no_answer');
        setCallStatus('ended');
        setError('No answer');
        setTimeout(() => onEnd(), 600);
      }, 50000);
    }

    return () => {
      if (unansweredTimeoutRef.current !== null) {
        window.clearTimeout(unansweredTimeoutRef.current);
        unansweredTimeoutRef.current = null;
      }
    };
  }, [callStatus, isIncoming, callId, callerId, onEnd, onReject, socket]);

  const playRingtonePulse = async () => {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!ringtoneAudioContextRef.current) {
      ringtoneAudioContextRef.current = new AudioContextClass();
    }

    const audioContext = ringtoneAudioContextRef.current;
    if (!audioContext) return;

    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        return;
      }
    }

    const now = audioContext.currentTime;
    const makeBeep = (startOffset: number, frequency: number, duration = 0.18) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + startOffset);
      gainNode.gain.setValueAtTime(0.0001, now + startOffset);
      gainNode.gain.exponentialRampToValueAtTime(0.08, now + startOffset + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(now + startOffset);
      oscillator.stop(now + startOffset + duration + 0.01);
    };

    makeBeep(0, 760);
    makeBeep(0.22, 620);
  };

  const stopRingtoneAndVibration = () => {
    if (ringtoneIntervalRef.current !== null) {
      window.clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
    if (vibrationIntervalRef.current !== null) {
      window.clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    if (navigator?.vibrate) {
      navigator.vibrate(0);
    }
  };

  useEffect(() => {
    if (!isIncoming || callStatus !== 'ringing') {
      stopRingtoneAndVibration();
      return;
    }

    void playRingtonePulse();
    ringtoneIntervalRef.current = window.setInterval(() => {
      void playRingtonePulse();
    }, 1700);

    if (navigator?.vibrate) {
      navigator.vibrate([320, 150, 320, 910]);
      vibrationIntervalRef.current = window.setInterval(() => {
        navigator.vibrate([320, 150, 320, 910]);
      }, 1700);
    }

    return () => {
      stopRingtoneAndVibration();
    };
  }, [isIncoming, callStatus]);

  const initializeCall = async (): Promise<boolean> => {
    try {
      if (peerConnectionRef.current && localStreamRef.current) return true;

      const stream = await getUserMedia();
      localStreamRef.current = stream;
      setLocalStream(stream);
      const hasVideo = stream.getVideoTracks().length > 0;
      setHasLocalVideoTrack(hasVideo);
      setIsVideoEnabled(hasVideo);

      const peerConnection = createPeerConnection();
      peerConnectionRef.current = peerConnection;

      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

      if (!isIncoming) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        const targetUserId = normalizeUserId(callerId);
        if (targetUserId) {
          socket.emit('webrtc:offer', { targetUserId, offer, callId });
        }
      }

      return true;
    } catch (err: any) {
      console.error('Failed to initialize call:', err);
      setError(err?.message || 'Could not start call media');
      return false;
    }
  };

  const getUserMedia = async (): Promise<MediaStream> => {
    if (!BrowserCompatibility.isGetUserMediaSupported()) {
      throw new Error('Camera and microphone are not supported in this browser.');
    }

    if (callType === 'video') {
      try {
        return await BrowserCompatibility.getUserMedia({
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch {
        setError('Camera permission denied. Continuing with voice only.');
        return await BrowserCompatibility.getUserMedia({ audio: true, video: false });
      }
    }

    return await BrowserCompatibility.getUserMedia({ audio: true, video: false });
  };

  const createPeerConnection = (): RTCPeerConnection => {
    const RTCPeerConnectionClass = BrowserCompatibility.getRTCPeerConnection();
    if (!RTCPeerConnectionClass) throw new Error('WebRTC is not supported in this browser.');

    const peerConnection = new RTCPeerConnectionClass({
      iceServers: buildIceServers()
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const targetUserId = normalizeUserId(callerId);
        if (!targetUserId) return;
        socket.emit('webrtc:ice-candidate', {
          targetUserId,
          candidate: event.candidate,
          callId
        });
      }
    };

    peerConnection.ontrack = (event) => {
      const incomingStream = event.streams?.[0];
      if (incomingStream) {
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);
        return;
      }

      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      remoteStreamRef.current.addTrack(event.track);
      setRemoteStream(remoteStreamRef.current);
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      logCallDebug('pc-connection-state', { state });
      if (state === 'connected') {
        hasConnectedOnceRef.current = true;
        if (disconnectGraceTimerRef.current !== null) {
          window.clearTimeout(disconnectGraceTimerRef.current);
          disconnectGraceTimerRef.current = null;
        }
        setCallStatus('active');
        return;
      }
      if (state === 'disconnected') {
        if (!hasConnectedOnceRef.current) return;
        if (disconnectGraceTimerRef.current !== null) {
          window.clearTimeout(disconnectGraceTimerRef.current);
        }
        disconnectGraceTimerRef.current = window.setTimeout(() => {
          const currentState = peerConnectionRef.current?.connectionState;
          if (currentState === 'disconnected') {
            handleCallEnded({ callId });
          }
        }, 8000);
        return;
      }
      if (state === 'failed' || state === 'closed') {
        handleCallEnded();
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      logCallDebug('pc-ice-state', { iceState });
      if (iceState === 'connected' || iceState === 'completed') {
        hasConnectedOnceRef.current = true;
        if (disconnectGraceTimerRef.current !== null) {
          window.clearTimeout(disconnectGraceTimerRef.current);
          disconnectGraceTimerRef.current = null;
        }
      } else if (iceState === 'failed') {
        handleCallEnded({ callId });
      }
    };

    return peerConnection;
  };

  const loadAudioOutputOptions = async () => {
    const mediaPrototype: any = typeof HTMLMediaElement !== 'undefined' ? (HTMLMediaElement as any).prototype : null;
    const supportsSetSinkId = Boolean(mediaPrototype && typeof mediaPrototype.setSinkId === 'function');
    audioOutputSupportedRef.current = supportsSetSinkId;
    setAudioOutputSupported(supportsSetSinkId);
    if (!supportsSetSinkId) return;

    if (!navigator?.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((device) => device.kind === 'audiooutput');
      if (!outputs.length) return;

      const findSink = (matcher: RegExp): string =>
        outputs.find((device) => matcher.test((device.label || '').toLowerCase()))?.deviceId || '';

      const bluetoothSink = findSink(/bluetooth|airpods|buds|headset|hands[- ]?free/);
      const earpieceSink = findSink(/earpiece|receiver|phone/);
      const speakerSink =
        findSink(/speaker|loudspeaker|headphone|headset/) ||
        outputs.find((device) => device.deviceId === 'default')?.deviceId ||
        outputs[0].deviceId ||
        'default';

      setAudioOutputOptions([
        { mode: 'speaker', label: 'Speaker', sinkId: speakerSink || 'default', available: true },
        { mode: 'earpiece', label: 'Earpiece', sinkId: earpieceSink, available: Boolean(earpieceSink) },
        { mode: 'bluetooth', label: 'Bluetooth', sinkId: bluetoothSink, available: Boolean(bluetoothSink) }
      ]);
    } catch (err) {
      console.error('Failed to enumerate audio output devices:', err);
    }
  };

  const applySelectedAudioOutput = async (mode: OutputMode) => {
    if (!audioOutputSupportedRef.current) return;
    const selected = audioOutputOptions.find((option) => option.mode === mode);
    if (!selected) return;
    if (!selected.available) {
      return;
    }

    const sinkId = selected.sinkId || 'default';
    const elements: Array<any> = [remoteAudioRef.current, remoteVideoRef.current].filter(Boolean);
    if (!elements.length) return;

    try {
      let applied = false;
      for (const element of elements) {
        if (typeof element.setSinkId === 'function') {
          await element.setSinkId(sinkId);
          applied = true;
        }
      }
      if (applied && error) {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to switch audio output:', err);
      setError(`Could not switch to ${selected.label}.`);
    }
  };

  const processOffer = async (data: any) => {
    try {
      if (!peerConnectionRef.current) {
        const ok = await initializeCall();
        if (!ok || !peerConnectionRef.current) return;
      }

      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await flushPendingIceCandidates();

      const targetUserId = normalizeUserId(data.fromUserId);
      if (!targetUserId) return;
      socket.emit('webrtc:answer', {
        targetUserId,
        answer,
        callId
      });
    } catch (err) {
      console.error('Failed to handle offer:', err);
    }
  };

  const handleOffer = async (data: any) => {
    if (String(data?.callId || '') !== String(callId)) return;
    logCallDebug('received-offer', { fromUserId: data?.fromUserId });
    if (isIncoming && !hasAcceptedIncomingRef.current) {
      pendingOfferRef.current = data;
      return;
    }
    await processOffer(data);
  };

  const handleAnswer = async (data: any) => {
    if (String(data?.callId || '') !== String(callId)) return;
    logCallDebug('received-answer', { fromUserId: data?.fromUserId });
    try {
      if (!peerConnectionRef.current) return;
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      await flushPendingIceCandidates();
    } catch (err) {
      console.error('Failed to handle answer:', err);
    }
  };

  const flushPendingIceCandidates = async () => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection || !peerConnection.remoteDescription) return;
    while (pendingIceCandidatesRef.current.length > 0) {
      const candidate = pendingIceCandidatesRef.current.shift();
      if (!candidate) continue;
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Failed to flush ICE candidate:', err);
      }
    }
  };

  const handleIceCandidate = async (data: any) => {
    if (String(data?.callId || '') !== String(callId)) return;
    logCallDebug('received-ice-candidate', { fromUserId: data?.fromUserId });
    try {
      if (!peerConnectionRef.current) {
        pendingIceCandidatesRef.current.push(data.candidate);
        return;
      }
      if (!peerConnectionRef.current.remoteDescription) {
        pendingIceCandidatesRef.current.push(data.candidate);
        return;
      }
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error('Failed to handle ICE candidate:', err);
    }
  };

  const handleCallAccepted = async (data?: any) => {
    if (String(data?.callId || '') !== String(callId)) return;
    logCallDebug('call-accepted', { acceptedBy: data?.acceptedBy });
    setCallStatus('connecting');
    if (!isIncoming && peerConnectionRef.current?.localDescription?.type === 'offer') {
      try {
        const targetUserId = normalizeUserId(callerId);
        if (targetUserId) {
          socket.emit('webrtc:offer', {
            targetUserId,
            offer: peerConnectionRef.current.localDescription,
            callId
          });
        }
      } catch (err) {
        console.error('Failed to re-send offer after call acceptance:', err);
      }
    }
  };

  const handleCallRejected = (data?: any) => {
    if (String(data?.callId || '') !== String(callId)) return;
    logCallDebug('call-rejected', { reason: data?.reason, rejectedBy: data?.rejectedBy });
    setCallStatus('ended');
    if (data?.reason === 'busy') {
      setError('User is busy on another call');
    } else if (data?.reason === 'no_answer') {
      setError('No answer');
    } else {
      setError('Call was declined');
    }
    setTimeout(() => onReject(), 1200);
  };

  const handleCallEnded = (data?: any) => {
    if (data?.callId && String(data.callId) !== String(callId)) return;
    logCallDebug('call-ended-event', { endedBy: data?.endedBy, reason: data?.reason });
    if (!data?.callId) {
      emitSocketCallEnd('connection_lost');
    }
    setCallStatus('ended');
    cleanup();
    setTimeout(() => onEnd(), 800);
  };

  const emitSocketCallEnd = (reason: string) => {
    try {
      socket.emit('call:end', { callId, reason });
    } catch (err) {
      console.error('Failed to emit call:end:', err);
    }
  };

  const handleAcceptCall = async () => {
    logCallDebug('accept-call-clicked');
    hasAcceptedIncomingRef.current = true;
    setCallStatus('connecting');

    const ok = await initializeCall();
    if (!ok) {
      hasAcceptedIncomingRef.current = false;
      const initiatorId = normalizeUserId(callerId);
      if (initiatorId) {
        socket.emit('call:reject', { callId, initiatorId, reason: 'media_failed' });
      }
      setCallStatus('ended');
      setTimeout(() => onReject(), 700);
      return;
    }

    onAccept();
    const initiatorId = normalizeUserId(callerId);
    logCallDebug('emit-call-accept', { initiatorId });
    socket.emit('call:accept', { callId, initiatorId });

    if (pendingOfferRef.current) {
      await processOffer(pendingOfferRef.current);
      pendingOfferRef.current = null;
    }
  };

  const handleRejectCall = () => {
    const initiatorId = normalizeUserId(callerId);
    logCallDebug('emit-call-reject', { initiatorId });
    socket.emit('call:reject', { callId, initiatorId, reason: 'declined' });
    onReject();
  };

  const handleEndCall = () => {
    logCallDebug('end-call-clicked');
    emitSocketCallEnd('ended');
    onEnd();
  };

  const handleAudioOutputChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedOutputMode(event.target.value as OutputMode);
  };

  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
  };

  const toggleVideo = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack || callType !== 'video') return;
    videoTrack.enabled = !videoTrack.enabled;
    setIsVideoEnabled(videoTrack.enabled);
  };

  const cleanup = () => {
    hasConnectedOnceRef.current = false;
    stopRingtoneAndVibration();
    if (unansweredTimeoutRef.current !== null) {
      window.clearTimeout(unansweredTimeoutRef.current);
      unansweredTimeoutRef.current = null;
    }
    if (disconnectGraceTimerRef.current !== null) {
      window.clearTimeout(disconnectGraceTimerRef.current);
      disconnectGraceTimerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    remoteStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (ringtoneAudioContextRef.current) {
      try {
        void ringtoneAudioContextRef.current.close();
      } catch {
        // no-op
      }
      ringtoneAudioContextRef.current = null;
    }
  };

  const selectedOutputIcon = selectedOutputMode === 'bluetooth'
    ? <BluetoothIcon />
    : selectedOutputMode === 'earpiece'
      ? <EarpieceIcon />
      : <SpeakerIcon />;

  return (
    <div className="call-modal-overlay">
      <div className="call-modal" role="dialog" aria-modal="true" aria-label={`${callType} call`}>
        {callStatus === 'ringing' && isIncoming && (
          <div className="call-ringing">
            <div className="caller-info">
              <div className="caller-avatar">{callerName?.charAt(0).toUpperCase() || '?'}</div>
              <h2>{callerName || 'Unknown'}</h2>
              <p>Incoming {callType} call</p>
            </div>
            <div className="call-actions">
              <button className="accept-button" onClick={handleAcceptCall} type="button">
                Accept
              </button>
              <button className="reject-button" onClick={handleRejectCall} type="button">
                Decline
              </button>
            </div>
          </div>
        )}

        {(callStatus === 'connecting' || callStatus === 'active') && (
          <div className="call-active">
            <div className="video-container">
              <audio ref={remoteAudioRef} autoPlay playsInline />

              <div className="call-top-bar">
                <h3>{callerName || 'Unknown'}</h3>
                <p>{callStatus === 'connecting' ? 'Connecting...' : 'Secure call'}</p>
              </div>

              {callType === 'video' && (
                <>
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={`remote-video ${!hasLocalVideoTrack ? 'audio-fallback' : ''}`}
                  />
                  {hasLocalVideoTrack ? (
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="local-video"
                    />
                  ) : (
                    <div className="local-video-unavailable">Your camera is off</div>
                  )}
                </>
              )}

              {callType === 'voice' && (
                <div className="voice-call-display">
                  <div className="caller-avatar-large">{callerName?.charAt(0).toUpperCase() || '?'}</div>
                  <h2>{callerName || 'Unknown'}</h2>
                  <p className="call-status-text">
                    {callStatus === 'connecting' ? 'Connecting...' : 'Connected'}
                  </p>
                </div>
              )}
            </div>

            <div className="call-controls">
              {audioOutputSupported && (
                <label className="audio-output-selector" aria-label="Audio output">
                  <span className="audio-output-icon">{selectedOutputIcon}</span>
                  <select
                    value={selectedOutputMode}
                    onChange={handleAudioOutputChange}
                    className="audio-output-dropdown"
                  >
                    {audioOutputOptions.map((option) => (
                      <option key={option.mode} value={option.mode} disabled={!option.available}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className={`control-button ${isMuted ? 'active' : ''}`}
                onClick={toggleMute}
                type="button"
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                <span className="icon">{isMuted ? 'Unmute' : 'Mute'}</span>
              </button>
              {callType === 'video' && (
                <button
                  className={`control-button ${!isVideoEnabled ? 'active' : ''}`}
                  onClick={toggleVideo}
                  type="button"
                  aria-label={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
                  title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
                >
                  <span className="icon">{isVideoEnabled ? 'Camera On' : 'Camera Off'}</span>
                </button>
              )}
              <button
                className="control-button end-call"
                onClick={handleEndCall}
                type="button"
                aria-label="End call"
                title="End call"
              >
                <span className="icon">End</span>
              </button>
            </div>
          </div>
        )}

        {callStatus === 'ended' && (
          <div className="call-ended">
            <p>{error || 'Call ended'}</p>
          </div>
        )}

        {error && callStatus !== 'ended' && (
          <div className="call-error">
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CallModal;
