import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readRuntimeConfig, studioApiBaseUrl } from "../../scripts/runtime-config.mjs";

const runtimeConfig = readRuntimeConfig();

export default defineConfig({
  plugins: [react()],
  define: {
    __STUDIO_API_URL__: JSON.stringify(studioApiBaseUrl(runtimeConfig)),
  },
  server: {
    host: runtimeConfig.ui.host,
    port: runtimeConfig.ui.devPort,
    strictPort: true,
  },
});
