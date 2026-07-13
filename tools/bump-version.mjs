#!/usr/bin/env node
/** Increment the patch component of a Foundry system manifest version. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const file = path.resolve(process.argv[2] || "system.json");
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(String(manifest.version ?? ""));
if (!match) throw new Error(`Expected a numeric semantic version, got: ${manifest.version}`);

const previous = manifest.version;
manifest.version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4]}`;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`DX3rd | version ${previous} → ${manifest.version}`);
