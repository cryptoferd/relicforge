# Studio Integration Plan for Contracts V1

The current v11.1.6 Sepolia workflow remains operational. Do not point production/mainnet Studio at these contracts until V1 passes the release gates.

## New Studio surfaces

### Mint Control

- Master Mint: PAUSED / ARMED.
- Create/edit/delete-before-use style phase management in Studio (onchain phases are disabled rather than physically deleted).
- Per phase: label stored offchain for presentation, public/whitelist type, price, allocation, max/wallet, priority, Merkle list, dynamic start and end.
- `Start Now` changes start timestamp to current time and enables phase.
- Pause/Resume toggles the phase.
- Countdown reads current onchain phase timestamps and updates automatically.
- Connected wallet eligibility should show every qualifying active tier and automatically select the highest priority/best tier.

### Reveal Control

- Current minted / revealed / deferred counts.
- `Reveal Minted Tokens` creates an epoch snapshot.
- Future Reveal Mode toggle: Creator/Epoch or Forge.
- Reveal request history and VRF status.
- Permissionless `processReveal` progress UI for large epochs.

### Ownership & Funds

- Creator/controller address.
- Primary payout receiver.
- ERC-2981 royalty receiver and BPS.
- Irreversible Renounce Control flow with prominent warnings and a final state preview.

### Moderation

RelicForge directory visibility is a backend/site record only. No moderation control is added to the NFT contract.

### Collaboration

Collaborators belong to wallet-scoped cloud project permissions. Editors may prepare art, traits, phases and lists, but creator signature remains required for launch and all V1 onchain admin actions.

## Production chain registry

Studio production mode should use a checked-in chain registry containing canonical audited factory/renderer/randomness adapter addresses and expected bytecode/version hashes. It should not browser-compile production infrastructure on demand.
