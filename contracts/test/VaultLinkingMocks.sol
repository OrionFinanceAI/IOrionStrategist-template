// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @dev Minimal config surface used by KBest strategist constructors.
contract MockOrionConfig {
    function underlyingAsset() external pure returns (address) {
        return address(uint160(1));
    }

    function priceAdapterDecimals() external pure returns (uint8) {
        return 8;
    }

    function priceAdapterRegistry() external pure returns (address) {
        return address(uint160(2));
    }
}

interface ISetVault {
    function setVault(address vault_) external;
}

/// @dev Mirrors OrionVault.updateStrategist authorization: only the manager may
///      call it, and the vault (not the deployer) is the setVault caller.
contract MockVault {
    error NotAuthorized();

    address public manager;
    address public strategist;

    constructor(address manager_) {
        manager = manager_;
    }

    function updateStrategist(address newStrategist) external {
        if (msg.sender != manager) revert NotAuthorized();
        strategist = newStrategist;
        ISetVault(newStrategist).setVault(address(this));
    }
}
