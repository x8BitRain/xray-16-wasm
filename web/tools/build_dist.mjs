import { readdir, stat, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const distDir = join(repo, 'web/dist');
const outDir = join(distDir, 'engine');
const entries = [];

async function copyTree(srcRoot, prefix) {
  const walk = async (dir) => {
    for (const name of await readdir(dir)) {
      const full = join(dir, name);
      const info = await stat(full);
      if (info.isDirectory()) {
        await walk(full);
        continue;
      }
      const rel = join(prefix, relative(srcRoot, full)).toLowerCase();
      const dest = join(outDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(full, dest);
      entries.push({ path: rel, size: info.size });
    }
  };
  await walk(srcRoot);
}

await mkdir(outDir, { recursive: true });
for (const name of await readdir(join(repo, 'web/page')))
  await copyFile(join(repo, 'web/page', name), join(distDir, name));

const fsgame = join(repo, 'res/fsgame.ltx');
await copyFile(fsgame, join(outDir, 'fsgame.ltx'));
entries.push({ path: 'fsgame.ltx', size: (await stat(fsgame)).size });
await copyTree(join(repo, 'res/gamedata'), 'gamedata');
await writeFile(join(distDir, 'engine_data.json'), JSON.stringify(entries));
console.log(`web/dist: page + ${entries.length} engine data files`);
