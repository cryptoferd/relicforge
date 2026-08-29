# RelicForge RC4.2 â€” Collection Fee Controls + Founder Support Mode

## Per-collection fee administration

There is no global platform-fee switch.

Each Minter Supported collection has independent platform fee state.

The RelicForge `platformAdmin` can:

- turn platform fees ON/OFF for one collection;
- change that collection's active USD-cents-per-NFT fee;
- clear an override and return to the collection's creation-time base rate;
- permanently waive a collection;
- change future Sponsored and Minter Supported default rates;
- change the platform treasury.

The hard fee ceiling is $5.00/NFT.

Changing one collection never changes another collection.

Sponsored collections are settled at creation. Their creator pays the quoted Sponsored fee upfront and their minters do not later incur platform mint fees.

## Founder Support Mode

Founder Support Mode exists only in RelicForge Cloud/Studio infrastructure.

It does not grant smart-contract authority.

Founder wallets are configured server-side with:

`FOUNDER_WALLETS=0xFounderWallet[,0xBackupFounderWallet]`

Founder authentication still requires normal wallet signature login.

Founder Support Mode can:

- list creator cloud projects;
- open a creator project and its Railway Bucket project assets;
- upload replacement project assets while troubleshooting;
- save a troubleshooting fix as a new project version;
- review support audit history.

Founder Support Mode cannot:

- impersonate the creator wallet;
- obtain the creator private key;
- sign creator transactions;
- change collection controller;
- change creator payout/royalty settings onchain;
- mint, reveal, seal, renounce, or launch on the creator's behalf without the creator's own signature;
- delete a creator project through the founder API.

Every founder project open/save is recorded in `founder_support_audit`.
Founder saves require a troubleshooting note.
