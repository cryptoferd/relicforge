param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

$ErrorActionPreference = "Stop"

function Fail-R9Verify([string]$Message) {
    throw "R9 INFRASTRUCTURE VERIFICATION FAILED: $Message"
}

function Import-RelicDotEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) { continue }
        if ($trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { continue }

        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Address-Word([string]$Address) {
    if ($Address -notmatch '^0x[0-9a-fA-F]{40}$') { Fail-R9Verify "Invalid address for constructor encoding." }
    return ("0" * 24) + $Address.Substring(2).ToLowerInvariant()
}

function Uint-Word([object]$Value) {
    $text = [string]$Value
    $number = [System.Numerics.BigInteger]::Parse(
        $text,
        [System.Globalization.CultureInfo]::InvariantCulture
    )
    if ($number.Sign -lt 0) { Fail-R9Verify "Negative constructor uint." }
    $hex = $number.ToString("x")
    if ($hex.Length -gt 64) { Fail-R9Verify "Constructor uint too large." }
    return $hex.PadLeft(64, "0")
}

function Static-Args([string[]]$Words) {
    return "0x" + ($Words -join "")
}

function Invoke-RelicVerify(
    [string]$Address,
    [string]$ContractId,
    [string]$ConstructorArgs = ""
) {
    Write-Host "Verifying $ContractId at $Address" -ForegroundColor Cyan

    $args = @(
        "verify-contract",
        $Address,
        $ContractId,
        "--chain",
        "sepolia",
        "--etherscan-api-key",
        $env:ETHERSCAN_API_KEY,
        "--watch"
    )
    if (-not [string]::IsNullOrWhiteSpace($ConstructorArgs)) {
        $args += @("--constructor-args", $ConstructorArgs)
    }

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        & forge @args
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Verified: $ContractId" -ForegroundColor Green
            Start-Sleep -Milliseconds 2200
            return
        }

        if ($attempt -lt 3) {
            $wait = 12 * $attempt
            Write-Host "Verification attempt $attempt failed; waiting $wait seconds for the free-tier/indexer..." -ForegroundColor Yellow
            Start-Sleep -Seconds $wait
        }
    }

    Fail-R9Verify "Unable to verify $ContractId after 3 attempts."
}

Import-RelicDotEnv (Join-Path $RepoPath ".env")

if ([string]::IsNullOrWhiteSpace($env:ETHERSCAN_API_KEY)) {
    Fail-R9Verify "ETHERSCAN_API_KEY is not set."
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    Fail-R9Verify "Deployment manifest missing: $ManifestPath"
}

Set-Location -LiteralPath $RepoPath
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

Write-Host "Etherscan Free-tier mode: conservative sequential verification" -ForegroundColor Yellow
Write-Host "Pacing: >= 2.2 seconds between completed contract verifications" -ForegroundColor Yellow

Invoke-RelicVerify $manifest.collectionImplementation "contracts/production/v2/RelicCollectionV2.sol:RelicCollectionV2"
Invoke-RelicVerify $manifest.dataImplementation "contracts/production/RelicProjectDataV1.sol:RelicProjectDataV1"
Invoke-RelicVerify $manifest.mintPhasesImplementation "contracts/production/v2/RelicMintPhasesV2.sol:RelicMintPhasesV2"
Invoke-RelicVerify $manifest.renderer "contracts/production/RelicRendererV1.sol:RelicRendererV1"
Invoke-RelicVerify $manifest.canonicalRegistry "contracts/production/v2/RelicForgeCanonicalRegistryV2.sol:RelicForgeCanonicalRegistryV2"

$reserveArgs = Static-Args @(
    (Address-Word $manifest.reserveFounder),
    (Address-Word $manifest.reserveRevenueTreasury),
    (Uint-Word $manifest.reserveMinimumWei),
    (Uint-Word $manifest.reserveActiveBatchBufferWei),
    (Uint-Word $manifest.reserveExposureSafetyBps),
    (Uint-Word $manifest.reserveMaxSubsidyPerRequestWei),
    (Uint-Word $manifest.reserveMaxSubsidyPerCollectionWei)
)
Invoke-RelicVerify $manifest.reserve "contracts/production/v2/RelicForgeReserveV2.sol:RelicForgeReserveV2" $reserveArgs

$adapterArgs = Static-Args @(
    (Uint-Word $manifest.chainId),
    (Address-Word $manifest.chainlinkVrfWrapper),
    (Address-Word $manifest.canonicalRegistry),
    (Uint-Word $manifest.requestConfirmations)
)
Invoke-RelicVerify $manifest.randomnessAdapter "contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol:RelicChainlinkVRFV25DirectAdapterV2" $adapterArgs

$feePolicyArgs = Static-Args @(
    (Address-Word $manifest.platformAdmin),
    (Address-Word $manifest.feeTreasury),
    (Address-Word $manifest.ethUsdPriceFeed),
    (Uint-Word $manifest.feeOracleMaxAgeSeconds)
)
Invoke-RelicVerify $manifest.feePolicy "contracts/production/RelicForgeFeePolicyV1.sol:RelicForgeFeePolicyV1" $feePolicyArgs

$factoryArgs = Static-Args @(
    (Address-Word $manifest.collectionImplementation),
    (Address-Word $manifest.dataImplementation),
    (Address-Word $manifest.mintPhasesImplementation),
    (Address-Word $manifest.renderer),
    (Address-Word $manifest.randomnessAdapter),
    (Address-Word $manifest.canonicalRegistry),
    (Address-Word $manifest.reserve),
    (Address-Word $manifest.feePolicy)
)
Invoke-RelicVerify $manifest.factory "contracts/production/v2/RelicForgeFactoryV2.sol:RelicForgeFactoryV2" $factoryArgs

Write-Host ""
Write-Host "R9 shared infrastructure source verification: COMPLETE" -ForegroundColor Green
