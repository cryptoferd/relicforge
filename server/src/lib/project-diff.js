const SECTION_IDS = Object.freeze(['artwork', 'rarity', 'rules', 'curation', 'launch', 'mint_page']);
const PROTECTED_FORGE_FIELDS = Object.freeze(['collectionAddress', 'dataAddress', 'publicPhaseId', 'whitelistPhaseId']);

function jsonClone(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}

function same(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function fileIdentity(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  if (value.__relicforgeAsset) {
    return {
      __relicforgeAsset: 1,
      id: value.id || null,
      name: value.name || null,
      type: value.type || null,
      size: Number(value.size || 0),
      sha256: value.sha256 || null,
    };
  }
  return {
    name: value.name || null,
    type: value.type || null,
    size: Number(value.size || 0),
    lastModified: Number(value.lastModified || 0),
  };
}

function studioState(snapshot) {
  return snapshot?.studio?.state || snapshot?.studio || {};
}

function studioUi(snapshot) {
  return snapshot?.studio?.ui || {};
}

function artworkProjection(snapshot) {
  const state = studioState(snapshot);
  return {
    imageWidth: state.imageWidth ?? null,
    imageHeight: state.imageHeight ?? null,
    layers: (state.layers || []).map((layer, index) => ({
      index,
      id: layer?.id ?? null,
      name: layer?.name ?? null,
      traits: (layer?.traits || []).map((trait, traitIndex) => ({
        traitIndex,
        id: trait?.id ?? null,
        name: trait?.name ?? null,
        isNone: !!trait?.isNone,
        file: fileIdentity(trait?.file),
      })),
    })),
    oneOfOnes: (state.oneOfOnes || []).map((item, index) => ({
      index,
      id: item?.id ?? null,
      name: item?.name ?? null,
      file: fileIdentity(item?.file),
    })),
  };
}

function layerRarity(layer) {
  return {
    allowNone: !!layer?.allowNone,
    rarityMode: layer?.rarityMode || 'tier',
    autoFillStyle: layer?.autoFillStyle || 'gradual',
    rarityOrder: layer?.rarityOrder || 'most_to_least',
    metadataHidden: !!layer?.metadataHidden,
  };
}

function traitRarity(trait) {
  return {
    rarity: trait?.rarity || 'common',
    distribution: trait?.distribution || 'weighted',
    exactCount: trait?.exactCount ?? null,
    exactManual: !!trait?.exactManual,
    percentage: trait?.percentage == null ? null : Number(trait.percentage),
    percentageManual: !!trait?.percentageManual,
    metadataHidden: !!trait?.metadataHidden,
  };
}

function oneOfOneMetadata(item) {
  return {
    tokenName: item?.tokenName || '',
    description: item?.description || '',
    metadata: jsonClone(item?.metadata || []),
    includeDefaultAttribute: item?.includeDefaultAttribute !== false,
  };
}

const DEFAULT_LAYER_RARITY = Object.freeze({
  allowNone: false,
  rarityMode: 'tier',
  autoFillStyle: 'gradual',
  rarityOrder: 'most_to_least',
  metadataHidden: false,
});
const DEFAULT_TRAIT_RARITY = Object.freeze({
  rarity: 'common',
  distribution: 'weighted',
  exactCount: null,
  exactManual: false,
  percentage: null,
  percentageManual: false,
  metadataHidden: false,
});
const DEFAULT_ONE_OF_ONE_METADATA = Object.freeze({
  tokenName: '',
  description: '',
  metadata: [],
  includeDefaultAttribute: true,
});

function byId(values = []) {
  return new Map(values.filter(value => value?.id != null).map(value => [String(value.id), value]));
}

function rarityChanged(previous, next) {
  const prevState = studioState(previous);
  const nextState = studioState(next);
  const prevUi = studioUi(previous);
  const nextUi = studioUi(next);

  // These controls live in Studio Step 2 with rarity/metadata settings. The current
  // navigation step is intentionally excluded because it is ephemeral UI state.
  if (!same(prevUi.collectionName ?? null, nextUi.collectionName ?? null)) return true;
  if (!same(prevUi.collectionSize ?? null, nextUi.collectionSize ?? null)) return true;
  if (!!prevState.hideNoneMetadata !== !!nextState.hideNoneMetadata) return true;

  const prevLayers = byId(prevState.layers || []);
  const nextLayers = byId(nextState.layers || []);
  for (const [id, nextLayer] of nextLayers) {
    const prevLayer = prevLayers.get(id);
    if (prevLayer) {
      if (!same(layerRarity(prevLayer), layerRarity(nextLayer))) return true;
      const prevTraits = byId(prevLayer.traits || []);
      const nextTraits = byId(nextLayer.traits || []);
      for (const [traitId, nextTrait] of nextTraits) {
        const prevTrait = prevTraits.get(traitId);
        if (prevTrait) {
          if (!same(traitRarity(prevTrait), traitRarity(nextTrait))) return true;
        } else if (!same(traitRarity(nextTrait), DEFAULT_TRAIT_RARITY)) {
          // Adding artwork with default rarity belongs to Artwork & Layers only.
          // A newly-added trait carrying custom rarity/metadata still requires Rarity.
          return true;
        }
      }
    } else {
      if (!same(layerRarity(nextLayer), DEFAULT_LAYER_RARITY)) return true;
      if ((nextLayer.traits || []).some(trait => !same(traitRarity(trait), DEFAULT_TRAIT_RARITY))) return true;
    }
  }

  const prevOnes = byId(prevState.oneOfOnes || []);
  const nextOnes = byId(nextState.oneOfOnes || []);
  for (const [id, nextItem] of nextOnes) {
    const prevItem = prevOnes.get(id);
    if (prevItem) {
      if (!same(oneOfOneMetadata(prevItem), oneOfOneMetadata(nextItem))) return true;
    } else if (!same(oneOfOneMetadata(nextItem), DEFAULT_ONE_OF_ONE_METADATA)) {
      return true;
    }
  }
  return false;
}

function rulesProjection(snapshot) {
  const state = studioState(snapshot);
  return {
    rulesEnabled: !!state.rulesEnabled,
    rules: jsonClone(state.rules ?? state.traitRules ?? snapshot?.studio?.rules ?? []),
  };
}

function curationDecisionProjection(snapshot) {
  const state = studioState(snapshot);
  const ui = studioUi(snapshot);
  return {
    buildMode: state.buildMode ?? 'auto',
    manifestSourceName: state.manifestSourceName ?? '',
    manifestTokens: jsonClone(state.manifestTokens ?? []),
    seed: ui.seed ?? null,
  };
}

function curationProjection(snapshot) {
  const state = studioState(snapshot);
  return {
    ...curationDecisionProjection(snapshot),
    compiledTokens: jsonClone(state.compiledTokens ?? []),
    compilerReport: jsonClone(state.compilerReport ?? null),
  };
}

function launchProjection(snapshot) {
  const forge = { ...(snapshot?.forge || {}) };
  for (const key of ['mintPageImageFile', 'mintPageBannerFile', 'showcaseEnabled', 'showcaseStart', 'showcaseStartAt']) delete forge[key];
  for (const key of PROTECTED_FORGE_FIELDS) delete forge[key];
  return forge;
}

function mintPageProjection(snapshot) {
  const forge = snapshot?.forge || {};
  return {
    mintPageImageFile: jsonClone(forge.mintPageImageFile ?? null),
    mintPageBannerFile: jsonClone(forge.mintPageBannerFile ?? null),
    showcaseEnabled: !!forge.showcaseEnabled,
    showcaseStart: forge.showcaseStart ?? forge.showcaseStartAt ?? null,
  };
}

export function protectedDeploymentBindings(snapshot) {
  const forge = snapshot?.forge || {};
  return Object.fromEntries(PROTECTED_FORGE_FIELDS.map(key => [key, forge[key] ?? null]));
}

export function protectedDeploymentBindingsChanged(previous, next) {
  return !same(protectedDeploymentBindings(previous), protectedDeploymentBindings(next));
}

export function classifyProjectChanges(previous, next) {
  if (!previous) return [...SECTION_IDS];
  const changed = [];
  const artwork = !same(artworkProjection(previous), artworkProjection(next));
  const rarity = rarityChanged(previous, next);
  const rules = !same(rulesProjection(previous), rulesProjection(next));
  if (artwork) changed.push('artwork');
  if (rarity) changed.push('rarity');
  if (rules) changed.push('rules');

  const curationDecisionChanged = !same(curationDecisionProjection(previous), curationDecisionProjection(next));
  const curationChanged = !same(curationProjection(previous), curationProjection(next));
  // Compiled recipes/report are curation state, but Studio deliberately clears them
  // when artwork/rarity/rules invalidate an old build. Do not make an upstream editor
  // require Curation merely to save that automatic invalidation. Direct curation or
  // standalone compiled-output changes still classify as Curation.
  if (curationDecisionChanged || (curationChanged && !artwork && !rarity && !rules)) changed.push('curation');

  if (!same(launchProjection(previous), launchProjection(next))) changed.push('launch');
  if (!same(mintPageProjection(previous), mintPageProjection(next))) changed.push('mint_page');
  return changed;
}

export function validPermissionIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => String(v)).filter(v => SECTION_IDS.includes(v)))];
}

export const COLLAB_PERMISSION_IDS = SECTION_IDS;
export const PROTECTED_DEPLOYMENT_FIELDS = PROTECTED_FORGE_FIELDS;
