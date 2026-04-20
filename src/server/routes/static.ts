import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try multiple paths for different environments
function findFile(paths: string[]): string | null {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function serveFile(res: ServerResponse, filePath: string, contentType: string): void {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": contentType === "text/html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("File not found");
  }
}

function serveHTML(res: ServerResponse): void {
  const paths = [
    path.join(__dirname, "..", "static", "index.html"),
    path.join(__dirname, "..", "index.html"),
    path.resolve(__dirname, "..", "..", "..", "src", "server", "static", "index.html"),
    path.resolve(__dirname, "..", "..", "..", "src", "server", "index.html"),
  ];

  const filePath = findFile(paths);
  if (filePath) {
    serveFile(res, filePath, "text/html");
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("index.html not found");
  }
}

function serveStaticFile(res: ServerResponse, pathname: string): void {
  // Security: prevent path traversal
  const cleanPath = pathname.replace(/\.\./g, "").replace(/^\/+/, "");
  const ext = path.extname(cleanPath);

  const contentTypes: Record<string, string> = {
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
  };

  const contentType = contentTypes[ext] || "application/octet-stream";

  const paths = [
    path.join(__dirname, "..", "static", cleanPath),
    path.resolve(__dirname, "..", "..", "..", "src", "server", "static", cleanPath),
  ];

  const filePath = findFile(paths);
  if (filePath) {
    serveFile(res, filePath, contentType);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Static file not found");
  }
}

function serveFont(res: ServerResponse, fontName: string): void {
  const paths = [
    path.resolve(__dirname, "..", "..", "..", "assets", "fonts", fontName),
    path.resolve(__dirname, "..", "..", "..", "src", "..", "assets", "fonts", fontName),
  ];

  const filePath = findFile(paths);
  if (filePath) {
    res.writeHead(200, {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Font not found");
  }
}

function serveLogo(res: ServerResponse): void {
  const paths = [
    path.resolve(__dirname, "..", "..", "..", "assets", "logo.jpeg"),
    path.resolve(__dirname, "..", "..", "..", "src", "..", "assets", "logo.jpeg"),
  ];

  const filePath = findFile(paths);
  if (filePath) {
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Logo not found");
  }
}

export function serve(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): void {
  // Serve static files from /static/
  if (pathname.startsWith("/static/")) {
    return serveStaticFile(res, pathname);
  }

  // Serve fonts
  if (pathname.startsWith("/fonts/")) {
    const fontName = path.basename(pathname);
    return serveFont(res, fontName);
  }

  // Serve logo
  if (pathname === "/logo.jpeg") {
    return serveLogo(res);
  }

  // Serve frontend SPA (all other routes)
  serveHTML(res);
}
