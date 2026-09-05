# Forge Reveal V2 — Phase 1 Test Plan

The Phase 1 prototype must answer these questions before production code is touched.

## Forge Reveal

- Does a request reserve supply without minting a placeholder?
- Can pending requests oversell supply?
- Are random token IDs unique across the full supply?
- Does `tokenId - 1` safely act as the recipe ID?
- Can callbacks arrive out of order without changing draw order?
- Does a later fulfilled request correctly wait for an earlier missing sequence?
- Can ready backlogs be permissionlessly settled?
- What callback gas is required for 1, 5, 10, 20 and 50 NFTs?
- What provider callback-gas limits exist on each target chain?
- What is the per-request randomness fee on each provider/chain?

## Reveal Later

- Can one random word reveal a 10,000-domain permutation?
- Is the mapping bijective for arbitrary collection sizes?
- Is reveal callback gas effectively independent of supply?
- Is future minting blocked once the reveal mapping becomes public?
- Does the renderer need any changes beyond `recipeForToken()` behavior?

## Security follow-up

Phase 2 must add adversarial tests for:
- malicious/duplicate provider request IDs;
- provider callback replay;
- callback reentrancy;
- request cancellation/refund policy;
- provider outage/timeouts;
- creator pause while Forge reservations are pending;
- payout accounting while mint requests are pending;
- batch mint pricing and platform-fee accounting;
- renunciation with unresolved reservations;
- forced settlement after out-of-order callback backlog;
- ERC-721 receiver safety when minting from callback;
- callback gas exhaustion and exact-word replay recovery.

No production deployment decision is made from Phase 1 alone.
