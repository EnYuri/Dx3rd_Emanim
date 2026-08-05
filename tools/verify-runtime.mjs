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

function walkFiles(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path, extensions);
    return entry.isFile() && extensions.some(extension => entry.name.endsWith(extension)) ? [path] : [];
  });
}

/**
 * 문서 스키마는 template.json(V16 에서 제거)이 아니라 런타임 스크립트가 들고 있다.
 * 그 스크립트는 로드 시점에 window 와 Hooks 만 건드리므로(foundry/CONFIG 는 register()
 * 안에서만 쓴다) 껍데기 둘만 주면 스키마를 그대로 꺼낼 수 있다.
 */
function loadDocumentSchema() {
  const path = join(root, "scripts", "data", "document-schema.js");
  if (!requireFile(path, "Document schema script")) return null;
  const sandbox = {};
  try {
    new Function("window", "Hooks", readFileSync(path, "utf8"))(sandbox, { once() {} });
  } catch (error) {
    fail(`scripts/data/document-schema.js failed to evaluate: ${error.message}`);
    return null;
  }
  if (!sandbox.DX3rdDocumentSchema) {
    fail("scripts/data/document-schema.js must expose window.DX3rdDocumentSchema");
    return null;
  }
  return sandbox.DX3rdDocumentSchema;
}

const manifest = readJson(join(root, "system.json"));
const schema = loadDocumentSchema();
const locale = readJson(join(root, "lang", "ko.json"));

if (!manifest || !schema || !locale) process.exit(1);

if (existsSync(join(root, "template.json"))) {
  fail("template.json is deprecated (removed in V16); the schema lives in scripts/data/document-schema.js");
}

// system.json 의 서브타입 선언과 스키마가 갈리면 그 타입 문서는 만들 수 없거나 정리되지 않는다.
for (const kind of ["Actor", "Item"]) {
  const declared = Object.keys(manifest.documentTypes?.[kind] ?? {});
  const defined = schema[kind]?.types ?? [];
  for (const type of defined) {
    if (!declared.includes(type)) fail(`system.json documentTypes.${kind} is missing "${type}"`);
    if (!schema[kind][type]) fail(`document-schema.js ${kind}.types lists "${type}" without a definition`);
  }
  for (const type of declared) {
    if (!defined.includes(type)) fail(`document-schema.js ${kind}.types is missing "${type}"`);
  }
}

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

const runtimeScripts = walkJavaScript(join(root, "scripts"));
const declaredScripts = new Set((manifest.scripts ?? []).map(path => path.replaceAll("\\", "/")));
for (const path of runtimeScripts) {
  const runtimePath = relative(root, path).replaceAll("\\", "/");
  if (!declaredScripts.has(runtimePath)) fail(`Runtime script is not declared in system.json: ${runtimePath}`);
}

const requiredOrder = [
  ["scripts/core/runtime-utils.js", "scripts/socket-router.js"],
  ["scripts/socket-router.js", "scripts/socket-contracts.js"],
  ["scripts/combat/combat.js", "scripts/combat/combat-socket.js"],
  ["scripts/socket-router.js", "scripts/handlers/universal-after-main.js"],
  ["scripts/handlers/universal-after-main.js", "scripts/dialog/after-main-queue-manager.js"],
  ["scripts/handlers/universal-handler.js", "scripts/socket-document-handlers.js"],
  ["scripts/chat-message-types.js", "scripts/main.js"]
];
for (const [before, after] of requiredOrder) {
  if ((manifest.scripts?.indexOf(before) ?? -1) >= (manifest.scripts?.indexOf(after) ?? -1)) {
    fail(`system.json must load ${before} before ${after}`);
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
for (const path of runtimeScripts) {
  const source = readFileSync(path, "utf8");
  const runtimePath = relative(root, path).replaceAll("\\", "/");
  if (runtimePath !== "scripts/socket-router.js" && source.includes("game.socket.emit(")) {
    fail(`Direct game.socket.emit must use DX3rdSocketRouter.emit: ${runtimePath}`);
  }
  for (const match of source.matchAll(i18nPattern)) {
    checkedI18nReferences++;
    if (!Object.hasOwn(locale, match[1])) {
      fail(`Missing ko.json key ${match[1]} referenced by ${relative(root, path)}`);
    }
  }
}

const templateI18nPattern = /{{\s*localize\s+["'](DX3rd\.[^"']+)["']/g;
for (const path of walkFiles(join(root, "templates"), [".html", ".hbs"])) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(templateI18nPattern)) {
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
