// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFreelanceEscrow {
    function submitWork(uint256 jobId, string calldata evidence) external;
    function approveAndRelease(uint256 jobId) external;
}

/// @dev สัญญาจำลองผู้โจมตี ใช้ในการทดสอบเท่านั้น: พยายามเรียกขอเงินซ้ำตอนรับ ETH
contract ReentrantFreelancer {
    IFreelanceEscrow public escrow;
    uint256 public targetJob;
    uint256 public attempts;

    constructor(address escrow_) {
        escrow = IFreelanceEscrow(escrow_);
    }

    function submit(uint256 jobId) external {
        targetJob = jobId;
        escrow.submitWork(jobId, "ipfs://attack");
    }

    receive() external payable {
        attempts++;
        if (attempts < 3) {
            // พยายามถอนซ้ำ — ต้องล้มเหลว
            escrow.approveAndRelease(targetJob);
        }
    }
}
