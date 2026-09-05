param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

$ErrorActionPreference = "Stop"

function Fail-R11R4Verify([string]$Message) {
    throw "R11 R4 SEPOLIA INFRASTRUCTURE VERIFICATION FAILED: $Message"
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
    if ($Address -notmatch '^0x[0-9a-fA-F]{40}$') { Fail-R11R4Verify "Invalid constructor address." }
    return ("0" * 24) + $Address.Substring(2).ToLowerInvariant()
}

function Uint-Word([object]$Value) {
    $number = [System.Numerics.BigInteger]::Parse(
        [string]$Value,
        [System.Globalization.CultureInfo]::InvariantCulture
    )
    if ($number.Sign -lt 0) { Fail-R11R4Verify "Negative constructor uint." }
    $hex = $number.ToString("x")
    if ($hex.Length -gt 64) { Fail-R11R4Verify "Constructor uint too large." }
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
        "verify-contract", $Address, $ContractId,
        "--chain", "sepolia",
        "--etherscan-api-key", $env:ETHERSCAN_API_KEY,
        "--watch"
    )
    if (-not [string]::IsNullOrWhiteSpace($ConstructorArgs)) {
        $args += @("--constructor-args", $ConstructorArgs)
    }

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        & forge @args
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Verified: $ContractId" -ForegroundColor Green
            Start-Sleep -Milliseconds 2500
            return
        }

        if ($attempt -lt 3) {
            $wait = 15 * $attempt
            Write-Host "Attempt $attempt failed; waiting $wait seconds for free-tier/indexer..." -ForegroundColor Yellow
            Start-Sleep -Seconds $wait
        }
    }

    Fail-R11R4Verify "Unable to verify $ContractId after 3 attempts."
}

Import-RelicDotEnv (Join-Path $RepoPath ".env")
if ([string]::IsNullOrWhiteSpace($env:ETHERSCAN_API_KEY)) {
    Fail-R11R4Verify "ETHERSCAN_API_KEY missing."
}
if (-not (Test-Path -LiteralPath $ManifestPath)) {
    Fail-R11R4Verify "Manifest missing."
}

Set-Location -LiteralPath $RepoPath
$m = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

Write-Host "Etherscan Free-tier mode: conservative sequential verification" -ForegroundColor Yellow
Write-Host "Pacing: >= 2.5 seconds between completed verifications" -ForegroundColor Yellow

Invoke-RelicVerify $m.collectionImplementation "contracts/production/v2/RelicCollectionV2.sol:RelicCollectionV2"
Invoke-RelicVerify $m.dataImplementation "contracts/production/RelicProjectDataV1.sol:RelicProjectDataV1"
Invoke-RelicVerify $m.mintPhasesImplementation "contracts/production/v2/RelicMintPhasesV2.sol:RelicMintPhasesV2"
Invoke-RelicVerify $m.renderer "contracts/production/RelicRendererV1.sol:RelicRendererV1"
Invoke-RelicVerify $m.canonicalRegistry "contracts/production/v2/RelicForgeCanonicalRegistryV2.sol:RelicForgeCanonicalRegistryV2"

$reserveArgs = Static-Args @(
    (Address-Word $m.reserveFounder),
    (Address-Word $m.reserveRevenueTreasury),
    (Uint-Word $m.reserveMinimumWei),
    (Uint-Word $m.reserveActiveBatchBufferWei),
    (Uint-Word $m.reserveExposureSafetyBps),
    (Uint-Word $m.reserveMaxSubsidyPerRequestWei),
    (Uint-Word $m.reserveMaxSubsidyPerCollectionWei)
)
Invoke-RelicVerify $m.reserve "contracts/production/v2/RelicForgeReserveV2.sol:RelicForgeReserveV2" $reserveArgs

$adapterArgs = Static-Args @(
    (Uint-Word $m.chainId),
    (Address-Word $m.chainlinkVrfWrapper),
    (Address-Word $m.canonicalRegistry),
    (Uint-Word $m.requestConfirmations)
)
Invoke-RelicVerify $m.randomnessAdapter "contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol:RelicChainlinkVRFV25DirectAdapterV2" $adapterArgs

$feePolicyArgs = Static-Args @(
    (Address-Word $m.platformAdmin),
    (Address-Word $m.feeTreasury),
    (Address-Word $m.ethUsdPriceFeed),
    (Uint-Word $m.feeOracleMaxAgeSeconds)
)
Invoke-RelicVerify $m.feePolicy "contracts/production/RelicForgeFeePolicyV1.sol:RelicForgeFeePolicyV1" $feePolicyArgs

$factoryArgs = Static-Args @(
    (Address-Word $m.collectionImplementation),
    (Address-Word $m.dataImplementation),
    (Address-Word $m.mintPhasesImplementation),
    (Address-Word $m.renderer),
    (Address-Word $m.randomnessAdapter),
    (Address-Word $m.canonicalRegistry),
    (Address-Word $m.reserve),
    (Address-Word $m.feePolicy)
)
Invoke-RelicVerify $m.factory "contracts/production/v2/RelicForgeFactoryV2.sol:RelicForgeFactoryV2" $factoryArgs

Write-Host "R11 R4 Sepolia shared infrastructure source verification: COMPLETE" -ForegroundColor Green
