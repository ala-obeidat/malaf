<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import '../app.css';
  import { ShieldCheck } from '@lucide/svelte';

  let { children } = $props();

  onMount(() => {
    if (browser && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  });
</script>

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Malaf">
      <span class="brand-mark"><ShieldCheck size={20} strokeWidth={2.2} /></span>
      <span>Malaf</span>
    </a>
    <span class="topbar-note">Private one-time file handoff</span>
  </header>

  {@render children()}
</div>
