/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js with two modes:
 * - GET with expo-platform header → platform manifest JSON (for Expo Go)
 * - GET without expo-platform → web PWA from dist/ (for browsers)
 *
 * Static file resolution order:
 *   1. dist/          (web export — PWA)
 *   2. static-build/  (native bundle assets referenced by manifests)
 *   3. SPA fallback → dist/index.html
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const WEB_DIST = path.resolve(__dirname, "..", "dist");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function readFileIfExists(filePath, root) {
  if (!filePath.startsWith(root)) return null;
  if (!fs.existsSync(filePath)) return null;
  if (fs.statSync(filePath).isDirectory()) return null;
  return fs.readFileSync(filePath);
}

function serveWebApp(pathname, req, res, landingPageTemplate, appName) {
  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");

  // 1. Try dist/ (web PWA export)
  const webFilePath = path.join(WEB_DIST, safePath);
  const webContent = readFileIfExists(webFilePath, WEB_DIST);
  if (webContent !== null) {
    const ext = path.extname(webFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(webContent);
    return;
  }

  // 2. Try static-build/ (native bundle assets referenced by Expo manifests)
  const staticFilePath = path.join(STATIC_ROOT, safePath);
  const staticContent = readFileIfExists(staticFilePath, STATIC_ROOT);
  if (staticContent !== null) {
    const ext = path.extname(staticFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(staticContent);
    return;
  }

  // 3. SPA fallback → dist/index.html
  const indexPath = path.join(WEB_DIST, "index.html");
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(indexPath));
    return;
  }

  // 4. No web build yet → Expo Go landing page
  if (pathname === "/") {
    serveLandingPage(req, res, landingPageTemplate, appName);
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  // Native Expo Go requests (Expo Go sends the expo-platform header)
  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];
    if (platform === "ios" || platform === "android") {
      return serveManifest(platform, res);
    }
  }

  // All browser requests → web PWA
  serveWebApp(pathname, req, res, landingPageTemplate, appName);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving on port ${port}`);
});
