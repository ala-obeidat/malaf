const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const MAGIC = 'MALAFv1';
export const CHUNK_SIZE = 5 * 1024 * 1024;
export const MAX_PLAINTEXT_BYTES = 100_000_000;

const MAGIC_BYTES = encoder.encode(MAGIC);
const VERSION = 1;
const ALG_AES_256_GCM = 1;
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const NONCE_PREFIX_BYTES = 8;
const METADATA_NONCE_BYTES = 12;
const FIXED_HEADER_BYTES =
  MAGIC_BYTES.length + 1 + 1 + 4 + 8 + 4 + NONCE_PREFIX_BYTES + METADATA_NONCE_BYTES + 4;

const FILE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class MalafCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalafCryptoError';
  }
}

export type CryptoProgress = (processedBytes: number, totalBytes: number) => void;

export type MalafMetadata = {
  name: string;
  type: string;
};

export type DecryptedMalafFile = {
  blob: Blob;
  metadata: MalafMetadata;
};

export type ParsedMalafHeader = {
  version: number;
  algorithm: number;
  chunkSize: number;
  originalSize: number;
  chunkCount: number;
  noncePrefix: Uint8Array;
  metadataNonce: Uint8Array;
  metadataCipherLength: number;
  metadataOffset: number;
  chunksOffset: number;
};

export async function generateSecretKey(): Promise<Uint8Array> {
  return randomBytes(32);
}

export function generateFileID(): string {
  return crypto.randomUUID();
}

export function encodeSecretKey(keyBytes: Uint8Array): string {
  if (keyBytes.byteLength !== 32) {
    throw new MalafCryptoError('Secret keys must be 32 bytes.');
  }
  return bytesToBase64URL(keyBytes);
}

export function decodeSecretKey(encoded: string): Uint8Array {
  const key = base64URLToBytes(encoded.replace(/^#/, ''));
  if (key.byteLength !== 32) {
    throw new MalafCryptoError('The link key is malformed.');
  }
  return key;
}

export async function encryptFile(
  file: File,
  fileID: string,
  keyBytes: Uint8Array,
  onProgress?: CryptoProgress
): Promise<Blob> {
  assertFileID(fileID);
  if (file.size > MAX_PLAINTEXT_BYTES) {
    throw new MalafCryptoError('The selected file is larger than 100 MB.');
  }

  const key = await importAESKey(keyBytes, ['encrypt']);
  const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
  const noncePrefix = randomBytes(NONCE_PREFIX_BYTES);
  const metadataNonce = randomBytes(METADATA_NONCE_BYTES);
  const headerForAAD: ParsedMalafHeader = {
    version: VERSION,
    algorithm: ALG_AES_256_GCM,
    chunkSize: CHUNK_SIZE,
    originalSize: file.size,
    chunkCount,
    noncePrefix,
    metadataNonce,
    metadataCipherLength: 0,
    metadataOffset: FIXED_HEADER_BYTES,
    chunksOffset: FIXED_HEADER_BYTES
  };

  const metadataPlaintext = encoder.encode(
    JSON.stringify({
      name: file.name || 'download',
      type: file.type || 'application/octet-stream'
    } satisfies MalafMetadata)
  );
  const metadataCiphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: asBufferSource(metadataNonce),
        additionalData: asBufferSource(manifestAAD(fileID, headerForAAD)),
        tagLength: 128
      },
      key,
      asBufferSource(metadataPlaintext)
    )
  );

  const header = writeHeader({
    ...headerForAAD,
    metadataCipherLength: metadataCiphertext.byteLength,
    chunksOffset: FIXED_HEADER_BYTES + metadataCiphertext.byteLength
  });
  const parts: BlobPart[] = [asBlobPart(header), asBlobPart(metadataCiphertext)];

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const plaintext = new Uint8Array(await file.slice(start, end).arrayBuffer());
    const nonce = chunkNonce(noncePrefix, index);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: asBufferSource(nonce),
          additionalData: asBufferSource(chunkAAD(fileID, headerForAAD, index)),
          tagLength: 128
        },
        key,
        asBufferSource(plaintext)
      )
    );
    parts.push(asBlobPart(nonce), asBlobPart(ciphertext));
    onProgress?.(end, file.size);
  }

  if (chunkCount === 0) {
    onProgress?.(0, 0);
  }

  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function decryptPayload(
  payload: ArrayBuffer | Uint8Array,
  fileID: string,
  keyBytes: Uint8Array,
  onProgress?: CryptoProgress
): Promise<DecryptedMalafFile> {
  assertFileID(fileID);
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const header = parseMalafHeader(bytes);
  const key = await importAESKey(keyBytes, ['decrypt']);

  const metadataCiphertext = bytes.slice(
    header.metadataOffset,
    header.metadataOffset + header.metadataCipherLength
  );
  let metadata: MalafMetadata;
  try {
    const metadataPlaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: asBufferSource(header.metadataNonce),
        additionalData: asBufferSource(manifestAAD(fileID, header)),
        tagLength: 128
      },
      key,
      asBufferSource(metadataCiphertext)
    );
    metadata = JSON.parse(decoder.decode(metadataPlaintext)) as MalafMetadata;
  } catch (error) {
    throw new MalafCryptoError('The link key, file id, or manifest authentication failed.');
  }

  const chunks: Uint8Array[] = [];
  let offset = header.chunksOffset;
  for (let index = 0; index < header.chunkCount; index += 1) {
    const plaintextLength = chunkPlaintextLength(header, index);
    const ciphertextLength = plaintextLength + TAG_BYTES;
    const segmentLength = NONCE_BYTES + ciphertextLength;
    if (offset + segmentLength > bytes.byteLength) {
      throw new MalafCryptoError('The encrypted payload is truncated.');
    }

    const nonce = bytes.slice(offset, offset + NONCE_BYTES);
    const expectedNonce = chunkNonce(header.noncePrefix, index);
    if (!equalBytes(nonce, expectedNonce)) {
      throw new MalafCryptoError('The encrypted chunks are out of order.');
    }
    offset += NONCE_BYTES;

    const ciphertext = bytes.slice(offset, offset + ciphertextLength);
    offset += ciphertextLength;
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: asBufferSource(nonce),
          additionalData: asBufferSource(chunkAAD(fileID, header, index)),
          tagLength: 128
        },
        key,
        asBufferSource(ciphertext)
      );
      chunks.push(new Uint8Array(plaintext));
    } catch (error) {
      throw new MalafCryptoError('The encrypted file failed authentication.');
    }
    onProgress?.(
      Math.min(header.originalSize, (index + 1) * header.chunkSize),
      header.originalSize
    );
  }

  if (offset !== bytes.byteLength) {
    throw new MalafCryptoError('The encrypted payload has trailing data.');
  }
  if (header.chunkCount === 0) {
    onProgress?.(0, 0);
  }

  return {
    blob: new Blob(chunks.map(asBlobPart), { type: metadata.type || 'application/octet-stream' }),
    metadata: {
      name: metadata.name || 'download',
      type: metadata.type || 'application/octet-stream'
    }
  };
}

export function parseMalafHeader(payload: Uint8Array): ParsedMalafHeader {
  if (payload.byteLength < FIXED_HEADER_BYTES) {
    throw new MalafCryptoError('The encrypted payload is missing its header.');
  }

  let offset = 0;
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    if (payload[i] !== MAGIC_BYTES[i]) {
      throw new MalafCryptoError('The encrypted payload is not MALAFv1.');
    }
  }
  offset += MAGIC_BYTES.length;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = view.getUint8(offset);
  offset += 1;
  const algorithm = view.getUint8(offset);
  offset += 1;
  const chunkSize = view.getUint32(offset, false);
  offset += 4;
  const originalSize = Number(view.getBigUint64(offset, false));
  offset += 8;
  const chunkCount = view.getUint32(offset, false);
  offset += 4;
  const noncePrefix = payload.slice(offset, offset + NONCE_PREFIX_BYTES);
  offset += NONCE_PREFIX_BYTES;
  const metadataNonce = payload.slice(offset, offset + METADATA_NONCE_BYTES);
  offset += METADATA_NONCE_BYTES;
  const metadataCipherLength = view.getUint32(offset, false);
  offset += 4;

  if (version !== VERSION || algorithm !== ALG_AES_256_GCM || chunkSize !== CHUNK_SIZE) {
    throw new MalafCryptoError('Unsupported MALAFv1 header.');
  }
  if (!Number.isSafeInteger(originalSize) || originalSize < 0) {
    throw new MalafCryptoError('The original file size is invalid.');
  }
  const expectedChunkCount = Math.ceil(originalSize / chunkSize);
  if (chunkCount !== expectedChunkCount) {
    throw new MalafCryptoError('The chunk count does not match the file size.');
  }
  if (offset + metadataCipherLength > payload.byteLength) {
    throw new MalafCryptoError('The encrypted metadata is truncated.');
  }

  return {
    version,
    algorithm,
    chunkSize,
    originalSize,
    chunkCount,
    noncePrefix,
    metadataNonce,
    metadataCipherLength,
    metadataOffset: offset,
    chunksOffset: offset + metadataCipherLength
  };
}

export function chunkRangesForTesting(payload: Uint8Array): Array<{ start: number; end: number }> {
  const header = parseMalafHeader(payload);
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = header.chunksOffset;
  for (let index = 0; index < header.chunkCount; index += 1) {
    const length = NONCE_BYTES + chunkPlaintextLength(header, index) + TAG_BYTES;
    ranges.push({ start: offset, end: offset + length });
    offset += length;
  }
  return ranges;
}

function writeHeader(header: ParsedMalafHeader): Uint8Array {
  const bytes = new Uint8Array(FIXED_HEADER_BYTES);
  bytes.set(MAGIC_BYTES, 0);
  const view = new DataView(bytes.buffer);
  let offset = MAGIC_BYTES.length;
  view.setUint8(offset, header.version);
  offset += 1;
  view.setUint8(offset, header.algorithm);
  offset += 1;
  view.setUint32(offset, header.chunkSize, false);
  offset += 4;
  view.setBigUint64(offset, BigInt(header.originalSize), false);
  offset += 8;
  view.setUint32(offset, header.chunkCount, false);
  offset += 4;
  bytes.set(header.noncePrefix, offset);
  offset += NONCE_PREFIX_BYTES;
  bytes.set(header.metadataNonce, offset);
  offset += METADATA_NONCE_BYTES;
  view.setUint32(offset, header.metadataCipherLength, false);
  return bytes;
}

function manifestAAD(fileID: string, header: ParsedMalafHeader): Uint8Array {
  const fileIDBytes = encoder.encode(fileID);
  const length = MAGIC_BYTES.length + 1 + 1 + 4 + 8 + 4 + NONCE_PREFIX_BYTES + 2 + fileIDBytes.length;
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  bytes.set(MAGIC_BYTES, offset);
  offset += MAGIC_BYTES.length;
  view.setUint8(offset, header.version);
  offset += 1;
  view.setUint8(offset, header.algorithm);
  offset += 1;
  view.setUint32(offset, header.chunkSize, false);
  offset += 4;
  view.setBigUint64(offset, BigInt(header.originalSize), false);
  offset += 8;
  view.setUint32(offset, header.chunkCount, false);
  offset += 4;
  bytes.set(header.noncePrefix, offset);
  offset += NONCE_PREFIX_BYTES;
  view.setUint16(offset, fileIDBytes.length, false);
  offset += 2;
  bytes.set(fileIDBytes, offset);
  return bytes;
}

function chunkAAD(fileID: string, header: ParsedMalafHeader, chunkIndex: number): Uint8Array {
  const fileIDBytes = encoder.encode(fileID);
  const bytes = new Uint8Array(
    MAGIC_BYTES.length + 1 + 1 + 4 + 8 + 4 + NONCE_PREFIX_BYTES + 4 + 2 + fileIDBytes.length
  );
  const view = new DataView(bytes.buffer);
  let offset = 0;
  bytes.set(MAGIC_BYTES, offset);
  offset += MAGIC_BYTES.length;
  view.setUint8(offset, header.version);
  offset += 1;
  view.setUint8(offset, header.algorithm);
  offset += 1;
  view.setUint32(offset, header.chunkSize, false);
  offset += 4;
  view.setBigUint64(offset, BigInt(header.originalSize), false);
  offset += 8;
  view.setUint32(offset, header.chunkCount, false);
  offset += 4;
  bytes.set(header.noncePrefix, offset);
  offset += NONCE_PREFIX_BYTES;
  view.setUint32(offset, chunkIndex, false);
  offset += 4;
  view.setUint16(offset, fileIDBytes.length, false);
  offset += 2;
  bytes.set(fileIDBytes, offset);
  return bytes;
}

function chunkNonce(prefix: Uint8Array, index: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(prefix, 0);
  new DataView(nonce.buffer).setUint32(NONCE_PREFIX_BYTES, index, false);
  return nonce;
}

function chunkPlaintextLength(header: ParsedMalafHeader, index: number): number {
  const start = index * header.chunkSize;
  return Math.min(header.chunkSize, header.originalSize - start);
}

async function importAESKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (keyBytes.byteLength !== 32) {
    throw new MalafCryptoError('Secret keys must be 32 bytes.');
  }
  return crypto.subtle.importKey('raw', asBufferSource(keyBytes), { name: 'AES-GCM', length: 256 }, false, usages);
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as Uint8Array<ArrayBuffer>;
}

function asBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as Uint8Array<ArrayBuffer>;
}

function assertFileID(fileID: string): void {
  if (!FILE_ID_PATTERN.test(fileID)) {
    throw new MalafCryptoError('The file id is malformed.');
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.byteLength; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

function bytesToBase64URL(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64URLToBytes(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
