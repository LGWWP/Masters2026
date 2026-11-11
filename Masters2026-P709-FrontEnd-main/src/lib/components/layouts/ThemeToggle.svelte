<!--
  ThemeToggle.svelte
  Segmented Light / Auto / Dark control. Auto follows the OS/browser preference.
-->

<svelte:options runes />

<script lang="ts">
  import { theme, setThemeMode, type ThemeMode } from '../../stores/theme.svelte';

  const OPTIONS: { mode: ThemeMode; label: string }[] = [
    { mode: 'light', label: 'Light' },
    { mode: 'dark', label: 'Dark' }
  ];
</script>

<div class="theme-toggle" role="radiogroup" aria-label="Theme">
  {#each OPTIONS as opt (opt.mode)}
    <button
      type="button"
      role="radio"
      aria-checked={theme.mode === opt.mode}
      class:active={theme.mode === opt.mode}
      onclick={() => setThemeMode(opt.mode)}
    >{opt.label}</button>
  {/each}
</div>

<style>
  .theme-toggle {
    display: flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid rgb(var(--ink) / 0.12);
    border-radius: 10px;
    background: rgb(var(--ink) / 0.05);
  }

  button {
    appearance: none;
    flex: 1;
    padding: 8px 0;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: rgb(var(--ink) / 0.6);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }

  button.active {
    background: var(--nav-active-bg);
    border-color: var(--nav-active-border);
    color: #ffffff;
  }
</style>
