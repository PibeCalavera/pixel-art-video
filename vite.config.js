import { defineConfig } from "vite";

export default defineConfig({
  base: "/pixel-art-video/",

  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg"] },
});
