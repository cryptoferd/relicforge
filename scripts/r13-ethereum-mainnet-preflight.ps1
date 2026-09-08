param(

  [Parameter(Mandatory=$true)][string]$RepoPath,

  [string]$MainnetRpcUrl = "",

  [string]$ResultsDir = ""

)



Set-StrictMode -Version Latest

$ErrorActionPreference='Stop'



function Fail([string]$Message){ throw $Message }

function RunNative([string]$Exe,[string[]]$NativeArgs,[string]$Label,[string]$LogFile){

  Add-Content -Path $LogFile -Value "`r`n===== $Label ====="

  $old=$ErrorActionPreference; $ErrorActionPreference='Continue'

  try {

    & $Exe @NativeArgs 2>&1 | Tee-Object -FilePath $LogFile -Append

    $code=$LASTEXITCODE

  } finally { $ErrorActionPreference=$old }

  if($code-ne 0){ throw "$Label failed with exit code $code. See $LogFile" }

}

function Git([string[]]$GitArgs){

  $old=$ErrorActionPreference; $ErrorActionPreference='Continue'

  try{$o=@(& git.exe -C $RepoPath @GitArgs 2>&1);$code=$LASTEXITCODE}

  finally{$ErrorActionPreference=$old}

  if($code-ne 0){throw "git $($GitArgs -join ' ') failed:`n$($o -join "`n")"}

  return $o

}



$RepoPath=(Resolve-Path $RepoPath).Path



if([string]::IsNullOrWhiteSpace($MainnetRpcUrl)){

  if(-not [string]::IsNullOrWhiteSpace($env:ETHEREUM_MAINNET_RPC_URL)){

    $MainnetRpcUrl=$env:ETHEREUM_MAINNET_RPC_URL

  } elseif(-not [string]::IsNullOrWhiteSpace($env:ALCHEMY_API_KEY)){

    $MainnetRpcUrl="https://eth-mainnet.g.alchemy.com/v2/$($env:ALCHEMY_API_KEY)"

  } else {

    Fail "No Ethereum mainnet RPC configured. Set ETHEREUM_MAINNET_RPC_URL or ALCHEMY_API_KEY, or pass -MainnetRpcUrl."

  }

}



if([string]::IsNullOrWhiteSpace($ResultsDir)){

  $ResultsDir=Join-Path ([Environment]::GetFolderPath('Desktop')) 'RelicForge-Mainnet-Preflight-Results'

}

New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null

$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'

$runDir=Join-Path $ResultsDir "R13-$stamp"

New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$log=Join-Path $runDir 'R13-mainnet-preflight.log'



Write-Host ""

Write-Host "Relic Forge R2.6 Phase 1 - Ethereum Mainnet Read-Only Preflight R13" -ForegroundColor Cyan

Write-Host "NO PRIVATE KEY. NO BROADCAST. NO MAINNET TRANSACTIONS." -ForegroundColor Green

Write-Host "Results: $runDir" -ForegroundColor Yellow

Write-Host ""



$branch=([string](@(Git @('rev-parse','--abbrev-ref','HEAD'))[0])).Trim()

if($branch-ne'r12-v2-creator-ui'){ Fail "Expected branch r12-v2-creator-ui, found $branch." }

$head=([string](@(Git @('rev-parse','HEAD'))[0])).Trim()

$expected='b575134d229632d3a857d1877f70aeaf74e63cf6'

if($head-ne$expected){ Fail "Expected baseline $expected, found $head." }



$status=@(Git @('status','--porcelain'))

$allowed=@(

  'docs/forge-reveal-v2/ETHEREUM_MAINNET_CHAINLINK_R13.json',

  'docs/forge-reveal-v2/PHASE2D_R13_ETHEREUM_MAINNET_PREFLIGHT.md',

  'scripts/r13-ethereum-mainnet-preflight.ps1',

  'test/v1/experimental/EthereumMainnetChainlinkForkPreflightR13.t.sol'

)

$unexpected=@()

foreach($line in $status){

  if($line.Length-lt 4){continue}

  $path=$line.Substring(3).Trim()

  if($allowed -notcontains $path){$unexpected+=$line}

}

if($unexpected.Count-ne 0){ Fail "Unexpected working-tree changes before preflight:`n$($unexpected -join "`n")" }



$prod=@(Git @('status','--porcelain','--','contracts/production'))

if($prod.Count-ne 0){ Fail "Production Solidity is dirty before preflight:`n$($prod -join "`n")" }



"Baseline commit: $head" | Set-Content -Path $log

"Branch: $branch" | Add-Content -Path $log

"Run UTC: $([DateTime]::UtcNow.ToString('o'))" | Add-Content -Path $log



Push-Location $RepoPath

try {

  Write-Host "[1/9] Toolchain..." -ForegroundColor Cyan

  RunNative 'forge.exe' @('--version') 'forge --version' $log

  RunNative 'cast.exe' @('--version') 'cast --version' $log



  # The production compiler configuration is frozen for this release.
  $foundryHash=([string](@(Git @('hash-object','foundry.toml'))[0])).Trim()
  if($foundryHash-ne'ffa12da2f6116930e52d3c2e44bed376bc6acccd'){
    Fail "Foundry compiler configuration differs from the frozen R12-v2 baseline."
  }
  Write-Host "PASS: frozen Foundry compiler configuration." -ForegroundColor Green

  Write-Host "[2/9] Production size gate + full compilation..." -ForegroundColor Cyan

  RunNative 'forge.exe' @('build','--sizes','--skip','test','--skip','script','--force') 'Production source size gate (fresh build)' $log
  RunNative 'forge.exe' @('build','--force') 'Full repository compilation (no harness size gate)' $log



  Write-Host "[3/9] Focused R12 final security gate..." -ForegroundColor Cyan

  RunNative 'forge.exe' @('test','--match-path','test/v1/experimental/ForgeRevealV2R12FinalSecurityGate.t.sol','-vv') 'R12 Final Security Gate' $log



  Write-Host "[4/9] Production-stack + Chainlink local regression..." -ForegroundColor Cyan

  RunNative 'forge.exe' @('test','--match-path','test/v1/experimental/ForgeRevealV2R12ProductionStack.t.sol','-vv') 'R12 Production Stack' $log

  RunNative 'forge.exe' @('test','--match-path','test/v1/experimental/ForgeRevealV2R12EthereumSepoliaAdapter.t.sol','-vv') 'R12 Ethereum Adapter Security' $log

  RunNative 'forge.exe' @('test','--match-path','test/v1/experimental/ForgeRevealV2Phase2DChainlinkAdapter.t.sol','-vv') 'Phase 2D Chainlink Adapter Security' $log



  Write-Host "[5/9] Ethereum mainnet live fork..." -ForegroundColor Cyan

  RunNative 'forge.exe' @(

    'test',

    '--match-path','test/v1/experimental/EthereumMainnetChainlinkForkPreflightR13.t.sol',

    '--fork-url',$MainnetRpcUrl,

    '-vv'

  ) 'R13 Ethereum Mainnet Live Fork' $log



  Write-Host "[6/9] Full repository regression..." -ForegroundColor Cyan

  RunNative 'forge.exe' @('test') 'Full Repository Regression' $log



  Write-Host "[7/9] Capture live dependency code hashes..." -ForegroundColor Cyan

  $deps=[ordered]@{

    link='0x514910771AF9Ca656af840dff83E8264EcF986CA'

    vrfCoordinator='0xD7f86b4b8Cae7D942340FF628F82735b7a20893a'

    vrfWrapper='0x02aae1A04f9828517b3007f83f6181900CaD910c'

    ethUsdFeed='0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'

  }

  $hashes=[ordered]@{}

  foreach($name in $deps.Keys){

    $old=$ErrorActionPreference;$ErrorActionPreference='Continue'

    try{

      $value=(& cast.exe codehash $deps[$name] --rpc-url $MainnetRpcUrl 2>$null | Select-Object -Last 1).Trim()

      $code=$LASTEXITCODE

    } finally {$ErrorActionPreference=$old}

    if($code-ne 0 -or [string]::IsNullOrWhiteSpace($value)){ Fail "Unable to read codehash for $name." }

    $hashes[$name]=[ordered]@{address=$deps[$name];codehash=$value}

    Write-Host "  PASS $name $value"

  }

  $hashes | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $runDir 'live-mainnet-codehashes.json') -Encoding UTF8



  Write-Host "[8/9] Mainnet-facing website language inventory..." -ForegroundColor Cyan

  $inventory=Join-Path $runDir 'site-language-inventory.txt'

  $patterns='test|testing|sepolia|preproduction|candidate|sandbox|demo|beta|not deployed|not mainnet'

  $siteFiles=@(Git @('ls-files','*.html','*.js','*.css'))

  $matches=@()

  foreach($rel in $siteFiles){

    $full=Join-Path $RepoPath $rel

    if(!(Test-Path $full)){continue}

    $found=Select-String -Path $full -Pattern $patterns -AllMatches

    foreach($hit in $found){

      $matches += "${rel}:$($hit.LineNumber): $($hit.Line.Trim())"

    }

  }

  $matches | Set-Content -Path $inventory -Encoding UTF8

  Write-Host "  Inventory: $inventory"

  Write-Host "  Matches: $($matches.Count)"



  Write-Host "[9/9] Final integrity guards..." -ForegroundColor Cyan

  $prodAfter=@(Git @('status','--porcelain','--','contracts/production'))

  if($prodAfter.Count-ne 0){ Fail "Production Solidity changed during preflight:`n$($prodAfter -join "`n")" }



  $old=$ErrorActionPreference;$ErrorActionPreference='Continue'

  try{& git.exe -C $RepoPath diff --check 2>$null;$diffCode=$LASTEXITCODE}

  finally{$ErrorActionPreference=$old}

  if($diffCode-ne 0){ Fail "git diff --check failed." }



  $summary=[ordered]@{

    schema='relicforge-mainnet-preflight-r13-result-v1'

    passed=$true

    baselineCommit=$head

    branch=$branch

    timestampUtc=[DateTime]::UtcNow.ToString('o')

    chainId=1

    mainnetTransactionSent=$false

    privateKeyRequired=$false

    productionSolidityChanged=$false

    gitDiffCheck='pass'

    websiteLanguageInventoryMatches=$matches.Count

    liveDependencies=$hashes

    nextGate='review R13 output before chain-aware application/mainnet-facing copy phase'

  }

  $summary | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $runDir 'R13-result.json') -Encoding UTF8

} finally {

  Pop-Location

}



Write-Host ""

Write-Host "R13 MAINNET READ-ONLY PREFLIGHT PASS" -ForegroundColor Green

Write-Host "No Ethereum mainnet transaction was sent." -ForegroundColor Green

Write-Host "Review $runDir before proceeding to application/mainnet-facing copy work." -ForegroundColor Yellow
