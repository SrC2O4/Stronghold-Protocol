// Local-client Spine extraction, followed by the existing atlas/parser/animation pipeline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { parseSkel } from './assets/skel.mjs';
import { pngSize } from './assets/formats.mjs';
import { resolveRoles } from './assets/anim-roles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv-extract', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const args = process.argv.slice(2);
const iconsOnly = args.includes('--icons-only');
if (!args.includes('--manifest-only')) {
  const run = spawnSync(python, [path.join(root, 'tools/local-extract/operators.py'), ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (run.error || run.status !== 0) { console.error(run.error || 'Local extraction failed'); process.exit(1); }
}
const report = JSON.parse(await fs.readFile(path.join(root, '.cache/local-operators.json'), 'utf8'));
const file = path.join(root, 'data/assets.json');
const assets = JSON.parse(await fs.readFile(file, 'utf8'));
const local = { chars: {}, tokens: {}, skills: { ...(report.skills || {}) }, modules: { ...(report.modules || {}) } };
let models = 0;
for (const group of ['chars', 'tokens']) for (const [id, source] of Object.entries(iconsOnly ? {} : report[group])) {
  const entry = { ...(assets[group][id] || {}), ...source, spine: { ...(assets[group][id]?.spine || {}) } };
  for (const [facing, dir] of Object.entries(source.spine || {})) {
    try {
      const abs = path.join(root, 'public', dir);
      const original = await fs.readFile(path.join(abs, 'model.atlas'), 'utf8');
      const info = atlasInfo(original);
      const sizes = {};
      for (const page of info.pages) sizes[page] = pngSize(await fs.readFile(path.join(abs, page)));
      const norm = normalizeAtlas(original, { pageSize: (name) => sizes[name], pma: false });
      const sk = parseSkel(await fs.readFile(path.join(abs, 'model.skel')), info.regions);
      if (!sk.animations.length || sk.missingRegions.length) throw new Error('Missing animations or atlas regions');
      await fs.writeFile(path.join(abs, 'model.atlas'), norm.text);
      entry.spine[facing] = { skel: `/${dir}/model.skel`, atlas: `/${dir}/model.atlas`,
        textures: info.pages.map((p) => `/${dir}/${p}`), pma: false,
        anims: resolveRoles(sk.animations, { skillIndices: [0, 1, 2], durations: sk.durations }),
        animations: sk.durations, events: sk.events, hits: sk.hits, bounds: sk.bounds };
      models++;
    } catch (error) { report.failures[`${id}/${facing}`] = error.message; }
  }
  if (group === 'tokens') entry.spine = entry.spine.front || assets.tokens[id]?.spine || null;
  assets[group][id] = entry;
  local[group][id] = entry;
}
const localFile = path.join(root, 'data/local-operators-assets.json');
// Diagnostic --only runs must not discard a previous full extraction.
try {
  const previous = JSON.parse(await fs.readFile(localFile, 'utf8'));
  for (const group of ['chars', 'tokens', 'skills', 'modules']) local[group] = { ...previous[group], ...local[group] };
} catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const group of ['skills', 'modules']) assets[group] = { ...(assets[group] || {}), ...(local[group] || {}) };
await fs.writeFile(localFile + '.tmp', JSON.stringify(local));
await fs.rename(localFile + '.tmp', localFile);
await fs.writeFile(file + '.tmp', JSON.stringify(assets));
await fs.rename(file + '.tmp', file);
await fs.writeFile(path.join(root, '.cache/local-operators-report.json'), JSON.stringify({ models, failures: report.failures }, null, 2));
console.log(iconsOnly
  ? `Registered ${Object.keys(local.skills).length} skill and ${Object.keys(local.modules).length} module icons.`
  : `Registered ${models} local Spine models; ${Object.keys(report.failures).length} failures (see .cache/local-operators-report.json)`);
if (Object.keys(report.failures).some((id) => id.startsWith('char_'))) process.exitCode = 1;
