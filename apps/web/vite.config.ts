import react from "@vitejs/plugin-react";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { cp } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Where the review page tells Excalidraw to load its fonts from. Without it
 * Excalidraw fetches them from esm.sh, and a canvas would need the network.
 */
const EXCALIDRAW_FONTS_ROUTE = "/excalidraw-assets/fonts";

/** Serves Excalidraw's own font files in dev and copies them into the build. */
function excalidrawFonts(): Plugin {
  const fontsDirectory = realpathSync(
    fileURLToPath(
      new URL(
        "./node_modules/@excalidraw/excalidraw/dist/prod/fonts",
        import.meta.url,
      ),
    ),
  );
  let outDirectory = "dist";

  return {
    name: "pena-excalidraw-fonts",
    configResolved(config) {
      outDirectory = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(EXCALIDRAW_FONTS_ROUTE, (request, response, next) => {
        const file = resolve(
          fontsDirectory,
          `.${decodeURIComponent(request.url?.split("?")[0] ?? "")}`,
        );

        if (
          !file.startsWith(`${fontsDirectory}${sep}`) ||
          !statSync(file, { throwIfNoEntry: false })?.isFile()
        ) {
          next();
          return;
        }

        response.setHeader("content-type", "font/woff2");
        createReadStream(file).pipe(response);
      });
    },
    async writeBundle() {
      await cp(fontsDirectory, join(outDirectory, EXCALIDRAW_FONTS_ROUTE), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawFonts()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
});
