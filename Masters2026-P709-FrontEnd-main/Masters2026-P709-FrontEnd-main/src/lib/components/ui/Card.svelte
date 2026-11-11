<!--
  Card.svelte
  =============================================================================
  Example of how this component can be used:
    <Card>...anything...</Card>
    <Card renderAs="article" active={isOn}>...</Card>
    <Card renderAs="button" onclick={doSomething}>...</Card>   <- tappable card

  Props:
    renderAs  Which HTML element to render. Pick the one that fits the meaning
             (article, li, ...). 'button' makes the whole card tappable.
    active   Highlights the card with the accent colour (e.g. a light that is on).
    glow     Adds a soft glow around an active card. Defaults to true. Turn it
             off (glow={false}) inside scrolling lists, where the glow would be
             cut off at the edge of the list.
    padding  'sm' | 'md' (default) | 'lg' - space between the edge and the content.
    class    Extra class name. Only needed for styling with :global() selectors,
             because a page's scoped CSS cannot reach into this component.
    ...      Any other normal HTML attribute (onclick, style, aria-*, id, ...) is
             passed straight to the element.

  Spacing between children:
    The card stacks its children in a column. Change the gap by setting the CSS
    variable on the element:  <Card style="--card-gap: 0.5rem">

  Colours come from the theme variables in app.css (--surface, --ink,
  --accent-rgb, ...), so the card follows the light/dark theme automatically.
-->

<svelte:options runes />

<script lang="ts">
  import type { Snippet } from 'svelte'; // For typing the content passed between <Card> and </Card>.
  import type { HTMLAttributes } from 'svelte/elements'; // For typing standard HTML attributes like onclick, style, id, etc.

  // Our own props, plus every standard HTML attribute (onclick, style, id, ...).
  type Props = HTMLAttributes<HTMLElement> & {
    renderAs?: 'div' | 'article' | 'section' | 'li' | 'button';
    active?: boolean;
    glow?: boolean;
    padding?: 'sm' | 'md' | 'lg';
    class?: string;
    // The content placed between <Card> and </Card>.
    children?: Snippet;
  };

  // Read the props and set their defaults.
  // `class` is a reserved word in JavaScript, so it is renamed to `className`.
  // `...rest` collects everything not listed here so it can be forwarded below.
  let {
    renderAs = 'div',
    active = false,
    glow = true,
    padding = 'md',
    class: className = '',
    children,
    ...rest
  }: Props = $props();
</script>

<!--
  <svelte:element this={renderAs}> renders whichever tag the `renderAs` prop names.
  - `class="card {className}"` always applies our styles and appends the caller's class.
  - `class:active` / `class:glow` add those classes only while the props are true.
  - `data-padding` is read by the CSS below to pick the padding size.
  - `{...rest}` forwards onclick, style, aria-* and any other attribute.
  - `{@render children?.()}` draws the content passed between the tags.
-->
<svelte:element
  this={renderAs}
  class="card {className}"
  class:active
  class:glow
  data-padding={padding}
  {...rest}
>
  {@render children?.()}
</svelte:element>

<style>
  /* Default styles look: a flex column so children stack with an even gap. */
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap, 1rem); /* override per card with style="--card-gap: ..." */
    box-sizing: border-box;
    /* rgb(var(--x) / alpha): the theme stores colours as RGB numbers so we can set
       the transparency here. Both change automatically with the theme. */
    background: rgb(var(--surface) / 0.8);
    border: 1px solid rgb(var(--ink) / 0.08);
    border-radius: 12px;
    color: inherit;
    transition: border-color 250ms, background 250ms, box-shadow 250ms;
  }

  /* Padding sizes, chosen by the `padding` prop through data-padding. */
  .card[data-padding='sm'] { padding: 0.75rem 0.85rem; }
  .card[data-padding='md'] { padding: 1rem; }
  .card[data-padding='lg'] { padding: 1.25rem; }

  /* Active: brighter surface and an accent-coloured border. */
  .card.active {
    background: rgb(var(--surface-hi) / 0.65);
    border-color: rgb(var(--accent-rgb) / 0.7);
  }
  /* Optional glow, kept separate so it can be switched off with glow={false}. */
  .card.active.glow {
    box-shadow: 0 0 20px rgb(var(--accent-rgb) / 0.25);
  }

  /* When rendered as a <button>: remove the browser's default button styling and
     make the whole card behave like a tappable tile. */
  button.card {
    appearance: none;
    width: 100%;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 250ms, background 250ms, box-shadow 250ms, transform 80ms;
  }
  /* Small press-down effect so touch panels give visible feedback. */
  button.card:active {
    transform: scale(0.98);
  }
</style>
