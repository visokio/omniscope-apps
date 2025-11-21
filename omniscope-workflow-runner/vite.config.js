import { defineConfig } from 'vite'

/*
If the browser calls:
/workflow-api/Customer+Satisfaction/Dashboard.iox/w/param

Vite will forward to:
http://127.0.0.1:24679/Customer+Satisfaction/Dashboard.iox/w/param
*/

export default defineConfig({
  server: {
    proxy: {
      // Frontend calls /workflow-api/... → proxied to http://127.0.0.1:24679/...
      '/workflow-api': {
        target: 'http://127.0.0.1:24679',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/workflow-api/, ''),
      },
    },
  },
})