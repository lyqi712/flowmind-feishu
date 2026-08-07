import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class EncryptedSecretStore {
  constructor({ secretFile, keyFile, envKey = '' }) {
    this.secretFile = secretFile;
    this.keyFile = keyFile;
    this.envKey = envKey || '';
    this.key = null;
    this.ready = this.initialize();
  }

  async initialize() {
    await mkdir(dirname(this.secretFile), { recursive: true });
    try { this.key = await readFile(this.keyFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.key = randomBytes(32);
      await writeFile(this.keyFile, this.key, { mode: 0o600 });
    }
    if (this.key.length !== 32) throw Object.assign(new Error('模型密钥主密钥格式错误'), { code: 'MODEL_SECRET_KEY_INVALID' });
  }

  async get() {
    await this.ready;
    if (this.envKey) return this.envKey;
    try {
      const raw = await readFile(this.secretFile, 'utf8');
      if (!raw.trim()) return '';
      const record = JSON.parse(raw);
      if (record.version !== 1 || !record.iv || !record.tag || !record.data) throw new Error('invalid secret record');
      const iv = Buffer.from(record.iv, 'base64');
      const tag = Buffer.from(record.tag, 'base64');
      const encrypted = Buffer.from(record.data, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw Object.assign(new Error('模型密钥解密失败'), { code: 'MODEL_SECRET_DECRYPT_FAILED' });
    }
  }

  async set(value) {
    await this.ready;
    const plaintext = String(value || '').trim();
    if (!plaintext) return this.clear();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const record = { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
    await writeFile(this.secretFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    this.envKey = '';
  }

  async clear() {
    await this.ready;
    this.envKey = '';
    await writeFile(this.secretFile, '', { mode: 0o600 });
  }

  async has() { return Boolean(await this.get()); }
}