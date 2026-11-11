<!-- Placeholder page. Real content lives here later. -->
<section class="page-body" aria-labelledby="home-title">
  <header class="page__header">
    <h1 id="home-title">Home</h1>
  </header>
  <section aria-labelledby="welcome-title">
    <h2 id="welcome-title">Welcome</h2>
    <p>Pick a page from the menu.</p>
  </section>
</section>

<style>
  .page-body {
    box-sizing: border-box;
    min-height: 100%;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem clamp(1rem, 5vw, 2rem);
  }
  .page__header {
    margin-bottom: 1rem;
  }
  .page__header h1 {
    margin: 0;
    font-size: 1.5rem;
    letter-spacing: 0.02em;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.45;
  }
  p {
    margin: 0;
    opacity: 0.7;
  }
</style>
