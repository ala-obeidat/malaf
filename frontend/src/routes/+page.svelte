<script lang="ts">
  import {
    CheckCircle2,
    Clipboard,
    Clock3,
    FileUp,
    Link2,
    RefreshCw,
    Share2,
    ShieldCheck,
    Upload
  } from '@lucide/svelte';
  import { ApiError, uploadEncrypted } from '$lib/api';
  import {
    MAX_PLAINTEXT_BYTES,
    encodeSecretKey,
    encryptFile,
    generateFileID,
    generateSecretKey
  } from '$lib/crypto';
  import { formatBytes, percent } from '$lib/format';

  type Stage = 'idle' | 'encrypting' | 'uploading' | 'ready' | 'error';

  let fileInput: HTMLInputElement;
  let selectedFile: File | null = null;
  let dragging = false;
  let stage: Stage = 'idle';
  let progressValue = 0;
  let progressTitle = '';
  let progressDetail = '';
  let shareURL = '';
  let errorMessage = '';
  let copied = false;

  $: busy = stage === 'encrypting' || stage === 'uploading';
  $: canShare = typeof navigator !== 'undefined' && 'share' in navigator && shareURL.length > 0;

  function openPicker() {
    fileInput.click();
  }

  function useFile(file: File | undefined) {
    if (!file || busy) {
      return;
    }
    selectedFile = file;
    stage = 'idle';
    shareURL = '';
    copied = false;
    errorMessage = '';
    progressValue = 0;
  }

  function handleInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    useFile(input.files?.[0]);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    useFile(event.dataTransfer?.files?.[0]);
  }

  async function startUpload() {
    if (!selectedFile || busy) {
      return;
    }
    if (selectedFile.size > MAX_PLAINTEXT_BYTES) {
      stage = 'error';
      errorMessage = `Select a file up to ${formatBytes(MAX_PLAINTEXT_BYTES)}.`;
      return;
    }

    try {
      const fileID = generateFileID();
      const key = await generateSecretKey();
      const keyText = encodeSecretKey(key);

      stage = 'encrypting';
      progressTitle = 'Encrypting';
      progressDetail = selectedFile.name;
      progressValue = 0;
      const encrypted = await encryptFile(selectedFile, fileID, key, (loaded, total) => {
        progressValue = percent(loaded, total || 1);
      });

      stage = 'uploading';
      progressTitle = 'Uploading';
      progressDetail = formatBytes(encrypted.size);
      progressValue = 0;
      await uploadEncrypted(fileID, encrypted, (loaded, total) => {
        progressValue = percent(loaded, total);
      });

      shareURL = `${window.location.origin}/d/${fileID}#${keyText}`;
      stage = 'ready';
      progressValue = 100;
    } catch (error) {
      stage = 'error';
      if (error instanceof ApiError && error.status === 429) {
        errorMessage = 'Upload rate limit reached. Try again later.';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = 'Upload failed.';
      }
    }
  }

  async function copyLink() {
    if (!shareURL) {
      return;
    }
    await navigator.clipboard.writeText(shareURL);
    copied = true;
    window.setTimeout(() => {
      copied = false;
    }, 1800);
  }

  async function shareLink() {
    if (!canShare || !shareURL) {
      return;
    }
    await navigator.share({
      title: 'Malaf file',
      url: shareURL
    });
  }

  function reset() {
    selectedFile = null;
    stage = 'idle';
    progressValue = 0;
    shareURL = '';
    errorMessage = '';
    copied = false;
    if (fileInput) {
      fileInput.value = '';
    }
  }
</script>

<svelte:head>
  <title>Malaf</title>
  <meta
    name="description"
    content="Anonymous, private, one-time encrypted file sharing through a self-hosted PWA."
  />
</svelte:head>

<main class="page">
  <section>
    <p class="eyebrow">One-time encrypted file sharing</p>
    <h1>Send a file without accounts, storage history, or plaintext metadata.</h1>
    <p class="lede">
      Files are encrypted in this browser, uploaded as MALAFv1 ciphertext, and removed after the first
      download attempt or expiry.
    </p>
  </section>

  <section class="workspace">
    <div class="tool">
      <div class="tool-header">
        <div>
          <h2>Upload</h2>
          <p class="muted">Plaintext limit: {formatBytes(MAX_PLAINTEXT_BYTES)}</p>
        </div>
        <button class="icon-button" type="button" title="Reset" aria-label="Reset" on:click={reset}>
          <RefreshCw size={19} />
        </button>
      </div>

      <div class="tool-body">
        <button
          class:dragging
          class="dropzone"
          type="button"
          on:click={openPicker}
          on:dragenter|preventDefault={() => (dragging = true)}
          on:dragover|preventDefault={() => (dragging = true)}
          on:dragleave={() => (dragging = false)}
          on:drop={handleDrop}
          disabled={busy}
        >
          <input bind:this={fileInput} type="file" on:change={handleInput} />
          <span class="dropzone-content">
            <FileUp size={36} strokeWidth={1.8} />
            <span class="dropzone-title">
              {selectedFile ? selectedFile.name : 'Choose file'}
            </span>
            <span class="dropzone-subtitle">
              {selectedFile ? formatBytes(selectedFile.size) : 'Drop one file here'}
            </span>
          </span>
        </button>

        {#if selectedFile}
          <div class="file-row">
            <div>
              <p class="file-name">{selectedFile.name}</p>
              <p class="file-meta">{formatBytes(selectedFile.size)} · {selectedFile.type || 'unknown type'}</p>
            </div>
            <button class="button" type="button" on:click={startUpload} disabled={busy || stage === 'ready'}>
              <Upload size={18} />
              <span>Encrypt and upload</span>
            </button>
          </div>
        {/if}

        {#if stage === 'encrypting' || stage === 'uploading'}
          <div class="progress" aria-live="polite">
            <div class="progress-label">
              <span>{progressTitle}</span>
              <span>{progressValue}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style={`--value: ${progressValue}%`}></div>
            </div>
            <p class="muted">{progressDetail}</p>
          </div>
        {/if}

        {#if stage === 'ready'}
          <div class="notice ok">
            <CheckCircle2 size={18} /> Link ready. Keep the full URL together.
          </div>
          <div class="share-row">
            <input class="share-input" readonly value={shareURL} aria-label="Share link" />
            <div class="actions">
              <button class="icon-button" type="button" title="Copy link" aria-label="Copy link" on:click={copyLink}>
                <Clipboard size={18} />
              </button>
              {#if canShare}
                <button class="icon-button" type="button" title="Share link" aria-label="Share link" on:click={shareLink}>
                  <Share2 size={18} />
                </button>
              {/if}
            </div>
          </div>
          {#if copied}
            <p class="muted">Copied.</p>
          {/if}
        {/if}

        {#if stage === 'error'}
          <div class="notice error" role="alert">{errorMessage}</div>
        {/if}
      </div>
    </div>

    <aside class="side-panel">
      <div class="tool">
        <div class="tool-body fact-list">
          <div class="fact">
            <ShieldCheck size={18} />
            <span>AES-256-GCM runs locally with a key that stays in the fragment.</span>
          </div>
          <div class="fact">
            <Clock3 size={18} />
            <span>Unclaimed files expire after 30 minutes.</span>
          </div>
          <div class="fact">
            <Link2 size={18} />
            <span>Anyone with the full link can decrypt the file.</span>
          </div>
        </div>
      </div>
      <p class="notice">
        Web cryptography depends on receiving uncompromised JavaScript from this server.
      </p>
    </aside>
  </section>
</main>
