# Relic Forge — Collection Builder Prototype

A local-first test build for the Relic Forge generative NFT launchpad concept.

This prototype is intentionally **static**: HTML + CSS + vanilla JavaScript with no backend, database, wallet dependency, or build step. Artwork stays in the browser while you test the collection-building workflow.

## What works in this prototype

- Upload an artwork folder containing layer folders.
- Auto-detect layers and traits from folder/file names.
- Preview uploaded artwork and change layer render order, including **drag-and-drop layer/category ordering**.
- **Simple / Advanced** mode toggle.
- Four collection workflows:
  - Generate for me.
  - Choose exact trait amounts.
  - Build exact token IDs visually from the uploaded layers.
  - Upload a premade CSV/JSON collection list.
- **Generate for me** now supports either **rarity tiers** or **exact percentages** per layer.
- Percentage mode validates each layer against **100% total** and includes **Auto Fill** based on the creator’s trait order.
- Percentage rarity order is **drag-and-drop** — grab the handle on a trait card and move it into place.
- Each layer can choose **Descending — common first** or **Ascending — rarest first** before Auto Fill.
- Common / Uncommon / Rare / Very Rare / Legendary weighting.
- Hard **exact-count** traits such as “exactly 250 Green Shirts.”
- Optional **None** trait per layer, with toggleable enable/disable and rarity/percentage support.
- Imported token recipes are rendered from the uploaded layers; the import does **not** contain finished NFT images.
- Full or partial token recipes. A partial recipe locks only the specified layers and lets the generator fill the rest.
- Visual manual curator for exact token numbers, using the same uploaded-layer recipe system as CSV/JSON import.
- Shared trait rules that can apply to **many traits across multiple layers at once**.
- Rule types:
  - Only works with
  - Doesn't work with
  - Always pair with
- Plain-English rule summaries.
- Deterministic generation seed.
- Browser-side collection compiler.
- Exact-count validation.
- Rule conflict validation/repair attempts without changing locked imported choices.
- Duplicate-combination reporting.
- Canvas-rendered NFT previews from the uploaded layers.
- Pixel-art previews render with crisp nearest-neighbor scaling instead of fuzzy interpolation.
- Export final collection manifest as JSON.
- Export final collection manifest as CSV.
- Export a prototype launch package.
- Launch settings mockup for Ethereum Mainnet and other EVM networks.

## Layer/category ordering

In Step 1, drag and drop the layer cards to change render order (background/back first → foreground/front last). The older arrow buttons are still there, but drag-and-drop is now the main workflow.

## Artwork folder structure

Choose a parent folder containing one subfolder per rendered layer:

```text
MyArtwork/
  Background/
    Blue.png
    Red.png
    Purple.png
  Body/
    Male.png
    Female.png
  Shirt/
    Green.png
    Black.png
  Eyes/
    Blue.png
    Brown.png
  Hat/
    Crown.png
    Beanie.png
```

The app uses the **immediate parent folder** of each image as its layer name.

All layers should normally use the same canvas dimensions and line up at the same origin. Transparent PNG is recommended.

## Premade collection CSV

After uploading artwork, choose **Use my collection list** and click **Download CSV Template**.

Example:

```csv
Token,Background,Body,Shirt,Eyes,Hat
1,Blue,Female,Green,Blue,Crown
2,Red,Male,Black,Brown,Beanie
3,Purple,Female,Green,Brown,Crown
```

The values must match the uploaded layer and trait names. The app validates the list before generation.

A row can also be partial:

```csv
Token,Background,Body,Shirt,Eyes,Hat
50,,Female,,,Crown
```

Token #50 will always use `Female` + `Crown`, while unspecified layers are generated.

## Premade collection JSON

```json
{
  "tokens": [
    {
      "tokenId": 1,
      "traits": {
        "Background": "Blue",
        "Body": "Female",
        "Shirt": "Green",
        "Eyes": "Blue",
        "Hat": "Crown"
      }
    },
    {
      "tokenId": 50,
      "traits": {
        "Body": "Female",
        "Hat": "Crown"
      }
    }
  ]
}
```

## Shared rules across multiple layers

The Rules screen lets you accumulate a source selection across as many layers as needed. Example:

1. Select `Female Body` from Body.
2. Select several `Female Shirt` traits from Shirt.
3. Select several `Female Hair` traits from Hair.
4. Apply one shared rule against another group of traits.

Selections persist when you change the layer dropdown, so a rule is not limited to two layers.

## Run locally

You can double-click `index.html`, but folder upload and browser security behave most consistently when served over localhost.

From the repo root:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Deploy to Vercel

No Railway service is required for this prototype.

1. Create a GitHub repository.
2. Put the contents of this folder at the repository root.
3. Push to GitHub.
4. Import the repository into Vercel.
5. Choose **Other** if Vercel asks for a framework.
6. There is no build command and no output-directory configuration required for this static prototype.
7. Deploy.

`vercel.json` is included.

## Why there is no backend yet

For this stage, we want to validate the creator experience before adding infrastructure. Keeping generation local gives us a fast feedback loop and avoids uploading unreleased art while the UX is still changing.

The production architecture will eventually need backend/storage services for things such as:

- persistent projects
- large collection rendering jobs
- IPFS / Arweave / fully-onchain asset packaging
- contract deployment
- chain configuration
- mint pages
- wallet authentication
- team/project collaboration
- ERC-20 integration later

That is where Railway or another worker/backend service can become useful.

## Prototype limitations

- Smart-contract deployment is deliberately disabled.
- Artwork files are not embedded when exporting the small project-settings JSON; re-upload the layer folder after a reload.
- Very complicated rule graphs may require a stronger constraint solver in the production implementation. The prototype preserves exact trait counts and manual token choices, then attempts count-preserving swaps to satisfy rules.
- Duplicate combinations are reported but not forcibly removed when doing so would violate exact counts or locked token recipes.
- The preview renders a sample of the compiled collection rather than exporting thousands of PNG files in-browser.

## Suggested next build

After testing this with a real collection, the next logical pass is to refine the creator UX from actual pain points, then add:

1. token-by-token visual editor
2. reusable named trait groups / presets
3. stronger constraint solving and uniqueness enforcement
4. project persistence
5. collection image/metadata export worker
6. ERC-721 factory + wallet deployment flow
7. IPFS / Arweave / onchain storage options
