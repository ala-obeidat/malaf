<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { AlertTriangle, CheckCircle2, Download, FileKey2, Loader2, ShieldAlert } from '@lucide/svelte';
  import { ApiError, downloadEncrypted, statFile } from '$lib/api';
  import { MalafCryptoError, decodeSecretKey, decryptPayload } from '$lib/crypto';
  import { formatBytes, percent, sanitizeFilename } from '$lib/format';

  type Stage = 'checking' | 'ready' | 'downloading' | 'decrypting' | 'done' | 'gone' | 'error';

  $: fileID = $page.params.fileId ?? '';

  let stage: Stage = 'checking';
  let encryptedSize = 0;
  let progressValue = 0;
  let progressTitle = '';
  let message = '';
  let secret = '';

  onMount(async () => {
    secret = window.location.hash.slice(1);
    if (!secret) {
      stage = 'error';
      message = 'This link is missing its decryption key in the hash fragment.';
      return;
    }

    try {
      const stat = await statFile(fileID);
      encryptedSize = stat.size;
      stage = 'ready';
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
        stage = 'gone';
        message = 'This file is expired or already used.';
      } else {
        stage = 'error';
        message = 'Unable to check this file status.';
      }
    }
  });

  async function downloadAndDecrypt() {
    if (stage !== 'ready') {
      return;
    }

    try {
      const key = decodeSecretKey(secret);
      stage = 'downloading';
      progressTitle = 'Downloading';
      progressValue = 0;
      const encrypted = await downloadEncrypted(fileID, (loaded, total) => {
        progressValue = percent(loaded, total || encryptedSize || 1);
      });

      stage = 'decrypting';
      progressTitle = 'Decrypting';
      progressValue = 0;
      const decrypted = await decryptPayload(encrypted, fileID, key, (loaded, total) => {
        progressValue = percent(loaded, total || 1);
      });

      const url = URL.createObjectURL(decrypted.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = sanitizeFilename(decrypted.metadata.name);
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      stage = 'done';
      message = `${sanitizeFilename(decrypted.metadata.name)} decrypted successfully.`;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
        stage = 'gone';
        message = 'This file is expired or already used.';
      } else if (error instanceof MalafCryptoError) {
        stage = 'error';
        message = 'The key is incorrect or the encrypted payload was tampered with.';
      } else {
        stage = 'error';
        message = 'Download failed.';
      }
    }
  }
</script>

<svelte:head>
  <title>Download · Malaf</title>
</svelte:head>

<main class="page">
  <section>
    <p class="eyebrow">Secure Handoff</p>
    <h1>Download your encrypted file.</h1>
    <p class="lede">The server will immediately purge the stored ciphertext as soon as this download is claimed.</p>
  </section>

  <section class="workspace">
    <div class="tool">
      <div class="tool-header">
        <div>
          <h2>File Package</h2>
          <p class="muted" style="font-family: monospace; font-size: 0.85rem;">{fileID}</p>
        </div>
        {#if stage === 'checking' || stage === 'downloading' || stage === 'decrypting'}
          <Loader2 size={22} style="animation: spin 1s linear infinite; color: var(--accent);" />
        {:else if stage === 'done'}
          <CheckCircle2 size={22} style="color: var(--ok)" />
        {:else if stage === 'gone' || stage === 'error'}
          <ShieldAlert size={22} style="color: var(--danger)" />
        {:else}
          <FileKey2 size={22} style="color: var(--accent)" />
        {/if}
      </div>

      <div class="tool-body download-stage">
        {#if stage === 'checking'}
          <div style="display: flex; align-items: center; gap: 12px; color: var(--muted);">
            <Loader2 size={18} style="animation: spin 1s linear infinite;" />
            <span>Validating encrypted handoff package...</span>
          </div>
        {:else if stage === 'ready'}
          <div class="status-row">
            <div>
              <p class="file-name">Encrypted Payload</p>
              <p class="file-meta">{formatBytes(encryptedSize)} · Opaque Ciphertext</p>
            </div>
            <button class="button" type="button" on:click={downloadAndDecrypt}>
              <Download size={18} />
              <span>Decrypt & Download</span>
            </button>
          </div>
        {:else if stage === 'downloading' || stage === 'decrypting'}
          <div class="progress" aria-live="polite">
            <div class="progress-label">
              <span>{progressTitle}...</span>
              <span>{progressValue}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style={`--value: ${progressValue}%`}></div>
            </div>
          </div>
        {:else if stage === 'done'}
          <div class="notice ok">
            <CheckCircle2 size={20} style="margin-top: 2px;" />
            <div>
              <strong>Decryption Complete</strong>
              <p style="margin: 4px 0 0 0; font-size: 0.9rem;">{message}</p>
            </div>
          </div>
        {:else if stage === 'gone'}
          <div class="notice error" role="alert">
            <AlertTriangle size={24} style="margin-top: 4px;" />
            <div>
              <strong style="font-size: 1.05rem;">Link Expired or Already Claimed</strong>
              <p style="margin: 6px 0 0 0; font-size: 0.9rem; line-height: 1.5;">
                For ultimate privacy, Malaf enforces a strict one-time claim policy. As soon as a file download is initiated, the encrypted payload is permanently deleted from the server.
              </p>
              <p style="margin: 8px 0 0 0; font-size: 0.85rem; opacity: 0.8;">
                If you haven't downloaded this, the link may have expired (30-minute limit) or been accessed already.
              </p>
            </div>
          </div>
        {:else if stage === 'error'}
          <div class="notice error" role="alert">
            <AlertTriangle size={20} style="margin-top: 2px;" />
            <div>
              <strong>Handoff Error</strong>
              <p style="margin: 4px 0 0 0; font-size: 0.9rem;">{message}</p>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <aside class="side-panel">
      <div class="tool">
        <div class="tool-body fact-list">
          <div class="fact">
            <ShieldAlert size={18} />
            <span>Decryption keys stay in the URL fragment (`#`) and are never sent to the server. Verification happens locally.</span>
          </div>
        </div>
      </div>
      <p class="notice">
        Note: If decryption fails, the first download attempt may already have consumed and purged the file from storage.
      </p>
    </aside>
  </section>
</main>

<style>
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
