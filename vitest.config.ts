import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom for component / hook tests; faster and ESM-friendly than jsdom
    environment: 'happy-dom',
  },
});
