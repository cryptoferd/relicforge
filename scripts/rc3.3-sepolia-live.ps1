$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "RC3.3: $Message"
}

function Load-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) {
        Fail "Missing .env at repo root. Copy .env.example to .env and fill in the Sepolia values."
    }

    foreach ($line in Get-Content $Path) {
        $trim = $line.Trim()
        if (-not $trim -or $trim.StartsWith("#")) { continue }

        $eq = $trim.IndexOf("=")
        if ($eq -lt 1) { continue }

        $name = $trim.Substring(0, $eq).Trim()
        $value = $trim.Substring($eq + 1).Trim()

        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Run-ForgeScript(
    [string]$Target,
    [bool]$Broadcast,
    [bool]$Verify = $false
) {
    $args = @(
        "script",
        $Target,
        "--rpc-url", $env:SEPOLIA_RPC_URL,
        "-vvvv"
    )

    if ($Broadcast) {
        $args += @("--broadcast", "--slow")
    }

    if ($Verify -and $env:ETHERSCAN_API_KEY) {
        $args += @("--verify", "--etherscan-api-key", $env:ETHERSCAN_API_KEY)
    }

    & forge @args
    if ($LASTEXITCODE -ne 0) {
        Fail "forge script failed: $Target"
    }
}

function Get-CodeHash([string]$Address) {
    $code = (& cast code $Address --rpc-url $env:SEPOLIA_RPC_URL).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $code -or $code -eq "0x") {
        Fail "No runtime code at $Address"
    }

    return (& cast keccak $code).Trim()
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) { Fail "Not inside a Git repository." }
Set-Location $repoRoot

$branch = (& git branch --show-current).Trim()
if ($branch -ne "contracts-v1-production") {
    Fail "Wrong branch '$branch'. Expected contracts-v1-production."
}

if (-not (Get-Command forge -ErrorAction SilentlyContinue)) {
    Fail "Foundry 'forge' is not installed or not on PATH."
}
if (-not (Get-Command cast -ErrorAction SilentlyContinue)) {
    Fail "Foundry 'cast' is not installed or not on PATH."
}

Load-DotEnv (Join-Path $repoRoot ".env")

if (-not $env:SEPOLIA_RPC_URL) {
    Fail "SEPOLIA_RPC_URL is missing from .env."
}
if (-not $env:DEPLOYER_PRIVATE_KEY) {
    Fail "DEPLOYER_PRIVATE_KEY is missing from .env."
}

$chainId = (& cast chain-id --rpc-url $env:SEPOLIA_RPC_URL).Trim()
if ($LASTEXITCODE -ne 0) { Fail "Could not reach Sepolia RPC." }
if ($chainId -ne "11155111") {
    Fail "RPC chain id is $chainId, expected Ethereum Sepolia 11155111."
}

$deployer = (& cast wallet address --private-key $env:DEPLOYER_PRIVATE_KEY).Trim()
if ($LASTEXITCODE -ne 0 -or -not $deployer) {
    Fail "Could not derive the disposable test-wallet address."
}

$balanceWei = (& cast balance $deployer --rpc-url $env:SEPOLIA_RPC_URL).Trim()
if ($LASTEXITCODE -ne 0) { Fail "Could not read deployer balance." }

Write-Host ""
Write-Host "RelicForge RC3.3 - Ethereum Sepolia live Chainlink VRF test"
Write-Host "Deployer: $deployer"
Write-Host "Balance (wei): $balanceWei"
Write-Host "Chain ID: $chainId"
Write-Host "Private key: [not displayed]"
Write-Host ""

$verifyDeploy = [bool]$env:ETHERSCAN_API_KEY
if (-not $verifyDeploy) {
    Write-Warning "ETHERSCAN_API_KEY is not set. Deployment will run, but automatic source verification will be skipped."
}

Write-Host "PHASE 1/5 - Deploy immutable V1 infrastructure..."
Run-ForgeScript "script/v1/DeploySepoliaRC33V1.s.sol:DeploySepoliaRC33V1" $true $verifyDeploy

$deploymentPath = Join-Path $repoRoot "deployments/rc3.3/sepolia-deployment.json"
if (-not (Test-Path $deploymentPath)) { Fail "Deployment manifest was not created." }

$deployment = Get-Content $deploymentPath -Raw | ConvertFrom-Json
Write-Host "Factory: $($deployment.factory)"
Write-Host "Adapter: $($deployment.adapter)"
Write-Host "Initial Chainlink quote (wei): $($deployment.initialQuoteWei)"
Write-Host ""

Write-Host "PHASE 2/5 - Create, seal, fund, and mint the disposable live probe..."
Run-ForgeScript "script/v1/PrepareSepoliaRC33SmokeV1.s.sol:PrepareSepoliaRC33SmokeV1" $true $false

$smokePath = Join-Path $repoRoot "deployments/rc3.3/sepolia-smoke.json"
if (-not (Test-Path $smokePath)) { Fail "Smoke manifest was not created." }

$smoke = Get-Content $smokePath -Raw | ConvertFrom-Json
Write-Host "Probe collection: $($smoke.collection)"
Write-Host "Local request ID: $($smoke.localRequestId)"
Write-Host "Chainlink upstream request ID: $($smoke.upstreamRequestId)"
Write-Host "Request cost (wei): $($smoke.requestCostWei)"
Write-Host ""

Write-Host "PHASE 3/5 - Wait for real Chainlink VRF fulfillment..."
$deadline = (Get-Date).AddMinutes(15)
$fulfilled = $false

while ((Get-Date) -lt $deadline) {
    $result = & cast call `
        $smoke.adapter `
        "deliveries(uint256)(address,uint256,uint256,bool,bool)" `
        $smoke.localRequestId `
        --rpc-url $env:SEPOLIA_RPC_URL

    if ($LASTEXITCODE -eq 0) {
        $lines = @($result | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
        if ($lines.Count -ge 5) {
            $ready = $lines[$lines.Count - 2].ToLowerInvariant() -eq "true"
            $delivered = $lines[$lines.Count - 1].ToLowerInvariant() -eq "true"

            if ($ready -and $delivered) {
                $fulfilled = $true
                break
            }
        }
    }

    Write-Host "VRF not fulfilled yet. Checking again in 15 seconds..."
    Start-Sleep -Seconds 15
}

if (-not $fulfilled) {
    Fail "Chainlink VRF did not reach wordReady=true, delivered=true within 15 minutes. Do not redeploy or reroll; investigate the existing request."
}

Write-Host "Chainlink VRF callback delivered successfully."
Write-Host ""

Write-Host "PHASE 4/5 - Replay-idempotency check, reveal processing, and unused-credit recovery..."
Run-ForgeScript "script/v1/FinalizeSepoliaRC33SmokeV1.s.sol:FinalizeSepoliaRC33SmokeV1" $true $false

Write-Host "PHASE 5/5 - Read-only immutable wiring and end-state verification..."
Run-ForgeScript "script/v1/VerifySepoliaRC33V1.s.sol:VerifySepoliaRC33V1" $false $false

$finalPath = Join-Path $repoRoot "deployments/rc3.3/sepolia-final.json"
if (-not (Test-Path $finalPath)) { Fail "Final manifest was not created." }
$final = Get-Content $finalPath -Raw | ConvertFrom-Json

$blockNumber = (& cast block-number --rpc-url $env:SEPOLIA_RPC_URL).Trim()

$factoryHash = Get-CodeHash $deployment.factory
$adapterHash = Get-CodeHash $deployment.adapter
$collectionHash = Get-CodeHash $smoke.collection
$dataHash = Get-CodeHash $smoke.projectData

$reportPath = Join-Path $repoRoot "deployments/rc3.3/SEPOLIA_LIVE_REPORT.md"
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$report = @"
# RelicForge Contracts V1 - RC3.3 Ethereum Sepolia Live Report

Generated: $timestamp

## Network

- Chain: Ethereum Sepolia
- Chain ID: 11155111
- Verification block: $blockNumber
- Deployer/test wallet: ``$deployer``

## Chainlink VRF v2.5

- Wrapper: ``$($deployment.chainlinkWrapper)``
- Coordinator: ``$($deployment.chainlinkCoordinator)``
- LINK token: ``$($deployment.linkToken)``
- Callback gas limit: $($deployment.callbackGasLimit)
- Request confirmations: $($deployment.requestConfirmations)
- Immutable max request price: $($deployment.maxRequestPriceWei) wei
- Initial wrapper quote: $($deployment.initialQuoteWei) wei

## RelicForge V1 infrastructure

- Collection implementation: ``$($deployment.collectionImplementation)``
- Data implementation: ``$($deployment.dataImplementation)``
- Renderer: ``$($deployment.renderer)``
- Direct-funded VRF adapter: ``$($deployment.adapter)``
- Immutable factory: ``$($deployment.factory)``

## Live disposable probe

- Collection: ``$($smoke.collection)``
- Project data: ``$($smoke.projectData)``
- Local randomness request ID: $($smoke.localRequestId)
- Chainlink upstream request ID: $($smoke.upstreamRequestId)
- Actual request cost: $($smoke.requestCostWei) wei
- Returned recipe: $($final.recipe)
- Random word recorded: yes
- Adapter delivery completed: yes
- Idempotent replay check: passed
- Bounded reveal processing: passed
- Canonical tokenURI/render: passed
- Unused per-collection VRF credit recovered: passed
- Read-only immutable wiring verification: passed

## Runtime code hashes at verification block

- Factory: ``$factoryHash``
- Adapter: ``$adapterHash``
- Probe collection clone: ``$collectionHash``
- Probe data clone: ``$dataHash``

## Explorer links

- Factory: https://sepolia.etherscan.io/address/$($deployment.factory)
- Adapter: https://sepolia.etherscan.io/address/$($deployment.adapter)
- Probe collection: https://sepolia.etherscan.io/address/$($smoke.collection)
- Project data: https://sepolia.etherscan.io/address/$($smoke.projectData)

## Result

**RC3.3 live Chainlink VRF integration passed on Ethereum Sepolia.**

This report is testnet evidence only. It is not an external security audit and does not make the contracts mainnet-ready.
"@

[System.IO.File]::WriteAllText($reportPath, $report, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "RC3.3 LIVE SEPOLIA TEST PASSED"
Write-Host "Report: $reportPath"
Write-Host ""
Write-Host "Public deployment evidence is ready to review/commit:"
git status --short deployments/rc3.3
