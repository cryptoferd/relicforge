$ErrorActionPreference = "Stop"

$branch = (git branch --show-current).Trim()
if ($branch -ne "contracts-v1-production") {
    throw "Wrong branch: $branch. Switch to contracts-v1-production before running this script."
}

function Patch-Text {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Old,
        [Parameter(Mandatory=$true)][string]$New,
        [Parameter(Mandatory=$true)][string]$Already
    )

    if (-not (Test-Path $Path)) {
        throw "Missing file: $Path"
    }

    $content = [System.IO.File]::ReadAllText((Resolve-Path $Path))
    # Normalize Windows/Unix newlines before matching.
    $content = $content.Replace("`r`n", "`n").Replace("`r", "`n")

    if ($content.Contains($Old)) {
        $content = $content.Replace($Old, $New)
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Resolve-Path $Path), $content, $utf8NoBom)
        Write-Host "PATCHED: $Path"
        return
    }

    if ($content.Contains($Already)) {
        Write-Host "ALREADY PATCHED: $Path"
        return
    }

    throw "Expected RC2 text not found in $Path. No change made to this file."
}

# 1. Batch-limit test: cache getter BEFORE vm.prank.
$old = @'
    function testBatchLimitEnforced() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.expectRevert(RF_BatchLimit.selector);
        vm.prank(BOB);
        collection.mint(phase, collection.MAX_MINT_BATCH() + 1, 0, new bytes32[](0));
    }
'@.Replace("`r`n","`n")

$new = @'
    function testBatchLimitEnforced() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        uint32 overLimit = collection.MAX_MINT_BATCH() + 1;
        vm.expectRevert(RF_BatchLimit.selector);
        vm.prank(BOB);
        collection.mint(phase, overLimit, 0, new bytes32[](0));
    }
'@.Replace("`r`n","`n")

Patch-Text "test/v1/PhaseSecurity.t.sol" $old $new "uint32 overLimit = collection.MAX_MINT_BATCH() + 1;"

# 2. Access-control test: cache getter BEFORE vm.prank.
$old = @'
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
'@.Replace("`r`n","`n")

$new = @'
        uint8 forgeMode = collection.REVEAL_FORGE();
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.setFutureRevealMode(forgeMode);
'@.Replace("`r`n","`n")

Patch-Text "test/v1/AccessControlSecurity.t.sol" $old $new "collection.setFutureRevealMode(forgeMode);"

# 3. Foundry 1.7 removed legacy testFail* convention.
$old = "    function testFailedDeliveryReplaysSameWordAndSuccessfulReplayIsIdempotent() public {"
$new = "    function testReplayAfterFailedDeliveryUsesSameWordAndIsIdempotent() public {"
Patch-Text "test/v1/RevealSecurity.t.sol" $old $new "function testReplayAfterFailedDeliveryUsesSameWordAndIsIdempotent() public"

# 4. Invariant targeting: expose targetContracts() instead of a Vm cheatcode.
$old = @'
contract RelicForgeStatefulInvariantTest is TestBase {
    RevealInvariantHandlerV1 internal handler;
    RelicCollectionV1 internal collection;

    function setUp() public {
'@.Replace("`r`n","`n")

$new = @'
contract RelicForgeStatefulInvariantTest is TestBase {
    RevealInvariantHandlerV1 internal handler;
    RelicCollectionV1 internal collection;
    address[] private _targetedContracts;

    function targetContracts() public view returns (address[] memory) {
        return _targetedContracts;
    }

    function setUp() public {
'@.Replace("`r`n","`n")

Patch-Text "test/v1/InvariantSecurity.t.sol" $old $new "address[] private _targetedContracts;"

$old = @'
        handler = new RevealInvariantHandlerV1(factory, randomness);
        collection = handler.collection();
        vm.targetContract(address(handler));
'@.Replace("`r`n","`n")

$new = @'
        handler = new RevealInvariantHandlerV1(factory, randomness);
        collection = handler.collection();
        _targetedContracts.push(address(handler));
'@.Replace("`r`n","`n")

Patch-Text "test/v1/InvariantSecurity.t.sol" $old $new "_targetedContracts.push(address(handler));"

# Remove invalid custom Vm cheatcode declaration.
$path = "test/v1/TestBase.sol"
$content = [System.IO.File]::ReadAllText((Resolve-Path $path))
$content = $content.Replace("`r`n", "`n").Replace("`r", "`n")
$oldLine = "    function targetContract(address) external;`n"
if ($content.Contains($oldLine)) {
    $content = $content.Replace($oldLine, "")
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Resolve-Path $path), $content, $utf8NoBom)
    Write-Host "PATCHED: $path"
} elseif ($content.Contains("function targetContract(address) external;")) {
    throw "Unexpected formatting around targetContract declaration in $path."
} else {
    Write-Host "ALREADY PATCHED: $path"
}

Write-Host ""
Write-Host "RC2.1 HARNESS FIX COMPLETE"
Write-Host "No production contract files were modified by this script."
