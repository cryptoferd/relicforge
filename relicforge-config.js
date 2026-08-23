// RelicForge runtime configuration.
// RelicForge production Cloud API. Mint-page presentation settings are published here
// so the same public page configuration is available from every device.
window.RELICFORGE_CONFIG = Object.freeze({
  apiBase: 'https://relicforge-production.up.railway.app',
  // Prefer a stable custom domain (for example https://api.relicforge.xyz) before sealing collections.
  // Leave blank to use apiBase.
  renderBase: '',
  cloudEnabled: true,
  version: '11.0.4'
});
