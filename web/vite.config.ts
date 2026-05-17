import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";

async function loadEnvFile() {
  const envPaths = [path.join(process.cwd(), ".env"), path.resolve(process.cwd(), "../.env")];
  const envContents = await Promise.all(envPaths.map((envPath) => fs.readFile(envPath, "utf8").catch(() => "")));
  return Object.fromEntries(
    envContents
      .join("\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      })
  );
}

async function proxyPexelsSearch(req: any, res: any) {
  const env = await loadEnvFile();
  const apiKey =
    process.env.PEXELS_API_KEY || process.env.VITE_PEXELS_API_KEY || env.PEXELS_API_KEY || env.VITE_PEXELS_API_KEY;

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
      name: "pexels-search-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith("/api/pexels-search") && req.method === "GET") {
            try {
              await proxyPexelsSearch(req, res);
            } catch (err) {
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
          } else {
            next();
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
