# Relic Forge Studio V10.10.0

V10.10.0 builds on the V10.9 Studio and adds editable metadata visibility plus custom metadata for standalone 1/1 artwork.

## V10.10.0 changes

- Layers remain editable throughout project creation: create categories manually, add one or many trait files later, rename them, remove individual traits, remove categories, or combine these controls with the original folder upload workflow.
- Added **Hide all None traits from token metadata**. None still participates in rarity/generation and renders as no artwork, but its category is omitted from a token's `attributes` when selected.
- Added **Hide category from metadata** for every normal layer. Artwork still renders; the whole category is omitted from token attributes.
- Added **Hide this trait from metadata** for every individual trait. When that trait is selected, that category/value is omitted only for those tokens.
- Added richer standalone 1/1 metadata: optional token-name override, optional description override, and arbitrary Trait Type / Value metadata rows for each full 1/1.
- Metadata visibility/custom 1/1 metadata are included in project saves, manifest exports, onchain compile provenance, and deployment-cost estimation.
- The onchain collection implementation now stores metadata-visibility flags and standalone 1/1 metadata needed to generate `tokenURI()` completely onchain.

## Important Sepolia note

V10.10 changes `RelicCollectionV1`, so deploy **fresh V10.10 test infrastructure** before testing these new metadata features. Existing older collections remain unchanged.

## GitHub deployment

Copy everything inside this folder into the root of the existing Relic Forge repository and overwrite matching files. There is still no npm/build step required.

Before deploying test infrastructure, open Studio Step 5 and use **Compile Contracts**. Do not deploy if Solidity reports any compiler errors.
