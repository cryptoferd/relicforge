# Relic Forge V10.10.0 Sepolia test checklist

## Studio editing
- [ ] Upload an organized folder, then add another trait into an existing layer with **Add Trait Artwork**.
- [ ] Create a new empty layer later, add several traits to it, rename it, remove a trait, and verify the saved project restores those edits.
- [ ] Delete a layer and verify manual recipes/rules referencing it are cleaned up.

## Metadata visibility
- [ ] Enable `None` on a layer and check **Hide all None traits from token metadata**.
- [ ] Hide an entire normal category from metadata.
- [ ] Hide one normal trait from metadata while leaving other traits in that category visible.
- [ ] Build and compile the collection; verify the metadata choices are included in provenance/compile output.

## 1/1 metadata
- [ ] Upload at least one full 1/1.
- [ ] Give it a custom token name and description.
- [ ] Add two custom metadata rows, e.g. `Edition = Genesis` and `Artifact = Crown`.
- [ ] Save/reload the Studio project and confirm the custom fields restore.

## Solidity / deployment
- [ ] Step 5 -> Compile Contracts reports zero errors.
- [ ] Deploy fresh V10.10 Sepolia test infrastructure.
- [ ] Forge a small collection.
- [ ] Mint/reveal normal layered NFTs and inspect `tokenURI()`.
- [ ] Confirm a token using `None` omits that category when global None hiding is enabled.
- [ ] Confirm a hidden category never appears in `attributes` but its artwork still renders.
- [ ] Confirm a hidden trait omits its attribute only on tokens using that trait.
- [ ] Reveal the full 1/1 and confirm its custom token name, description, and custom attributes are returned onchain.

## V10.10.1 rarity-page incremental upload
- Add a new trait from Step 2 using **+ Add Trait Artwork** on an existing category.
- Confirm the trait appears immediately with a blank/auto percentage or exact amount.
- Confirm manually pinned values remain unchanged after **Auto Fill Remainder**.
- Remove a trait from Step 2 and confirm curated-token/rule references are cleaned up.
- No infrastructure redeploy is required for this UI/compiler update.
