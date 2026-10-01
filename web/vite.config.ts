import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  worker: { format: "es" },
  // exceljs and jszip are lazy-loaded; only the app shell is in the main chunk.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/parity/**"],
  },
} as any);
