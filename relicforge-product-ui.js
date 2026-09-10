(() => {
  'use strict';
  const N = window.RelicForgeNetworks;
  if (!N || !document.body) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isStudio = page === 'studio.html';
  const isDashboard = page === 'dashboard.html';
  const isMint = page === 'mint.html';
  const isCreator = isStudio || isDashboard;
  // The existing creator write paths remain Sepolia-only in this release.
  // The public V2 collector already resolves its own URL-bound chain.
  const chain = isMint ? Number(new URLSearchParams(location.search).get('chain') || 11155111)
    : isCreator ? 11155111 : N.preferredChainId();
  let meta;
  try { meta = N.metadata(chain); } catch (_) { return; }
  const available = N.isLaunchEnabled(chain);

  // Network selection belongs to the creation workflow, not the public
  // website. This release's existing Studio transaction path is Sepolia-only.
  function installNetworkControl() {
    if (!isDashboard) return;
    if ($('rf26NetworkControl')) return;
    const header = document.querySelector('.topbar,.rc47b-nav');
    if (!header) return;
    const host = document.createElement('div');
    host.id = 'rf26NetworkControl';
    host.className = 'rf26-network-control';
    host.innerHTML = `<span class="rf26-eyebrow">NETWORK</span><strong>${esc(meta.name)}</strong>`;
    header.append(host);
  }
  function installCreatorStatus() {
    if (!isStudio || $('rf26NetworkStatus')) return;
    const launch = document.querySelector('.canonical-v1-card');
    if (!launch) return;
    const box = document.createElement('section');
    box.id = 'rf26NetworkStatus';
    box.className = 'rf26-network-status rf26-studio-network';
    box.setAttribute('aria-label', 'Collection network and launch guidance');
    box.innerHTML = `
      <div class="rf26-studio-network-main">
        <div>
          <span class="rf26-eyebrow">COLLECTION NETWORK</span>
          <h4>Choose where your collection will live.</h4>
          <p>Network selection determines where your collection is deployed. A production deployment uses real funds and creates permanent onchain records.</p>
        </div>
        <div class="rf26-network-field">
          <label for="rf26StudioNetworkSelect">Deployment network</label>
          <select id="rf26StudioNetworkSelect" aria-describedby="rf26StudioNetworkHelp">
            <option value="11155111">Ethereum Sepolia · Development</option>
            <option value="1" disabled>Ethereum Mainnet · Preparing</option>
          </select>
          <small id="rf26StudioNetworkHelp">Sepolia is currently the available Studio deployment network. Mainnet and additional supported networks will be selectable when their integrations are ready.</small>
        </div>
      </div>
      <div class="rf26-test-recommendation">
        <div class="rf26-test-recommendation-heading">
          <span class="rf26-eyebrow">STRONGLY RECOMMENDED</span>
          <strong>Test on Sepolia before your production launch.</strong>
        </div>
        <p>Complete a full test launch before deploying to Ethereum Mainnet or another supported production network. Verify your artwork and metadata, mint stages, approved-wallet access, minting, reveal, and creator controls with real wallet interactions.</p>
        <p>Review the entire experience, including how the collection appears in wallets and marketplaces. Fix any issues before committing real funds. A successful test is valuable preparation, but it does not guarantee that a production deployment is risk-free.</p>
        <a href="./how-to.html">Explore the creation guide <span aria-hidden="true">↗</span></a>
      </div>`;
    launch.prepend(box);
    const select = $('rf26StudioNetworkSelect');
    select.value = '11155111';
    select.addEventListener('change', () => {
      // Do not offer a simulated mainnet selection while the real write path
      // remains bound to Sepolia. The future integration will own this control.
      select.value = '11155111';
    });
  }
  function installMintStatus() {
    if (!isMint || $('rf26MintNetwork')) return;
    const status = $('mintStatus');
    if (!status) return;
    const label = document.createElement('div');
    label.id = 'rf26MintNetwork';
    label.className = 'rf26-mint-network';
    label.textContent = meta.name;
    status.before(label);
  }

  // Only presentation labels are rewritten. Never modify error messages,
  // contractual terms, security disclosures, inputs, code, or network facts.
  const copy = new Map([
    ['Resumable R12-v2 deployment','Resumable deployment'],
    ['R12-v2 collector mint page opened.','Collector mint page opened.'],
    ['Preparing R12-v2 forge...','Preparing your collection...'],
    ['Create R12-v2 Collection + ProjectData + MintPhases','Create collection and onchain data'],
    ['V1 Mint Page & Upcoming Mints','Mint Page & Upcoming Mints'],
    ['R12-v2 Collection','Collection'],
    ['R12-v2 collector page','Collector mint page'],
    ['Relic Forge R12-v2','Relic Forge Infrastructure'],
    ['Certified Sepolia preproduction infrastructure','Ethereum Sepolia infrastructure'],
    ['How-To','How It Works'],
    ['Technical Breakdown','Technology']
  ]);
  function cleanCopy() {
    if (!document.createTreeWalker) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.parentElement || node.parentElement.closest('script,style,code,pre,textarea,svg,[contenteditable],.rf26-network-control,.rf26-network-status,.rf26-mint-network,[role="alert"],.r24-status,.r23-status,.forge-inline-status')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const old = node.nodeValue, trimmed = old.trim();
      if (copy.has(trimmed)) node.nodeValue = old.replace(trimmed, copy.get(trimmed));
    }
    if (page !== 'technical-breakdown.html') {
      const footer = document.querySelector('.site-footer > span:last-child');
      if (footer && footer.textContent.trim() === 'Release candidate · Testnet · Unaudited') footer.textContent = 'Relic Forge · Onchain by design';
    }
    if (isCreator) {
      const heading = document.querySelector('.canonical-v1-heading h3');
      if (heading && heading.textContent !== 'Relic Forge Infrastructure') heading.textContent = 'Relic Forge Infrastructure';
      const detail = document.querySelector('.canonical-v1-heading small');
      if (detail && detail.textContent !== 'Ethereum Sepolia infrastructure') detail.textContent = 'Ethereum Sepolia infrastructure';
    }
  }
  function install() {
    installNetworkControl();
    installCreatorStatus();
    installMintStatus();
    cleanCopy();
  }
  install();
  // Existing application modules create parts of the Studio asynchronously.
  // Observe only structural additions, avoiding a loop on text mutations.
  let scheduled = false;
  const observer = new MutationObserver(records => {
    if (!records.some(r => r.addedNodes && r.addedNodes.length) || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; install(); });
  });
  observer.observe(document.body, {childList:true,subtree:true});
})();
