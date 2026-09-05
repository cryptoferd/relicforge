#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && p.endsWith(".sol")) out.push(p);
  }
  return out;
}
function rel(repo, p) { return path.relative(repo, p).replaceAll("\\", "/"); }
function matches(source, regex) {
  const found = [];
  for (const m of source.matchAll(regex)) {
    found.push({
      line: source.slice(0, m.index).split("\n").length,
      text: m[0].replace(/\s+/g, " ").trim()
    });
  }
  return found;
}

const idx = process.argv.indexOf("--repo");
if (idx < 0 || !process.argv[idx + 1]) {
  console.error("usage: node relicforge-r11-r4-attack-surface.mjs --repo <repo>");
  process.exit(2);
}
const repo = path.resolve(process.argv[idx + 1]);
const prod = path.join(repo, "contracts", "production");
const files = walk(prod);

const surfaces = [
  ["tx.origin", /\btx\.origin\b/g],
  ["delegatecall", /\.delegatecall\b/g],
  ["selfdestruct", /\bselfdestruct\s*\(/g],
  ["low-level call", /\.call\s*(?:\{[^}]*\})?\s*\(/g],
  ["assembly", /\bassembly\b/g],
  ["ecrecover", /\becrecover\s*\(/g],
  ["blockhash", /\bblockhash\s*\(/g],
  ["prevrandao", /\bblock\.prevrandao\b/g],
  ["create2", /\bcreate2\b/g],
];

let critical = 0;
let warnings = 0;

console.log("=== R11 R4 PRODUCTION ATTACK-SURFACE SCAN ===");

for (const file of files) {
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [label, regex] of surfaces) {
    for (const hit of matches(source, regex)) {
      console.log(`[SURFACE] ${label}: ${rel(repo, file)}:${hit.line} :: ${hit.text}`);
      warnings++;
    }
  }
}

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const [label, regex] of [
    ["tx.origin", /\btx\.origin\b/],
    ["delegatecall", /\.delegatecall\b/],
    ["selfdestruct", /\bselfdestruct\s*\(/],
  ]) {
    if (regex.test(source)) {
      console.error(`[CRITICAL] forbidden primitive ${label} in ${rel(repo, file)}`);
      critical++;
    }
  }
}

const feePolicyPath = path.join(prod, "RelicForgeFeePolicyV1.sol");
if (fs.existsSync(feePolicyPath)) {
  const fee = fs.readFileSync(feePolicyPath, "utf8");

  if (
    !fee.includes("pendingTreasury") ||
    !fee.includes("function acceptTreasury()") ||
    !fee.includes("pendingTreasury = treasury_")
  ) {
    console.error("[CRITICAL] FeePolicy treasury rotation is not two-step.");
    critical++;
  }

  if (
    !fee.includes("pendingPlatformAdmin") ||
    !fee.includes("function acceptPlatformAdmin()") ||
    !fee.includes("pendingPlatformAdmin = newAdmin")
  ) {
    console.error("[CRITICAL] FeePolicy platform-admin rotation is not two-step.");
    critical++;
  }

  if (!fee.includes("pendingTreasury = address(0)")) {
    console.error("[CRITICAL] FeePolicy old-admin pending treasury proposal is not cleared.");
    critical++;
  }
}

const reservePath = path.join(prod, "v2", "RelicForgeReserveV2.sol");
if (fs.existsSync(reservePath)) {
  const reserve = fs.readFileSync(reservePath, "utf8");

  if (/function\s+setRevenueTreasury\s*\(/.test(reserve)) {
    console.error("[CRITICAL] Reserve one-step treasury setter remains.");
    critical++;
  }
  if (/function\s+transferFounder\s*\(/.test(reserve)) {
    console.error("[CRITICAL] Reserve one-step founder transfer remains.");
    critical++;
  }

  for (const required of [
    "proposeRevenueTreasury",
    "acceptRevenueTreasury",
    "proposeFounder",
    "acceptFounder",
    "syncCollections"
  ]) {
    if (!new RegExp(`function\\s+${required}\\s*\\(`).test(reserve)) {
      console.error(`[CRITICAL] Reserve expected R11 function missing: ${required}`);
      critical++;
    }
  }
}

console.log("\n=== PUBLIC/EXTERNAL MUTATOR INVENTORY ===");
for (const file of files) {
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const regex =
    /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*([^{};]*\b(?:external|public)\b[^{};]*)\{/g;

  for (const m of source.matchAll(regex)) {
    const sig = `${m[1]}(...) ${m[2].replace(/\s+/g, " ").trim()}`;
    const lower = sig.toLowerCase();
    if (lower.includes(" view") || lower.includes(" pure")) continue;

    const line = source.slice(0, m.index).split("\n").length;
    console.log(`[MUTATOR] ${rel(repo, file)}:${line} :: ${sig}`);
  }
}

console.log("\n=== SCAN SUMMARY ===");
console.log(`Production Solidity files: ${files.length}`);
console.log(`Critical findings: ${critical}`);
console.log(`Surfaces / hardening warnings: ${warnings}`);

if (critical !== 0) process.exit(1);
