import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173, // default is fine
    proxy: {
      "/proxy": {
        target: "https://public.omniscope.me",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy/, ""),
      },
    },
  },
});