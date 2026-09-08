# Shared standalone 1/1 metadata categories

Release: RF26-OneOfOne-Metadata-R1

## Behavior

The standalone artwork editor offers existing metadata categories and a Create New Category option. Existing labels are gathered from visible generative categories, saved custom categories, and all standalone 1/1 metadata rows in the current project. A custom category remains available after its last row is removed. Names are matched using Unicode NFKC, case-insensitive comparison, and collapsed whitespace. The first canonical spelling is retained; punctuation is not discarded.

Creating a name that already exists reuses the existing category. The category's display name is stored in each metadata row, preserving the existing flat trait_type/value onchain format. Each 1/1 retains independent values, token-name and description overrides, and the optional default 1/1 attribute.

An identical category/value pair on one token is rejected, including a collision with the enabled default attribute. Different values under the same category are permitted. Incomplete nonempty rows are reported and block compilation; completely empty draft rows are ignored for export. No existing row is silently deduplicated or deleted.

## Persistence and compatibility

The project snapshot schema remains relic-forge/studio-save@1. A new optional state.oneOfOneMetadataCategories string array stores reusable custom labels. Old saves restore without modification to their metadata rows, and their existing categories are added to the reusable catalog. Canonical spelling is applied to in-memory rows only after successful validation. Original artwork, metadata values, and all other project state are preserved. The same field is included in the human-readable project configuration and manifest exports. Editable project configuration retains unfinished original metadata rows; final manifests use validated canonical rows. No SQL migration, contract change, or new chain-specific state is required.

Studio's Step 4 compiler and the onchain compiler validate metadata before producing a new artifact. A metadata edit invalidates the cached onchain compilation. The Forge compiler obtains validated rows through RelicForgeStudioBridge.getOneOfOneMetadataRows. Future compiler paths must preserve this validation and the canonical category spelling. No deployed contract, ABI, or metadata encoding is changed by this feature.

## Mainnet release carry-forward

This overlay is based on R4 commit ef328f5416604a0ac86c2bdd1d94f4bd14995dc9, tree 1971e116da3870f565b8fabe4590f7deac7ec5c4. The production Solidity tree remains a330c9a1aba50c6a0d3e5b0bedb85d1435f19171. Parts 1–4 and Part 5A are historical release evidence; do not regenerate or relabel their compiler artifacts. The next Mainnet implementation package must inspect the new commit, verify that the production Solidity tree is unchanged, and explicitly carry this Studio feature forward. Existing transaction journals, deployment identities, and disabled Mainnet activation gates remain unchanged.

This is a Studio feature commit, not a Mainnet deployment, contract audit, or authorization to broadcast transactions.
