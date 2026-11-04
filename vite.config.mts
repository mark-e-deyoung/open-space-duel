import { defineConfig } from 'vite';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pkg from './package.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/open-space-duel/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'generate-version-json',
      buildStart() {
        // Generate version.json in public folder so it's copied to dist
        const versionPath = join(__dirname, 'public', 'version.json');
        writeFileSync(versionPath, JSON.stringify({ version: pkg.version }, null, 2));
      }
    }
  ],
  server: {
    port: 3000,
  },
});
