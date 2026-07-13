import { logger } from '../shared/logger';

const SEED_KEY = 'secure:seed';
const STORAGE_PREFIX = 'secure:';
const PBKDF2_ITERATIONS = 100000;

interface EncryptedPayload {
  iv: number[];
  data: number[];
  salt: number[];
}

export class SecureStorage {
  private static seedPromise: Promise<ArrayBuffer> | null = null;

  private static async initSeed(): Promise<ArrayBuffer> {
    const result = await chrome.storage.local.get(SEED_KEY);
    const stored = result[SEED_KEY] as number[] | undefined;
    if (stored) {
      const buf = new Uint8Array(stored.length);
      buf.set(stored);
      return buf.buffer as ArrayBuffer;
    }
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    await chrome.storage.local.set({ [SEED_KEY]: Array.from(seed) });
    return seed.buffer as ArrayBuffer;
  }

  private static getSeed(): Promise<ArrayBuffer> {
    if (!this.seedPromise) {
      this.seedPromise = this.initSeed();
    }
    return this.seedPromise;
  }

  private static _cachedKey: { seed: ArrayBuffer; aesKey: CryptoKey } | null = null;

  private static async deriveKey(seed: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
    if (this._cachedKey && this._cachedKey.seed === seed) return this._cachedKey.aesKey;
    const keyMaterial = await crypto.subtle.importKey('raw', seed, 'PBKDF2', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    this._cachedKey = { seed, aesKey };
    return aesKey;
  }

  static async encrypt(key: string, data: string, storageArea?: chrome.storage.StorageArea): Promise<void> {
    const traceId = crypto.randomUUID();
    logger.debug('SEC', traceId, '加密数据: ' + key);

    const seed = await this.getSeed();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const aesKey = await this.deriveKey(seed, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      new TextEncoder().encode(data),
    );

    const payload: EncryptedPayload = {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
      salt: Array.from(salt),
    };

    const area = storageArea ?? chrome.storage.sync; // [BUG-FIX] WG1-2 - 支持传入 storageArea，默认 sync 保持向后兼容
    try {
      await area.set({ [STORAGE_PREFIX + key]: payload });
    } catch (err) {
      logger.error('SEC', traceId, '持久化加密数据失败: ' + err);
      throw err;
    }
  }

  static async decrypt(key: string, storageArea?: chrome.storage.StorageArea): Promise<string | null> {
    const traceId = crypto.randomUUID();
    logger.debug('SEC', traceId, '解密数据: ' + key);

    const area = storageArea ?? chrome.storage.sync; // [BUG-FIX] WG1-2 - 支持传入 storageArea，默认 sync 保持向后兼容
    const result = await area.get(STORAGE_PREFIX + key);
    const payload = result[STORAGE_PREFIX + key] as EncryptedPayload | undefined;
    if (!payload) return null;

    const seed = await this.getSeed();
    try {
      const aesKey = await this.deriveKey(seed, new Uint8Array(payload.salt));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
        aesKey,
        new Uint8Array(payload.data),
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return null;
    }
  }

  static async hasKey(key: string): Promise<boolean> {
    const result = await chrome.storage.sync.get(STORAGE_PREFIX + key);
    return STORAGE_PREFIX + key in result;
  }
}

export const encrypt = SecureStorage.encrypt.bind(SecureStorage);
export const decrypt = SecureStorage.decrypt.bind(SecureStorage);
