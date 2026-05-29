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
      message = 'This link is missing its decryption key.';
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
        message = 'Unable to check this file.';
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
      message = `${sanitizeFilename(decrypted.metadata.name)} decrypted.`;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
        stage = 'gone';
        message = 'This file is expired or already used.';
      } else if (error instanceof MalafCryptoError) {
        stage = 'error';
        message = 'The key is wrong or the encrypted file was tampered with.';
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
    <p class="eyebrow">Receive</p>
    <h1>Download the encrypted file once.</h1>
    <p class="lede">The server will delete the stored ciphertext as soon as this download is claimed.</p>
  </section>

  <section class="workspace">
    <div class="tool">
      <div class="tool-header">
        <div>
          <h2>File</h2>
          <p class="muted">{fileID}</p>
        </div>
        {#if stage === 'checking' || stage === 'downloading' || stage === 'decrypting'}
          <Loader2 size={22} />
        {:else if stage === 'done'}
          <CheckCircle2 size={22} />
        {:else if stage === 'gone' || stage === 'error'}
          <ShieldAlert size={22} />
        {:else}
          <FileKey2 size={22} />
        {/if}
      </div>

      <div class="tool-body download-stage">
        {#if stage === 'checking'}
          <p class="muted">Checking availability.</p>
        {:else if stage === 'ready'}
          <div class="status-row">
            <div>
              <p class="file-name">Encrypted payload</p>
              <p class="file-meta">{formatBytes(encryptedSize)}</p>
            </div>
            <button class="button" type="button" on:click={downloadAndDecrypt}>
              <Download size={18} />
              <span>Download</span>
            </button>
          </div>
        {:else if stage === 'downloading' || stage === 'decrypting'}
          <div class="progress" aria-live="polite">
            <div class="progress-label">
              <span>{progressTitle}</span>
              <span>{progressValue}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style={`--value: ${progressValue}%`}></div>
            </div>
          </div>
        {:else if stage === 'done'}
          <div class="notice ok">
            <CheckCircle2 size={18} /> {message}
          </div>
        {:else if stage === 'gone'}
          <div class="notice error" role="alert">
            <AlertTriangle size={18} /> {message}
          </div>
        {:else if stage === 'error'}
          <div class="notice error" role="alert">
            <AlertTriangle size={18} /> {message}
          </div>
        {/if}
      </div>
    </div>

    <aside class="side-panel">
      <p class="notice">Anyone with the full URL has the decryption key. Share it through a channel you trust.</p>
      <p class="notice">If decryption fails, the first download attempt may already have consumed the file.</p>
    </aside>
  </section>
</main>
