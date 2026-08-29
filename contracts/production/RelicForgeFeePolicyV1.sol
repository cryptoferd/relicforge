// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";

/**
 * @title RelicForgeFeePolicyV1
 * @notice Narrow platform-fee policy for RelicForge V1.
 * @dev The platform admin controls fee policy only. It has no authority over collection content,
 *      creator sale controls, creator proceeds, royalties, reveal state, or NFT ownership.
 *      USD conversion fails open to zero fees when the immutable price feed is unhealthy/stale.
 */
contract RelicForgeFeePolicyV1 {
    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;

    // Safety cap for future defaults. Existing collections separately lock their fee cents at creation.
    uint32 public constant MAX_DEFAULT_FEE_CENTS = 10_000; // $100.00 / NFT hard ceiling

    address public immutable priceFeed;
    uint8 public immutable priceFeedDecimals;
    uint64 public immutable maxOracleAge;

    address public platformAdmin;
    address public treasury;

    bool public feesEnabled = true;
    uint32 public sponsoredFeeCents = 25; // $0.25 * max supply, paid by creator at launch
    uint32 public minterFeeCents = 50;    // $0.50 / NFT, paid by minter

    mapping(address => bool) public collectionFeeWaived;

    uint256 public accruedFees;
    uint256 private _entered;

    event FeesEnabledSet(bool enabled);
    event DefaultFeeCentsSet(uint32 sponsoredFeeCents, uint32 minterFeeCents);
    event TreasurySet(address indexed treasury);
    event PlatformAdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event CollectionFeeWaived(address indexed collection);
    event SponsoredFeeReceived(
        address indexed factory,
        address indexed collection,
        address indexed creator,
        uint32 maxSupply,
        uint32 feeCents,
        uint256 amount
    );
    event MintFeesReceived(address indexed collection, uint256 amount);
    event PlatformFeesWithdrawn(address indexed treasury, uint256 amount);

    modifier onlyPlatformAdmin() {
        if (msg.sender != platformAdmin) revert RF_NotAuthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 0) revert RF_Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address platformAdmin_, address treasury_, address priceFeed_, uint64 maxOracleAge_) {
        if (platformAdmin_ == address(0) || treasury_ == address(0) || priceFeed_ == address(0)) {
            revert RF_ZeroAddress();
        }
        if (priceFeed_.code.length == 0 || maxOracleAge_ == 0) revert RF_BadOracleConfig();

        uint8 decimals_ = IRFAggregatorV3V1(priceFeed_).decimals();
        if (decimals_ > 18) revert RF_BadOracleConfig();

        platformAdmin = platformAdmin_;
        treasury = treasury_;
        priceFeed = priceFeed_;
        priceFeedDecimals = decimals_;
        maxOracleAge = maxOracleAge_;
    }

    function setFeesEnabled(bool enabled) external onlyPlatformAdmin {
        feesEnabled = enabled;
        emit FeesEnabledSet(enabled);
    }

    /// @notice Changes defaults for collections created after this transaction only.
    function setDefaultFeeCents(uint32 sponsoredCents, uint32 minterCents) external onlyPlatformAdmin {
        if (sponsoredCents > MAX_DEFAULT_FEE_CENTS || minterCents > MAX_DEFAULT_FEE_CENTS) {
            revert RF_FeeLimit();
        }
        sponsoredFeeCents = sponsoredCents;
        minterFeeCents = minterCents;
        emit DefaultFeeCentsSet(sponsoredCents, minterCents);
    }

    function setTreasury(address treasury_) external onlyPlatformAdmin {
        if (treasury_ == address(0)) revert RF_ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function transferPlatformAdmin(address newAdmin) external onlyPlatformAdmin {
        if (newAdmin == address(0)) revert RF_ZeroAddress();
        address oldAdmin = platformAdmin;
        platformAdmin = newAdmin;
        emit PlatformAdminTransferred(oldAdmin, newAdmin);
    }

    /// @notice One-way permanent waiver. There is intentionally no unwaive function.
    function waiveCollection(address collection) external onlyPlatformAdmin {
        if (collection == address(0)) revert RF_ZeroAddress();
        if (!collectionFeeWaived[collection]) {
            collectionFeeWaived[collection] = true;
            emit CollectionFeeWaived(collection);
        }
    }

    function quoteUsdCents(uint256 usdCents) public view returns (uint256 nativeAmount, bool oracleHealthy) {
        if (usdCents == 0) return (0, true);

        // Protocol callers are bounded to uint32 supply/quantity and <= MAX_DEFAULT_FEE_CENTS.
        // Treat absurd external quote requests as unhealthy instead of risking arithmetic overflow.
        if (usdCents > uint256(type(uint32).max) * MAX_DEFAULT_FEE_CENTS) return (0, false);

        try IRFAggregatorV3V1(priceFeed).latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (
                answer <= 0 ||
                updatedAt == 0 ||
                updatedAt > block.timestamp ||
                answeredInRound < roundId ||
                block.timestamp - updatedAt > maxOracleAge
            ) {
                return (0, false);
            }

            uint256 scale = 10 ** uint256(priceFeedDecimals);
            uint256 numerator = usdCents * 1 ether * scale;
            uint256 denominator = uint256(answer) * 100;

            // Round upward so a healthy quote never under-collects by truncation.
            nativeAmount = (numerator + denominator - 1) / denominator;
            oracleHealthy = true;
        } catch {
            return (0, false);
        }
    }

    function quoteSponsoredFee(uint32 maxSupply)
        external view returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        if (!feesEnabled || sponsoredFeeCents == 0 || maxSupply == 0) return (0, true, false);
        (feeWei, oracleHealthy) = quoteUsdCents(uint256(sponsoredFeeCents) * maxSupply);
        feeActive = true;
    }

    function quoteMintFee(address collection, uint32 lockedFeeCents, uint32 quantity)
        external view returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        if (
            !feesEnabled ||
            collectionFeeWaived[collection] ||
            lockedFeeCents == 0 ||
            quantity == 0
        ) {
            return (0, true, false);
        }

        (feeWei, oracleHealthy) = quoteUsdCents(uint256(lockedFeeCents) * quantity);
        feeActive = true;
    }

    /// @notice Called by a factory after configuring a sponsored collection.
    function recordSponsoredFee(
        address collection,
        address creator,
        uint32 maxSupply,
        uint32 feeCents
    ) external payable {
        if (collection == address(0) || creator == address(0)) revert RF_ZeroAddress();

        IRelicCollectionFeeViewV1 c = IRelicCollectionFeeViewV1(collection);
        if (
            c.factory() != msg.sender ||
            c.feePolicy() != address(this) ||
            c.platformFeeMode() != FEE_MODE_SPONSORED ||
            c.lockedPlatformFeeCents() != feeCents ||
            c.maxSupply() != maxSupply ||
            c.creator() != creator
        ) revert RF_NotAuthorized();

        accruedFees += msg.value;
        emit SponsoredFeeReceived(msg.sender, collection, creator, maxSupply, feeCents, msg.value);
    }

    /// @notice Called by a canonical minter-supported collection to forward already-accrued fees.
    function depositMintFees(address collection) external payable {
        if (msg.sender != collection || collection == address(0)) revert RF_NotAuthorized();

        IRelicCollectionFeeViewV1 c = IRelicCollectionFeeViewV1(collection);
        if (
            c.feePolicy() != address(this) ||
            c.platformFeeMode() != FEE_MODE_MINTER_SUPPORTED
        ) revert RF_NotAuthorized();

        accruedFees += msg.value;
        emit MintFeesReceived(collection, msg.value);
    }

    /// @notice Anyone may trigger withdrawal; only the configured platform treasury receives funds.
    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        if (amount == 0) return;

        accruedFees = 0;
        address receiver = treasury;
        (bool ok,) = payable(receiver).call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();

        emit PlatformFeesWithdrawn(receiver, amount);
    }

    // Prevent unattributed direct transfers.
    receive() external payable { revert RF_BadRequest(); }
}