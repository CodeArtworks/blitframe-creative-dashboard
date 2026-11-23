import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dashboardApi } from "./server/dashboard-api.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: { host: "127.0.0.1", port: Number(env.PORT || 4173), strictPort: true, watch: { ignored: ["**/.env"] } },
    plugins: [react(), dashboardApi(env.BLITFRAME_API_KEY, env.BLITFRAME)],
  };
});
