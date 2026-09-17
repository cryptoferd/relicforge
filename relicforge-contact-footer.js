(() => {
  'use strict';

  const LINKS = Object.freeze([
    {
      href: 'https://x.com/relicforge_io',
      label: 'Relic Forge',
      value: '@relicforge_io',
      aria: 'Relic Forge on X, @relicforge_io'
    },
    {
      href: 'https://x.com/cryptoferd13',
      label: 'Founder',
      value: '@cryptoferd13',
      aria: 'Relic Forge founder on X, @cryptoferd13'
    },
    {
      href: 'mailto:forge.master@relicforge.io',
      label: 'Contact',
      value: 'forge.master@relicforge.io',
      aria: 'Email Relic Forge at forge.master@relicforge.io'
    }
  ]);

  function buildFooter() {
    const bar = document.createElement('div');
    bar.className = 'rf-contact-footer';
    bar.setAttribute('role', 'contentinfo');
    bar.setAttribute('aria-label', 'Relic Forge contact links');

    const inner = document.createElement('div');
    inner.className = 'rf-contact-footer-inner';

    const mark = document.createElement('span');
    mark.className = 'rf-contact-footer-mark';
    mark.textContent = 'RELIC FORGE';
    inner.appendChild(mark);

    const nav = document.createElement('nav');
    nav.className = 'rf-contact-footer-links';
    nav.setAttribute('aria-label', 'Relic Forge social and contact links');

    LINKS.forEach((item, index) => {
      const link = document.createElement('a');
      link.href = item.href;
      link.setAttribute('aria-label', item.aria);
      if (item.href.startsWith('https://')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }

      const label = document.createElement('span');
      label.className = 'rf-contact-footer-label';
      label.textContent = item.label;

      const value = document.createElement('strong');
      value.textContent = item.value;

      link.append(label, value);
      nav.appendChild(link);

      if (index < LINKS.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'rf-contact-footer-separator';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '·';
        nav.appendChild(sep);
      }
    });

    inner.appendChild(nav);
    bar.appendChild(inner);
    return bar;
  }

  function install() {
    if (document.querySelector('.rf-contact-footer')) return;
    document.body.appendChild(buildFooter());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
