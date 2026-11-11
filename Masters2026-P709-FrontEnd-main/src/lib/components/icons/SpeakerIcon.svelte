<script lang="ts">
  type Props = {
    /** CSS size (any length). Defaults to 1em so it tracks font-size. */
    size?: string | number;
    /** Extra classes to merge onto the <svg>. */
    class?: string;
    /** Draws a slash instead of sound waves. */
    muted?: boolean;
  };

  let { size = '1em', class: className = '', muted = false, ...rest }: Props = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size}
     fill="none" stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" class={className} {...rest}>
  <!-- Speaker body -->
  <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />

  {#if muted}
    <!-- Cross: the speaker is muted -->
    <path d="m16 9.5 5 5" />
    <path d="m21 9.5-5 5" />
  {:else}
    <!-- Sound waves -->
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
  {/if}
</svg>
