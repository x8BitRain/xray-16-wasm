// Copies the Steam game folder (minus bin/) and the engine's data into OPFS under game/,
// lowercasing every path component so the engine's lowercase lookups match.
const CHUNK = 16 << 20;
const SKIP_DIRS = new Set(['bin', 'directx', 'helpers', '_appdata_']);
const SKIP_EXT = /\.(exe|dll|pdb|txt|url|ini)$/i;

async function gameDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('game', { create: true });
}

async function ensureDir(base, parts) {
  let dir = base;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

async function existingSize(dir, name) {
  try {
    const handle = await dir.getFileHandle(name);
    return (await handle.getFile()).size;
  } catch {
    return -1;
  }
}

async function writeBlob(dir, name, blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    let offset = 0;
    while (offset < blob.size) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
      access.write(bytes, { at: offset });
      offset += bytes.byteLength;
    }
    access.flush();
  } finally {
    access.close();
  }
}

async function collect(dirHandle, prefix, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    const lower = name.toLowerCase();
    if (handle.kind === 'directory') {
      if (!SKIP_DIRS.has(lower)) await collect(handle, [...prefix, lower], out);
    } else if (!SKIP_EXT.test(lower)) {
      out.push({ parts: prefix, name: lower, handle });
    }
  }
}

async function ingest(sourceDir) {
  const files = [];
  await collect(sourceDir, [], files);
  const game = await gameDir();
  let total = 0;
  const sized = [];
  for (const f of files) {
    const file = await f.handle.getFile();
    sized.push({ ...f, file });
    total += file.size;
  }
  let done = 0;
  for (const f of sized) {
    const dir = await ensureDir(game, f.parts);
    if ((await existingSize(dir, f.name)) !== f.file.size) await writeBlob(dir, f.name, f.file);
    done += f.file.size;
    postMessage({ type: 'progress', file: [...f.parts, f.name].join('/'), done, total });
  }
  for (const sub of ['logs', 'savedgames', 'screenshots']) await ensureDir(game, ['_appdata_', sub]);
  await writeBlob(game, '.ingested', new Blob([new Date().toISOString()]));
}

async function syncEngineData() {
  const game = await gameDir();
  const manifest = await (await fetch('./engine_data.json')).json();
  for (const entry of manifest) {
    const parts = entry.path.split('/');
    const name = parts.pop();
    const dir = await ensureDir(game, parts);
    if ((await existingSize(dir, name)) === entry.size) continue;
    await writeBlob(dir, name, await (await fetch('./engine/' + entry.path)).blob());
  }
  for (const sub of ['logs', 'savedgames', 'screenshots']) await ensureDir(game, ['_appdata_', sub]);
}

async function status() {
  const game = await gameDir();
  return { ingested: (await existingSize(game, '.ingested')) >= 0 };
}

onmessage = async (e) => {
  const { id } = e.data;
  try {
    switch (e.data.type) {
      case 'status': postMessage({ id, type: 'status', ...(await status()) }); break;
      case 'ingest': await ingest(e.data.dir); postMessage({ id, type: 'done' }); break;
      case 'sync-engine-data': await syncEngineData(); postMessage({ id, type: 'done' }); break;
    }
  } catch (err) {
    postMessage({ id, type: 'error', error: err.message });
  }
};
