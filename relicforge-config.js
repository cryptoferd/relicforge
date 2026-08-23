// RelicForge runtime configuration.
// After Railway gives the API service a public domain, set apiBase to it.
// Example: apiBase: 'https://relicforge-api-production.up.railway.app'
window.RELICFORGE_CONFIG = Object.freeze({
  apiBase: '',
  // Prefer a stable custom domain (for example https://api.relicforge.xyz) before sealing collections.
  // Leave blank to use apiBase.
  renderBase: '',
  cloudEnabled: true,
  version: '11.0.2'
});
