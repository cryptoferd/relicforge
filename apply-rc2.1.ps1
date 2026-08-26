$ErrorActionPreference = "Stop"

function Replace-Exact {
    param(
        [string]$Path,
        [string]$Old,
        [string]$New
    )

    if (-not (Test-Path $Path)) {
        throw "Missing expected file: $Path"
    }

    $content = Get-Content -Raw -Path $Path
    if (-not $content.Contains($Old)) {
        throw "Expected RC2 text not found in $Path. Stop to avoid patching the wrong version."
    }

    $updated = $content.Replace($Old, $New)
    Set-Content -Path $Path -Value $updated -NoNewline
    Write-Host "Patched $Path"
}

# 1) vm.prank applies to the next external call. Cache MAX_MINT_BATCH before prank.
$old = @'
    function testBatchLimitEnforced() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.expectRevert(RF_BatchLimit.selector);
        vm.prank(BOB);
        collection.mint(phase, collection.MAX_MINT_BATCH() + 1, 0, new bytes32[](0));
    }
'@

$new = @'
    function testBatchLimitEnforced() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        uint32 overLimit = collection.MAX_MINT_BATCH() + 1;
        vm.expectRevert(RF_BatchLimit.selector);
        vm.prank(BOB);
        collection.mint(phase, overLimit, 0, new bytes32[](0));
    }
'@

Replace-Exact "test/v1/PhaseSecurity.t.sol" $old $new

# 2) Same prank-consumption issue: cache REVEAL_FORGE before prank.
$old = @'
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
'@

$new = @'
        uint8 forgeMode = collection.REVEAL_FORGE();
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.setFutureRevealMode(forgeMode);
'@

Replace-Exact "test/v1/AccessControlSecurity.t.sol" $old $new

# 3) Foundry 1.7 treats any test name beginning with "testFail" as the removed legacy convention.
$old = '    function testFailedDeliveryReplaysSameWordAndSuccessfulReplayIsIdempotent() public {'
$new = '    function testReplayAfterFailedDeliveryUsesSameWordAndIsIdempotent() public {'
Replace-Exact "test/v1/RevealSecurity.t.sol" $old $new

# 4) targetContract is a StdInvariant helper, not a Vm cheatcode.
#    Expose the targetContracts() hook directly, keeping this repo dependency-free.
$old = @'
contract RelicForgeStatefulInvariantTest is TestBase {
    RevealInvariantHandlerV1 internal handler;
    RelicCollectionV1 internal collection;

    function setUp() public {
'@

$new = @'
contract RelicForgeStatefulInvariantTest is TestBase {
    RevealInvariantHandlerV1 internal handler;
    RelicCollectionV1 internal collection;
    address[] private _targetedContracts;

    function targetContracts() public view returns (address[] memory) {
        return _targetedContracts;
    }

    function setUp() public {
'@

Replace-Exact "test/v1/InvariantSecurity.t.sol" $old $new

$old = @'
        handler = new RevealInvariantHandlerV1(factory, randomness);
        collection = handler.collection();
        vm.targetContract(address(handler));
'@

$new = @'
        handler = new RevealInvariantHandlerV1(factory, randomness);
        collection = handler.collection();
        _targetedContracts.push(address(handler));
'@

Replace-Exact "test/v1/InvariantSecurity.t.sol" $old $new

# Remove the invalid cheatcode declaration so future tests cannot accidentally call it.
$old = @'
    function targetContract(address) external;
'@
$new = @'
'@
Replace-Exact "test/v1/TestBase.sol" $old $new

Write-Host ""
Write-Host "RC2.1 test-harness fixes applied successfully."
Write-Host "Review with: git diff -- test/v1"
