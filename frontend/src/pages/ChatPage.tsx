import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Socket } from 'socket.io-client';
import { EncryptionService } from '../utils/encryption';
import CallModal from '../components/CallModal';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { acquireSharedSocket, releaseSharedSocket } from '../utils/socketManager';
import { goToProfile } from '../utils/profileRouting';
import BeeLoader from '../components/BeeLoader';
import useSmoothLoader from '../hooks/useSmoothLoader';
import './ChatPage.css';

interface ChatRoom {
  chatRoomId: string;
  type: 'personal' | 'group';
  participants: Array<{
    userId: string;
    name: string;
    profession: string;
    photo?: string;
  }>;
  lastMessage: {
    encryptedContent: string;
    timestamp: Date;
    senderId: string;
  } | null;
  lastMessageAt: Date;
  unreadCount?: number;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  encryptedContent: string;
  replyToMessageId?: string | null;
  timestamp: Date;
  delivered: boolean;
  read: boolean;
  deletedForEveryone?: boolean;
  reactions?: Array<{
    userId: string;
    emoji: string;
    reactedAt?: Date | string;
  }>;
}

const CIPHERTEXT_PLACEHOLDER = '[Encrypted message - not readable on this device]';
const DELETED_MESSAGE_TEXT = 'This message was deleted';
const MESSAGE_REACTION_OPTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];
const QUICK_EMOJIS = ['\u{1F600}', '\u{1F602}', '\u{1F60D}', '\u{1F44D}', '\u{1F389}', '\u{1F525}', '\u{1F64F}', '\u{2764}\u{FE0F}'];
const ACTION_SHEET_WIDTH = 264;
const ACTION_SHEET_MARGIN = 10;
const SWIPE_REPLY_THRESHOLD = 54;
const MAX_SWIPE_DISTANCE = 60;
const PREVIEW_REPLY_CHARS = 90;
const AUTO_SCROLL_BOTTOM_EPSILON = 100;

type MessageActionSheetState = {
  messageId: string;
  isOwn: boolean;
  x: number;
  y: number;
  alignX: 'left' | 'right';
  alignY: 'above' | 'below';
} | null;
type MessageActionSheetPosition = {
  x: number;
  y: number;
  alignX: 'left' | 'right';
  alignY: 'above' | 'below';
};

type ReactionViewer = {
  userId: string;
  name: string;
  emoji: string;
};

type ReplyTarget = {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  isOwn: boolean;
};
type MessageDeliveryStatus = 'sent' | 'delivered' | 'read';

const BackArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5L8 12L15 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 11V8a5 5 0 1 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <rect x="5" y="11" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const VoiceCallIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 4.8h3.3l1.2 3.9-1.9 1.4a13.4 13.4 0 0 0 5.4 5.4l1.4-1.9 3.9 1.2V18a2 2 0 0 1-2 2A13.3 13.3 0 0 1 4 6.8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const VideoCallIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3.8" y="6.5" width="11.5" height="11" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M15.3 10.2 20.2 7.7v8.6l-4.9-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MessageStatusTicks = ({ status }: { status: MessageDeliveryStatus }) => {
  if (status === 'sent') {
    return (
      <svg className="message-status-icon single" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M1.5 6.8L4.2 9.5L10.5 2.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg className="message-status-icon double" viewBox="0 0 17 12" aria-hidden="true" focusable="false">
      <path d="M1.2 6.8L3.9 9.5L10.2 2.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.2 6.8L8.9 9.5L15.2 2.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const isLikelyCiphertext = (text: string): boolean => {
  if (!text) return false;
  // Base64-like long payloads are likely encrypted RSA output.
  return text.length > 80 && /^[A-Za-z0-9+/=]+$/.test(text);
};

const ChatPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { friendshipId } = useParams();
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [selectedChatRoom, setSelectedChatRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const { showLoader, complete, handleLoaderComplete } = useSmoothLoader(loading);
  const [sending, setSending] = useState(false);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const [currentCall, setCurrentCall] = useState<{
    callId: string;
    type: 'voice' | 'video';
    isIncoming: boolean;
    callerName?: string;
    callerId?: string;
  } | null>(null);
  const [actionSheet, setActionSheet] = useState<MessageActionSheetState>(null);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [isMobileView, setIsMobileView] = useState(false);
  const [showSidebarOnMobile, setShowSidebarOnMobile] = useState(true);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [participantPhotos, setParticipantPhotos] = useState<Record<string, string>>({});
  const [activeMatchBadge, setActiveMatchBadge] = useState(false);
  const [reactionSheetMessageId, setReactionSheetMessageId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [swipeOffsets, setSwipeOffsets] = useState<Record<string, number>>({});
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerLastSeen, setPeerLastSeen] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<Socket | null>(null);
  const selectedChatRoomRef = useRef<ChatRoom | null>(null);
  const typingStopTimeoutRef = useRef<number | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const photoCacheRef = useRef<Record<string, string>>({});
  const messagesSyncInFlightRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressMovedRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const isAtBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const initialScrollDoneRef = useRef<string>('');
  const swipeStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const openedUserQueryRef = useRef<string>('');
  const keyboardOffsetRef = useRef(0);
  const keyboardHoldOffsetRef = useRef(0);
  const keyboardVisibleRef = useRef(false);
  const inputFocusedRef = useRef(false);

  const API_URL = getApiBaseUrl();
  const currentUserId = localStorage.getItem('userId');
  const roomFromQuery = new URLSearchParams(location.search).get('room');
  const userFromQuery = new URLSearchParams(location.search).get('user');
  const currentUserIdStr = String(currentUserId || '');
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

  const setChatViewportHeight = () => {
    if (!isMobileView) {
      document.documentElement.style.removeProperty('--chat-app-height');
      return;
    }
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--chat-app-height', `${Math.max(0, viewportHeight)}px`);
  };

  const applyKeyboardOffset = (rawOffset: number) => {
    const positiveOffset = Math.max(0, rawOffset);

    if (positiveOffset > 0) {
      keyboardVisibleRef.current = true;
      keyboardOffsetRef.current = positiveOffset;
      keyboardHoldOffsetRef.current = positiveOffset;
    } else {
      keyboardVisibleRef.current = false;
      keyboardOffsetRef.current = 0;
      if (!showEmojiPicker) {
        keyboardHoldOffsetRef.current = 0;
      }
    }

    const effectiveOffset =
      showEmojiPicker && keyboardHoldOffsetRef.current > 0
        ? keyboardHoldOffsetRef.current
        : keyboardOffsetRef.current;

    document.documentElement.style.setProperty('--chat-keyboard-offset', `${effectiveOffset}px`);
  };

  const getCurrentKeyboardOffset = () => {
    const viewport = window.visualViewport;
    if (!viewport) return 0;
    return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  };
  const upsertMessagesById = (incoming: Message[]) => {
    const byId = new Map<string, Message>();
    for (const message of incoming) {
      byId.set(normalizeId(message.id), { ...message, id: normalizeId(message.id) });
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  };

  const appendMessageDedup = (nextMessage: Message) => {
    const nextId = normalizeId(nextMessage.id);
    setMessages((prev) => {
      const existingIndex = prev.findIndex((message) => normalizeId(message.id) === nextId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          ...nextMessage,
          id: nextId
        };
        return updated;
      }
      return [...prev, { ...nextMessage, id: nextId }];
    });
  };

  const handleMessagesScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceToBottom <= AUTO_SCROLL_BOTTOM_EPSILON;
  };

  const toReadableTimestamp = (value?: string | Date | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const getOtherParticipant = (room: ChatRoom) =>
    room.participants.find((p) => String(p.userId) !== currentUserIdStr);

  const getParticipantPhoto = (participant?: { userId: string; photo?: string }) => {
    if (!participant) return '';
    if (participant.photo) return participant.photo;
    return participantPhotos[String(participant.userId)] || '';
  };

  const getInitial = (name?: string) => (name?.charAt(0).toUpperCase() || 'U');

  const openUserProfile = (userId: string) => {
    if (!userId) return;
    goToProfile(navigate, userId);
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    initializeEncryption();
    loadChatRooms();
    const cleanupSocket = setupWebSocket();

    return () => {
      cleanupSocket?.();
    };
  }, []);

  useEffect(() => {
    if (selectedChatRoom) {
      forceScrollToBottomRef.current = true;
      isAtBottomRef.current = true;
      initialScrollDoneRef.current = '';
      setReplyTarget(null);
      setReactionSheetMessageId(null);
      loadMessages(selectedChatRoom.chatRoomId);
    }
  }, [selectedChatRoom]);

  useEffect(() => {
    const roomIdFromUrl = new URLSearchParams(location.search).get('room');
    const userIdFromUrl = new URLSearchParams(location.search).get('user');
    const normalizedRoomId = normalizeId(roomIdFromUrl);
    const normalizedUserId = normalizeId(userIdFromUrl);

    if (!normalizedRoomId && !normalizedUserId) {
      if (isMobileView && !selectedChatRoom) {
        setShowSidebarOnMobile(true);
      }
      return;
    }

    if (isMobileView) {
      setShowSidebarOnMobile(false);
    }

    if (chatRooms.length > 0) {
      const targetRoom = normalizedRoomId
        ? chatRooms.find((room) => String(room.chatRoomId) === normalizedRoomId)
        : chatRooms.find((room) =>
            room.participants.some((participant) => normalizeId(participant.userId) === normalizedUserId)
          );
      if (
        targetRoom &&
        String(targetRoom.chatRoomId) !== String(selectedChatRoom?.chatRoomId || '')
      ) {
        setSelectedChatRoom(targetRoom);
      }
    }
  }, [location.search, isMobileView, chatRooms, selectedChatRoom]);

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

      const roomIdFromMessage = normalizeId(
        message.chatRoomId || new URLSearchParams(nextPath.split('?')[1] || '').get('room')
      );
      if (!roomIdFromMessage) return;

      if (isMobileView) {
        setShowSidebarOnMobile(false);
      }

      const room = chatRooms.find((chat) => String(chat.chatRoomId) === roomIdFromMessage);
      if (room && String(room.chatRoomId) !== String(selectedChatRoom?.chatRoomId || '')) {
        setSelectedChatRoom(room);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwNavigationMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSwNavigationMessage);
  }, [navigate, isMobileView, chatRooms, selectedChatRoom]);

  useEffect(() => {
    selectedChatRoomRef.current = selectedChatRoom;
    setIsPeerTyping(false);
  }, [selectedChatRoom]);

  useEffect(() => {
    const loadMatchStatus = async () => {
      const targetUserId = selectedChatRoom?.participants.find(
        (p) => String(p.userId) !== currentUserIdStr
      )?.userId;
      if (!targetUserId) {
        setActiveMatchBadge(false);
        return;
      }
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/match/status/${targetUserId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          setActiveMatchBadge(false);
          return;
        }
        const data = await response.json();
        setActiveMatchBadge(Boolean(data?.isMatched));
      } catch {
        setActiveMatchBadge(false);
      }
    };

    loadMatchStatus();
  }, [selectedChatRoom?.chatRoomId]);

  useEffect(() => {
    const loadPresence = async () => {
      const participantId = normalizeId(
        selectedChatRoomRef.current?.participants.find(
          (p) => normalizeId(p.userId) !== currentUserIdStr
        )?.userId
      );
      if (!participantId) {
        setPeerOnline(false);
        setPeerLastSeen('');
        return;
      }
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/presence/${participantId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          setPeerOnline(false);
          setPeerLastSeen('');
          return;
        }
        const data = await response.json();
        setPeerOnline(Boolean(data?.online));
        setPeerLastSeen(toReadableTimestamp(data?.lastSeen));
      } catch {
        setPeerOnline(false);
        setPeerLastSeen('');
      }
    };

    loadPresence();
  }, [selectedChatRoom?.chatRoomId]);

  useEffect(() => {
    const onSoftRefresh = () => {
      loadChatRooms();
      if (selectedChatRoomRef.current) {
        if (messagesSyncInFlightRef.current) return;
        messagesSyncInFlightRef.current = true;
        loadMessages(selectedChatRoomRef.current.chatRoomId).finally(() => {
          messagesSyncInFlightRef.current = false;
        });
      }
    };

    window.addEventListener('hivemate:soft-refresh', onSoftRefresh as EventListener);
    window.addEventListener('hivemate:critical-refresh', onSoftRefresh as EventListener);
    return () => {
      window.removeEventListener('hivemate:soft-refresh', onSoftRefresh as EventListener);
      window.removeEventListener('hivemate:critical-refresh', onSoftRefresh as EventListener);
    };
  }, []);

  useEffect(() => {
    const closePopups = () => {
      setActionSheet(null);
      setShowEmojiPicker(false);
      setReactionSheetMessageId(null);
    };
    document.addEventListener('click', closePopups);
    return () => document.removeEventListener('click', closePopups);
  }, []);

  useEffect(() => {
    const isCallActive = showCallModal && Boolean(currentCall);
    (window as any).__hivemateCallOverlayActive = isCallActive;
    return () => {
      (window as any).__hivemateCallOverlayActive = false;
    };
  }, [showCallModal, currentCall]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      const deepLinkedRoomId = normalizeId(new URLSearchParams(window.location.search).get('room'));
      setIsMobileView(mobile);

      if (!mobile) {
        setShowSidebarOnMobile(true);
      } else if (deepLinkedRoomId) {
        setShowSidebarOnMobile(false);
      } else if (!selectedChatRoomRef.current) {
        setShowSidebarOnMobile(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [location.search]);

  useLayoutEffect(() => {
    if (!isMobileView) {
      document.documentElement.style.removeProperty('--chat-keyboard-offset');
      document.documentElement.style.removeProperty('--chat-app-height');
      keyboardOffsetRef.current = 0;
      keyboardHoldOffsetRef.current = 0;
      keyboardVisibleRef.current = false;
      return;
    }

    const viewport = window.visualViewport;

    const syncViewportLayout = () => {
      setChatViewportHeight();
      if (!viewport) {
        applyKeyboardOffset(0);
        return;
      }
      const keyboardOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      applyKeyboardOffset(keyboardOffset);
      if (inputFocusedRef.current && selectedChatRoomRef.current) {
        forceScrollToBottom();
      }
    };

    syncViewportLayout();
    viewport?.addEventListener('resize', syncViewportLayout);
    viewport?.addEventListener('scroll', syncViewportLayout);
    window.addEventListener('resize', syncViewportLayout);
    window.addEventListener('orientationchange', syncViewportLayout);

    return () => {
      viewport?.removeEventListener('resize', syncViewportLayout);
      viewport?.removeEventListener('scroll', syncViewportLayout);
      window.removeEventListener('resize', syncViewportLayout);
      window.removeEventListener('orientationchange', syncViewportLayout);
      document.documentElement.style.removeProperty('--chat-keyboard-offset');
      document.documentElement.style.removeProperty('--chat-app-height');
    };
  }, [isMobileView, showEmojiPicker]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    if (forceScrollToBottomRef.current) {
      scrollToBottom();
      forceScrollToBottomRef.current = false;
      isAtBottomRef.current = true;
      return;
    }
    if (isAtBottomRef.current) {
      scrollToBottom();
      isAtBottomRef.current = true;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

  const initializeEncryption = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      // Get or generate key pair
      await EncryptionService.getKeyPair();
      
      // Upload public key to server
      await EncryptionService.uploadPublicKey(API_URL, token);
      
      setEncryptionReady(true);
      console.log('Encryption initialized');
    } catch (error) {
      console.error('Failed to initialize encryption:', error);
      // Continue without encryption
      setEncryptionReady(true);
    }
  };

  const setupWebSocket = () => {
    const socket = acquireSharedSocket();
    if (!socket) return () => undefined;

    const handleConnect = () => {
      console.log('WebSocket connected');
    };

    const handleDisconnect = () => {
      console.log('WebSocket disconnected');
    };

    const handleMessageReceive = async (data: any) => {
      console.log('Received message:', data);

      try {
        const keyPair = await EncryptionService.getKeyPair();
        const decryptedContent = await EncryptionService.decryptMessage(
          data.encryptedContent,
          keyPair.privateKey
        );

        if (selectedChatRoomRef.current && data.chatRoomId === selectedChatRoomRef.current.chatRoomId) {
          const newMessage: Message = {
            id: normalizeId(data.messageId),
            senderId: data.senderId,
            receiverId: currentUserId!,
            encryptedContent: decryptedContent,
            timestamp: new Date(data.timestamp),
            delivered: true,
            read: false,
            reactions: []
          };
          appendMessageDedup(newMessage);
          if (normalizeId(data.senderId) === currentUserIdStr) {
            forceScrollToBottomRef.current = true;
            isAtBottomRef.current = true;
          }
        }

        loadChatRooms();
      } catch (error) {
        if (selectedChatRoomRef.current && data.chatRoomId === selectedChatRoomRef.current.chatRoomId) {
          const unreadableMessage: Message = {
            id: normalizeId(data.messageId),
            senderId: data.senderId,
            receiverId: currentUserId!,
            encryptedContent: CIPHERTEXT_PLACEHOLDER,
            timestamp: new Date(data.timestamp),
            delivered: true,
            read: false,
            reactions: []
          };
          appendMessageDedup(unreadableMessage);
          if (normalizeId(data.senderId) === currentUserIdStr) {
            forceScrollToBottomRef.current = true;
            isAtBottomRef.current = true;
          }
        }
      }
    };

    const handleSocketError = (error: any) => {
      console.error('WebSocket error:', error);
    };

    const handleDeletedForEveryone = (data: any) => {
      setMessages((prev) =>
        prev.map((msg) =>
          String(msg.id) === String(data.messageId)
            ? { ...msg, encryptedContent: DELETED_MESSAGE_TEXT, deletedForEveryone: true }
            : msg
        )
      );
    };

    const handleMessageReaction = (data: any) => {
      const incomingChatRoomId = String(data?.chatRoomId || '');
      const activeRoomId = String(selectedChatRoomRef.current?.chatRoomId || '');
      if (!incomingChatRoomId || incomingChatRoomId !== activeRoomId) return;

      setMessages((prev) =>
        prev.map((msg) =>
          String(msg.id) === String(data?.messageId)
            ? {
                ...msg,
                reactions: Array.isArray(data?.reactions)
                  ? data.reactions.map((reaction: any) => ({
                      userId: String(reaction.userId),
                      emoji: reaction.emoji,
                      reactedAt: reaction.reactedAt
                    }))
                  : []
              }
            : msg
        )
      );
    };

    const handleTypingStart = (data: any) => {
      const activeRoom = selectedChatRoomRef.current;
      if (!activeRoom) return;
      if (data?.chatRoomId === activeRoom.chatRoomId) {
        setIsPeerTyping(true);
      }
    };

    const handleTypingStop = (data: any) => {
      const activeRoom = selectedChatRoomRef.current;
      if (!activeRoom) return;
      if (data?.chatRoomId === activeRoom.chatRoomId) {
        setIsPeerTyping(false);
      }
    };

    const handlePresenceUpdate = (data: any) => {
      const targetId = normalizeId(selectedChatRoomRef.current?.participants.find(
        (p) => normalizeId(p.userId) !== currentUserIdStr
      )?.userId);
      if (!targetId) return;
      if (normalizeId(data?.userId) !== targetId) return;
      setPeerOnline(Boolean(data?.online));
      setPeerLastSeen(toReadableTimestamp(data?.lastSeen || data?.timestamp));
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('message:receive', handleMessageReceive);
    socket.on('error', handleSocketError);
    socket.on('message:deleted_for_everyone', handleDeletedForEveryone);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    socket.on('message:reaction', handleMessageReaction);
    socket.on('presence:update', handlePresenceUpdate);

    wsRef.current = socket;

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('message:receive', handleMessageReceive);
      socket.off('error', handleSocketError);
      socket.off('message:deleted_for_everyone', handleDeletedForEveryone);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
      socket.off('message:reaction', handleMessageReaction);
      socket.off('presence:update', handlePresenceUpdate);
      releaseSharedSocket();
      wsRef.current = null;
    };
  };

  const loadChatRooms = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/messages/chats`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        const chats: ChatRoom[] = data.chats || [];
        setChatRooms(chats);
        await hydrateParticipantPhotos(chats);
        
        // If room query is provided, select that exact chat first.
        const normalizedRoomId = normalizeId(
          new URLSearchParams(window.location.search).get('room') || roomFromQuery
        );
        const normalizedUserId = normalizeId(
          new URLSearchParams(window.location.search).get('user') || userFromQuery
        );
        if (normalizedRoomId && chats.length > 0) {
          const room = chats.find((c: ChatRoom) => String(c.chatRoomId) === normalizedRoomId);
          if (room) {
            setSelectedChatRoom(room);
            setShowSidebarOnMobile(false);
            console.log('[ChatPage] Selected room from deep link after chats load:', normalizedRoomId);
            return;
          }
          // Keep mobile chat pane open for deep links even before room data resolves.
          setShowSidebarOnMobile(false);
          console.warn('[ChatPage] Deep-linked room not found in chat list response yet:', normalizedRoomId);
        }

        if (!normalizedRoomId && normalizedUserId && chats.length > 0) {
          const roomByUser = chats.find((c: ChatRoom) =>
            c.participants.some((p) => normalizeId(p.userId) === normalizedUserId)
          );
          if (roomByUser) {
            openedUserQueryRef.current = '';
            setSelectedChatRoom(roomByUser);
            setShowSidebarOnMobile(false);
            return;
          }
          if (openedUserQueryRef.current === normalizedUserId) {
            return;
          }
          openedUserQueryRef.current = normalizedUserId;
          await openDirectChat(normalizedUserId);
          return;
        }

        // If friendshipId is provided, select by participant user id.
        if (friendshipId && chats.length > 0) {
          const targetId = normalizeId(friendshipId);
          const chat = chats.find((c: ChatRoom) =>
            c.participants.some((p) => normalizeId(p.userId) === targetId)
          );
          if (chat) {
            setSelectedChatRoom(chat);
            if (isMobileView) setShowSidebarOnMobile(false);
          } else {
            await openDirectChat(targetId);
          }
        } else if (friendshipId && chats.length === 0) {
          await openDirectChat(normalizeId(friendshipId));
        }
      }
    } catch (error) {
      console.error('Failed to load chat rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const openDirectChat = async (targetUserId: string) => {
    try {
      const token = localStorage.getItem('token');
      const normalizedTargetUserId = normalizeId(targetUserId);
      if (!token || !normalizedTargetUserId) return;

      const response = await fetch(`${API_URL}/api/messages/open/${normalizedTargetUserId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) return;
      const data = await response.json();
      const openedChat = data?.chat;
      if (!openedChat) return;

      setChatRooms((prev) => {
        const exists = prev.some((room) => String(room.chatRoomId) === String(openedChat.chatRoomId));
        if (exists) return prev;
        return [openedChat, ...prev];
      });

      await hydrateParticipantPhotos([openedChat]);
      setSelectedChatRoom(openedChat);
      openedUserQueryRef.current = '';
      if (isMobileView) setShowSidebarOnMobile(false);
    } catch (error) {
      console.error('Failed to open direct chat:', error);
    }
  };

  const hydrateParticipantPhotos = async (rooms: ChatRoom[]) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const participantIds = Array.from(
      new Set(
        rooms
          .flatMap((room) => room.participants)
          .map((p) => String(p.userId))
          .filter((id) => id && id !== currentUserIdStr)
      )
    );

    const missingIds = participantIds.filter((id) => !(id in photoCacheRef.current));
    if (missingIds.length === 0) {
      setParticipantPhotos({ ...photoCacheRef.current });
      return;
    }

    await Promise.all(
      missingIds.map(async (id) => {
        try {
          const response = await fetch(`${API_URL}/api/profiles/${id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!response.ok) {
            photoCacheRef.current[id] = '';
            return;
          }

          const data = await response.json();
          photoCacheRef.current[id] = data?.profile?.photos?.[0] || '';
        } catch {
          photoCacheRef.current[id] = '';
        }
      })
    );

    setParticipantPhotos({ ...photoCacheRef.current });
  };

  const loadMessages = async (chatRoomId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/messages/chat/${chatRoomId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        
        // Decrypt all messages
        const keyPair = await EncryptionService.getKeyPair();
        const decryptedMessages = await Promise.all(
          (data.messages || []).map(async (msg: Message) => {
            try {
              if (msg.deletedForEveryone) {
                return { ...msg, encryptedContent: DELETED_MESSAGE_TEXT, deletedForEveryone: true };
              }
              const decryptedContent = await EncryptionService.decryptMessage(
                msg.encryptedContent,
                keyPair.privateKey
              );
              return { ...msg, encryptedContent: decryptedContent };
            } catch {
              if (msg.deletedForEveryone) {
                return { ...msg, encryptedContent: DELETED_MESSAGE_TEXT, deletedForEveryone: true };
              }
              return { ...msg, encryptedContent: CIPHERTEXT_PLACEHOLDER };
            }
          })
        );
        const normalizedRoomId = normalizeId(chatRoomId);
        const isFirstLoadForRoom = initialScrollDoneRef.current !== normalizedRoomId;
        const container = messagesContainerRef.current;
        const previousScrollHeight = container?.scrollHeight || 0;
        const previousScrollTop = container?.scrollTop || 0;
        if (isFirstLoadForRoom) {
          forceScrollToBottomRef.current = true;
          isAtBottomRef.current = true;
        }
        setMessages(upsertMessagesById(decryptedMessages));
        if (!isFirstLoadForRoom && previousScrollTop <= 1) {
          requestAnimationFrame(() => {
            const currentContainer = messagesContainerRef.current;
            if (!currentContainer) return;
            const heightDelta = currentContainer.scrollHeight - previousScrollHeight;
            if (heightDelta > 0) {
              currentContainer.scrollTop = heightDelta;
            }
          });
        }
        if (isFirstLoadForRoom) {
          initialScrollDoneRef.current = normalizedRoomId;
        }
        setChatRooms((prev) =>
          prev.map((room) =>
            String(room.chatRoomId) === String(chatRoomId)
              ? { ...room, unreadCount: 0 }
              : room
          )
        );
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const sendMessage = async () => {
    const sanitizedMessage = messageInput.trim();
    if (!sanitizedMessage || !selectedChatRoom || sending || !encryptionReady) return;
    const replyContext = replyTarget;

    setSending(true);
    try {
      const token = localStorage.getItem('token');
      const receiverId = selectedChatRoom.participants.find(
        p => String(p.userId) !== currentUserIdStr
      )?.userId;

      if (!receiverId) {
        console.error('No receiver found');
        return;
      }

      // Encrypt for receiver and sender (sender must read own history later).
      let encryptedContent: string;
      let senderEncryptedContent: string;
      try {
        const keyPair = await EncryptionService.getKeyPair();
        const recipientPublicKey = await EncryptionService.getRecipientPublicKey(
          receiverId,
          API_URL,
          token!
        );
        encryptedContent = await EncryptionService.encryptMessage(
          sanitizedMessage,
          recipientPublicKey
        );
        senderEncryptedContent = await EncryptionService.encryptMessage(
          sanitizedMessage,
          keyPair.publicKey
        );
      } catch (error) {
        console.error('Encryption failed:', error);
        alert('Could not encrypt message. Please refresh and try again.');
        return;
      }

      const response = await fetch(`${API_URL}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          receiverId,
          encryptedContent,
          senderEncryptedContent,
          chatRoomId: selectedChatRoom.chatRoomId,
          replyToMessageId: replyContext?.messageId || undefined
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Add message to local state (store decrypted version locally)
        const newMessage: Message = {
          id: normalizeId(data.messageData.id),
          senderId: currentUserId!,
          receiverId,
          encryptedContent: sanitizedMessage, // Store decrypted for display
          replyToMessageId: replyContext?.messageId || null,
          timestamp: new Date(data.messageData.timestamp),
          delivered: Boolean(data.messageData.delivered),
          read: false,
          deletedForEveryone: false,
          reactions: []
        };
        forceScrollToBottom();
        appendMessageDedup(newMessage);
        setMessageInput('');
        setReplyTarget(null);
        setShowEmojiPicker(false);
        setActionSheet(null);
        if (messageInputRef.current) {
          messageInputRef.current.style.height = 'auto';
          messageInputRef.current.focus();
        }
        emitTypingState(false);
        if (typingStopTimeoutRef.current) {
          window.clearTimeout(typingStopTimeoutRef.current);
          typingStopTimeoutRef.current = null;
        }
        setIsPeerTyping(false);
      } else {
        const error = await response.json();
        alert(error.error?.message || 'Failed to send message');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData?.getData('text');
    if (!pastedText) return;

    e.preventDefault();
    const target = e.currentTarget;
    const start = target.selectionStart ?? messageInput.length;
    const end = target.selectionEnd ?? messageInput.length;
    const nextText = `${messageInput.slice(0, start)}${pastedText}${messageInput.slice(end)}`;
    setMessageInput(nextText);

    requestAnimationFrame(() => {
      const nextCursorPos = start + pastedText.length;
      target.selectionStart = nextCursorPos;
      target.selectionEnd = nextCursorPos;
    });
  };

  const addEmojiToInput = (emoji: string) => {
    setMessageInput((prev) => `${prev}${emoji}`);
    messageInputRef.current?.focus();
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom());
    }
  };

  const reactToMessage = async (messageId: string, emoji: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/messages/${messageId}/reaction`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ emoji })
      });
      if (!response.ok) return;
      const data = await response.json();
      setMessages((prev) =>
        prev.map((message) =>
          String(message.id) === String(messageId)
            ? {
                ...message,
                reactions: Array.isArray(data?.reactions)
                  ? data.reactions.map((reaction: any) => ({
                      userId: String(reaction.userId),
                      emoji: reaction.emoji,
                      reactedAt: reaction.reactedAt
                    }))
                  : []
              }
            : message
        )
      );
    } catch (error) {
      console.error('Failed to react to message:', error);
    } finally {
      setActionSheet(null);
    }
  };

  const removeReaction = async (messageId: string, event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    const snapshot = messages;
    setMessages((prev) =>
      prev.map((message) =>
        String(message.id) === String(messageId)
          ? {
              ...message,
              reactions: (message.reactions || []).filter(
                (reaction) => normalizeId(reaction.userId) !== currentUserIdStr
              )
            }
          : message
      )
    );
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/messages/${messageId}/reaction`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        setMessages(snapshot);
        return;
      }
      const data = await response.json();
      setMessages((prev) =>
        prev.map((message) =>
          String(message.id) === String(messageId)
            ? {
                ...message,
                reactions: Array.isArray(data?.reactions)
                  ? data.reactions.map((reaction: any) => ({
                      userId: String(reaction.userId),
                      emoji: reaction.emoji,
                      reactedAt: reaction.reactedAt
                    }))
                  : []
              }
            : message
        )
      );
    } catch (error) {
      console.error('Failed to remove reaction:', error);
      setMessages(snapshot);
    } finally {
      setActionSheet(null);
      setReactionSheetMessageId(null);
    }
  };

  const renderMessageContent = (text: string) => {
    const linkPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const parts = String(text || '').split(linkPattern);
    return parts.map((part, index) => {
      if (!part) return null;
      const isLink = /^(https?:\/\/|www\.)/i.test(part);
      if (!isLink) return <span key={`${part}-${index}`}>{part}</span>;
      const href = part.startsWith('http') ? part : `https://${part}`;
      return (
        <a
          key={`${part}-${index}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-link"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    });
  };

  const myReactionForMessage = (message: Message) =>
    (message.reactions || []).find((reaction) => String(reaction.userId) === currentUserIdStr)?.emoji || '';

  const groupedReactionsForMessage = (message: Message) => {
    const grouped = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const reaction of message.reactions || []) {
      const emoji = reaction.emoji;
      const current = grouped.get(emoji);
      const mine = String(reaction.userId) === currentUserIdStr;
      if (!current) {
        grouped.set(emoji, { emoji, count: 1, mine });
      } else {
        grouped.set(emoji, { emoji, count: current.count + 1, mine: current.mine || mine });
      }
    }
    return Array.from(grouped.values());
  };

  const getParticipantName = (userId: string) => {
    if (normalizeId(userId) === currentUserIdStr) return 'You';
    const currentRoom = selectedChatRoomRef.current;
    const participant = currentRoom?.participants.find((p) => normalizeId(p.userId) === normalizeId(userId));
    return participant?.name || 'User';
  };

  const getReactionViewers = (message: Message): ReactionViewer[] => {
    return (message.reactions || []).map((reaction) => ({
      userId: normalizeId(reaction.userId),
      name: getParticipantName(String(reaction.userId)),
      emoji: reaction.emoji
    }));
  };

  const reactionSheetMessage = useMemo(
    () => (reactionSheetMessageId ? messages.find((message) => normalizeId(message.id) === normalizeId(reactionSheetMessageId)) || null : null),
    [reactionSheetMessageId, messages]
  );

  const reactionSheetViewers = useMemo(
    () => (reactionSheetMessage ? getReactionViewers(reactionSheetMessage) : []),
    [reactionSheetMessage]
  );

  const messagesById = useMemo(() => {
    const byId = new Map<string, Message>();
    for (const message of messages) {
      byId.set(normalizeId(message.id), message);
    }
    return byId;
  }, [messages]);

  const actionSheetMessage = useMemo(
    () => (actionSheet ? messages.find((message) => String(message.id) === String(actionSheet.messageId)) || null : null),
    [actionSheet, messages]
  );
  const myReactionOnActionSheetMessage = actionSheetMessage ? myReactionForMessage(actionSheetMessage) : '';

  const getReplyPreviewForMessage = (message: Message) => {
    const replyId = normalizeId(message.replyToMessageId);
    if (!replyId) return null;

    const repliedMessage = messagesById.get(replyId);
    if (!repliedMessage) {
      return {
        senderName: 'Original message',
        text: 'Message not available'
      };
    }

    const senderName =
      normalizeId(repliedMessage.senderId) === currentUserIdStr
        ? 'You'
        : getParticipantName(String(repliedMessage.senderId));
    const text = String(repliedMessage.encryptedContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, PREVIEW_REPLY_CHARS) || 'Message';

    return { senderName, text };
  };

  const emitTypingState = (isTyping: boolean) => {
    const activeRoom = selectedChatRoomRef.current;
    if (!activeRoom || !wsRef.current) return;
    const normalizedTargetUserId = activeRoom.participants.find(
      (p) => String(p.userId) !== currentUserIdStr
    )?.userId;
    if (!normalizedTargetUserId) return;

    wsRef.current.emit(isTyping ? 'typing:start' : 'typing:stop', {
      targetUserId: normalizedTargetUserId,
      chatRoomId: activeRoom.chatRoomId
    });
  };

  const handleMessageInputChange = (value: string) => {
    setMessageInput(value);
    if (messageInputRef.current) {
      messageInputRef.current.style.height = 'auto';
      const nextHeight = Math.min(messageInputRef.current.scrollHeight, 120);
      messageInputRef.current.style.height = `${nextHeight}px`;
    }
    if (!selectedChatRoomRef.current) return;

    if (value.trim()) {
      emitTypingState(true);
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
      }
      typingStopTimeoutRef.current = window.setTimeout(() => {
        emitTypingState(false);
      }, 1200);
    } else {
      emitTypingState(false);
    }
  };

  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  };

  const forceScrollToBottom = () => {
    forceScrollToBottomRef.current = true;
    isAtBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom());
  };

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const initiateCall = async (type: 'voice' | 'video') => {
    if (!selectedChatRoom) return;

    const friendId = selectedChatRoom.participants.find(
      p => String(p.userId) !== currentUserIdStr
    )?.userId;
    const friendName =
      selectedChatRoom.participants.find((p) => String(p.userId) !== currentUserIdStr)?.name ||
      'Unknown';

    if (!friendId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/calls/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          participantId: friendId,
          type
        })
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentCall({
          callId: data.call.id,
          type,
          isIncoming: false,
          callerId: String(friendId),
          callerName: friendName
        });
        setShowCallModal(true);
      } else {
        const error = await response.json();
        alert(error.error?.message || 'Failed to initiate call');
      }
    } catch (error) {
      console.error('Failed to initiate call:', error);
      alert('Failed to initiate call');
    }
  };

  const handleAcceptCall = () => {
    console.log('Call accepted');
  };

  const handleRejectCall = () => {
    setShowCallModal(false);
    setCurrentCall(null);
  };

  const handleEndCall = async () => {
    if (currentCall) {
      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_URL}/api/calls/${currentCall.callId}/end`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (error) {
        console.error('Failed to end call:', error);
      }
    }
    setShowCallModal(false);
    setCurrentCall(null);
  };

  const filteredChatRooms = chatRooms.filter((room) => {
    const other = getOtherParticipant(room);
    const haystack = `${other?.name || ''} ${other?.profession || ''}`.toLowerCase();
    return haystack.includes(chatSearch.toLowerCase());
  });

  const selectedOtherParticipant = selectedChatRoom
    ? selectedChatRoom.participants.find((p) => String(p.userId) !== currentUserIdStr)
    : null;

  const headerPresenceText = isPeerTyping
    ? 'Typing...'
    : peerOnline
      ? 'Online'
      : peerLastSeen
        ? `Last seen ${peerLastSeen}`
        : 'Offline';

  const buildActionSheetPosition = (
    rect: DOMRect,
    isOwn: boolean
  ): MessageActionSheetPosition => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const preferredX = isOwn ? rect.right - ACTION_SHEET_WIDTH : rect.left;
    const clampedX = Math.max(
      ACTION_SHEET_MARGIN,
      Math.min(preferredX, viewportWidth - ACTION_SHEET_WIDTH - ACTION_SHEET_MARGIN)
    );

    const spaceBelow = viewportHeight - rect.bottom;
    const sheetHeightEstimate = 188;
    const alignY: 'above' | 'below' = spaceBelow < sheetHeightEstimate ? 'above' : 'below';
    const y = alignY === 'above' ? rect.top - 8 : rect.bottom + 8;

    return {
      x: clampedX,
      y,
      alignX: isOwn ? 'right' : 'left',
      alignY
    };
  };

  const openActionSheetFromRect = (rect: DOMRect, message: Message, isOwnMessage: boolean) => {
    if (message.deletedForEveryone) return;
    const position = buildActionSheetPosition(rect, isOwnMessage);
    setActionSheet({
      messageId: String(message.id),
      isOwn: isOwnMessage,
      ...position
    });
    setShowEmojiPicker(false);
  };

  const handleMessageContextMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    message: Message,
    isOwnMessage: boolean
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
    openActionSheetFromRect(rect, message, isOwnMessage);
  };

  const startMessageLongPress = (
    event: React.PointerEvent<HTMLDivElement>,
    message: Message,
    isOwnMessage: boolean
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    longPressMovedRef.current = false;
    activePointerIdRef.current = event.pointerId;
    const target = event.currentTarget;
    longPressTimerRef.current = window.setTimeout(() => {
      if (longPressMovedRef.current) return;
      const rect = target.getBoundingClientRect();
      openActionSheetFromRect(rect, message, isOwnMessage);
    }, 360);
  };

  const cancelMessageLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    activePointerIdRef.current = null;
  };

  const moveMessageLongPress = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === null) return;
    if (event.pointerId !== activePointerIdRef.current) return;
    if (Math.abs(event.movementX) > 6 || Math.abs(event.movementY) > 6) {
      longPressMovedRef.current = true;
      cancelMessageLongPress();
    }
  };

  const startSwipeReply = (event: React.TouchEvent<HTMLDivElement>, message: Message) => {
    if (event.touches.length !== 1 || message.deletedForEveryone) return;
    const touch = event.touches[0];
    const messageId = normalizeId(message.id);
    swipeStartRef.current = {
      id: messageId,
      x: touch.clientX,
      y: touch.clientY
    };
    setSwipingMessageId(messageId);
    setSwipeOffsets((prev) => ({ ...prev, [messageId]: 0 }));
  };

  const moveSwipeReply = (
    event: React.TouchEvent<HTMLDivElement>,
    message: Message,
    isOwnMessage: boolean
  ) => {
    const activeSwipe = swipeStartRef.current;
    const messageId = normalizeId(message.id);
    if (!activeSwipe || activeSwipe.id !== messageId) return;
    const touch = event.touches?.[0];
    if (!touch) return;

    const diffX = touch.clientX - activeSwipe.x;
    const diffY = touch.clientY - activeSwipe.y;
    if (Math.abs(diffY) > 42) return;

    let nextOffset = 0;
    if (isOwnMessage) {
      nextOffset = Math.max(-MAX_SWIPE_DISTANCE, Math.min(0, diffX));
    } else {
      nextOffset = Math.max(0, Math.min(MAX_SWIPE_DISTANCE, diffX));
    }
    setSwipeOffsets((prev) => ({ ...prev, [messageId]: nextOffset }));
  };

  const endSwipeReply = (
    event: React.TouchEvent<HTMLDivElement>,
    message: Message,
    isOwnMessage: boolean
  ) => {
    const messageId = normalizeId(message.id);
    if (!swipeStartRef.current || swipeStartRef.current.id !== messageId) return;
    const touch = event.changedTouches?.[0];
    if (!touch) {
      swipeStartRef.current = null;
      setSwipingMessageId(null);
      setSwipeOffsets((prev) => ({ ...prev, [messageId]: 0 }));
      return;
    }

    const diffX = touch.clientX - swipeStartRef.current.x;
    const diffY = touch.clientY - swipeStartRef.current.y;
    swipeStartRef.current = null;
    setSwipingMessageId(null);
    setSwipeOffsets((prev) => ({ ...prev, [messageId]: 0 }));

    if (Math.abs(diffY) > 42) return;
    if (!isOwnMessage && diffX < SWIPE_REPLY_THRESHOLD) return;
    if (isOwnMessage && diffX > -SWIPE_REPLY_THRESHOLD) return;

    const senderName = normalizeId(message.senderId) === currentUserIdStr ? 'You' : getParticipantName(String(message.senderId));
    const safeText = String(message.encryptedContent || '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_REPLY_CHARS);
    setReplyTarget({
      messageId,
      senderId: normalizeId(message.senderId),
      senderName,
      text: safeText,
      isOwn: normalizeId(message.senderId) === currentUserIdStr
    });
    messageInputRef.current?.focus();
  };

  const scrollToQuotedMessage = (replyToMessageId?: string | null) => {
    const targetId = normalizeId(replyToMessageId);
    if (!targetId) return;
    const targetElement = document.getElementById(`message-${targetId}`);
    if (!targetElement) return;

    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetElement.classList.remove('message-row-highlight');
    void targetElement.offsetWidth;
    targetElement.classList.add('message-row-highlight');
    setHighlightedMessageId(null);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      targetElement.classList.remove('message-row-highlight');
      setHighlightedMessageId(null);
    }, 1500);
  };

  const deleteForMe = async () => {
    if (!actionSheet) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/messages/${actionSheet.messageId}/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        setMessages((prev) => prev.filter((m) => String(m.id) !== String(actionSheet.messageId)));
      }
    } catch (error) {
      console.error('Delete for me failed:', error);
    } finally {
      setActionSheet(null);
    }
  };

  const deleteForEveryone = async () => {
    if (!actionSheet || !actionSheet.isOwn) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/messages/${actionSheet.messageId}/everyone`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(actionSheet.messageId)
              ? { ...m, encryptedContent: DELETED_MESSAGE_TEXT, deletedForEveryone: true }
              : m
          )
        );
      }
    } catch (error) {
      console.error('Delete for everyone failed:', error);
    } finally {
      setActionSheet(null);
    }
  };

  if (showLoader) {
    return <BeeLoader message="Loading chats..." fullscreen complete={complete} onComplete={handleLoaderComplete} />;
  }

  return (
    <div className="chat-page">
      <div className="chat-container">
        {/* Chat List Sidebar */}
        <div className={`chat-list-sidebar ${isMobileView && showSidebarOnMobile ? 'mobile-visible' : ''}`}>
          <div className="chat-list-header">
            <button className="back-button" onClick={() => navigate('/home')}>
              <BackArrowIcon />
            </button>
            <h2>Messages</h2>
            <input
              className="chat-search-input"
              type="text"
              placeholder="Search chats..."
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
            />
          </div>

          {filteredChatRooms.length === 0 ? (
            <div className="no-chats">
              <p>No matching chats</p>
              <p className="subtitle">Try a different name or profession.</p>
            </div>
          ) : (
            <div className="chat-list">
              {filteredChatRooms.map((room) => {
                const otherParticipant = room.participants.find(
                  p => String(p.userId) !== currentUserIdStr
                );
                const isSelected = selectedChatRoom?.chatRoomId === room.chatRoomId;

                return (
                  <div
                    key={room.chatRoomId}
                    className={`chat-list-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedChatRoom(room);
                      if (isMobileView) setShowSidebarOnMobile(false);
                    }}
                  >
                    <div className="chat-avatar-btn" aria-hidden="true">
                      {getParticipantPhoto(otherParticipant) ? (
                        <img
                          src={getParticipantPhoto(otherParticipant)}
                          alt={otherParticipant?.name || 'User'}
                          className="chat-avatar"
                        />
                      ) : (
                        <span className="chat-avatar-fallback">{getInitial(otherParticipant?.name)}</span>
                      )}
                    </div>
                    <div className="chat-list-item-main">
                      <div className="chat-list-item-info">
                        <h3>
                          <span className="chat-name-link">
                            {otherParticipant?.name || 'Unknown'}
                          </span>
                          {otherParticipant?.profession && (
                            <span className="chat-name-profession">{` • ${otherParticipant.profession}`}</span>
                          )}
                        </h3>
                        {room.lastMessage && (
                          <p className="last-message">
                            {isLikelyCiphertext(room.lastMessage.encryptedContent)
                              ? 'Encrypted message'
                              : `${room.lastMessage.encryptedContent.substring(0, 30)}${
                                  room.lastMessage.encryptedContent.length > 30 ? '...' : ''
                                }`}
                          </p>
                        )}
                      </div>
                      <div className="chat-list-item-meta">
                        {room.lastMessageAt && (
                          <span className="last-message-time">
                            {formatDate(new Date(room.lastMessageAt))}
                          </span>
                        )}
                        {Number(room.unreadCount || 0) > 0 && (
                          <span className="chat-unread-badge">
                            {room.unreadCount! > 99 ? '99+' : room.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Chat Window */}
        <div className={`chat-window ${isMobileView && showSidebarOnMobile ? 'mobile-hidden' : ''}`}>
          {selectedChatRoom ? (
            <>
              <div className="chat-window-header">
                <div className="chat-header-primary">
                  {isMobileView && (
                    <button
                      className="back-to-chats-button"
                      onClick={() => setShowSidebarOnMobile(true)}
                      aria-label="Back to chats"
                    >
                      <BackArrowIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    className="chat-header-user"
                    onClick={() => selectedOtherParticipant?.userId && openUserProfile(String(selectedOtherParticipant.userId))}
                    aria-label={`Open ${selectedOtherParticipant?.name || 'user'} profile`}
                  >
                    {getParticipantPhoto(selectedOtherParticipant || undefined) ? (
                      <img
                        src={getParticipantPhoto(selectedOtherParticipant || undefined)}
                        alt={selectedOtherParticipant?.name || 'User'}
                        className="chat-header-avatar"
                      />
                    ) : (
                      <span className="chat-header-avatar-fallback">{getInitial(selectedOtherParticipant?.name)}</span>
                    )}
                    <span className="chat-header-info">
                      <span className="chat-header-name">
                        {selectedChatRoom.participants
                          .filter(p => String(p.userId) !== currentUserIdStr)
                          .map(p => p.name)
                          .join(', ')}
                      </span>
                      <span className="chat-header-subline">
                        <span className="encryption-indicator">
                          <span className="lock-icon"><LockIcon /></span>
                          <span>End-to-end encrypted</span>
                        </span>
                        {activeMatchBadge && <span className="typing-indicator">{`Matched \u{1F496}`}</span>}
                      </span>
                      <span className={`typing-indicator ${isPeerTyping ? 'typing-live' : ''}`}>
                        {headerPresenceText}
                      </span>
                    </span>
                  </button>
                </div>
                <div className="call-buttons" role="group" aria-label="Call actions">
                  <button
                    className="call-button icon-only"
                    onClick={() => initiateCall('voice')}
                    title="Voice call"
                    aria-label="Voice call"
                  >
                    <VoiceCallIcon />
                  </button>
                  <button
                    className="call-button icon-only"
                    onClick={() => initiateCall('video')}
                    title="Video call"
                    aria-label="Video call"
                  >
                    <VideoCallIcon />
                  </button>
                </div>
              </div>

              <div className="messages-container" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
                {messages.map((message, index) => {
                  const isOwnMessage = String(message.senderId) === currentUserIdStr;
                  const showDate = index === 0 || 
                    formatDate(new Date(messages[index - 1].timestamp)) !== 
                    formatDate(new Date(message.timestamp));
                  const replyPreview = message.deletedForEveryone ? null : getReplyPreviewForMessage(message);

                  return (
                    <div
                      key={message.id}
                      id={`message-${normalizeId(message.id)}`}
                      className={highlightedMessageId === normalizeId(message.id) ? 'message-row message-row-highlight' : 'message-row'}
                    >
                      {showDate && (
                        <div className="message-date-divider">
                          {formatDate(new Date(message.timestamp))}
                        </div>
                      )}
                      <div className={`message ${isOwnMessage ? 'own' : 'other'}`}>
                        <div className="message-swipe-shell">
                          <span className="message-reply-indicator" aria-hidden="true">
                            ↩
                          </span>
                          <div
                            className={`message-content ${message.deletedForEveryone ? 'deleted' : ''}`}
                            style={{
                              transform: `translateX(${swipeOffsets[normalizeId(message.id)] || 0}px)`,
                              transition:
                                swipingMessageId === normalizeId(message.id)
                                  ? 'none'
                                  : 'transform 0.2s ease-out'
                            }}
                            onContextMenu={(e) => handleMessageContextMenu(e, message, isOwnMessage)}
                            onPointerDown={(e) => startMessageLongPress(e, message, isOwnMessage)}
                            onPointerUp={cancelMessageLongPress}
                            onPointerLeave={cancelMessageLongPress}
                            onPointerCancel={cancelMessageLongPress}
                            onPointerMove={moveMessageLongPress}
                            onTouchStart={(e) => startSwipeReply(e, message)}
                            onTouchMove={(e) => moveSwipeReply(e, message, isOwnMessage)}
                            onTouchEnd={(e) => endSwipeReply(e, message, isOwnMessage)}
                            onTouchCancel={(e) => endSwipeReply(e, message, isOwnMessage)}
                          >
                            {replyPreview && (
                              <div
                                className="message-quote"
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  scrollToQuotedMessage(message.replyToMessageId);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    scrollToQuotedMessage(message.replyToMessageId);
                                  }
                                }}
                              >
                                <span className="message-quote-sender">{replyPreview.senderName}</span>
                                <span className="message-quote-text">{replyPreview.text}</span>
                              </div>
                            )}
                            {renderMessageContent(message.encryptedContent)}
                          </div>
                        </div>
                        {Array.isArray(message.reactions) && message.reactions.length > 0 && (
                          <div className="message-reactions-bar">
                            {groupedReactionsForMessage(message).map((reaction) => (
                              <button
                                key={`${message.id}-${reaction.emoji}`}
                                className={`reaction-chip ${reaction.mine ? 'reaction-chip-own' : ''}`}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReactionSheetMessageId(normalizeId(message.id));
                                }}
                              >
                                <span className="reaction-chip-emoji">{reaction.emoji}</span>
                                <span className="reaction-chip-count">{reaction.count}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="message-meta">
                          <span className="message-time">
                            {formatTime(message.timestamp)}
                          </span>
                          {isOwnMessage && (
                            <span
                              className={`message-status ${message.read ? 'read' : message.delivered ? 'delivered' : 'sent'}`}
                              aria-label={message.read ? 'Read' : message.delivered ? 'Delivered' : 'Sent'}
                            >
                              <MessageStatusTicks status={message.read ? 'read' : message.delivered ? 'delivered' : 'sent'} />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="message-input-container">
                {replyTarget && (
                  <div
                    className={`reply-preview ${replyTarget.isOwn ? 'reply-preview-own' : 'reply-preview-other'}`}
                    role="status"
                    aria-live="polite"
                  >
                    <div className="reply-preview-text">
                      <strong>Replying to {replyTarget.senderName}</strong>
                      <span>{replyTarget.text}</span>
                    </div>
                    <button
                      type="button"
                      className="reply-preview-close"
                      onClick={() => setReplyTarget(null)}
                      aria-label="Cancel reply"
                    >
                      ×
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="emoji-toggle-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEmojiPicker((prev) => {
                      const next = !prev;
                      if (next) {
                        const currentKeyboardOffset = Math.max(getCurrentKeyboardOffset(), keyboardOffsetRef.current);
                        keyboardHoldOffsetRef.current = Math.max(
                          keyboardHoldOffsetRef.current,
                          currentKeyboardOffset
                        );
                        document.documentElement.style.setProperty(
                          '--chat-keyboard-offset',
                          `${keyboardHoldOffsetRef.current}px`
                        );
                      } else if (!keyboardVisibleRef.current) {
                        keyboardHoldOffsetRef.current = 0;
                      }
                      if (isAtBottomRef.current) {
                        requestAnimationFrame(() => scrollToBottom());
                      }
                      return next;
                    });
                  }}
                  aria-label="Open emoji picker"
                >
                  {'\u{1F642}'}
                </button>
                {showEmojiPicker && (
                  <div
                    className="emoji-picker-panel"
                    role="dialog"
                    aria-label="Emoji picker"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={`quick-emoji-${emoji}`}
                        type="button"
                        className="emoji-option-btn"
                        onClick={() => addEmojiToInput(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={messageInputRef}
                  className="message-input"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => handleMessageInputChange(e.target.value)}
                  onFocus={() => {
                    if (!isMobileView) return;
                    inputFocusedRef.current = true;
                    setChatViewportHeight();
                    const viewport = window.visualViewport;
                    const keyboardOffset = viewport
                      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
                      : 0;
                    applyKeyboardOffset(keyboardOffset);
                    forceScrollToBottom();
                    window.setTimeout(() => scrollToBottom(), 40);
                    window.setTimeout(() => scrollToBottom(), 120);
                  }}
                  onBlur={() => {
                    inputFocusedRef.current = false;
                  }}
                  onKeyDown={handleKeyPress}
                  onPaste={handleInputPaste}
                  rows={1}
                  disabled={sending}
                />
                <button
                  type="button"
                  className="send-button"
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={sendMessage}
                  disabled={!messageInput.trim() || sending}
                >
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <div className="no-chat-selected">
              <p>Select a chat to start messaging</p>
            </div>
          )}
        </div>
      </div>

      {/* Call Modal */}
      {showCallModal && currentCall && (
        <CallModal
          callId={currentCall.callId}
          callType={currentCall.type}
          isIncoming={currentCall.isIncoming}
          callerName={currentCall.callerName}
          callerId={currentCall.callerId}
          onAccept={handleAcceptCall}
          onReject={handleRejectCall}
          onEnd={handleEndCall}
          socket={wsRef.current}
        />
      )}

      {actionSheet && (
        <div
          className={`message-action-sheet menu-align-${actionSheet.alignX} menu-${actionSheet.alignY}`}
          style={{ left: `${actionSheet.x}px`, top: `${actionSheet.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="reaction-row" role="group" aria-label="React to message">
            {MESSAGE_REACTION_OPTIONS.map((emoji) => (
              <button
                key={`sheet-reaction-${emoji}`}
                type="button"
                className={`reaction-pill ${myReactionOnActionSheetMessage === emoji ? 'reaction-pill-active' : ''}`}
                onClick={() => reactToMessage(actionSheet.messageId, emoji)}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
          {myReactionOnActionSheetMessage && (
            <button className="context-item" onClick={(e) => removeReaction(actionSheet.messageId, e)}>
              Remove my reaction
            </button>
          )}
          {actionSheet.isOwn && (
            <button className="context-item danger" onClick={deleteForEveryone}>
              Delete for everyone
            </button>
          )}
          <button className="context-item" onClick={deleteForMe}>
            Delete for me
          </button>
        </div>
      )}

      {reactionSheetMessage && (
        <div className="reaction-sheet-backdrop" onClick={() => setReactionSheetMessageId(null)}>
          <div className="reaction-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="reaction-sheet-handle" />
            <div className="reaction-sheet-header">
              <h4>Reactions</h4>
              <button
                type="button"
                className="reaction-sheet-close"
                onClick={() => setReactionSheetMessageId(null)}
                aria-label="Close reactions"
              >
                ×
              </button>
            </div>
            <div className="reaction-sheet-list">
              {reactionSheetViewers.length === 0 ? (
                <p className="reaction-sheet-empty">No reactions yet</p>
              ) : (
                reactionSheetViewers.map((viewer, index) => (
                  <div className="reaction-sheet-row" key={`${viewer.userId}-${viewer.emoji}-${index}`}>
                    <span className="reaction-sheet-emoji">{viewer.emoji}</span>
                    <span className="reaction-sheet-name">{viewer.name}</span>
                  </div>
                ))
              )}
            </div>
            {(reactionSheetMessage.reactions || []).some(
              (reaction) => normalizeId(reaction.userId) === currentUserIdStr
            ) && (
              <button
                type="button"
                className="reaction-sheet-remove-btn"
                onClick={(e) => removeReaction(reactionSheetMessage.id, e)}
              >
                Remove my reaction
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatPage;





