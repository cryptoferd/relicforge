// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicSupraDVRFV3ThinAdapterV2Harness.sol";
import "./RelicSupraDVRFV3DepositMockV2.sol";

interface IRelicSupraDVRFV3CallbackV2 {
    function supraCallback(uint256 nonce, uint256[] calldata rngList) external;
}

/// @title RelicSupraDVRFV3RouterMockV2
/// @notice ABI-shaped Supra dVRF V3 router/retry mock for Phase 2D R4 certification tests.
/// @dev EXPERIMENTAL ONLY. Models the documented generateRequest shape, stored request-parameter hash,
///      one random word, shared subscription charging, and retry of a previously committed callback result.
contract RelicSupraDVRFV3RouterMockV2 is IRelicSupraDVRFV3Router {
    struct Request {
        address requester;
        bytes32 functionSigHash;
        uint8 rngCount;
        uint256 confirmations;
        uint256 clientSeed;
        address clientWallet;
        uint128 callbackGasPrice;
        uint128 callbackGasLimit;
        bytes32 requestHash;
        uint256 committedWord;
        uint256 totalChargedWei;
        uint32 callbackAttempts;
        bool wordCommitted;
        bool fulfilled;
    }

    RelicSupraDVRFV3DepositMockV2 public immutable deposit;
    uint256 public nextNonce = 1;
    uint128 public successChargeWei;
    uint128 public failedAttemptChargeWei;
    mapping(uint256 => Request) public requests;

    event SupraMockRequested(
        uint256 indexed nonce, address indexed requester, address indexed clientWallet, bytes32 requestHash
    );
    event SupraMockCallbackAttempted(uint256 indexed nonce, uint256 randomWord, bool success, uint256 chargedWei);

    constructor(address deposit_) {
        if (deposit_ == address(0) || deposit_.code.length == 0) revert RF_BadConfig();
        deposit = RelicSupraDVRFV3DepositMockV2(deposit_);
    }

    function setCharges(uint128 successChargeWei_, uint128 failedAttemptChargeWei_) external {
        successChargeWei = successChargeWei_;
        failedAttemptChargeWei = failedAttemptChargeWei_;
    }

    function generateRequest(
        string memory functionSig,
        uint8 rngCount,
        uint256 numConfirmations,
        uint256 clientSeed,
        address clientWalletAddress
    ) external returns (uint256 nonce) {
        if (rngCount == 0 || rngCount > 255 || numConfirmations == 0 || numConfirmations > 20) {
            revert RF_BadRequest();
        }
        if (clientSeed == 0 || clientWalletAddress == address(0)) revert RF_BadRequest();
        if (deposit.isMinimumBalanceReached(clientWalletAddress)) revert RF_BadRequest();
        (uint128 callbackGasPrice, uint128 callbackGasLimit) = deposit.getContractDetails(msg.sender);
        if (callbackGasPrice == 0 || callbackGasLimit == 0) revert RF_NotAuthorized();

        nonce = nextNonce++;
        bytes32 functionSigHash = keccak256(bytes(functionSig));
        bytes32 requestHash = keccak256(
            abi.encode(
                nonce,
                msg.sender,
                functionSigHash,
                rngCount,
                numConfirmations,
                clientSeed,
                clientWalletAddress,
                callbackGasPrice,
                callbackGasLimit
            )
        );
        requests[nonce] = Request({
            requester: msg.sender,
            functionSigHash: functionSigHash,
            rngCount: rngCount,
            confirmations: numConfirmations,
            clientSeed: clientSeed,
            clientWallet: clientWalletAddress,
            callbackGasPrice: callbackGasPrice,
            callbackGasLimit: callbackGasLimit,
            requestHash: requestHash,
            committedWord: 0,
            totalChargedWei: 0,
            callbackAttempts: 0,
            wordCommitted: false,
            fulfilled: false
        });
        emit SupraMockRequested(nonce, msg.sender, clientWalletAddress, requestHash);
    }

    function attemptFulfill(uint256 nonce, uint256 randomWord) external returns (bool success) {
        Request storage req = requests[nonce];
        if (req.requester == address(0) || req.fulfilled) revert RF_BadRequest();
        if (!req.wordCommitted) {
            req.wordCommitted = true;
            req.committedWord = randomWord;
        } else if (req.committedWord != randomWord) {
            revert RF_BadRequest();
        }
        success = _attempt(nonce, req);
    }

    function retry(uint256 nonce) external returns (bool success) {
        Request storage req = requests[nonce];
        if (req.requester == address(0) || req.fulfilled || !req.wordCommitted) revert RF_BadRequest();
        success = _attempt(nonce, req);
    }

    function attemptFulfillWithRequestHash(uint256 nonce, uint256 randomWord, bytes32 suppliedRequestHash)
        external
        returns (bool success)
    {
        Request storage req = requests[nonce];
        if (req.requestHash != suppliedRequestHash) revert RF_BadRequest();
        if (req.requester == address(0) || req.fulfilled) revert RF_BadRequest();
        if (!req.wordCommitted) {
            req.wordCommitted = true;
            req.committedWord = randomWord;
        } else if (req.committedWord != randomWord) {
            revert RF_BadRequest();
        }
        success = _attempt(nonce, req);
    }

    function forceDuplicateCallback(uint256 nonce, uint256 randomWord) external {
        Request storage req = requests[nonce];
        if (req.requester == address(0)) revert RF_BadRequest();
        uint256[] memory words = new uint256[](1);
        words[0] = randomWord;
        IRelicSupraDVRFV3CallbackV2(req.requester).supraCallback(nonce, words);
    }

    function _attempt(uint256 nonce, Request storage req) internal returns (bool success) {
        uint256[] memory words = new uint256[](1);
        words[0] = req.committedWord;
        (success,) = req.requester.call{gas: req.callbackGasLimit}(
            abi.encodeCall(IRelicSupraDVRFV3CallbackV2.supraCallback, (nonce, words))
        );
        ++req.callbackAttempts;
        uint128 charge = success ? successChargeWei : failedAttemptChargeWei;
        if (charge != 0) {
            deposit.chargeClient(req.clientWallet, charge);
            req.totalChargedWei += charge;
        }
        if (success) req.fulfilled = true;
        emit SupraMockCallbackAttempted(nonce, req.committedWord, success, charge);
    }
}
