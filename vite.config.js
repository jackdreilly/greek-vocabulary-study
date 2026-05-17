import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";

async function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  const envContent = await fs.readFile(envPath, "utf8").catch(() => "");
  return Object.fromEntries(
    envContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      })
  );
}

async function proxyPexelsSearch(req, res) {
  const env = await loadEnvFile();
  const apiKey = process.env.PEXELS_API_KEY || process.env.VITE_PEXELS_API_KEY || env.PEXELS_API_KEY || env.VITE_PEXELS_API_KEY;

  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "PEXELS_API_KEY is not configured." }));
    return;
  }

  const requestUrl = new URL(req.url, "http://localhost");
  const upstreamUrl = new URL("https://api.pexels.com/v1/search");
  upstreamUrl.searchParams.set("query", requestUrl.searchParams.get("query") || "");
  upstreamUrl.searchParams.set("per_page", requestUrl.searchParams.get("per_page") || "6");
  upstreamUrl.searchParams.set("orientation", requestUrl.searchParams.get("orientation") || "landscape");

  const upstream = await fetch(upstreamUrl, { headers: { Authorization: apiKey } });
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.end(await upstream.text());
}

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    {
      name: "save-preferences-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith("/api/pexels-search") && req.method === "GET") {
            try {
              await proxyPexelsSearch(req, res);
            } catch (err) {
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: err.message }));
            }
          } else if (req.url === "/api/save-preferences" && req.method === "POST") {
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
