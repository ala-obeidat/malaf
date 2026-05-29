<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import '../app.css';
  import { ShieldCheck, Sun, Moon } from '@lucide/svelte';

  let { children } = $props();
  let isDark = $state(false);

  onMount(() => {
    if (browser) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
      }
      isDark = document.documentElement.classList.contains('dark');
    }
  });

  function toggleTheme() {
    if (!browser) return;
    isDark = !isDark;
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#06b6d4');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0284c7');
    }
  }
</script>

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Malaf">
      <span class="brand-mark"><ShieldCheck size={24} strokeWidth={2.5} /></span>
      <span>Malaf</span>
    </a>
    <div class="topbar-right">
      <span class="topbar-note">Private one-time handoff</span>
      <button 
        class="theme-switch" 
        type="button" 
        aria-label="Toggle theme" 
        onclick={toggleTheme}
      >
        {#if isDark}
          <Sun size={20} />
        {:else}
          <Moon size={20} />
        {/if}
      </button>
    </div>
  </header>

  {@render children()}
</div>
