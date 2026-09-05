# Relic Forge R12-v2 R11 R4 - FeePolicy Hardening R2

R4 R1 passed the first adversarial wave and surfaced one concrete mainnet-hardening issue:
RelicForgeFeePolicyV1 allowed immediate one-step treasury and platform-admin rotation.

R2 closes that issue without changing RelicCollectionV2 or RelicForgeReserveV2.

For ABI compatibility, the existing names remain but become proposal-only:
- setTreasury(newTreasury) records pendingTreasury.
- newTreasury must call acceptTreasury().
- transferPlatformAdmin(newAdmin) records pendingPlatformAdmin.
- newAdmin must call acceptPlatformAdmin().
- accepted admin handoff clears any pending treasury proposal created by the old admin.

This reduces accidental-address risk and forces control transfer to prove possession of the destination.
It does not replace multisig security: mainnet platformAdmin and Reserve founder should still be
hardware-backed multisigs, with a separate treasury multisig.

R2 reruns the R4 attack scan, R4 attacker harness, dedicated FeePolicy hardening tests,
PlatformFeeSecurity, R11 Reserve/revenue tests, the full repository, and the Collection runtime freeze.

No transaction is broadcast.
Mainnet activation remains disabled.
