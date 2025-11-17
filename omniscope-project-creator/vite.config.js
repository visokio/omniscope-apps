import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: "./fontend",
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});