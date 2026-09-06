// Static dev server with the cross-origin isolation headers SharedArrayBuffer needs.
// Usage: node web/serve.mjs [dir] [port] [game-folder]
// With a game folder, /gamefiles/index.json lists it and /gamefiles/<path> serves it,
// so the page can ingest into OPFS over HTTP instead of the directory picker.
import { createServer } from 'node:http';
import { stat, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, relative } from 'node:path';

const root = resolve(process.argv[2] ?? 'web/dist');
const port = Number(process.argv[3] ?? 8080);
const gameRoot = process.argv[4] ? resolve(process.argv[4]) : null;

async function listGameFiles() {
  const files = [];
  const walk = async (dir) => {
    for (const name of await readdir(dir)) {
      const full = join(dir, name);
      const info = await stat(full);
      if (info.isDirectory()) await walk(full);
      else files.push({ path: relative(gameRoot, full).split('\\').join('/'), size: info.size });
    }
  };
  await walk(gameRoot);
  return files;
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
  '.css': 'text/css',
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const headers = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cache-Control': 'no-store',
  };
  if (req.method === 'POST' && urlPath.startsWith('/save/')) {
    const name = urlPath.slice('/save/'.length).replace(/[^\w.-]/g, '_');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    await mkdir('web/out', { recursive: true });
    await writeFile(join('web/out', name), Buffer.concat(chunks));
    res.writeHead(200, headers).end('saved ' + name);
    return;
  }
  if (gameRoot && urlPath === '/gamefiles/index.json') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(await listGameFiles()));
    return;
  }
  let file = gameRoot && urlPath.startsWith('/gamefiles/')
    ? join(gameRoot, urlPath.slice('/gamefiles/'.length))
    : join(root, urlPath);
  if (!file.startsWith(root) && !(gameRoot && file.startsWith(gameRoot))) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found: ' + urlPath);
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}`));
