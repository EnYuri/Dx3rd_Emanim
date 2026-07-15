#!/usr/bin/env node
/**
 * Read-only structural verification for the public Foundry runtime.
 *
 * This script never launches Foundry, accesses a world, rebuilds packs, or
 * writes any project file. It is deliberately safe to run while developing.
 *
 * Usage: node tools/verify-runtime.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
let checkedScripts = 0;
let checkedI18nReferences = 0;

function fail(message) {
  errors.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relative(root, path)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function requireFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing: ${relative(root, path)}`);
    return false;
  }
  if (!statSync(path).isFile()) {
    fail(`${label} is not a file: ${relative(root, path)}`);
    return false;
  }
  return true;
}

function walkJavaScript(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScript(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  });
}

const manifest = readJson(join(root, "system.json"));
const template = readJson(join(root, "template.json"));
const locale = readJson(join(root, "lang", "ko.json"));

if (!manifest || !template || !locale) process.exit(1);

for (const field of ["scripts", "styles"]) {
  if (!Array.isArray(manifest[field])) {
    fail(`system.json ${field} must be an array.`);
    continue;
  }
  const seen = new Set();
  for (const entry of manifest[field]) {
    if (seen.has(entry)) fail(`system.json ${field} contains a duplicate entry: ${entry}`);
    seen.add(entry);
    requireFile(resolve(root, entry), `Declared ${field.slice(0, -1)}`);
  }
}

// Foundry loads these classic scripts directly. Syntax checking is the only
// executable check here; no document class, hook, or global is evaluated.
for (const script of manifest.scripts ?? []) {
  const path = resolve(root, script);
  if (!existsSync(path)) continue;
  checkedScripts++;
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`JavaScript syntax error in ${script}: ${(result.stderr || result.stdout).trim()}`);
  }
}

// Report only literal keys: computed keys are intentional runtime behavior and
// must remain outside this read-only verifier's authority.
const i18nPattern = /(?:game\.)?i18n\.(?:localize|format)\(\s*["'](DX3rd\.[^"']+)["']/g;
for (const path of walkJavaScript(join(root, "scripts"))) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(i18nPattern)) {
    checkedI18nReferences++;
    if (!Object.hasOwn(locale, match[1])) {
      fail(`Missing ko.json key ${match[1]} referenced by ${relative(root, path)}`);
    }
  }
}

if (errors.length) {
  console.error("DX3rd | runtime verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`DX3rd | runtime verification passed (${checkedScripts} declared scripts, ${checkedI18nReferences} literal i18n references).`);
