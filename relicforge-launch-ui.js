(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isStudio = page === 'studio.html';
  const isDashboard = page === 'dashboard.html';
  let preflightSerial = 0;
  let observerScheduled = false;

  function setNetworkStatus(message, bad = false) {
    const node = $('rf26ForgeNetworkStatus');
    if (!node) return;
    node.textContent = String(message || '');
    node.style.color = bad ? '#d9a1a1' : '';
  }

  async function verifySelectedNetwork() {
    if (!isStudio) return;
    const runtime = window.RelicForgeForgeNetwork;
    if (!runtime) return;
    const chainId = runtime.selectedChainId?.();
    if (chainId == null) return;
    if (!runtime.localReady?.(chainId)) {
      setNetworkStatus(`${runtime.title?.(chainId) || 'Selected network'} is not available for deployment yet.`, true);
      return;
    }

    const ticket = ++preflightSerial;
    try {
      setNetworkStatus('Checking selected release and onchain infrastructure…');
      const result = await runtime.preflight();
      if (ticket !== preflightSerial) return;
      const title = runtime.title?.(result.chainId) || `Chain ${result.chainId}`;
      setNetworkStatus(`${title} is ready. Release and infrastructure verified automatically.`);
    } catch (error) {
      if (ticket !== preflightSerial) return;
      setNetworkStatus(`Automatic network verification failed: ${error?.message || String(error)}`, true);
    }
  }

  function installAutomaticNetworkVerification() {
    if (!isStudio) return;
    const picker = $('rf26ForgeNetworkSelect');
    if (!picker || picker.dataset.rfAutoVerify === '1') return;
    picker.dataset.rfAutoVerify = '1';

    const oldButton = $('rf26ForgePreflightBtn');
    if (oldButton) {
      const parent = oldButton.parentElement;
      oldButton.remove();
      if (parent && !parent.children.length && !parent.textContent.trim()) parent.remove();
    }

    picker.addEventListener('change', () => {
      // rf26-forge-network.js owns the authoritative selection handler and runs first.
      // Verify only after it has accepted the new network.
      queueMicrotask(() => verifySelectedNetwork());
    });

    setTimeout(() => {
      if (window.RelicForgeForgeNetwork?.selectedChainId?.() != null) verifySelectedNetwork();
    }, 0);
  }

  function addFullWidthClass(inputId) {
    $(inputId)?.closest('label')?.classList.add('rf-launch-full');
  }

  function organizeStudioLaunch() {
    if (!isStudio) return;

    // Remove the superseded duplicate network guidance card if an older cached
    // product-ui script inserted it before this module loaded.
    $('rf26NetworkStatus')?.remove();

    const layout = document.querySelector('.forge-launch-layout');
    if (!layout || layout.classList.contains('rf-launch-clean')) return;

    const networkCard = layout.querySelector('.rf26-forge-network-card');
    const collectionCard = $('launchName')?.closest('.launch-card');
    const accessCard = $('publicMintEnabled')?.closest('.launch-card');
    const revealCard = document.querySelector('input[name="revealMode"]')?.closest('.launch-card');
    const renderingCard = $('holderRenderModeEnabled')?.closest('.launch-card');
    const feeCard = document.querySelector('input[name="platformFeeMode"]')?.closest('.launch-card');
    const infraCard = layout.querySelector('.canonical-v1-card');

    if (!collectionCard || !accessCard || !revealCard || !renderingCard || !feeCard || !infraCard) return;

    layout.classList.add('rf-launch-clean');
    collectionCard.classList.add('rf-launch-collection');
    accessCard.classList.add('rf-launch-access');
    revealCard.classList.add('rf-launch-reveal');
    renderingCard.classList.add('rf-launch-rendering');
    feeCard.classList.add('rf-launch-fee');
    infraCard.classList.add('rf-launch-infra');

    const collectionHeading = collectionCard.querySelector(':scope > h3');
    if (collectionHeading) collectionHeading.textContent = 'Collection & deployment';
    const accessHeading = accessCard.querySelector(':scope > h3');
    if (accessHeading) accessHeading.textContent = 'Mint access';

    addFullWidthClass('launchDescription');

    if (networkCard && !$('rfLaunchNetworkInline')) {
      const pickerLabel = $('rf26ForgeNetworkSelect')?.closest('label.field');
      const networkStatus = $('rf26ForgeNetworkStatus');
      if (pickerLabel && networkStatus) {
        const block = document.createElement('div');
        block.id = 'rfLaunchNetworkInline';
        block.className = 'rf-launch-network-inline';

        const copy = document.createElement('div');
        copy.className = 'rf-launch-network-copy';
        copy.innerHTML = '<strong>Deployment network</strong><small>Select the chain for this collection. Relic Forge verifies the selected release and infrastructure automatically; your wallet is not switched until you connect to launch.</small>';

        block.append(copy, pickerLabel, networkStatus);
        collectionHeading?.insertAdjacentElement('afterend', block);
      }
      networkCard.remove();
    }

    if (!layout.querySelector('.rf-launch-options-grid')) {
      const options = document.createElement('div');
      options.className = 'rf-launch-options-grid';
      const stack = document.createElement('div');
      stack.className = 'rf-launch-options-stack';
      layout.insertBefore(options, revealCard);
      options.append(revealCard, stack);
      stack.append(feeCard, renderingCard);
    }

    if (!infraCard.querySelector('.rf-infra-details')) {
      const addresses = infraCard.querySelector('.canonical-v1-addresses');
      const status = $('canonicalV1Status');
      if (addresses || status) {
        const details = document.createElement('details');
        details.className = 'rf-infra-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Infrastructure details';
        details.append(summary);
        if (addresses) details.append(addresses);
        if (status) details.append(status);
        const connect = $('connectForgeWalletBtn');
        if (connect) infraCard.insertBefore(details, connect);
        else infraCard.append(details);
      }
    }

    installAutomaticNetworkVerification();
  }

  function organizeWorkbench() {
    if (!isStudio) return;
    const grid = document.querySelector('.forge-workbench-grid');
    if (!grid) return;
    grid.classList.add('rf-workbench-clean');

    document.querySelector('.mint-page-builder-card')?.classList.add('rf-workbench-mintpage');
    $('compileOnchainBtn')?.closest('.forge-workbench-card')?.classList.add('rf-workbench-compiler');
    $('refreshForgeCostBtn')?.closest('.forge-workbench-card')?.classList.add('rf-workbench-cost');
    $('forgeCollectionBtn')?.closest('.forge-workbench-card')?.classList.add('rf-workbench-deploy');
    $('forgeMintQuantity')?.closest('.forge-workbench-card')?.classList.add('rf-workbench-test');
    $('viewerCollectionAddress')?.closest('.forge-workbench-card')?.classList.add('rf-workbench-marketplace');
  }

  function labelDashboardPreview() {
    if (!isDashboard) return;
    document.querySelectorAll('.dashboard-mint-page-builder .mint-page-studio-preview').forEach(preview => {
      if (preview.querySelector(':scope > .rf-dashboard-preview-label')) return;
      const label = document.createElement('div');
      label.className = 'rf-dashboard-preview-label';
      label.textContent = 'MINT PAGE PREVIEW';
      preview.prepend(label);
    });
  }

  function install() {
    organizeStudioLaunch();
    organizeWorkbench();
    installAutomaticNetworkVerification();
    labelDashboardPreview();
  }

  install();

  // Dashboard collection controls and deployment recovery panels are rendered
  // asynchronously, so apply presentation classes when those nodes appear.
  const observer = new MutationObserver(records => {
    if (observerScheduled || !records.some(record => record.addedNodes?.length)) return;
    observerScheduled = true;
    requestAnimationFrame(() => {
      observerScheduled = false;
      install();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
