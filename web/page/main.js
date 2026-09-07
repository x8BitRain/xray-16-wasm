const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const logEl = $('log');

const pending = [];
let flushScheduled = false;
function print(line) {
  pending.push(line);
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    logEl.textContent += pending.join('\n') + '\n';
    pending.length = 0;
    flushScheduled = false;
    if (logEl.textContent.length > 400000) logEl.textContent = logEl.textContent.slice(-200000);
    logEl.scrollTop = logEl.scrollHeight;
  }, 50);
}

print(`crossOriginIsolated=${crossOriginIsolated}`);
if (location.protocol === 'file:')
  print('WARNING: open this page over http://localhost, not file:// (the ingest worker and SharedArrayBuffer are blocked)');
else if (!crossOriginIsolated)
  print('WARNING: page is not cross-origin isolated; serve it with web/serve.mjs so COOP/COEP are set, or threads will fail');

const worker = new Worker('./ingest-worker.js', { type: 'module' });
const requests = new Map();
let nextRequestId = 0;

worker.addEventListener('message', (e) => {
  if (e.data.type === 'progress') {
    $('progress').hidden = false;
    $('progress').value = e.data.done / e.data.total;
    $('ingest-status').textContent = `${e.data.file} (${(e.data.done / 1e9).toFixed(2)} / ${(e.data.total / 1e9).toFixed(2)} GB)`;
    return;
  }
  const request = requests.get(e.data.id);
  if (!request) return;
  requests.delete(e.data.id);
  if (e.data.type === 'error') request.reject(new Error(e.data.error));
  else request.resolve(e.data);
});

function failRequests(reason) {
  for (const request of requests.values()) request.reject(new Error(reason));
  requests.clear();
}
worker.addEventListener('error', (e) => failRequests(`ingest worker failed: ${e.message || 'script did not load'}`));
worker.addEventListener('messageerror', () => failRequests('ingest worker sent an unreadable message'));

function askWorker(message, timeoutMs) {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    worker.postMessage({ ...message, id });
    if (!timeoutMs) return;
    setTimeout(() => {
      if (!requests.delete(id)) return;
      reject(new Error(`ingest worker did not answer '${message.type}' within ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });
}

async function refreshState() {
  try {
    const state = await askWorker({ type: 'status' }, 15000);
    $('ingest-status').textContent = state.ingested ? 'game files present in OPFS' : 'game files not ingested yet (launch will only exercise engine startup)';
    $('launch').disabled = false;
  } catch (e) {
    $('ingest-status').textContent = 'OPFS unavailable: ' + e.message;
    print('OPFS unavailable: ' + e.message);
  }
}

$('pick').onclick = async () => {
  try {
    if (!window.showDirectoryPicker)
      throw new Error('this browser has no File System Access API; use Chrome');
    const dir = await window.showDirectoryPicker({ id: 'stalker-cop', mode: 'read' });
    $('pick').disabled = true;
    $('ingest-status').textContent = 'scanning game folder...';
    await askWorker({ type: 'ingest', dir });
    $('progress').hidden = true;
    print('ingestion complete');
  } catch (e) {
    print('ingestion failed: ' + e.message);
  } finally {
    $('pick').disabled = false;
    await refreshState();
  }
};

$('launch').onclick = async () => {
  $('launch').disabled = true;
  $('pick').disabled = true;
  $('ingest-status').textContent = 'syncing engine data...';
  try {
    await askWorker({ type: 'sync-engine-data' });
  } catch (e) {
    $('ingest-status').textContent = 'engine data sync failed: ' + e.message;
    print('engine data sync failed: ' + e.message);
    $('launch').disabled = false;
    $('pick').disabled = false;
    return;
  }
  $('ingest-status').textContent = 'running';

  const args = ['-nosplash', '-nointro', '-nogameintro', '-fsltx', '/opfs/game/fsgame.ltx'];
  args.push(...$('extra-args').value.split(/\s+/).filter(Boolean));
  print('launching: ' + args.join(' '));

  canvas.width = 1280;
  canvas.height = 720;

  const { default: createModule } = await import('./xr_3da.js');
  await createModule({ canvas, arguments: args, print, printErr: print });
  canvas.focus();

  $('status').textContent = 'engine running';
};

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('click', () => {
  canvas.focus();
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  canvas.style.cursor = document.pointerLockElement === canvas ? 'none' : 'default';
});

refreshState();

window.saveFromOpfs = async (path, name) => {
  let dir = await navigator.storage.getDirectory();
  const parts = path.split('/');
  const file = parts.pop();
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  const blob = await (await dir.getFileHandle(file)).getFile();
  await fetch('/save/' + (name ?? file), { method: 'POST', body: blob });
  return `${file}: ${blob.size} bytes`;
};
