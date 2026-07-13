// Archived AppV1 migration audit.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanTargets = ['scripts/helpers.js', 'scripts/sheets', 'scripts/dialog'];
const patterns = {
  appv1Namespace: /foundry\.appv1/g,
  legacyApplicationBase: /\b(?:ActorSheet|ItemSheet|FormApplication|Dialog)\b/g,
  defaultOptions: /\bdefaultOptions\b/g,
  getData: /\bgetData\s*\(/g,
  activateListeners: /\bactivateListeners\s*\(/g,
  updateObject: /\b_updateObject\s*\(/g,
  jqueryFactory: /\$\s*\(/g,
  jqueryFind: /\bhtml\.find\s*\(/g,
  jqueryOn: /\bhtml\.on\s*\(/g
};

function walk(target) {
  if (fs.statSync(target).isFile()) return target.endsWith('.js') ? [target] : [];
  return fs.readdirSync(target, {withFileTypes: true}).flatMap(entry => {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

const files = scanTargets.flatMap(scanTarget => walk(path.join(root, scanTarget)));
const totals = Object.fromEntries(Object.keys(patterns).map(key => [key, 0]));
const results = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const counts = {};
  for (const [name, pattern] of Object.entries(patterns)) {
    const count = source.match(pattern)?.length || 0;
    counts[name] = count;
    totals[name] += count;
  }
  if (Object.values(counts).some(Boolean)) {
    results.push({file: path.relative(root, file).replaceAll('\\', '/'), ...counts});
  }
}

const report = {
  scannedFiles: files.length,
  filesWithLegacyUsage: results.length,
  totals,
  files: results.sort((a, b) => {
    const sum = value => Object.keys(patterns).reduce((total, key) => total + value[key], 0);
    return sum(b) - sum(a) || a.file.localeCompare(b.file);
  })
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`AppV1 audit: ${report.filesWithLegacyUsage}/${report.scannedFiles} files contain migration markers.`);
  for (const [name, count] of Object.entries(totals)) console.log(`${name.padEnd(24)} ${count}`);
  console.log('\nMost coupled files:');
  for (const file of report.files.slice(0, 10)) {
    const count = Object.keys(patterns).reduce((total, key) => total + file[key], 0);
    console.log(`${String(count).padStart(4)}  ${file.file}`);
  }
}
