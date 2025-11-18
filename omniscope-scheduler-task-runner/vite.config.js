// vite.config.js
import { defineConfig } from 'vite';

/**
 * Omniscope Scheduler Task Runner – Vite config
 *
 * This project uses a dev-time proxy so the browser can call the
 * Omniscope Scheduler API without CORS issues.
 *
 * By default we enable the proxy and talk to:
 *   http://127.0.0.1:24679/_admin_/scheduler/api/v1
 *
 * The frontend calls relative URLs like:
 *   /scheduler-api/all/
 *   /scheduler-api/task/{taskName}/execute/
 *   /scheduler-api/job/{jobId}/
 *
 * Vite rewrites those to the real Omniscope URL.
 *
 * If you don’t want to use a proxy (for example, if you host this
 * page from Omniscope itself or have CORS configured), set
 * `useProxy` to false and update script.js to call the API directly.
 */

const useProxy = true; // <- toggle this if you really want to disable the proxy

// Default local Omniscope Scheduler API target (edit if your port/host differ)
const schedulerTarget =
  process.env.SCHEDULER_TARGET ||
  'http://127.0.0.1:24679/_admin_/scheduler/api/v1';

export default defineConfig({
  server: useProxy
    ? {
        proxy: {
          // Frontend calls /scheduler-api/... which is proxied to the real API
          '/scheduler-api': {
            target: schedulerTarget,
            changeOrigin: true,
            /**
             * Strip the /scheduler-api prefix before forwarding.
             * e.g. /scheduler-api/all/  ->  {schedulerTarget}/all/
             */
            rewrite: (path) => path.replace(/^\/scheduler-api/, ''),
          },
        },
      }
    : {}, // no proxy: browser must talk to the API directly (mind CORS!)
});
