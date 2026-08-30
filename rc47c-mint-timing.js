(() => {
  'use strict';

  const base = () => String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  const originalAdapter = window.RelicForgeMintV1Adapter;
  if (!originalAdapter?.start) return;

  let config = null;
  let state = null;
  let secondTimer = null;
  let pollTimer = null;
  let lastPoll = 0;

  function dateTime(ts) {
    if (!Number(ts)) return 'No scheduled start';
    return new Intl.DateTimeFormat(undefined, {
      year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'
    }).format(new Date(Number(ts) * 1000));
  }

  function duration(seconds) {
    let left = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(left / 86400); left %= 86400;
    const hours = Math.floor(left / 3600); left %= 3600;
    const minutes = Math.floor(left / 60); const secs = left % 60;
    if (days > 0) return `${String(days).padStart(2,'0')}D : ${String(hours).padStart(2,'0')}H : ${String(minutes).padStart(2,'0')}M : ${String(secs).padStart(2,'0')}S`;
    return `${String(hours).padStart(2,'0')}H : ${String(minutes).padStart(2,'0')}M : ${String(secs).padStart(2,'0')}S`;
  }

  function ensureUi() {
    const mintbox = document.querySelector('.mintbox');
    if (mintbox && !$('rfMintCountdown')) {
      const box = document.createElement('div');
      box.className = 'rf-mint-countdown';
      box.id = 'rfMintCountdown';
      box.innerHTML = '<div class="rf-mint-countdown-kicker" id="rfMintCountdownKicker">MINT SCHEDULE</div><div class="rf-mint-countdown-value" id="rfMintCountdownValue">Loading…</div><div class="rf-mint-countdown-date" id="rfMintCountdownDate"></div>';
      const intro = $('mintIntro');
      mintbox.insertBefore(box, intro || mintbox.firstChild);
    }
    [['publicCard','rfPublicTiming'],['whitelistCard','rfWhitelistTiming']].forEach(([cardId,timingId]) => {
      const card = $(cardId);
      if (!card || $(timingId)) return;
      const line = document.createElement('small');
      line.className = 'rf-phase-timing';
      line.id = timingId;
      const top = card.querySelector('.access-top');
      if (top) top.insertAdjacentElement('afterend', line); else card.prepend(line);
    });
  }

  function phaseLine(phase, label, nowSec) {
    if (!phase) return 'Not configured';
    const start = Number(phase.startTime || 0);
    const end = Number(phase.endTime || 0);
    if (phase.open) {
      if (end > nowSec) return `LIVE · Ends ${dateTime(end)} · ${duration(end - nowSec)} remaining`;
      return 'LIVE · No automatic end';
    }
    if (end && nowSec >= end) return `Ended ${dateTime(end)}`;
    if (start > nowSec) return `Starts ${dateTime(start)} · ${duration(start - nowSec)}`;
    if (!state?.masterMintEnabled) return start ? `Scheduled ${dateTime(start)} · Master Mint is paused` : 'Master Mint is paused';
    return `${label} phase is not currently open`;
  }

  function render() {
    ensureUi();
    if (!state) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const phases = [
      { label:'Whitelist', phase:state.whitelistPhase },
      { label:'Public', phase:state.publicPhase },
    ].filter(row => row.phase);

    const publicLine = $('rfPublicTiming');
    if (publicLine) {
      publicLine.textContent = phaseLine(state.publicPhase, 'Public', nowSec);
      publicLine.classList.toggle('live', !!state.publicPhase?.open);
    }
    const wlLine = $('rfWhitelistTiming');
    if (wlLine) {
      wlLine.textContent = phaseLine(state.whitelistPhase, 'Whitelist', nowSec);
      wlLine.classList.toggle('live', !!state.whitelistPhase?.open);
    }

    const box = $('rfMintCountdown');
    const kicker = $('rfMintCountdownKicker');
    const value = $('rfMintCountdownValue');
    const when = $('rfMintCountdownDate');
    if (!box || !kicker || !value || !when) return;
    box.classList.remove('live');

    const open = phases.filter(row => row.phase.open);
    if (open.length) {
      const withEnd = open.filter(row => Number(row.phase.endTime || 0) > nowSec)
        .sort((a,b) => Number(a.phase.endTime) - Number(b.phase.endTime));
      const chosen = withEnd[0] || open[0];
      const end = Number(chosen.phase.endTime || 0);
      box.classList.add('live');
      if (end > nowSec) {
        kicker.textContent = `${chosen.label.toUpperCase()} MINT ENDS IN`;
        value.textContent = duration(end - nowSec);
        when.textContent = dateTime(end);
      } else {
        kicker.textContent = `${chosen.label.toUpperCase()} MINT`;
        value.textContent = 'LIVE';
        when.textContent = 'No automatic end';
      }
    } else {
      const upcoming = phases.filter(row => Number(row.phase.startTime || 0) > nowSec)
        .sort((a,b) => Number(a.phase.startTime) - Number(b.phase.startTime));
      if (upcoming.length) {
        const chosen = upcoming[0];
        const start = Number(chosen.phase.startTime);
        kicker.textContent = `${chosen.label.toUpperCase()} MINT BEGINS IN`;
        value.textContent = duration(start - nowSec);
        when.textContent = dateTime(start);
      } else if (!state.masterMintEnabled) {
        kicker.textContent = 'MINT STATUS';
        value.textContent = 'PAUSED';
        when.textContent = 'The creator has Master Mint turned off.';
      } else {
        kicker.textContent = 'MINT STATUS';
        value.textContent = 'NOT CURRENTLY OPEN';
        when.textContent = 'Check the phase schedule below.';
      }
    }

    const boundaryCrossed = phases.some(({phase}) => {
      const start = Number(phase.startTime || 0), end = Number(phase.endTime || 0);
      if (state.masterMintEnabled && phase.enabled && start && nowSec >= start && !phase.open && (!end || nowSec < end)) return true;
      if (phase.open && end && nowSec >= end) return true;
      return false;
    });
    if (boundaryCrossed && Date.now() - lastPoll > 2500) poll().catch(() => {});
  }

  async function poll() {
    if (!config || !base()) return;
    lastPoll = Date.now();
    const response = await fetch(`${base()}/api/rc47b/public/mint/${Number(config.chainId)}/${encodeURIComponent(config.contract)}/state`, { headers:{accept:'application/json'}, cache:'no-store' });
    if (!response.ok) return;
    state = await response.json();
    render();
  }

  const wrapped = Object.freeze({
    ...originalAdapter,
    start: async nextConfig => {
      config = nextConfig;
      const result = await originalAdapter.start(nextConfig);
      await poll().catch(() => {});
      clearInterval(secondTimer); clearInterval(pollTimer);
      secondTimer = setInterval(render, 1000);
      pollTimer = setInterval(() => poll().catch(() => {}), 15000);
      return result;
    }
  });
  window.RelicForgeMintV1Adapter = wrapped;
})();
