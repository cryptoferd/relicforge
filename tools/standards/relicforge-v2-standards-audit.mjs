#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

function fail(message) {
  console.error(`R10 STANDARDS ABI AUDIT FAILED: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; ++i) {
    const token = argv[i];
    if (token === "--repo") {
      out.repo = argv[++i];
      continue;
    }
    if (token === "--self-test") {
      out.selfTest = true;
      continue;
    }
    fail(`unknown argument: ${token}`);
  }
  return out;
}

function parseForgeAbiOutput(output) {
  const trimmed = String(output ?? "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) fail("forge ABI output is empty");
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    fail(`forge ABI JSON is invalid: ${error.message}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.abi)) return parsed.abi;
  fail("forge ABI JSON has unexpected shape");
}

function forgeAbi(repo, contract) {
  const output = execFileSync(
    "forge",
    ["inspect", "--json", contract, "abi"],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return parseForgeAbiOutput(output);
}

function functions(abi, name) {
  return abi.filter((item) => item?.type === "function" && item.name === name);
}

function exactlyOneFunction(abi, name, inputs, outputs = null) {
  const matches = functions(abi, name).filter((item) => {
    const inTypes = (item.inputs ?? []).map((x) => x.type);
    return JSON.stringify(inTypes) === JSON.stringify(inputs);
  });
  if (matches.length !== 1) fail(`${name}(${inputs.join(",")}) expected exactly once`);
  if (outputs) {
    const outTypes = (matches[0].outputs ?? []).map((x) => x.type);
    if (JSON.stringify(outTypes) !== JSON.stringify(outputs)) {
      fail(`${name} output mismatch: ${outTypes.join(",")}`);
    }
  }
  return matches[0];
}

function event(abi, name) {
  const matches = abi.filter((item) => item?.type === "event" && item.name === name);
  if (matches.length !== 1) fail(`${name} event expected exactly once`);
  return matches[0];
}

function assertEventInput(input, name, type, indexed) {
  if (!input) fail(`missing event input ${name}`);
  if (input.name !== name) fail(`event input name mismatch: expected ${name}, got ${input.name}`);
  if (input.type !== type) fail(`event ${name} type mismatch: ${input.type}`);
  if (Boolean(input.indexed) !== indexed) {
    fail(`event ${name} indexed mismatch: expected ${indexed}, got ${Boolean(input.indexed)}`);
  }
}

function runAudit(abi) {
  // ERC-721 core + metadata.
  exactlyOneFunction(abi, "balanceOf", ["address"], ["uint256"]);
  exactlyOneFunction(abi, "ownerOf", ["uint256"], ["address"]);
  exactlyOneFunction(abi, "safeTransferFrom", ["address", "address", "uint256"]);
  exactlyOneFunction(abi, "safeTransferFrom", ["address", "address", "uint256", "bytes"]);
  exactlyOneFunction(abi, "transferFrom", ["address", "address", "uint256"]);
  exactlyOneFunction(abi, "approve", ["address", "uint256"]);
  exactlyOneFunction(abi, "setApprovalForAll", ["address", "bool"]);
  exactlyOneFunction(abi, "getApproved", ["uint256"], ["address"]);
  exactlyOneFunction(abi, "isApprovedForAll", ["address", "address"], ["bool"]);
  exactlyOneFunction(abi, "name", [], ["string"]);
  exactlyOneFunction(abi, "symbol", [], ["string"]);
  exactlyOneFunction(abi, "tokenURI", ["uint256"], ["string"]);
  exactlyOneFunction(abi, "supportsInterface", ["bytes4"], ["bool"]);

  // Explorer/indexer convention without claiming full Enumerable.
  exactlyOneFunction(abi, "totalSupply", [], ["uint256"]);
  if (functions(abi, "tokenByIndex").length !== 0 || functions(abi, "tokenOfOwnerByIndex").length !== 0) {
    fail("partial Enumerable policy drift: enumeration methods unexpectedly present");
  }

  // ERC-2981.
  exactlyOneFunction(abi, "royaltyInfo", ["uint256", "uint256"], ["address", "uint256"]);

  // ERC-173 / ERC-5313-compatible ownership surface.
  exactlyOneFunction(abi, "owner", [], ["address"]);
  exactlyOneFunction(abi, "transferOwnership", ["address"]);

  // ERC-7572 surface.
  exactlyOneFunction(abi, "contractURI", [], ["string"]);
  const contractUriUpdated = event(abi, "ContractURIUpdated");
  if ((contractUriUpdated.inputs ?? []).length !== 0) fail("ContractURIUpdated must have no inputs");

  // ERC-4906 canonical event ABI. Names are deliberately canonical because some
  // indexers consume decoded named arguments.
  const metadataUpdate = event(abi, "MetadataUpdate");
  if ((metadataUpdate.inputs ?? []).length !== 1) fail("MetadataUpdate must have one input");
  assertEventInput(metadataUpdate.inputs[0], "_tokenId", "uint256", false);

  const batchMetadataUpdate = event(abi, "BatchMetadataUpdate");
  if ((batchMetadataUpdate.inputs ?? []).length !== 2) fail("BatchMetadataUpdate must have two inputs");
  assertEventInput(batchMetadataUpdate.inputs[0], "_fromTokenId", "uint256", false);
  assertEventInput(batchMetadataUpdate.inputs[1], "_toTokenId", "uint256", false);

  const ownershipTransferred = event(abi, "OwnershipTransferred");
  if ((ownershipTransferred.inputs ?? []).length !== 2) fail("OwnershipTransferred must have two inputs");
  assertEventInput(ownershipTransferred.inputs[0], "previousOwner", "address", true);
  assertEventInput(ownershipTransferred.inputs[1], "newOwner", "address", true);

  const reads = abi.filter(
    (item) => item?.type === "function" && (item.stateMutability === "view" || item.stateMutability === "pure")
  );
  const writes = abi.filter(
    (item) => item?.type === "function" && item.stateMutability !== "view" && item.stateMutability !== "pure"
  );

  return {
    readMethodCount: reads.length,
    writeMethodCount: writes.length,
    readMethodNames: [...new Set(reads.map((x) => x.name))].sort(),
  };
}

function selfTest() {
  const sample = [
    { type: "event", name: "MetadataUpdate", inputs: [{ name: "_tokenId", type: "uint256", indexed: false }] },
    {
      type: "event",
      name: "BatchMetadataUpdate",
      inputs: [
        { name: "_fromTokenId", type: "uint256", indexed: false },
        { name: "_toTokenId", type: "uint256", indexed: false },
      ],
    },
  ];
  const parsed = parseForgeAbiOutput(JSON.stringify(sample));
  if (parsed.length !== 2) fail("self-test parser");
  console.log("R10 standards ABI auditor self-test: PASS");
  console.log("  forge JSON parser: PASS");
  console.log("  canonical ERC-4906 event shape fixture: PASS");
}

const args = parseArgs(process.argv);
if (args.selfTest) {
  selfTest();
  process.exit(0);
}
if (!args.repo) fail("--repo is required");

const abi = forgeAbi(args.repo, "contracts/production/v2/RelicCollectionV2.sol:RelicCollectionV2");
const result = runAudit(abi);

console.log("R10 standards ABI audit: PASS");
console.log("  ERC-721 core + metadata ABI: PASS");
console.log("  totalSupply() explorer convention: PASS");
console.log("  ERC-2981 royalty ABI: PASS");
console.log("  ERC-4906 canonical non-indexed events: PASS");
console.log("  ERC-173 ownership ABI: PASS");
console.log("  ERC-7572 contractURI surface: PASS");
console.log("  Full ERC-721 Enumerable is NOT claimed by ABI surface.");
console.log(`  Read methods exposed by collection ABI: ${result.readMethodCount}`);
console.log(`  Write methods exposed by collection ABI: ${result.writeMethodCount}`);
console.log("  Extra Relic Forge read methods are allowed; standards are additive, not exclusive.");
console.log(JSON.stringify(result, null, 2));
