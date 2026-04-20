import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function serveHTML(res: ServerResponse): void {
  const htmlPath = path.join(__dirname, "..", "index.html");
  const srcHtmlPath = path.resolve(__dirname, "..", "..", "..", "src", "server", "index.html");
  const filePath = fs.existsSync(htmlPath) ? htmlPath : srcHtmlPath;

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fs.readFileSync(filePath, "utf-8"));
}

function serveFont(res: ServerResponse, fontName: string): void {
  const fontPath = path.resolve(__dirname, "..", "..", "..", "assets", "fonts", fontName);
  const srcFontPath = path.resolve(__dirname, "..", "..", "..", "src", "..", "assets", "fonts", fontName);
  const resolvedFont = fs.existsSync(fontPath) ? fontPath : srcFontPath;

  if (fs.existsSync(resolvedFont)) {
    res.writeHead(200, {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(fs.readFileSync(resolvedFont));
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Font not found");
  }
}

function serveLogo(res: ServerResponse): void {
  const logoPath = path.resolve(__dirname, "..", "..", "..", "assets", "logo.jpeg");
  const srcLogoPath = path.resolve(__dirname, "..", "..", "..", "src", "..", "assets", "logo.jpeg");
  const resolvedLogo = fs.existsSync(logoPath) ? logoPath : srcLogoPath;

  if (fs.existsSync(resolvedLogo)) {
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(fs.readFileSync(resolvedLogo));
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
