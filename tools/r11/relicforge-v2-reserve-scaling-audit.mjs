#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`R11 RESERVE/REVENUE AUDIT FAILED: ${message}`);
  process.exit(1);
}
function read(p) {
  return fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
}
function findFunctionBlock(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) fail(`function ${name} not found`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  fail(`function ${name} unterminated`);
}

const idx = process.argv.indexOf("--repo");
if (idx < 0 || !process.argv[idx + 1]) fail("usage: --repo <repo>");
const repo = path.resolve(process.argv[idx + 1]);

const collection = read(path.join(repo, "contracts/production/v2/RelicCollectionV2.sol"));
const reserve = read(path.join(repo, "contracts/production/v2/RelicForgeReserveV2.sol"));

const requiredSync = "IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this));";
for (const name of ["_mintDeferred", "_queueForgeReservation"]) {
  const block = findFunctionBlock(collection, name);
  if (!block.includes(requiredSync) || block.includes("try IRelicForgeReserveV2Prod")) {
    fail(`${name}: liability-increase sync is not mandatory`);
  }
}

const release = findFunctionBlock(reserve, "releaseRevenue");
if (release.includes("_syncCollection") || release.includes("collections[") || /\bfor\s*\(/.test(release)) {
  fail("releaseRevenue contains collection-scaling work");
}
if (!release.includes("revenueTreasury.call{value: amount}") &&
    !release.includes("treasury.call{value: amount}")) {
  fail("releaseRevenue does not pay only configured treasury");
}
if (release.includes("address payable treasury_") || release.includes("address recipient")) {
  fail("releaseRevenue has caller-selectable destination");
}

if (reserve.includes("function syncAllCollections(")) fail("unbounded syncAllCollections remains");
if (!reserve.includes("MAX_SYNC_COLLECTIONS_PER_CALL = 64")) fail("bounded maintenance cap missing");

for (const name of [
  "registerCollection",
  "syncCollection",
  "pullCollectionExcess",
  "fundRandomnessShortfall",
  "setReservePolicy",
  "proposeRevenueTreasury",
  "acceptRevenueTreasury",
  "proposeFounder",
  "acceptFounder"
]) {
  const block = findFunctionBlock(reserve, name);
  if (!block.slice(0, block.indexOf("{")).includes("reserveUnlocked")) {
    fail(`${name}: reserveUnlocked missing`);
  }
}

if (reserve.includes("function setRevenueTreasury(")) fail("legacy one-step treasury setter remains");
if (reserve.includes("function transferFounder(")) fail("legacy one-step founder setter remains");

const proposeTreasury = findFunctionBlock(reserve, "proposeRevenueTreasury");
const acceptTreasury = findFunctionBlock(reserve, "acceptRevenueTreasury");
const proposeFounder = findFunctionBlock(reserve, "proposeFounder");
const acceptFounder = findFunctionBlock(reserve, "acceptFounder");

if (!proposeTreasury.slice(0, proposeTreasury.indexOf("{")).includes("onlyFounder")) {
  fail("treasury proposal is not founder-only");
}
if (!acceptTreasury.includes("msg.sender != pending")) {
  fail("treasury acceptance is not destination-authenticated");
}
if (!proposeFounder.slice(0, proposeFounder.indexOf("{")).includes("onlyFounder")) {
  fail("founder proposal is not founder-only");
}
if (!acceptFounder.includes("msg.sender != pending")) {
  fail("founder acceptance is not target-authenticated");
}
if (!acceptFounder.includes("pendingRevenueTreasury = payable(address(0))")) {
  fail("old founder pending treasury proposal survives ownership handoff");
}

console.log("R11 Reserve + revenue security source audit: PASS");
console.log("  releaseRevenue: O(1), configured destination only");
console.log("  treasury redirection: two-step, target acceptance required");
console.log("  founder transfer: two-step, target acceptance required");
console.log("  one-step redirect/ownership bypass selectors: ABSENT");
console.log("  liability-increase push sync: MANDATORY");
console.log("  maintenance sync cap: 64");
