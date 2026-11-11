<!--
  PageOutlet.svelte
  =============================================================================
  Renders whichever page is currently active in the navigation store, with a
  cross-fade animation when the user switches pages. This is the ONLY place in
  the app that mounts a page component — Header, Footer, and App know nothing
  about which page is up.

  How the animation works (this is worth understanding):

  {#key nav.current}
    ...content that reads nav.current...
  {/key}

  The `{#key expression}` block tells Svelte: "when the expression changes,
  tear down the entire block and mount a fresh copy." That triggers Svelte's
  transition system. Because `out:fade` on the old block and `in:fade` on the
  new block start simultaneously, we get a true crossfade — the two `.page`
  <div>s briefly coexist during the transition, then the old one is removed.

  Why {#await ...} inside the {#key}?
  Because `loadPage()` returns a Promise (dynamic `import()`), we need to
  handle the "still loading" state. On the very first tap of a page, this
  might take a few frames while Vite fetches that page's JS chunk. On every
  subsequent tap, the browser has cached the module, so the promise resolves
  synchronously and the user sees no loading state.

  Why is the .page div `position: absolute`?
  During the crossfade both the outgoing and incoming pages exist at once.
  Without absolute positioning they would stack vertically and push the
  layout around. Absolute positioning inside a `position: relative` parent
  (the <main> in App.svelte) lets them occupy the same rectangle and blend
  in place.
-->

<script lang="ts">
  import { fade } from 'svelte/transition';
  import { nav, loadPage } from '../stores/navigation.svelte';
</script>

{#key nav.current}
  <div
    class="page"
    in:fade={{ duration: 180 }}
    out:fade={{ duration: 120 }}
  >
    {#await loadPage(nav.current)}
      <!--
        Deliberately empty. On first visit this shows for maybe one frame
        while the JS chunk downloads; on subsequent visits it never shows at
        all because the browser has cached the module. If you want a spinner
        for very slow first-loads, drop it in here.
      -->
    {:then Page}
      <!--
        The `Page` local variable holds the resolved component. In Svelte 5
        we render a dynamic component by using its variable name as a tag —
        the variable MUST be capitalized (Svelte treats lowercase tags as
        plain HTML). No <svelte:component> needed; that syntax is legacy.
      -->
      <Page />
    {:catch error}
      <!--
        The dynamic import failed — usually a build/deploy problem. Show a
        minimal, non-alarming message so the panel doesn't look broken.
      -->
      <div class="page-error">
        <p>Could not load this page.</p>
        <p class="detail">{error?.message ?? 'Unknown error'}</p>
      </div>
    {/await}
  </div>
{/key}

<style>
  .page {
    /*
     * Fills the entire <main> area of the shell. Absolute positioning is
     * what lets outgoing and incoming pages overlap cleanly during the
     * fade — see the comment at the top of the file.
     */
    position: absolute;
    inset: 0;
    overflow: auto;

    /*
     * Hint to the browser: this element will animate opacity soon, so
     * promote it to its own GPU layer. Without this, the browser can fall
     * back to CPU compositing on the first frame of the transition, which
     * can show as a subtle flicker on weaker hardware.
     */
    will-change: opacity;
  }

  .page-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    padding: 2rem;
    color: var(--color-surface-50, #ffffff);
  }

  .page-error .detail {
    opacity: 0.6;
    font-size: 0.85em;
    margin-top: 0.5rem;
  }
</style>
