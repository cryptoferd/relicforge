$ErrorActionPreference = "Stop"

function Fail([string]$Message) { throw "RC4.3: $Message" }

function Load-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) { Fail "Missing .env at repo root." }
    foreach ($line in Get-Content $Path) {
        $trim = $line.Trim()
        if (-not $trim -or $trim.StartsWith("#")) { continue }
        $eq = $trim.IndexOf("=")
        if ($eq -lt 1) { continue }
        $name = $trim.Substring(0, $eq).Trim()
        $value = $trim.Substring($eq + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Require-Address([string]$Name, [string]$Value) {
    if (-not $Value) { Fail "$Name is missing from .env." }
    $checked = (& cast to-check-sum-address $Value 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $checked) { Fail "$Name is not a valid EVM address." }
    return $checked
}

function Require-Code([string]$Name, [string]$Address) {
    $code = (& cast code $Address --rpc-url $env:SEPOLIA_RPC_URL).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $code -or $code -eq "0x") { Fail "$Name has no runtime code at $Address" }
}

function Call-Address([string]$Address, [string]$Signature) {
    $value = (& cast call $Address $Signature --rpc-url $env:SEPOLIA_RPC_URL).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "cast call failed: $Signature on $Address" }
    return $value
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) { Fail "Not inside a Git repository." }
Set-Location $repoRoot

$branch = (& git branch --show-current).Trim()
if ($branch -ne "contracts-v1-production") { Fail "Wrong branch '$branch'. Expected contracts-v1-production." }
if (git status --porcelain) { Fail "Working tree must be clean before canonical deployment." }

if (-not (Get-Command forge -ErrorAction SilentlyContinue)) { Fail "forge is not on PATH." }
if (-not (Get-Command cast -ErrorAction SilentlyContinue)) { Fail "cast is not on PATH." }

Load-DotEnv (Join-Path $repoRoot ".env")
if (-not $env:SEPOLIA_RPC_URL) { Fail "SEPOLIA_RPC_URL is missing from .env." }
if (-not $env:DEPLOYER_PRIVATE_KEY) { Fail "DEPLOYER_PRIVATE_KEY is missing from .env." }

$platformAdmin = Require-Address "PLATFORM_ADMIN" $env:PLATFORM_ADMIN
$feeTreasury = Require-Address "FEE_TREASURY" $env:FEE_TREASURY

$chainId = (& cast chain-id --rpc-url $env:SEPOLIA_RPC_URL).Trim()
if ($LASTEXITCODE -ne 0 -or $chainId -ne "11155111") { Fail "RPC must be Ethereum Sepolia (11155111); got '$chainId'." }

$deployer = (& cast wallet address --private-key $env:DEPLOYER_PRIVATE_KEY).Trim()
if ($LASTEXITCODE -ne 0 -or -not $deployer) { Fail "Could not derive deployer address." }
$balanceWei = (& cast balance $deployer --rpc-url $env:SEPOLIA_RPC_URL).Trim()
if ($LASTEXITCODE -ne 0) { Fail "Could not read deployer balance." }
$sourceCommit = (& git rev-parse HEAD).Trim()

$feed = "0x694AA1769357215DE4FAC081bf1f309aDC325306"
$feedDescription = (& cast call $feed "description()(string)" --rpc-url $env:SEPOLIA_RPC_URL).Trim()
& cast call $feed "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url $env:SEPOLIA_RPC_URL | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Could not read the Sepolia ETH/USD feed." }

$gasPrice = (& cast gas-price --rpc-url $env:SEPOLIA_RPC_URL).Trim()
if ($LASTEXITCODE -ne 0 -or -not $gasPrice -or [bigint]$gasPrice -le 0) { Fail "Could not read current Sepolia gas price." }
$env:RC43_SIM_GAS_PRICE_WEI = $gasPrice

Write-Host ""
Write-Host "RelicForge RC4.3 - canonical V1 Ethereum Sepolia deployment"
Write-Host "Source commit: $sourceCommit"
Write-Host "Deployer: $deployer"
Write-Host "Deployer balance (wei): $balanceWei"
Write-Host "Platform admin: $platformAdmin"
Write-Host "Fee treasury: $feeTreasury"
Write-Host "Price feed: $feed - $feedDescription"
Write-Host "Gas price (wei): $gasPrice"
Write-Host "Private key: [not displayed]"
Write-Host ""

Write-Host "Preflight - build + full V1 tests..."
& forge build
if ($LASTEXITCODE -ne 0) { Fail "forge build failed." }
& forge test
if ($LASTEXITCODE -ne 0) { Fail "forge test failed. Deployment aborted." }

Write-Host ""
Write-Host "DEPLOYING CANONICAL RC4.2 V1 STACK..."
$args = @(
    "script",
    "script/v1/DeploySepoliaRC43V1.s.sol:DeploySepoliaRC43V1",
    "--rpc-url", $env:SEPOLIA_RPC_URL,
    "--gas-price", $gasPrice,
    "--broadcast",
    "--slow",
    "-vvvv"
)
if ($env:ETHERSCAN_API_KEY) {
    $args += @("--verify", "--etherscan-api-key", $env:ETHERSCAN_API_KEY)
} else {
    Write-Warning "ETHERSCAN_API_KEY is not set. Deployment will proceed without automatic source verification."
}

& forge @args
if ($LASTEXITCODE -ne 0) {
    Fail "Canonical deployment failed. DO NOT rerun blindly if transactions were broadcast; inspect broadcast/ first."
}

$manifestPath = Join-Path $repoRoot "deployments/rc4.3/sepolia-v1.json"
if (-not (Test-Path $manifestPath)) { Fail "Deployment manifest was not created." }
$m = Get-Content $manifestPath -Raw | ConvertFrom-Json

Write-Host ""
Write-Host "Verifying deployed runtime code and bindings..."
Require-Code "Collection implementation" $m.collectionImplementation
Require-Code "ProjectData implementation" $m.dataImplementation
Require-Code "Renderer" $m.renderer
Require-Code "Randomness adapter" $m.randomnessAdapter
Require-Code "Fee policy" $m.feePolicy
Require-Code "Factory" $m.factory

$factoryFeePolicy = Call-Address $m.factory "feePolicy()(address)"
$adapterFactory = Call-Address $m.randomnessAdapter "factory()(address)"
$policyAdmin = Call-Address $m.feePolicy "platformAdmin()(address)"
$policyTreasury = Call-Address $m.feePolicy "treasury()(address)"
$sponsoredCents = Call-Address $m.feePolicy "sponsoredFeeCents()(uint32)"
$minterCents = Call-Address $m.feePolicy "minterFeeCents()(uint32)"
$feeCap = Call-Address $m.feePolicy "MAX_COLLECTION_FEE_CENTS()(uint32)"

if ($factoryFeePolicy.ToLowerInvariant() -ne $m.feePolicy.ToLowerInvariant()) { Fail "Factory feePolicy wiring mismatch." }
if ($adapterFactory.ToLowerInvariant() -ne $m.factory.ToLowerInvariant()) { Fail "VRF adapter factory wiring mismatch." }
if ($policyAdmin.ToLowerInvariant() -ne $platformAdmin.ToLowerInvariant()) { Fail "Platform admin mismatch." }
if ($policyTreasury.ToLowerInvariant() -ne $feeTreasury.ToLowerInvariant()) { Fail "Fee treasury mismatch." }
if ([int]$sponsoredCents -ne 25 -or [int]$minterCents -ne 50 -or [int]$feeCap -ne 500) { Fail "Unexpected fee defaults/cap." }

$manifest = [ordered]@{}
$m.psobject.Properties | ForEach-Object { $manifest[$_.Name] = $_.Value }
$manifest["sourceCommit"] = $sourceCommit
$manifest["deployedAtUtc"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$manifest["network"] = "Ethereum Sepolia"
$manifest["canonicalForStudio"] = $true
$json = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($manifestPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))

$addressConfigPath = Join-Path $repoRoot "relicforge-v1-addresses.js"
$addressJs = @"
(function () {
  'use strict';
  window.RELICFORGE_V1_ADDRESSES = Object.freeze({
    11155111: Object.freeze({
      chainId: 11155111,
      network: 'Ethereum Sepolia',
      factory: '$($m.factory)',
      feePolicy: '$($m.feePolicy)',
      collectionImplementation: '$($m.collectionImplementation)',
      dataImplementation: '$($m.dataImplementation)',
      renderer: '$($m.renderer)',
      randomnessAdapter: '$($m.randomnessAdapter)',
      ethUsdPriceFeed: '$($m.ethUsdPriceFeed)',
      chainlinkVrfWrapper: '$($m.chainlinkVrfWrapper)',
      platformAdmin: '$platformAdmin',
      feeTreasury: '$feeTreasury',
      sponsoredFeeCents: 25,
      minterFeeCents: 50,
      maxCollectionFeeCents: 500,
      sourceCommit: '$sourceCommit'
    })
  });
})();
"@
[System.IO.File]::WriteAllText($addressConfigPath, $addressJs, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "CANONICAL ADDRESSES"
Write-Host "Factory:            $($m.factory)"
Write-Host "FeePolicy:          $($m.feePolicy)"
Write-Host "Collection impl:    $($m.collectionImplementation)"
Write-Host "ProjectData impl:   $($m.dataImplementation)"
Write-Host "Renderer:           $($m.renderer)"
Write-Host "Randomness adapter: $($m.randomnessAdapter)"
Write-Host "ETH/USD feed:       $($m.ethUsdPriceFeed)"
Write-Host ""

Write-Host "Recording canonical addresses in Git..."
git add -- "deployments/rc4.3/sepolia-v1.json" "relicforge-v1-addresses.js"
if ($LASTEXITCODE -ne 0) { Fail "git add failed." }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { Fail "Staged deployment files failed git diff --check." }

git commit -m "Record canonical RC4.2 Sepolia V1 deployment"
if ($LASTEXITCODE -ne 0) { Fail "git commit failed." }
git push origin contracts-v1-production
if ($LASTEXITCODE -ne 0) { Fail "Deployment succeeded but git push failed. DO NOT redeploy. Push the existing commit manually." }

Write-Host ""
Write-Host "RC4.3 CANONICAL SEPOLIA DEPLOYMENT COMPLETE"
Write-Host "The addresses are committed and pushed to contracts-v1-production."
Write-Host "Creators should use the static Factory in relicforge-v1-addresses.js."
