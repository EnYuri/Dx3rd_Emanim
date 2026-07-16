#!/usr/bin/env node
/** Increment a decimal-style Foundry system manifest version (x.y.z). */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const file = path.resolve(process.argv[2] || "system.json");
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(String(manifest.version ?? ""));
if (!match) throw new Error(`Expected a numeric semantic version, got: ${manifest.version}`);

const previous = manifest.version;
let [major, minor, patch] = match.slice(1, 4).map(Number);

// Release versions use one decimal digit per component: 1.7.9 → 1.8.0,
// and 1.9.9 → 2.0.0. Do not produce multi-digit patch components such as
// 1.7.10, even though they are valid semantic versions.
if (patch >= 9) {
  patch = 0;
  if (minor === 9) {
    minor = 0;
    major += 1;
  } else {
    minor += 1;
  }
} else {
  patch += 1;
}

manifest.version = `${major}.${minor}.${patch}${match[4]}`;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`DX3rd | version ${previous} → ${manifest.version}`);
