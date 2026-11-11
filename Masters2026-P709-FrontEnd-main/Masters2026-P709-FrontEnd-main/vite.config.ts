import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const projectConfigPath = fileURLToPath(new URL('./src/assets/data/project-config.json', import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built app works when served from a Crestron
  // touch panel (which hosts .ch5 projects from a non-root path).
  base: './',
  plugins: [
    svelte(),
    {
      name: 'project-config',
      configureServer(server) {
        server.middlewares.use('/assets/data/project-config.json', (request, response, next) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') return next();
          readFile(projectConfigPath).then((content) => {
            response.setHeader('Content-Type', 'application/json');
            response.end(content);
          }, next);
        });
      },
      async generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'assets/data/project-config.json',
          source: await readFile(projectConfigPath)
        });
      }
    }
  ]
});
