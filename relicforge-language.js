(() => {
  'use strict';

  // Normal Relic Forge pages use creator-friendly language. The dedicated
  // Technical Breakdown intentionally does not load this file.
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT']);
  const replacements = [
    [/\bRC\d+(?:\.\d+)+(?:[A-Z]\d*)?\b\s*[·-]?\s*/g, ''],
    [/CANONICAL V1 COLLECTION/g, 'LAUNCHED COLLECTION'],
    [/CANONICAL V1/g, 'LAUNCHED COLLECTION'],
    [/V1 Mint Page & Upcoming Mints/g, 'Mint Page & Upcoming Mints'],
    [/V1 Mint Page/g, 'Mint Page'],
    [/V1 Onchain Controls/g, 'Creator Controls'],
    [/V1 collection/gi, 'collection'],
    [/V1 phase/gi, 'mint stage'],
    [/V1 /g, ''],
    [/Master Mint/g, 'Minting'],
    [/master mint/gi, 'minting'],
    [/Mint Phases/g, 'Mint Stages'],
    [/Mint Phase/g, 'Mint Stage'],
    [/mint phases/gi, 'mint stages'],
    [/mint phase/gi, 'mint stage'],
    [/\bPhases\b/g, 'Stages'],
    [/\bPhase\b/g, 'Stage'],
    [/\bphases\b/g, 'stages'],
    [/\bphase\b/g, 'stage'],
    [/Whitelist \/ Merkle/g, 'Approved Wallets'],
    [/Whitelist mint/gi, 'Approved-wallet mint'],
    [/Whitelist price/gi, 'Approved-wallet price'],
    [/Whitelist phase/gi, 'Approved-wallet stage'],
    [/Whitelist root/gi, 'Allowlist verification'],
    [/\bWhitelist\b/g, 'Approved Wallets'],
    [/\bwhitelist\b/g, 'approved-wallet list'],
    [/Merkle root/gi, 'allowlist verification code'],
    [/Merkle proof/gi, 'allowlist verification'],
    [/Merkle/gi, 'allowlist verification'],
    [/Public mint/gi, 'Open mint'],
    [/Public price/gi, 'Open-mint price'],
    [/Public phase/gi, 'Open-mint stage'],
    [/Deferred Reveal/g, 'Reveal Later'],
    [/deferred reveal/gi, 'reveal-later'],
    [/Reveal epoch/gi, 'reveal batch'],
    [/reveal epoch/gi, 'reveal batch'],
    [/Request Deferred Reveal/g, 'Reveal Pending NFTs'],
    [/Process Ready Reveal/g, 'Complete Reveal'],
    [/Process Reveal/g, 'Complete Reveal'],
    [/Process steps/g, 'NFTs to complete per transaction'],
    [/Deferred pending/g, 'NFTs waiting to reveal'],
    [/Reveal queue/g, 'Reveal requests waiting'],
    [/WAITING FOR RANDOMNESS/g, 'WAITING FOR VERIFIED RANDOMNESS'],
    [/Chainlink VRF/gi, 'Chainlink verifiable randomness'],
    [/VRF randomness/gi, 'verified randomness'],
    [/VRF funding/gi, 'reveal balance'],
    [/randomness credit/gi, 'reveal balance'],
    [/native credit/gi, 'reveal balance'],
    [/randomness provider/gi, 'reveal service'],
    [/ProjectData/g, 'Onchain artwork data'],
    [/Content sealed/gi, 'Artwork & metadata locked'],
    [/content sealing/gi, 'locking artwork & metadata'],
    [/content seal/gi, 'artwork & metadata lock'],
    [/\bsealed\b/gi, 'locked'],
    [/Provenance hash/gi, 'content fingerprint'],
    [/\bProvenance\b/g, 'Content fingerprint'],
    [/\bprovenance\b/g, 'content fingerprint'],
    [/Controller renounce/gi, 'permanently surrender creator control'],
    [/controller has been renounced/gi, 'creator control has been permanently surrendered'],
    [/CONTROL RENOUNCED/g, 'CREATOR CONTROL SURRENDERED'],
    [/Control renounced/gi, 'Creator control surrendered'],
    [/\bController\b/g, 'Creator control'],
    [/\bcontroller\b/g, 'creator control'],
    [/renounce control/gi, 'permanently surrender creator control'],
    [/renounced/gi, 'permanently surrendered'],
    [/RelicForge Cloud/g, 'Relic Forge cloud storage'],
    [/EVM wallet/gi, 'wallet'],
    [/EVM-compatible/gi, 'compatible blockchain'],
    [/\bRPC\b/g, 'network connection'],
    [/RPCs/g, 'network connections'],
    [/Gas estimate/gi, 'Estimated network fee'],
    [/gas price/gi, 'network fee rate'],
    [/\bgas\b/gi, 'network fee'],
    [/fee oracle/gi, 'fee price feed'],
    [/\boracle\b/gi, 'price feed'],
    [/Minter Supported/g, 'Collector Covers Platform Fee'],
    [/Sponsored/g, 'Creator Covers Platform Fee'],
    [/Fully Onchain SVG/g, 'Fully Onchain Artwork'],
    [/Offchain Render/g, 'Cached Display'],
    [/offchain renderer/gi, 'cached display service'],
    [/Renderer base URI/gi, 'Display cache address'],
    [/Render Settings/g, 'Display Settings'],
    [/Render mode/gi, 'Display mode'],
    [/renderToken\(\)/g, 'onchain artwork'],
    [/quoteMint\(\)/g, 'live onchain price check'],
    [/Factory address/gi, 'deployment system address'],
    [/known Factor(?:y|ies)/gi, 'known deployment systems'],
    [/\bFactory\b/g, 'Deployment system'],
    [/\bfactory\b/g, 'deployment system'],
    [/DNA shards?/gi, 'collection-recipe storage'],
    [/Art shards?/gi, 'artwork storage'],
    [/\bDNA\b/g, 'collection recipe data'],
    [/deterministic/gi, 'repeatable'],
    [/canonical/gi, 'official'],
    [/source contract/gi, 'source collection'],
    [/snapshot block/gi, 'snapshot point'],
    [/mint access/gi, 'mint availability'],
    [/assignment nonce/gi, 'assignment counter'],
    [/assign recipes/gi, 'assign artwork combinations'],
    [/recipe pool/gi, 'artwork-combination pool'],
    [/collection recipe/gi, 'collection artwork plan'],
    [/release candidate/gi, 'pre-release build'],
    [/Unaudited/g, 'Not professionally audited'],
    [/unaudited/g, 'not professionally audited'],
    [/testnet/gi, 'testing network'],
  ];

  function translate(value) {
    let out = String(value ?? '');
    for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement);
    return out;
  }

  function shouldSkip(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      if (SKIP.has(el.tagName) || el.matches?.('[data-rf-technical="true"]')) return true;
      el = el.parentElement;
    }
    return false;
  }

  function translateText(root) {
    if (!root || shouldSkip(root)) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const next = translate(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (shouldSkip(node) || !node.nodeValue?.trim()) continue;
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  }

  function translateAttributes(root) {
    const elements = root?.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [...document.querySelectorAll('*')];
    for (const el of elements) {
      if (shouldSkip(el)) continue;
      for (const attr of ['title', 'placeholder', 'aria-label', 'aria-description']) {
        if (!el.hasAttribute?.(attr)) continue;
        const value = el.getAttribute(attr);
        const next = translate(value);
        if (next !== value) el.setAttribute(attr, next);
      }
    }
  }

  function apply(root = document) {
    translateText(root);
    translateAttributes(root);
  }

  const start = () => {
    document.title = translate(document.title);
    const nativeAlert = window.alert?.bind(window);
    const nativeConfirm = window.confirm?.bind(window);
    const nativePrompt = window.prompt?.bind(window);
    if (nativeAlert) window.alert = message => nativeAlert(translate(message));
    if (nativeConfirm) window.confirm = message => nativeConfirm(translate(message));
    if (nativePrompt) window.prompt = (message, value) => nativePrompt(translate(message), value);
    apply(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          if (!shouldSkip(record.target)) translateText(record.target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) apply(node);
        }
      }
    });
    observer.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
    window.RelicForgeLanguage = Object.freeze({ translate, apply });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
