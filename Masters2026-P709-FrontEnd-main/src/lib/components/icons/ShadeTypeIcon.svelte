<script lang="ts">
  import type { ShadeType } from "../../stores/shades.svelte";

  let { type }: { type: ShadeType } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if type === "curtain"}
    <path d="M3 4h18M4 5v15h6L7 12l3-7M20 5v15h-6l3-8-3-7M4 12h3M17 12h3" />
  {:else if type === "roller"}
    <rect x="3" y="3" width="18" height="3" rx="1" />
    <path d="M5 6v11h14V6M12 17v4M10 21h4" />
  {:else}
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M4 8h16M4 12h16M4 16h16" />
  {/if}
</svg>

<style>
  svg {
    width: 1.4em;
    height: 1.4em;
    flex-shrink: 0;
  }
</style>
