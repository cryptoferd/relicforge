(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const networks = () => window.RelicForgeNetworks;

  function setLaunchStatus(message, state = '') {
    const node = $('launchNetworkStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `forge-inline-status production-network-status${state ? ` ${state}` : ''}`;
  }

  function selectedNetwork() {
    const select = $('launchNetworkSelect');
    return networks()?.get(Number(select?.value || 0)) || null;
  }

  function refreshLaunchNetworkUi() {
    const network = selectedNetwork();
    if (!network || !networks()) return;
    const ready = networks().canonicalReady(network.chainId);
    const badge = $('canonicalV1NetworkBadge');
    if (badge) badge.textContent = network.badge || network.name.toUpperCase();
    const button = $('forgeCollectionBtn');
    if (button) button.textContent = ready ? `Forge Collection on ${network.name}` : 'Forge Collection';

    const addressFields = ['canonicalFactoryAddress','canonicalFeePolicyAddress','canonicalRandomnessAddress','canonicalRendererAddress'];
    if (!ready) addressFields.forEach(id => { const node=$(id); if (node) { node.textContent='Pending activation'; node.removeAttribute('title'); } });

    if (ready) {
      setLaunchStatus(`Canonical Relic Forge V1 infrastructure is configured for ${network.name}.`, 'good');
    } else if (network.production) {
      setLaunchStatus(`${network.name} is a launch target. Canonical V1 addresses will be activated here before public launch.`, 'neutral');
    } else {
      setLaunchStatus(`${network.name} is available for internal QA when canonical infrastructure is configured.`, 'neutral');
    }

    window.dispatchEvent(new CustomEvent('relicforge:launch-network-changed', { detail: { chainId: network.chainId, network, ready } }));
  }

  function initLaunchSelector() {
    const select = $('launchNetworkSelect');
    if (!select || !networks()) return;
    const available = networks().visibleLaunchNetworks();
    select.innerHTML = '';
    available.forEach(network => {
      const option = document.createElement('option');
      option.value = String(network.chainId);
      option.textContent = network.production ? network.name : `${network.name} · QA`;
      select.appendChild(option);
    });

    let saved = 0;
    try { saved = Number(localStorage.getItem('relicforge_launch_chain') || 0); } catch (_) {}
    const qaDefault = networks().qaMode && networks().canonicalReady(11155111) ? 11155111 : 0;
    const desired = available.some(n => n.chainId === saved) ? saved : (qaDefault || available[0]?.chainId);
    if (desired) select.value = String(desired);
    select.addEventListener('change', () => {
      try { localStorage.setItem('relicforge_launch_chain', select.value); } catch (_) {}
      refreshLaunchNetworkUi();
    });
    refreshLaunchNetworkUi();
  }

  function blockWhenUnavailable(buttonId) {
    const button = $(buttonId);
    if (!button) return;
    button.addEventListener('click', event => {
      const network = selectedNetwork();
      if (!network || networks()?.canonicalReady(network.chainId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setLaunchStatus(`${network.name} canonical infrastructure is not configured yet. No wallet network change or transaction was requested.`, 'bad');
    }, true);
  }

  function protectUnavailableLaunches() {
    blockWhenUnavailable('connectForgeWalletBtn');
    blockWhenUnavailable('forgeCollectionBtn');
    blockWhenUnavailable('refreshForgeCostBtn');
  }

  function protectDashboardUntilProductionDeployments() {
    if (!$('launchedDashboardStatus') || networks()?.qaMode) return;
    const message = 'Creator Dashboard chain discovery will activate when the canonical production deployments are configured.';
    ['launchedConnectBtn','launchedChangeWalletBtn','launchedRefreshBtn','launchedManualAddBtn'].forEach(id => {
      const button = $(id);
      if (!button) return;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        $('launchedDashboardStatus').textContent = message;
      }, true);
    });
    $('launchedDashboardStatus').textContent = message;
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLaunchSelector();
    protectUnavailableLaunches();
    protectDashboardUntilProductionDeployments();
  });
})();
