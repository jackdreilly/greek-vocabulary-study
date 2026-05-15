import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    {
      name: "save-preferences-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === "/api/save-preferences" && req.method === "POST") {
            let body = "";
            for await (const chunk of req) {
              body += chunk;
            }
            try {
              const data = JSON.parse(body);
              const filePath = path.join(process.cwd(), "public", "data", "image-preferences.json");
              await fs.writeFile(filePath, JSON.stringify(data, null, 2));
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              res.statusCode = 500;
              res.end(err.message);
            }
          } else {
            next();
          }
        });
      },
    },
  ],
  publicDir: "public",
  build: {
    outDir: "site",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
  },
});
