/**
 * Client-side encryption utilities using Web Crypto API
 * Implements RSA-OAEP for end-to-end encrypted messaging
 */

import { BrowserCompatibility } from './browserCompatibility';
import { getApiBaseUrl } from './runtimeConfig';

const ENCRYPTION_ALGORITHM = 'RSA-OAEP';
const KEY_SIZE = 2048;
const HASH_ALGORITHM = 'SHA-256';
const RSA_MAX_PLAINTEXT_BYTES = 190;
const AES_ALGORITHM = 'AES-GCM';
const AES_KEY_LENGTH = 256;
const AES_IV_LENGTH_BYTES = 12;

interface HybridEnvelopeV2 {
  v: 2;
  alg: 'RSA-OAEP+A256GCM';
  ek: string;
  iv: string;
  ct: string;
}

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export class EncryptionService {
  private static keyPair: KeyPair | null = null;
  private static publicKeyCache: Map<string, CryptoKey> = new Map();
  private static readonly BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;
  private static readonly PEM_PUBLIC_KEY_HEADER = '-----BEGIN PUBLIC KEY-----';
  private static readonly PEM_PUBLIC_KEY_FOOTER = '-----END PUBLIC KEY-----';

  /**
   * Generate RSA key pair for the current user
   */
  static async generateKeyPair(): Promise<KeyPair> {
    // Check browser compatibility
    if (!BrowserCompatibility.isWebCryptoSupported()) {
      throw new Error('Web Crypto API is not supported in this browser');
    }

    try {
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: ENCRYPTION_ALGORITHM,
          modulusLength: KEY_SIZE,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: HASH_ALGORITHM
        },
        true, // extractable
        ['encrypt', 'decrypt']
      );

      this.keyPair = keyPair as KeyPair;
      
      // Store private key in IndexedDB for persistence
      await this.storePrivateKey(keyPair.privateKey);
      
      return keyPair as KeyPair;
    } catch (error) {
      console.error('Failed to generate key pair:', error);
      throw new Error('Key generation failed');
    }
  }

  /**
   * Get or generate key pair
   */
  static async getKeyPair(): Promise<KeyPair> {
    if (this.keyPair) {
      return this.keyPair;
    }

    // Try to load from storage
    const storedKeyPair = await this.loadStoredKeyPair();
    if (storedKeyPair) {
      this.keyPair = storedKeyPair;
      return this.keyPair;
    }

    // Try to load from server (same account on another device/browser)
    const serverKeyPair = await this.loadKeyPairFromServer();
    if (serverKeyPair) {
      this.keyPair = serverKeyPair;
      await this.storePrivateKey(serverKeyPair.privateKey);
      return this.keyPair;
    }

    // Generate new key pair
    return await this.generateKeyPair();
  }

  /**
   * Export public key to base64 string for sharing
   */
  static async exportPublicKey(publicKey: CryptoKey): Promise<string> {
    try {
      const exported = await window.crypto.subtle.exportKey('spki', publicKey);
      const exportedAsString = String.fromCharCode(...new Uint8Array(exported));
      return btoa(exportedAsString);
    } catch (error) {
      console.error('Failed to export public key:', error);
      throw new Error('Public key export failed');
    }
  }

  /**
   * Import public key from base64 string
   */
  static async importPublicKey(publicKeyString: string): Promise<CryptoKey> {
    try {
      const normalized = this.normalizeBase64Key(publicKeyString);
      const binaryString = atob(normalized);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return await window.crypto.subtle.importKey(
        'spki',
        bytes,
        {
          name: ENCRYPTION_ALGORITHM,
          hash: HASH_ALGORITHM
        },
        true,
        ['encrypt']
      );
    } catch (error) {
      console.error('Failed to import public key:', error);
      throw new Error('Public key import failed');
    }
  }

  static clearRecipientPublicKeyCache(recipientId?: string): void {
    if (!recipientId) {
      this.publicKeyCache.clear();
      return;
    }
    this.publicKeyCache.delete(String(recipientId));
  }

  /**
   * Encrypt message with recipient's public key
   */
  static async encryptMessage(message: string, recipientPublicKey: CryptoKey): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);

      if (data.byteLength > RSA_MAX_PLAINTEXT_BYTES) {
        return await this.encryptHybridMessage(data, recipientPublicKey);
      }

      const encrypted = await window.crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGORITHM },
        recipientPublicKey,
        data
      );

      return this.bytesToBase64(new Uint8Array(encrypted));
    } catch (error) {
      console.error('Failed to encrypt message:', error);
      throw new Error('Message encryption failed');
    }
  }

  /**
   * Decrypt message with own private key
   */
  static async decryptMessage(encryptedMessage: string, privateKey: CryptoKey): Promise<string> {
    if (!encryptedMessage) return '';
    if (!this.BASE64_REGEX.test(encryptedMessage) || encryptedMessage.length < 24) {
      // Backward compatibility for plaintext legacy messages.
      return encryptedMessage;
    }

    try {
      const hybridEnvelope = this.tryParseHybridEnvelope(encryptedMessage);
      if (hybridEnvelope) {
        return await this.decryptHybridMessage(hybridEnvelope, privateKey);
      }

      const bytes = this.base64ToBytes(encryptedMessage);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: ENCRYPTION_ALGORITHM },
        privateKey,
        this.toArrayBuffer(bytes)
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      throw new Error('Message decryption failed');
    }
  }

  /**
   * Fetch and cache recipient's public key from server
   */
  static async getRecipientPublicKey(recipientId: string, apiUrl: string, token: string): Promise<CryptoKey> {
    // Check cache first
    if (this.publicKeyCache.has(recipientId)) {
      return this.publicKeyCache.get(recipientId)!;
    }

    try {
      const response = await fetch(`${apiUrl}/api/keys/${recipientId}/public`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const error: any = new Error('Failed to fetch public key');
        error.status = response.status;
        const payload = await response.json().catch(() => null);
        error.code = payload?.error?.code;
        throw error;
      }

      const data = await response.json();
      const publicKey = await this.importPublicKey(data.publicKey);
      
      // Cache the key
      this.publicKeyCache.set(recipientId, publicKey);
      
      return publicKey;
    } catch (error) {
      console.error('Failed to get recipient public key:', error);
      throw new Error('Could not retrieve recipient public key');
    }
  }

  /**
   * Upload public key to server
   */
  static async uploadPublicKey(apiUrl: string, token: string): Promise<void> {
    try {
      const keyPair = await this.getKeyPair();
      const publicKeyString = await this.exportPublicKey(keyPair.publicKey);
      const privateKeyString = await this.exportPrivateKey(keyPair.privateKey);

      const response = await fetch(`${apiUrl}/api/keys/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ publicKey: publicKeyString, privateKey: privateKeyString })
      });

      if (!response.ok) {
        const error: any = new Error('Failed to upload public key');
        error.status = response.status;
        const payload = await response.json().catch(() => null);
        error.code = payload?.error?.code;
        throw error;
      }
    } catch (error) {
      console.error('Failed to upload public key:', error);
      throw new Error('Public key upload failed');
    }
  }

  /**
   * Store key pair in localStorage
   */
  private static async storePrivateKey(privateKey: CryptoKey): Promise<void> {
    try {
      const keyPair = this.keyPair;
      if (!keyPair) return;

      const exportedPrivate = await window.crypto.subtle.exportKey('pkcs8', privateKey);
      const exportedPublic = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);

      const privateString = String.fromCharCode(...new Uint8Array(exportedPrivate));
      const publicString = String.fromCharCode(...new Uint8Array(exportedPublic));

      localStorage.setItem('privateKey', btoa(privateString));
      localStorage.setItem('publicKey', btoa(publicString));
    } catch (error) {
      console.error('Failed to store private key:', error);
    }
  }

  /**
   * Load key pair from localStorage
   */
  private static async loadStoredKeyPair(): Promise<KeyPair | null> {
    try {
      const storedPrivate = localStorage.getItem('privateKey');
      const storedPublic = localStorage.getItem('publicKey');
      if (!storedPrivate || !storedPublic) return null;

      const privateBinary = atob(storedPrivate);
      const privateBytes = new Uint8Array(privateBinary.length);
      for (let i = 0; i < privateBinary.length; i++) {
        privateBytes[i] = privateBinary.charCodeAt(i);
      }

      const publicBinary = atob(storedPublic);
      const publicBytes = new Uint8Array(publicBinary.length);
      for (let i = 0; i < publicBinary.length; i++) {
        publicBytes[i] = publicBinary.charCodeAt(i);
      }

      const privateKey = await window.crypto.subtle.importKey(
        'pkcs8',
        privateBytes,
        {
          name: ENCRYPTION_ALGORITHM,
          hash: HASH_ALGORITHM
        },
        true,
        ['decrypt']
      );

      const publicKey = await window.crypto.subtle.importKey(
        'spki',
        publicBytes,
        {
          name: ENCRYPTION_ALGORITHM,
          hash: HASH_ALGORITHM
        },
        true,
        ['encrypt']
      );

      return { publicKey, privateKey };
    } catch (error) {
      console.error('Failed to load stored key pair:', error);
      return null;
    }
  }

  private static async exportPrivateKey(privateKey: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('pkcs8', privateKey);
    return this.bytesToBase64(new Uint8Array(exported));
  }

  private static async encryptHybridMessage(
    data: Uint8Array,
    recipientPublicKey: CryptoKey
  ): Promise<string> {
    const aesKey = await window.crypto.subtle.generateKey(
      { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH_BYTES));
    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: AES_ALGORITHM, iv: this.toArrayBuffer(iv) },
      aesKey,
      this.toArrayBuffer(data)
    );

    const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
    const encryptedKeyBuffer = await window.crypto.subtle.encrypt(
      { name: ENCRYPTION_ALGORITHM },
      recipientPublicKey,
      rawAesKey
    );

    const payload: HybridEnvelopeV2 = {
      v: 2,
      alg: 'RSA-OAEP+A256GCM',
      ek: this.bytesToBase64(new Uint8Array(encryptedKeyBuffer)),
      iv: this.bytesToBase64(iv),
      ct: this.bytesToBase64(new Uint8Array(cipherBuffer))
    };

    return this.utf8ToBase64(JSON.stringify(payload));
  }

  private static async decryptHybridMessage(
    envelope: HybridEnvelopeV2,
    privateKey: CryptoKey
  ): Promise<string> {
    const encryptedAesKey = this.base64ToBytes(envelope.ek);
    const rawAesKey = await window.crypto.subtle.decrypt(
      { name: ENCRYPTION_ALGORITHM },
      privateKey,
      this.toArrayBuffer(encryptedAesKey)
    );

    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      rawAesKey,
      { name: AES_ALGORITHM },
      false,
      ['decrypt']
    );

    const iv = this.base64ToBytes(envelope.iv);
    const cipherBytes = this.base64ToBytes(envelope.ct);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: AES_ALGORITHM, iv: this.toArrayBuffer(iv) },
      aesKey,
      this.toArrayBuffer(cipherBytes)
    );

    return new TextDecoder().decode(decrypted);
  }

  private static tryParseHybridEnvelope(encryptedMessage: string): HybridEnvelopeV2 | null {
    try {
      const decoded = this.base64ToUtf8(encryptedMessage);
      const parsed = JSON.parse(decoded);
      if (
        parsed &&
        parsed.v === 2 &&
        parsed.alg === 'RSA-OAEP+A256GCM' &&
        typeof parsed.ek === 'string' &&
        typeof parsed.iv === 'string' &&
        typeof parsed.ct === 'string'
      ) {
        return parsed as HybridEnvelopeV2;
      }
      return null;
    } catch {
      return null;
    }
  }

  private static bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private static base64ToBytes(value: string): Uint8Array {
    const binaryString = atob(value);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private static utf8ToBase64(value: string): string {
    return this.bytesToBase64(new TextEncoder().encode(value));
  }

  private static base64ToUtf8(value: string): string {
    return new TextDecoder().decode(this.base64ToBytes(value));
  }

  private static normalizeBase64Key(value: string): string {
    let normalized = String(value || '').trim();
    if (
      normalized.startsWith(this.PEM_PUBLIC_KEY_HEADER) &&
      normalized.includes(this.PEM_PUBLIC_KEY_FOOTER)
    ) {
      normalized = normalized
        .replace(this.PEM_PUBLIC_KEY_HEADER, '')
        .replace(this.PEM_PUBLIC_KEY_FOOTER, '')
        .trim();
    }
    normalized = normalized.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const remainder = normalized.length % 4;
    if (remainder > 0) {
      normalized = normalized.padEnd(normalized.length + (4 - remainder), '=');
    }
    return normalized;
  }

  private static toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  private static async loadKeyPairFromServer(): Promise<KeyPair | null> {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;

      const apiUrl = getApiBaseUrl();

      const response = await fetch(`${apiUrl}/api/keys/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) return null;
      const data = await response.json();
      if (!data.publicKey || !data.privateKey) return null;

      const publicKey = await this.importPublicKey(data.publicKey);

      const privateBinary = atob(data.privateKey);
      const privateBytes = new Uint8Array(privateBinary.length);
      for (let i = 0; i < privateBinary.length; i++) {
        privateBytes[i] = privateBinary.charCodeAt(i);
      }

      const privateKey = await window.crypto.subtle.importKey(
        'pkcs8',
        privateBytes,
        {
          name: ENCRYPTION_ALGORITHM,
          hash: HASH_ALGORITHM
        },
        true,
        ['decrypt']
      );

      return { publicKey, privateKey };
    } catch (error) {
      console.error('Failed to load key pair from server:', error);
      return null;
    }
  }

  /**
   * Clear cached keys (for logout)
   */
  static clearKeys(): void {
    this.keyPair = null;
    this.publicKeyCache.clear();
    localStorage.removeItem('privateKey');
    localStorage.removeItem('publicKey');
  }
}
