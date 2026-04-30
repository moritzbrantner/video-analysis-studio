import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readOrCreateDevApiToken, readRuntimeConfig, studioApiBaseUrl } from "../../scripts/runtime-config.mjs";

const runtimeConfig = readRuntimeConfig();
const studioApiToken = process.env.VITE_STUDIO_API_TOKEN ?? readOrCreateDevApiToken();

export default defineConfig({
  plugins: [react()],
  define: {
    __STUDIO_API_URL__: JSON.stringify(studioApiBaseUrl(runtimeConfig)),
    __STUDIO_API_TOKEN__: JSON.stringify(studioApiToken),
  },
  server: {
    host: runtimeConfig.ui.host,
    port: runtimeConfig.ui.devPort,
    strictPort: true,
  },
});
