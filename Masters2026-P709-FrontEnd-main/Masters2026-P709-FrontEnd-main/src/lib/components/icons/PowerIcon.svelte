<script lang="ts">
  type Props = {
    /** CSS size (any length). Defaults to 1em so it tracks font-size. */
    size?: string | number;
    /** Extra classes to merge onto the <svg>. */
    class?: string;
  };

  let { size = '1em', class: className = '', ...rest }: Props = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size}
     fill="none" stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" class={className} {...rest}>
  <!--
    Standard power symbol:
      1. A vertical line at the top (the "on" tick).
      2. An open circle around it, with a gap at the top for the line.
  -->

  <!-- Tick -->
  <path d="M12 3v9" />

  <!-- Open ring -->
  <path d="M6.4 6.6a8 8 0 1 0 11.2 0" />
</svg>
