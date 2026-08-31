(() => {
  'use strict';

  const HELP = [
    ['#launchedConnectBtn','Connect the wallet that created or currently controls your Relic Forge collections so the dashboard can discover and manage them.'],
    ['#launchedChangeWalletBtn','Switch to a different wallet without leaving the dashboard. Only the collection creator wallet can change creator-controlled settings.'],
    ['#launchedDisconnectBtn','Disconnect the current dashboard wallet. This does not change ownership or any collection settings.'],
    ['#launchedFactoryInput','Advanced recovery field. Paste an older Relic Forge Factory address only when a launched collection is not discovered automatically. Most creators can leave this blank.'],
    ['#launchedRefreshBtn','Search again for collections controlled by the connected wallet and refresh their latest onchain and Relic Forge Cloud information.'],
    ['#launchedManualCollection','Paste the address of a launched Relic Forge collection that is missing from discovery. Relic Forge verifies that the connected wallet is authorized before adding it.'],
    ['#launchedManualAddBtn','Verify the pasted collection and add it to this dashboard when the connected wallet has creator authority.'],
    ['[data-rfcc-action="refresh"]','Reload the selected collection from the blockchain and Relic Forge Cloud so every control and balance reflects the latest confirmed state.'],
    ['[data-rfcc-action="toggle-mint"]','Pause or resume collector minting for the entire collection. Pausing does not delete mint stages, dates, prices, allowlists, or already-minted NFTs.'],
    ['#rfccCreatorRecipient','Wallet that will receive NFTs created with the creator-only mint function. This can be your wallet or another valid wallet address.'],
    ['#rfccCreatorQty','Number of creator copies to mint in this transaction. Creator mints still consume the collection’s remaining supply.'],
    ['[data-rfcc-action="creator-mint"]','Mint the chosen quantity directly to the recipient using the collection’s creator-only mint function.'],
    ['[data-rfcc-stage] [data-k="access"]','Choose whether anyone can mint during this stage or only wallets on the approved-wallet list. Restricted stages require a saved approved-wallet list.'],
    ['[data-rfcc-stage] [data-k="price"]','Price a collector pays for each NFT minted during this stage. Set 0 for a free mint.'],
    ['[data-rfcc-stage] [data-k="supply"]','Maximum number of NFTs this stage may mint. Set 0 for no stage-specific cap; the collection’s overall maximum supply still applies.'],
    ['[data-rfcc-stage] [data-k="wallet"]','Maximum number this wallet may mint through this stage. Set 0 for no stage-wide wallet limit. Approved-wallet allowances can impose an additional per-wallet limit.'],
    ['[data-rfcc-stage] [data-k="start"]','Date and time when this mint stage becomes eligible to open. The collection must also be globally unpaused.'],
    ['[data-rfcc-stage] [data-k="end"]','Date and time when this stage automatically closes. Leave blank if it should remain eligible until manually paused or sold out.'],
    ['[data-rfcc-stage] [data-k="priority"]','Determines which stage wins when multiple stages are open at the same time. Higher numbers take priority.'],
    ['[id^="rfccApprovedWallets"]','One approved wallet per line. Add an optional allowance after a comma, such as 0xWallet...,2. Saving rebuilds the verification data for this stage.'],
    ['[data-rfcc-action="load-allowlist"]','Load the currently published approved-wallet list and allowances for this stage from Relic Forge Cloud.'],
    ['[data-rfcc-action="save-allowlist"]','Rebuild the approved-wallet verification tree, update this stage onchain, and publish matching wallet proofs so approved collectors can mint.'],
    ['[data-rfcc-action="save-stage"]','Save this stage’s edited price, dates, supply limit, wallet limit, access type, and priority to the collection contract. Approved-wallet membership is saved separately.'],
    ['[data-rfcc-action="toggle-stage"]','Pause or enable only this mint stage. Other enabled stages and the collection-wide mint setting are unaffected.'],
    ['#rfccNewAccess','Choose whether the new stage is public or restricted to approved wallets.'],
    ['#rfccNewPrice','Price per NFT for the new stage. Set 0 for a free mint.'],
    ['#rfccNewSupply','Maximum NFTs this new stage may mint. Set 0 for no stage-specific cap.'],
    ['#rfccNewWallet','Maximum NFTs one wallet may mint through this stage. Set 0 for no stage-wide wallet cap.'],
    ['#rfccNewStart','When the new stage becomes eligible to open. Leave blank to make it eligible immediately when enabled.'],
    ['#rfccNewEnd','When the new stage should automatically close. Leave blank for no automatic end.'],
    ['#rfccNewPriority','Priority used when this stage overlaps another open stage. Higher numbers win.'],
    ['#rfccNewEnabled','When checked, the new stage is enabled as soon as its creation transaction confirms. Its start time still determines whether it is actually open.'],
    ['#rfccNewApprovedWallets','For an Approved Wallets stage, enter one wallet per line with an optional allowance after a comma. Relic Forge creates and publishes the proofs automatically.'],
    ['[data-rfcc-action="create-stage"]','Create this mint stage onchain using the settings above. Restricted stages also publish their approved-wallet proofs.'],
    ['#rfccRevealMode','Controls only NFTs minted after this setting is changed. Forge Reveal starts a randomness request after future mints; Reveal Later lets you accumulate unrevealed NFTs and reveal them when you choose.'],
    ['[data-rfcc-action="save-reveal-mode"]','Save the reveal behavior for future mints. NFTs already waiting in Reveal Later remain in that queue until you reveal them.'],
    ['[data-rfcc-action="request-reveal"]','Start a reveal request for NFTs already accumulated under Reveal Later. This requests verified randomness; it does not instantly finish the reveal.'],
    ['#rfccRevealSteps','Maximum number of NFTs to finalize in one reveal-processing transaction. Larger batches may cost more gas; use multiple transactions for large reveals.'],
    ['[data-rfcc-action="process-reveal"]','Use received verified randomness to assign final collection recipes to the next batch of NFTs ready to reveal.'],
    ['#rfccFundReveal','Amount of native network currency to add to this collection’s dedicated reveal balance. Verified randomness requests are paid from this balance.'],
    ['[data-rfcc-action="fund-reveal"]','Add the entered amount to this collection’s reveal balance. Anyone may add funds; adding funds does not mint or reveal an NFT by itself.'],
    ['#rfccWithdrawReveal','Amount of unused reveal balance to withdraw. Only the collection’s current payout wallet may withdraw unused reveal funds.'],
    ['[data-rfcc-action="withdraw-reveal"]','Withdraw the entered unused reveal balance to the current payout wallet.'],
    ['#rfccPayout','Wallet that receives creator earnings withdrawn from the collection. This wallet also controls withdrawal of unused reveal balance.'],
    ['#rfccRoyaltyWallet','Wallet returned as the royalty recipient for secondary sales that honor the collection’s royalty information.'],
    ['#rfccRoyaltyPct','Royalty percentage reported by the collection for secondary sales. Marketplace enforcement can vary. Relic Forge limits this field to 0–10%.'],
    ['[data-rfcc-action="save-money"]','Save payout-wallet and royalty changes onchain. If both changed, your wallet may need to confirm more than one transaction.'],
    ['[data-rfcc-action="withdraw-creator"]','Send currently available creator earnings from the collection contract to the configured payout wallet.'],
    ['[data-rfcc-action="forward-fees"]','Forward reserved Relic Forge platform fees to the platform fee receiver. This does not withdraw creator earnings.'],
    ['#rfccDisplayMode','Choose the collection’s default presentation: fully onchain artwork or the configured cached display. This does not change token ownership or the sealed onchain collection data.'],
    ['#rfccDisplayUri','Base address used for the optional cached display mode. It affects presentation only; the fully onchain collection data remains authoritative.'],
    ['#rfccHolderDisplay','Allow individual token owners to choose between available display modes for their own tokens when supported.'],
    ['[data-rfcc-action="save-display"]','Save the display configuration. Once collection content is permanently locked, these display settings may no longer be editable.'],
    ['#rfccSurrenderConfirm','Safety confirmation for the irreversible creator-control surrender. The permanent button remains unavailable until required contract safety conditions are satisfied.'],
    ['[data-rfcc-action="renounce"]','IRREVERSIBLE: permanently removes creator authority to pause minting, edit stages, change future reveal behavior, change payout/royalty settings, or creator-mint. This cannot be restored.']
  ];

  let popover = null;
  let pinned = null;

  function ensurePopover() {
    if (popover?.isConnected) return popover;
    popover = document.createElement('div');
    popover.id = 'rfCreatorHelpPopover';
    popover.className = 'rf-creator-help-popover';
    popover.setAttribute('role','tooltip');
    popover.hidden = true;
    document.body.appendChild(popover);
    return popover;
  }

  function position(icon) {
    const pop = ensurePopover();
    const rect = icon.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(340, Math.max(240, window.innerWidth - margin * 2));
    pop.style.width = width + 'px';
    pop.style.left = '0px'; pop.style.top = '0px';
    const box = pop.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = rect.top - box.height - 10;
    if (top < margin) top = rect.bottom + 10;
    top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  function show(icon, pin=false) {
    if (!icon?.dataset?.rfHelp) return;
    const pop = ensurePopover();
    pop.textContent = icon.dataset.rfHelp;
    pop.hidden = false;
    pop.classList.add('visible');
    icon.setAttribute('aria-describedby', pop.id);
    if (pin) pinned = icon;
    requestAnimationFrame(() => position(icon));
  }

  function hide(force=false) {
    if (pinned && !force) return;
    if (popover) { popover.classList.remove('visible'); popover.hidden = true; }
    document.querySelectorAll('.rf-help-icon[aria-describedby]').forEach(n => n.removeAttribute('aria-describedby'));
    pinned = null;
  }

  function icon(text) {
    const node = document.createElement('span');
    node.className = 'rf-help-icon';
    node.textContent = 'i';
    node.tabIndex = 0;
    node.setAttribute('role','button');
    node.setAttribute('aria-label',`Help: ${text}`);
    node.dataset.rfHelp = text;
    return node;
  }

  function attach(control,text) {
    if (!control || control.dataset.rfHelpDecorated === '1') return;
    control.dataset.rfHelpDecorated = '1';
    const info = icon(text);
    if (control.matches('input,select,textarea')) {
      const label = control.closest('label');
      const heading = label?.querySelector(':scope > span');
      if (heading) { heading.classList.add('rf-help-label-inline'); heading.appendChild(info); }
      else if (label) label.appendChild(info);
      else control.insertAdjacentElement('beforebegin',info);
      return;
    }
    if (control.matches('button')) {
      const wrap = document.createElement('span');
      wrap.className = 'rf-help-action-wrap';
      control.replaceWith(wrap);
      wrap.append(control,info);
      return;
    }
    control.appendChild(info);
  }

  function decorate(root=document) {
    for (const [selector,text] of HELP) root.querySelectorAll(selector).forEach(el => attach(el,text));
  }

  function decorateWhenReady(attempt=0) {
    const panel = document.getElementById('rfCompleteCreatorControls');
    if (panel) { decorate(panel); return; }
    if (attempt < 40) setTimeout(() => decorateWhenReady(attempt+1), 100);
  }

  function bind() {
    decorate(document);
    window.addEventListener('relicforge:creator-dashboard-collection-opened', () => decorateWhenReady(0));
    document.addEventListener('mouseover',e => { const i=e.target.closest?.('.rf-help-icon'); if(i&&!pinned) show(i); });
    document.addEventListener('mouseout',e => { const i=e.target.closest?.('.rf-help-icon'); if(i&&!pinned) hide(); });
    document.addEventListener('focusin',e => { const i=e.target.closest?.('.rf-help-icon'); if(i&&!pinned) show(i); });
    document.addEventListener('focusout',e => { const i=e.target.closest?.('.rf-help-icon'); if(i&&!pinned) hide(); });
    document.addEventListener('click',e => {
      const i=e.target.closest?.('.rf-help-icon');
      if(i){ e.preventDefault(); e.stopPropagation(); if(pinned===i) hide(true); else { hide(true); show(i,true); } return; }
      if(pinned) hide(true);
    });
    document.addEventListener('keydown',e => { if(e.key==='Escape') hide(true); });
    window.addEventListener('resize',() => hide(true));
    window.addEventListener('scroll',() => hide(true),true);
    decorateWhenReady(0);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
})();
