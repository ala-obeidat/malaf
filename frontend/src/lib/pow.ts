export type ProofOfWorkResult = {
  nonce: string;
  digest: string;
  attempts: number;
};

export async function solveHashcash(prefix: string, difficultyBits: number): Promise<ProofOfWorkResult> {
  const targetHexPrefix = '0'.repeat(Math.floor(difficultyBits / 4));
  let attempts = 0;
  while (true) {
    attempts += 1;
    const nonce = crypto.randomUUID();
    const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${prefix}:${nonce}`)));
    const digest = [...digestBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (digest.startsWith(targetHexPrefix) && leadingZeroBits(digestBytes) >= difficultyBits) {
      return { nonce, digest, attempts };
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    for (let mask = 0x80; mask > 0; mask >>= 1) {
      if ((byte & mask) === 0) {
        bits += 1;
      } else {
        return bits;
      }
    }
  }
  return bits;
}
