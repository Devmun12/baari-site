// Local dev server for Baari. Not deployed (see .vercelignore).
//
//   node dev/server.mjs              -> mocked Gemini and Supabase, no internet needed
//   DEV_REAL=1 node dev/server.mjs   -> real services, keys read from .env
//
// It serves index.html and routes /api/* to the real handler files, imitating
// the small parts of Vercel's Node runtime that the handlers use.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3000);
const REAL = process.env.DEV_REAL === "1";

let mocks = null;
if (REAL) {
  loadDotEnv(path.join(ROOT, ".env"));
} else {
  mocks = await import("./mocks.mjs");
  mocks.installMocks();
}

const ROUTES = {
  "/api/setup-week": path.join(ROOT, "api/setup-week.js"),
  "/api/stats": path.join(ROOT, "api/stats.js"),
};

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const started = Date.now();
  res.on("finish", () => {
    if (!url.pathname.startsWith("/__mock")) {
      console.log(`${req.method} ${url.pathname}${url.search} -> ${res.statusCode} (${Date.now() - started} ms)`);
    }
  });

  try {
    if (ROUTES[url.pathname]) {
      const raw = await readBody(req);
      req.query = Object.fromEntries(url.searchParams);
      // Like Vercel: JSON bodies arrive parsed. Bad JSON stays a string, and the handler rejects it.
      if (raw && /json/i.test(req.headers["content-type"] || "")) {
        try { req.body = JSON.parse(raw); } catch { req.body = raw; }
      } else {
        req.body = raw || undefined;
      }
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (data) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
      const mod = await import(pathToFileURL(ROUTES[url.pathname]).href);
      await mod.default(req, res);
      return;
    }

    if (mocks && url.pathname.startsWith("/__mock/")) {
      const raw = req.method === "POST" ? await readBody(req) : "";
      const out = await mocks.mockControl(url.pathname, req.method, raw ? JSON.parse(raw) : null);
      return out ? sendJson(res, 200, out) : sendJson(res, 404, { error: "Unknown mock control" });
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(path.join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "Dev server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Baari dev server on http://localhost:${PORT} (${REAL ? "REAL Gemini and Supabase" : "mocked Gemini and Supabase"})`);
});
