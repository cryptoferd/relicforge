# RelicForge V11.0.7 — Alchemy EVM Endpoint Registry

Registry snapshot: **2026-08-23**. Endpoint bases are non-secret and are sourced from Alchemy's supported-network catalog. `ALCHEMY_API_KEY` is appended only on the Railway server.

- Cataloged EVM endpoint variants: **133**
- Endpoint variants with built-in numeric chain-ID routing: **88**
- Entries without a built-in chain ID remain available by endpoint key through `ALCHEMY_NETWORK_OVERRIDES_JSON`.
- RelicForge still enables **forging only on validated deployment chains**; RPC/snapshot support does not imply deployment support.

| Platform | Network | Chain ID | Endpoint base |
|---|---|---:|---|
| World Chain | World Chain Mainnet | 480 | `https://worldchain-mainnet.g.alchemy.com/v2` |
| World Chain | World Chain Sepolia | 4801 | `https://worldchain-sepolia.g.alchemy.com/v2` |
| Shape | Shape Mainnet | 360 | `https://shape-mainnet.g.alchemy.com/v2` |
| Shape | Shape Sepolia | 11011 | `https://shape-sepolia.g.alchemy.com/v2` |
| Ethereum | Ethereum Mainnet | 1 | `https://eth-mainnet.g.alchemy.com/v2` |
| Ethereum | Ethereum Sepolia | 11155111 | `https://eth-sepolia.g.alchemy.com/v2` |
| Ethereum | Ethereum Holesky | 17000 | `https://eth-holesky.g.alchemy.com/v2` |
| Ethereum | Ethereum Hoodi | 560048 | `https://eth-hoodi.g.alchemy.com/v2` |
| ZKsync | ZKsync Mainnet | 324 | `https://zksync-mainnet.g.alchemy.com/v2` |
| ZKsync | ZKsync Sepolia | 300 | `https://zksync-sepolia.g.alchemy.com/v2` |
| OP Mainnet | OP Mainnet | 10 | `https://opt-mainnet.g.alchemy.com/v2` |
| OP Mainnet | OP Sepolia | 11155420 | `https://opt-sepolia.g.alchemy.com/v2` |
| Polygon PoS | Polygon Mainnet | 137 | `https://polygon-mainnet.g.alchemy.com/v2` |
| Polygon PoS | Polygon Amoy | 80002 | `https://polygon-amoy.g.alchemy.com/v2` |
| Arbitrum | Arbitrum One | 42161 | `https://arb-mainnet.g.alchemy.com/v2` |
| Arbitrum | Arbitrum Sepolia | 421614 | `https://arb-sepolia.g.alchemy.com/v2` |
| Astar | Astar Mainnet | 592 | `https://astar-mainnet.g.alchemy.com/v2` |
| ZetaChain | ZetaChain Mainnet | 7000 | `https://zetachain-mainnet.g.alchemy.com/v2` |
| ZetaChain | ZetaChain Testnet | 7001 | `https://zetachain-testnet.g.alchemy.com/v2` |
| Mantle | Mantle Mainnet | 5000 | `https://mantle-mainnet.g.alchemy.com/v2` |
| Mantle | Mantle Sepolia | 5003 | `https://mantle-sepolia.g.alchemy.com/v2` |
| Berachain | Berachain Mainnet | 80094 | `https://berachain-mainnet.g.alchemy.com/v2` |
| Berachain | Berachain Bepolia | 80069 | `https://berachain-bepolia.g.alchemy.com/v2` |
| Blast | Blast Mainnet | 81457 | `https://blast-mainnet.g.alchemy.com/v2` |
| Blast | Blast Sepolia | 168587773 | `https://blast-sepolia.g.alchemy.com/v2` |
| Linea | Linea Mainnet | 59144 | `https://linea-mainnet.g.alchemy.com/v2` |
| Linea | Linea Sepolia | 59141 | `https://linea-sepolia.g.alchemy.com/v2` |
| Zora | Zora Mainnet | 7777777 | `https://zora-mainnet.g.alchemy.com/v2` |
| Zora | Zora Sepolia | 999999999 | `https://zora-sepolia.g.alchemy.com/v2` |
| Ronin | Ronin Mainnet | 2020 | `https://ronin-mainnet.g.alchemy.com/v2` |
| Ronin | Ronin Saigon | 2021 | `https://ronin-saigon.g.alchemy.com/v2` |
| Plasma | Plasma Mainnet | — | `https://plasma-mainnet.g.alchemy.com/v2` |
| Plasma | Plasma Testnet | — | `https://plasma-testnet.g.alchemy.com/v2` |
| Standard | Standard Mainnet | — | `https://standard-mainnet.g.alchemy.com/v2` |
| Mythos | Mythos Mainnet | — | `https://mythos-mainnet.g.alchemy.com/v2` |
| Settlus | Settlus Mainnet | — | `https://settlus-mainnet.g.alchemy.com/v2` |
| Settlus | Settlus Sepolia | — | `https://settlus-septestnet.g.alchemy.com/v2` |
| Earnm | Earnm Mainnet | — | `https://earnm-mainnet.g.alchemy.com/v2` |
| Earnm | Earnm Sepolia | — | `https://earnm-sepolia.g.alchemy.com/v2` |
| X Protocol | X Protocol Mainnet | — | `https://xprotocol-mainnet.g.alchemy.com/v2` |
| BOB | BOB Mainnet | 60808 | `https://bob-mainnet.g.alchemy.com/v2` |
| BOB | BOB Sepolia | — | `https://bob-sepolia.g.alchemy.com/v2` |
| MegaETH | MegaETH Mainnet | — | `https://megaeth-mainnet.g.alchemy.com/v2` |
| MegaETH | MegaETH Testnet | — | `https://megaeth-testnet.g.alchemy.com/v2` |
| Rootstock | Rootstock Mainnet | 30 | `https://rootstock-mainnet.g.alchemy.com/v2` |
| Rootstock | Rootstock Testnet | 31 | `https://rootstock-testnet.g.alchemy.com/v2` |
| WorldL3 | WorldL3 Devnet | — | `https://worldl3-devnet.g.alchemy.com/v2` |
| Citrea | Citrea Mainnet | — | `https://citrea-mainnet.g.alchemy.com/v2` |
| Citrea | Citrea Testnet | — | `https://citrea-testnet.g.alchemy.com/v2` |
| Tea | Tea Sepolia | — | `https://tea-sepolia.g.alchemy.com/v2` |
| Gensyn | Gensyn Mainnet | — | `https://gensyn-mainnet.g.alchemy.com/v2` |
| Gensyn | Gensyn Testnet | — | `https://gensyn-testnet.g.alchemy.com/v2` |
| Arc | Arc Testnet | — | `https://arc-testnet.g.alchemy.com/v2` |
| DATA Network | DATA Network Mainnet | 1514 | `https://story-mainnet.g.alchemy.com/v2` |
| DATA Network | DATA Network Aeneid | 1315 | `https://story-aeneid.g.alchemy.com/v2` |
| Humanity | Humanity Mainnet | — | `https://humanity-mainnet.g.alchemy.com/v2` |
| Humanity | Humanity Testnet | — | `https://humanity-testnet.g.alchemy.com/v2` |
| Base | Base Mainnet | 8453 | `https://base-mainnet.g.alchemy.com/v2` |
| Base | Base Sepolia | 84532 | `https://base-sepolia.g.alchemy.com/v2` |
| Tempo | Tempo Mainnet | — | `https://tempo-mainnet.g.alchemy.com/v2` |
| Tempo | Tempo Moderato | — | `https://tempo-moderato.g.alchemy.com/v2` |
| HyperEVM | HyperEVM Mainnet | 999 | `https://hyperliquid-mainnet.g.alchemy.com/v2` |
| HyperEVM | HyperEVM Testnet | 998 | `https://hyperliquid-testnet.g.alchemy.com/v2` |
| Galactica | Galactica Mainnet | — | `https://galactica-mainnet.g.alchemy.com/v2` |
| Galactica | Galactica Cassiopeia | — | `https://galactica-cassiopeia.g.alchemy.com/v2` |
| Lens | Lens Mainnet | 232 | `https://lens-mainnet.g.alchemy.com/v2` |
| Lens | Lens Sepolia | 37111 | `https://lens-sepolia.g.alchemy.com/v2` |
| World Mobile Chain | World Mobile Chain Mainnet | — | `https://worldmobilechain-mainnet.g.alchemy.com/v2` |
| Frax | Frax Mainnet | 252 | `https://frax-mainnet.g.alchemy.com/v2` |
| Frax | Frax Hoodi | 2522 | `https://frax-hoodi.g.alchemy.com/v2` |
| Ink | Ink Mainnet | 57073 | `https://ink-mainnet.g.alchemy.com/v2` |
| Ink | Ink Sepolia | 763373 | `https://ink-sepolia.g.alchemy.com/v2` |
| Avalanche | Avalanche C-Chain Mainnet | 43114 | `https://avax-mainnet.g.alchemy.com/v2` |
| Avalanche | Avalanche Fuji | 43113 | `https://avax-fuji.g.alchemy.com/v2` |
| Gnosis | Gnosis Mainnet | 100 | `https://gnosis-mainnet.g.alchemy.com/v2` |
| Gnosis | Gnosis Chiado | 10200 | `https://gnosis-chiado.g.alchemy.com/v2` |
| BNB Smart Chain | BNB Smart Chain Mainnet | 56 | `https://bnb-mainnet.g.alchemy.com/v2` |
| BNB Smart Chain | BNB Smart Chain Testnet | 97 | `https://bnb-testnet.g.alchemy.com/v2` |
| Boba | Boba Mainnet | 288 | `https://boba-mainnet.g.alchemy.com/v2` |
| Boba | Boba Sepolia | 28882 | `https://boba-sepolia.g.alchemy.com/v2` |
| Unichain | Unichain Mainnet | 130 | `https://unichain-mainnet.g.alchemy.com/v2` |
| Unichain | Unichain Sepolia | 1301 | `https://unichain-sepolia.g.alchemy.com/v2` |
| Superseed | Superseed Mainnet | 5330 | `https://superseed-mainnet.g.alchemy.com/v2` |
| Superseed | Superseed Sepolia | 53302 | `https://superseed-sepolia.g.alchemy.com/v2` |
| Rise | Rise Mainnet | — | `https://rise-mainnet.g.alchemy.com/v2` |
| Rise | Rise Testnet | — | `https://rise-testnet.g.alchemy.com/v2` |
| Monad | Monad Mainnet | 143 | `https://monad-mainnet.g.alchemy.com/v2` |
| Monad | Monad Testnet | 10143 | `https://monad-testnet.g.alchemy.com/v2` |
| Flow EVM | Flow EVM Mainnet | 747 | `https://flow-mainnet.g.alchemy.com/v2` |
| Flow EVM | Flow EVM Testnet | 545 | `https://flow-testnet.g.alchemy.com/v2` |
| Openloot | Openloot Sepolia | — | `https://openloot-sepolia.g.alchemy.com/v2` |
| Worldmobile | WorldMobile Devnet | — | `https://worldmobile-devnet.g.alchemy.com/v2` |
| Worldmobile | WorldMobile Testnet | — | `https://worldmobile-testnet.g.alchemy.com/v2` |
| Unite | Unite Mainnet | — | `https://unite-mainnet.g.alchemy.com/v2` |
| Unite | Unite Testnet | — | `https://unite-testnet.g.alchemy.com/v2` |
| Degen | Degen Mainnet | 666666666 | `https://degen-mainnet.g.alchemy.com/v2` |
| Degen | Degen Sepolia | — | `https://degen-sepolia.g.alchemy.com/v2` |
| Polynomial | Polynomial Mainnet | — | `https://polynomial-mainnet.g.alchemy.com/v2` |
| Polynomial | Polynomial Sepolia | — | `https://polynomial-sepolia.g.alchemy.com/v2` |
| Mode | Mode Mainnet | 34443 | `https://mode-mainnet.g.alchemy.com/v2` |
| Mode | Mode Sepolia | 919 | `https://mode-sepolia.g.alchemy.com/v2` |
| Edge | Edge Mainnet | — | `https://edge-mainnet.g.alchemy.com/v2` |
| Edge | Edge Testnet | — | `https://edge-testnet.g.alchemy.com/v2` |
| Moonbeam | Moonbeam Mainnet | 1284 | `https://moonbeam-mainnet.g.alchemy.com/v2` |
| ApeChain | ApeChain Mainnet | 33139 | `https://apechain-mainnet.g.alchemy.com/v2` |
| ApeChain | ApeChain Curtis | 33111 | `https://apechain-curtis.g.alchemy.com/v2` |
| Celo | Celo Mainnet | 42220 | `https://celo-mainnet.g.alchemy.com/v2` |
| Celo | Celo Sepolia | 11142220 | `https://celo-sepolia.g.alchemy.com/v2` |
| Anime | Anime Mainnet | 69000 | `https://anime-mainnet.g.alchemy.com/v2` |
| Anime | Anime Sepolia | 6900 | `https://anime-sepolia.g.alchemy.com/v2` |
| Alterscope | Alterscope Mainnet | — | `https://alterscope-mainnet.g.alchemy.com/v2` |
| Metis | Metis Mainnet | 1088 | `https://metis-mainnet.g.alchemy.com/v2` |
| Sonic | Sonic Mainnet | 146 | `https://sonic-mainnet.g.alchemy.com/v2` |
| Sonic | Sonic Testnet | 57054 | `https://sonic-testnet.g.alchemy.com/v2` |
| Sei | Sei EVM Mainnet | 1329 | `https://sei-mainnet.g.alchemy.com/v2` |
| Sei | Sei EVM Testnet | 1328 | `https://sei-testnet.g.alchemy.com/v2` |
| ADI | ADI Mainnet | — | `https://adi-mainnet.g.alchemy.com/v2` |
| ADI | ADI Testnet AB | — | `https://adi-testnet.g.alchemy.com/v2` |
| Scroll | Scroll Mainnet | 534352 | `https://scroll-mainnet.g.alchemy.com/v2` |
| opBNB | opBNB Mainnet | 204 | `https://opbnb-mainnet.g.alchemy.com/v2` |
| opBNB | opBNB Testnet | 5611 | `https://opbnb-testnet.g.alchemy.com/v2` |
| Race | Race Mainnet | — | `https://race-mainnet.g.alchemy.com/v2` |
| Race | Race Sepolia | — | `https://race-sepolia.g.alchemy.com/v2` |
| CrossFi | CrossFi Mainnet | 4158 | `https://crossfi-mainnet.g.alchemy.com/v2` |
| CrossFi | CrossFi Testnet | 4157 | `https://crossfi-testnet.g.alchemy.com/v2` |
| Abstract | Abstract Mainnet | 2741 | `https://abstract-mainnet.g.alchemy.com/v2` |
| Abstract | Abstract Testnet | 11124 | `https://abstract-testnet.g.alchemy.com/v2` |
| Soneium | Soneium Mainnet | 1868 | `https://soneium-mainnet.g.alchemy.com/v2` |
| Soneium | Soneium Minato | 1946 | `https://soneium-minato.g.alchemy.com/v2` |
| Stable | Stable Mainnet | — | `https://stable-mainnet.g.alchemy.com/v2` |
| Stable | Stable Testnet | — | `https://stable-testnet.g.alchemy.com/v2` |
| Robinhood Chain | Robinhood Chain Mainnet | 4663 | `https://robinhood-mainnet.g.alchemy.com/v2` |
| Robinhood Chain | Robinhood Chain Testnet | 46630 | `https://robinhood-testnet.g.alchemy.com/v2` |
