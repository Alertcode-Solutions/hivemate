/**
 * Client-side encryption utilities using Web Crypto API
 * Implements RSA-OAEP for end-to-end encrypted messaging
 */

import { BrowserCompatibility } from './browserCompatibility';
import { getApiBaseUrl } from './runtimeConfig';

const ENCRYPTION_ALGORITHM = 'RSA-OAEP';
const KEY_SIZE = 2048;
const HASH_ALGORITHM = 'SHA-256';

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export class EncryptionService {
  private static keyPair: KeyPair | null = null;
  private static publicKeyCache: Map<string, CryptoKey> = new Map();
  private static readonly BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;

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
      const binaryString = atob(publicKeyString);
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

  /**
   * Encrypt message with recipient's public key
   */
  static async encryptMessage(message: string, recipientPublicKey: CryptoKey): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);

      const encrypted = await window.crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGORITHM },
        recipientPublicKey,
        data
      );

      const encryptedArray = new Uint8Array(encrypted);
      const encryptedString = String.fromCharCode(...encryptedArray);
      return btoa(encryptedString);
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
      const binaryString = atob(encryptedMessage);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const decrypted = await window.crypto.subtle.decrypt(
        { name: ENCRYPTION_ALGORITHM },
        privateKey,
        bytes
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
        throw new Error('Failed to fetch public key');
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
        throw new Error('Failed to upload public key');
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
    const exportedAsString = String.fromCharCode(...new Uint8Array(exported));
    return btoa(exportedAsString);
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
