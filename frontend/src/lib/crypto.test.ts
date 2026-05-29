import { describe, expect, it } from 'vitest';
import {
  MalafCryptoError,
  chunkRangesForTesting,
  decryptPayload,
  encryptFile,
  generateSecretKey
} from './crypto';

const fileID = '22222222-2222-4222-8222-222222222222';

describe('MALAFv1 crypto', () => {
  it('encrypts and decrypts a roundtrip', async () => {
    const key = await generateSecretKey();
    const file = new File(['hello from malaf'], 'note.txt', { type: 'text/plain' });

    const encrypted = await encryptFile(file, fileID, key);
    const decrypted = await decryptPayload(await encrypted.arrayBuffer(), fileID, key);

    await expect(decrypted.blob.text()).resolves.toBe('hello from malaf');
    expect(decrypted.metadata).toEqual({ name: 'note.txt', type: 'text/plain' });
  });

  it('rejects tampered ciphertext', async () => {
    const key = await generateSecretKey();
    const file = new File(['authenticated'], 'auth.txt', { type: 'text/plain' });
    const encrypted = new Uint8Array(await (await encryptFile(file, fileID, key)).arrayBuffer());

    encrypted[encrypted.byteLength - 1] ^= 0x01;

    await expect(decryptPayload(encrypted, fileID, key)).rejects.toThrow(MalafCryptoError);
  });

  it('rejects the wrong key', async () => {
    const correctKey = await generateSecretKey();
    const wrongKey = await generateSecretKey();
    const file = new File(['keyed'], 'keyed.txt', { type: 'text/plain' });
    const encrypted = await encryptFile(file, fileID, correctKey);

    await expect(decryptPayload(await encrypted.arrayBuffer(), fileID, wrongKey)).rejects.toThrow(
      MalafCryptoError
    );
  });

  it('rejects chunk reordering and truncation', async () => {
    const key = await generateSecretKey();
    const body = new Uint8Array(11 * 1024 * 1024);
    for (let i = 0; i < body.byteLength; i += 1) {
      body[i] = i % 251;
    }
    const file = new File([body], 'large.bin', { type: 'application/octet-stream' });
    const encrypted = new Uint8Array(await (await encryptFile(file, fileID, key)).arrayBuffer());
    const ranges = chunkRangesForTesting(encrypted);
    expect(ranges.length).toBeGreaterThanOrEqual(3);

    const reordered = encrypted.slice();
    const first = encrypted.slice(ranges[0].start, ranges[0].end);
    const second = encrypted.slice(ranges[1].start, ranges[1].end);
    reordered.set(second, ranges[0].start);
    reordered.set(first, ranges[1].start);

    await expect(decryptPayload(reordered, fileID, key)).rejects.toThrow(MalafCryptoError);
    await expect(decryptPayload(encrypted.slice(0, encrypted.byteLength - 1), fileID, key)).rejects.toThrow(
      MalafCryptoError
    );
  });

  it('keeps metadata encrypted', async () => {
    const key = await generateSecretKey();
    const file = new File(['private'], 'private-filename.txt', { type: 'text/secret-malaf' });
    const encrypted = new Uint8Array(await (await encryptFile(file, fileID, key)).arrayBuffer());
    const decoded = new TextDecoder().decode(encrypted);

    expect(decoded).toContain('MALAFv1');
    expect(decoded).not.toContain('private-filename.txt');
    expect(decoded).not.toContain('text/secret-malaf');
  });
});
