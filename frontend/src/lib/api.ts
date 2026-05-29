export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type TransferProgress = (loaded: number, total: number) => void;

export async function statFile(fileID: string): Promise<{ exists: boolean; size: number }> {
  const response = await fetch(`/api/stat/${encodeURIComponent(fileID)}`, {
    cache: 'no-store',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) {
    throw new ApiError(response.status, response.status === 404 ? 'not found' : 'stat failed');
  }
  return (await response.json()) as { exists: boolean; size: number };
}

export function uploadEncrypted(
  fileID: string,
  encrypted: Blob,
  onProgress?: TransferProgress
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?fileId=${encodeURIComponent(fileID)}`, true);
    xhr.responseType = 'text';
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ApiError(xhr.status, xhr.status === 413 ? 'upload too large' : 'upload failed'));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network error'));
    xhr.onabort = () => reject(new ApiError(0, 'upload aborted'));
    xhr.send(encrypted);
  });
}

export async function downloadEncrypted(
  fileID: string,
  onProgress?: TransferProgress
): Promise<Uint8Array> {
  const response = await fetch(`/api/download/${encodeURIComponent(fileID)}`, {
    cache: 'no-store',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) {
    throw new ApiError(response.status, response.status === 410 || response.status === 404 ? 'gone' : 'download failed');
  }

  const total = Number(response.headers.get('content-length') || '0');
  if (!response.body) {
    const fallback = new Uint8Array(await response.arrayBuffer());
    onProgress?.(fallback.byteLength, fallback.byteLength);
    return fallback;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total || loaded);
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
