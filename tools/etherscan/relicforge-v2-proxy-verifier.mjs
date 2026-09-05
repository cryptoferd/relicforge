#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ETHERSCAN_API = "https://api.etherscan.io/v2/api";
const EIP1167_PREFIX = "363d3d373d3d3d363d73";
const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

const FREE_TIER_DEFAULT_MIN_INTERVAL_MS = 1100;
const configuredInterval = Number(
  process.env.ETHERSCAN_MIN_INTERVAL_MS ?? FREE_TIER_DEFAULT_MIN_INTERVAL_MS
);
const ETHERSCAN_MIN_INTERVAL_MS =
  Number.isFinite(configuredInterval) && configuredInterval >= 350
    ? Math.floor(configuredInterval)
    : FREE_TIER_DEFAULT_MIN_INTERVAL_MS;

let lastEtherscanRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEtherscanSlot() {
  const elapsed = Date.now() - lastEtherscanRequestAt;
  const waitMs = ETHERSCAN_MIN_INTERVAL_MS - elapsed;
  if (waitMs > 0) await sleep(waitMs);
  lastEtherscanRequestAt = Date.now();
}

async function etherscanFetch(url, options = undefined, label = "request") {
  let lastError;
  for (let attempt = 1; attempt <= 5; ++attempt) {
    await waitForEtherscanSlot();
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`Etherscan ${label} HTTP ${response.status}`);
        if (attempt < 5) {
          await sleep(4000 * attempt);
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await sleep(4000 * attempt);
        continue;
      }
    }
  }
  throw lastError ?? new Error(`Etherscan ${label} failed`);
}

const REQUIRED_METHODS = Object.freeze({
  collection: [
    "name",
    "symbol",
    "mint",
    "creatorMint",
    "requestDelayedReveal",
    "requestRandomnessForBatch",
    "settleReady",
    "recipeForToken",
    "isRevealed",
    "mintPhases",
    "dataContract",
    "tokenURI",
    "withdraw",
  ],
  projectData: [
    "addArtShard",
    "addDnaShard",
    "setDNAConfig",
    "validateNextRecipes",
    "sealContent",
    "readRecipe",
    "contentSealed",
    "provenanceHash",
  ],
  mintPhases: [
    "createPhase",
    "updatePhase",
    "setPhaseEnabled",
    "setMasterMintEnabled",
    "phaseIsOpen",
    "phaseWalletMinted",
  ],
});

function fail(message) {
  throw new Error(message);
}

function normalizeHex(value) {
  if (typeof value !== "string") fail("Expected hex string.");
  const raw = value.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(raw) || raw.length % 2 !== 0) fail("Malformed hex.");
  return raw;
}

function normalizeAddress(value, label = "address") {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail(`Invalid ${label}: ${value ?? "<missing>"}`);
  }
  return `0x${value.slice(2).toLowerCase()}`;
}

export function expectedMinimalProxyRuntime(implementation) {
  const impl = normalizeAddress(implementation, "implementation").slice(2);
  return `0x${EIP1167_PREFIX}${impl}${EIP1167_SUFFIX}`;
}

export function extractMinimalProxyImplementation(runtimeCode) {
  const raw = normalizeHex(runtimeCode);
  if (raw.length !== 90) fail(`Expected 45-byte EIP-1167 runtime, got ${raw.length / 2} bytes.`);
  if (!raw.startsWith(EIP1167_PREFIX) || !raw.endsWith(EIP1167_SUFFIX)) {
    fail("Runtime is not the canonical EIP-1167 minimal-proxy form used by Relic Forge.");
  }
  return `0x${raw.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40)}`;
}

function parseAbiJson(value, label) {
  if (typeof value === "string") {
    const trimmed = value.replace(/^\uFEFF/, "").trim();
    if (!trimmed || trimmed === "Contract source code not verified") {
      fail(`${label} ABI is unavailable; verify the implementation source first.`);
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      fail(`${label} ABI is not valid JSON: ${error.message}`);
    }
  }
  if (Array.isArray(value)) return value;
  fail(`${label} ABI has unexpected shape.`);
}

export function assertAbiMethods(abiLike, required, label) {
  const abi = parseAbiJson(abiLike, label);
  const methods = new Set(
    abi.filter((entry) => entry && entry.type === "function" && typeof entry.name === "string")
      .map((entry) => entry.name)
  );
  const missing = required.filter((name) => !methods.has(name));
  if (missing.length) fail(`${label} ABI is missing methods: ${missing.join(", ")}`);
  return methods;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; ++i) {
    const token = argv[i];
    if (token === "--self-test") {
      args.selfTest = true;
      continue;
    }
    if (token === "--check-repo-abis") {
      args.checkRepoAbis = true;
      continue;
    }
    if (token === "--allow-pending") {
      args.allowPending = true;
      continue;
    }
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) fail(`Missing value for --${key}`);
    args[key] = argv[++i];
  }
  return args;
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) fail(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) fail(`RPC ${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

function etherscanUrl(apiKey, chainId, action, extra = {}) {
  const url = new URL(ETHERSCAN_API);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, String(value));
  return url;
}

async function etherscanGet(apiKey, chainId, action, extra = {}) {
  const response = await etherscanFetch(etherscanUrl(apiKey, chainId, action, extra), undefined, action);
  if (!response.ok) fail(`Etherscan ${action} HTTP ${response.status}`);
  return response.json();
}

async function getAbi(apiKey, chainId, address, label) {
  const body = await etherscanGet(apiKey, chainId, "getabi", { address });
  if (body.status !== "1") fail(`${label} ABI unavailable on Etherscan: ${body.result ?? body.message}`);
  return parseAbiJson(body.result, label);
}

async function getSourceRecord(apiKey, chainId, address, label) {
  const body = await etherscanGet(apiKey, chainId, "getsourcecode", { address });
  if (body.status !== "1" || !Array.isArray(body.result) || body.result.length === 0) {
    fail(`${label} source record unavailable on Etherscan: ${body.result ?? body.message}`);
  }
  return body.result[0];
}

function sourceAbiIfAvailable(source, label) {
  if (!source || typeof source !== "object") return null;
  const raw = source.ABI;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || /not verified/i.test(trimmed)) return null;
  try {
    return parseAbiJson(trimmed, label);
  } catch {
    return null;
  }
}

async function readEip1167ExplorerState(apiKey, chainId, proxy, implementation, requiredMethods, label) {
  const body = await etherscanGet(apiKey, chainId, "getsourcecode", { address: proxy });
  if (body.status !== "1" || !Array.isArray(body.result) || body.result.length === 0) {
    return {
      ready: false,
      reason: `Etherscan source metadata unavailable: ${String(body.result ?? body.message ?? "unknown")}`,
    };
  }

  const source = body.result[0] ?? {};
  const reportedImplementationRaw = String(source.Implementation ?? "").trim();

  // EIP-1167 proves the immutable target from runtime bytecode. If Etherscan independently
  // reports an implementation, it must agree. Blank is acceptable while clone auto-indexing catches up.
  if (reportedImplementationRaw) {
    const reportedImplementation = normalizeAddress(
      reportedImplementationRaw,
      `${label} Etherscan implementation`
    );
    if (reportedImplementation !== implementation) {
      fail(
        `${label} Etherscan implementation mismatch: ${reportedImplementation} != ${implementation}`
      );
    }
  }

  const abi = sourceAbiIfAvailable(source, `${label} Etherscan clone`);
  if (!abi) {
    return {
      ready: false,
      reason: "Etherscan has not exposed an ABI for this EIP-1167 clone yet",
      proxyFlag: String(source.Proxy ?? ""),
      implementationField: reportedImplementationRaw,
      similarMatch: String(source.SimilarMatch ?? ""),
    };
  }

  try {
    assertAbiMethods(abi, requiredMethods, `${label} Etherscan clone`);
  } catch (error) {
    return {
      ready: false,
      reason: error.message,
      proxyFlag: String(source.Proxy ?? ""),
      implementationField: reportedImplementationRaw,
      similarMatch: String(source.SimilarMatch ?? ""),
    };
  }

  return {
    ready: true,
    reason: "Etherscan clone ABI is visible",
    proxyFlag: String(source.Proxy ?? ""),
    implementationField: reportedImplementationRaw,
    similarMatch: String(source.SimilarMatch ?? ""),
  };
}

async function waitForEip1167ExplorerRecognition(
  apiKey,
  chainId,
  proxy,
  implementation,
  requiredMethods,
  label,
  attempts,
  delayMs
) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; ++attempt) {
    last = await readEip1167ExplorerState(
      apiKey,
      chainId,
      proxy,
      implementation,
      requiredMethods,
      label
    );

    if (last.ready) return last;

    if (attempt < attempts) {
      console.log(
        `${label}: Etherscan EIP-1167 auto-recognition pending (${attempt}/${attempts}): ${last.reason}`
      );
      await sleep(delayMs);
    }
  }
  return last ?? { ready: false, reason: "No Etherscan status returned" };
}

async function preflightClone(rpcUrl, proxy, expectedImplementation, label) {
  const code = await rpc(rpcUrl, "eth_getCode", [proxy, "latest"]);
  if (!code || code === "0x") fail(`${label} has no runtime code.`);
  const actual = normalizeAddress(extractMinimalProxyImplementation(code), `${label} implementation`);
  const expected = normalizeAddress(expectedImplementation, `${label} expected implementation`);
  if (actual !== expected) fail(`${label} points to ${actual}, expected ${expected}.`);

  const implementationCode = await rpc(rpcUrl, "eth_getCode", [expected, "latest"]);
  if (!implementationCode || implementationCode === "0x") fail(`${label} implementation has no runtime code.`);
}

async function verifyOne({
  apiKey,
  chainId,
  rpcUrl,
  label,
  proxy,
  implementation,
  requiredMethods,
  allowPending,
  explorerAttempts,
  explorerDelayMs,
}) {
  proxy = normalizeAddress(proxy, `${label} proxy`);
  implementation = normalizeAddress(implementation, `${label} implementation`);

  // This is the security-critical linkage check for EIP-1167:
  // the immutable 45-byte runtime itself contains the implementation address.
  await preflightClone(rpcUrl, proxy, implementation, label);

  // The shared implementation must be source-verified on Etherscan.
  const implementationAbi = await getAbi(apiKey, chainId, implementation, `${label} implementation`);
  assertAbiMethods(implementationAbi, requiredMethods, `${label} implementation`);

  // Etherscan's verifyproxycontract endpoint attempts to DETECT an implementation.
  // expectedimplementation only enforces the detected address; it does not inject a target.
  // For canonical ERC/EIP-1167 clones, Etherscan normally recognizes the implementation
  // directly from the standardized runtime once the implementation is verified.
  const explorer = await waitForEip1167ExplorerRecognition(
    apiKey,
    chainId,
    proxy,
    implementation,
    requiredMethods,
    label,
    explorerAttempts,
    explorerDelayMs
  );

  if (!explorer.ready && !allowPending) {
    fail(`${label} Etherscan EIP-1167 recognition still pending: ${explorer.reason}`);
  }

  return {
    label,
    proxy,
    implementation,
    onchainEip1167Linkage: true,
    implementationSourceVerified: true,
    explorerAbiVisible: explorer.ready,
    explorerStatus: explorer.ready ? "verified" : "pending",
    explorerReason: explorer.reason,
  };
}

function parseForgeAbiOutput(output, label) {
  const trimmed = String(output ?? "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) fail(`${label} forge ABI output is empty.`);

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    fail(`${label} forge ABI JSON is invalid: ${error.message}`);
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.abi)) return parsed.abi;
  fail(`${label} forge ABI JSON has unexpected shape.`);
}

function forgeAbi(repo, contract) {
  const output = execFileSync(
    "forge",
    ["inspect", "--json", contract, "abi"],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return parseForgeAbiOutput(output, contract);
}

function checkRepoAbis(repo) {
  const collectionAbi = forgeAbi(repo, "contracts/production/v2/RelicCollectionV2.sol:RelicCollectionV2");
  const dataAbi = forgeAbi(repo, "contracts/production/RelicProjectDataV1.sol:RelicProjectDataV1");
  const phasesAbi = forgeAbi(repo, "contracts/production/v2/RelicMintPhasesV2.sol:RelicMintPhasesV2");

  assertAbiMethods(collectionAbi, REQUIRED_METHODS.collection, "compiled RelicCollectionV2");
  assertAbiMethods(dataAbi, REQUIRED_METHODS.projectData, "compiled RelicProjectDataV1");
  assertAbiMethods(phasesAbi, REQUIRED_METHODS.mintPhases, "compiled RelicMintPhasesV2");

  console.log("Compiled ABI visibility: PASS");
  console.log(`  Collection methods required: ${REQUIRED_METHODS.collection.join(", ")}`);
  console.log(`  ProjectData methods required: ${REQUIRED_METHODS.projectData.join(", ")}`);
  console.log(`  MintPhases methods required: ${REQUIRED_METHODS.mintPhases.join(", ")}`);
}

function selfTest() {
  const impl = "0x1234567890abcdef1234567890abcdef12345678";
  const runtime = expectedMinimalProxyRuntime(impl);
  const extracted = extractMinimalProxyImplementation(runtime);
  if (extracted !== impl) fail("EIP-1167 extraction self-test failed.");

  let rejected = false;
  try {
    extractMinimalProxyImplementation("0x60006000");
  } catch {
    rejected = true;
  }
  if (!rejected) fail("Malformed proxy runtime was not rejected.");

  const sampleAbi = [
    { type: "function", name: "mint" },
    { type: "function", name: "settleReady" },
  ];
  assertAbiMethods(sampleAbi, ["mint", "settleReady"], "sample");

  const forgeArray = parseForgeAbiOutput(JSON.stringify(sampleAbi), "forge-array");
  assertAbiMethods(forgeArray, ["mint", "settleReady"], "forge-array");

  const forgeObject = parseForgeAbiOutput(JSON.stringify({ abi: sampleAbi }), "forge-object");
  assertAbiMethods(forgeObject, ["mint", "settleReady"], "forge-object");

  rejected = false;
  try {
    assertAbiMethods(sampleAbi, ["mint", "recipeForToken"], "sample");
  } catch {
    rejected = true;
  }
  if (!rejected) fail("Missing ABI method was not rejected.");

  console.log("Relic Forge V2 Etherscan verifier self-test: PASS");
  console.log("  canonical EIP-1167 extraction: PASS");
  console.log("  malformed runtime rejection: PASS");
  console.log("  required ABI method enforcement: PASS");
  console.log("  forge --json ABI parser: PASS");
  console.log(`  Etherscan pacing: PASS (${ETHERSCAN_MIN_INTERVAL_MS}ms minimum interval)`);
  console.log("  EIP-1167 strategy: runtime linkage + explorer auto-recognition (no verifyproxycontract submission)");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    selfTest();
    return;
  }

  if (args.checkRepoAbis) {
    const repo = args.repo ?? process.cwd();
    checkRepoAbis(repo);
    return;
  }

  const chainId = Number(args["chain-id"]);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) fail("--chain-id is required.");

  const rpcUrl = args["rpc-url"] ?? process.env.SEPOLIA_RPC_URL ?? process.env.RPC_URL;
  if (!rpcUrl) fail("--rpc-url, SEPOLIA_RPC_URL, or RPC_URL is required.");

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) fail("ETHERSCAN_API_KEY is required. It is read only from the environment.");

  const rpcChain = Number(BigInt(await rpc(rpcUrl, "eth_chainId")));
  if (rpcChain !== chainId) fail(`RPC chain ID ${rpcChain} does not match requested chain ID ${chainId}.`);

  const jobs = [
    {
      label: "Collection",
      proxy: args.collection,
      implementation: args["collection-implementation"],
      requiredMethods: REQUIRED_METHODS.collection,
    },
    {
      label: "ProjectData",
      proxy: args["project-data"],
      implementation: args["data-implementation"],
      requiredMethods: REQUIRED_METHODS.projectData,
    },
    {
      label: "MintPhases",
      proxy: args["mint-phases"],
      implementation: args["mint-phases-implementation"],
      requiredMethods: REQUIRED_METHODS.mintPhases,
    },
  ];

  const allowPending = Boolean(args.allowPending);
  const explorerAttemptsRaw = Number(process.env.ETHERSCAN_EIP1167_POLL_ATTEMPTS ?? 8);
  const explorerDelayRaw = Number(process.env.ETHERSCAN_EIP1167_POLL_DELAY_MS ?? 5000);
  const explorerAttempts =
    Number.isSafeInteger(explorerAttemptsRaw) && explorerAttemptsRaw > 0 ? explorerAttemptsRaw : 8;
  const explorerDelayMs =
    Number.isFinite(explorerDelayRaw) && explorerDelayRaw >= 1000 ? explorerDelayRaw : 5000;

  const results = [];
  for (const job of jobs) {
    const result = await verifyOne({
      apiKey,
      chainId,
      rpcUrl,
      allowPending,
      explorerAttempts,
      explorerDelayMs,
      ...job,
    });
    results.push(result);

    if (result.explorerAbiVisible) {
      console.log(`${job.label}: EIP-1167 runtime linkage + Etherscan ABI visibility PASS`);
    } else {
      console.log(
        `${job.label}: EIP-1167 runtime linkage PASS; Etherscan ABI visibility PENDING (${result.explorerReason})`
      );
    }
  }

  const pending = results.filter((result) => !result.explorerAbiVisible).length;
  console.log(JSON.stringify({ chainId, allowPending, pending, results }, null, 2));

  if (pending !== 0 && !allowPending) {
    fail(`${pending} EIP-1167 clone(s) are still pending Etherscan ABI auto-recognition.`);
  }
}

main().catch((error) => {
  console.error(`RELIC FORGE V2 ETHERSCAN VERIFICATION FAILED: ${error.message}`);
  process.exitCode = 1;
});
