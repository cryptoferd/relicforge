// Phase 2B: legacy presentation publishing cannot grant production discovery
// or claim a vanity URL. Those actions belong to the verified RF26 endpoints.
const fail = message => Object.assign(new Error(message), { statusCode: 400 });
const PUBLIC_FIELDS = ['listed', 'featured', 'featureRequested', 'showcaseEnabled'];
export function normalizeLegacyMintPage(input, policy) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Mint-page configuration must be an object.');
  if (!policy || !Number.isSafeInteger(Number(policy.chain_id))) throw fail('A valid network policy is required.');
  const config = { ...input };
  if (config.slug !== undefined && config.slug !== null && config.slug !== '') {
    throw fail('Claim custom mint URLs through the verified production deployment endpoint.');
  }
  delete config.slug;
  for (const key of PUBLIC_FIELDS) {
    if (config[key] === true || config[key] === 'true' || config[key] === 1) {
      throw fail('Public discovery and featuring must be configured through the verified production publication endpoint.');
    }
    delete config[key];
  }
  // The route parameters, not untrusted presentation JSON, identify the chain.
  delete config.chainId;
  delete config.contract;
  return config;
}
