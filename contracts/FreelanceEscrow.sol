// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FreelanceEscrow
 * @notice ระบบจ้างงานฟรีแลนซ์และชำระเงินตามผลงาน (Freelance Escrow & Smart Payment Platform)
 *
 * วงจรชีวิตของงาน (Job lifecycle)
 *
 *   Created ──deposit──▶ Funded ──submitWork──▶ Submitted ──approve──▶ Released
 *      │                   │  ▲                    │
 *    cancel            dispute│ submitWork(แก้ไข)  dispute
 *      ▼                   ▼  │                    ▼
 *   Cancelled           Disputed ◀─────────────────┘
 *                          │ resolveDispute (arbiter)
 *                          ▼
 *                       Resolved
 *
 *   Funded + เลยกำหนดส่งและยังไม่มีการส่งงาน ──claimRefund──▶ Refunded
 *
 * กฎสำคัญ:
 *  - ห้ามจ่ายเงินซ้ำ: เงินของแต่ละงานถูกเก็บใน `job.escrowBalance` และถูกตั้งเป็น 0
 *    ก่อนโอนออกทุกครั้ง (Checks-Effects-Interactions) + มี nonReentrant guard
 *  - เงินออกจาก Escrow ได้เพียง 3 ทาง: approve (จ่ายฟรีแลนซ์), resolveDispute (ผู้ดูแลตัดสิน),
 *    claimRefund (เลยกำหนดส่งแล้วฟรีแลนซ์ไม่ส่งงาน) — ทุกทางตรวจสถานะก่อนเสมอ
 */
contract FreelanceEscrow {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        Created,    // 0 สร้างข้อตกลงแล้ว รอฝากเงิน
        Funded,     // 1 ฝากเงินเข้า Escrow แล้ว รอฟรีแลนซ์ส่งงาน
        Submitted,  // 2 ฟรีแลนซ์ส่งงานแล้ว รอผู้ว่าจ้างตรวจรับ
        Released,   // 3 อนุมัติและจ่ายเงินให้ฟรีแลนซ์แล้ว
        Disputed,   // 4 อยู่ระหว่างข้อพิพาท
        Resolved,   // 5 ผู้ดูแลตัดสินข้อพิพาทแล้ว
        Refunded,   // 6 คืนเงินให้ผู้ว่าจ้าง (เลยกำหนดส่ง)
        Cancelled   // 7 ยกเลิกก่อนฝากเงิน
    }

    struct Job {
        uint256 id;
        address client;          // ผู้ว่าจ้าง
        address freelancer;      // ฟรีแลนซ์
        string title;            // ชื่อโครงการ
        string description;      // รายละเอียดงาน
        uint256 amount;          // ค่าจ้าง (wei)
        uint256 deadline;        // กำหนดส่ง (unix timestamp)
        uint256 escrowBalance;   // ยอดเงินที่ถูกล็อกอยู่ใน Escrow ของงานนี้
        string workEvidence;     // หลักฐานการส่งงาน (URL / IPFS CID / hash)
        string disputeReason;    // เหตุผลการแจ้งข้อพิพาท
        address disputeRaisedBy;
        Status status;
        uint256 createdAt;
        uint256 submittedAt;
        uint256 closedAt;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public owner;
    mapping(address => bool) public isArbiter;

    uint256 public jobCount;
    mapping(uint256 => Job) private jobs;
    mapping(address => uint256[]) private clientJobs;
    mapping(address => uint256[]) private freelancerJobs;

    bool private locked;

    // ---------------------------------------------------------------------
    // Events (ใช้สำหรับติดตามสถานะ/ประวัติธุรกรรมบนหน้าเว็บ)
    // ---------------------------------------------------------------------

    event JobCreated(uint256 indexed jobId, address indexed client, address indexed freelancer, string title, uint256 amount, uint256 deadline);
    event PaymentDeposited(uint256 indexed jobId, address indexed client, uint256 amount);
    event WorkSubmitted(uint256 indexed jobId, address indexed freelancer, string evidence);
    event PaymentReleased(uint256 indexed jobId, address indexed freelancer, uint256 amount);
    event DisputeRaised(uint256 indexed jobId, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed jobId, address indexed arbiter, uint256 freelancerAmount, uint256 clientAmount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobCancelled(uint256 indexed jobId, address indexed client);
    event ArbiterUpdated(address indexed arbiter, bool enabled);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotOwner();
    error NotArbiter();
    error NotClient();
    error NotFreelancer();
    error NotParty();
    error JobNotFound();
    error InvalidStatus(Status current);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error EmptyField();
    error DeadlineNotPassed();
    error ArbiterIsParty();
    error TransferFailed();
    error Reentrancy();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyArbiter() {
        if (!isArbiter[msg.sender]) revert NotArbiter();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    modifier jobExists(uint256 jobId) {
        if (jobId == 0 || jobId > jobCount) revert JobNotFound();
        _;
    }

    constructor() {
        owner = msg.sender;
        isArbiter[msg.sender] = true; // ผู้ deploy เป็นผู้ดูแลข้อพิพาทคนแรก
        emit OwnershipTransferred(address(0), msg.sender);
        emit ArbiterUpdated(msg.sender, true);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setArbiter(address arbiter, bool enabled) external onlyOwner {
        if (arbiter == address(0)) revert InvalidAddress();
        isArbiter[arbiter] = enabled;
        emit ArbiterUpdated(arbiter, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------------
    // 1. Create Contract
    // ---------------------------------------------------------------------

    /// @notice ผู้ว่าจ้างสร้างข้อตกลงการจ้างงาน
    function createJob(
        string calldata title,
        string calldata description,
        uint256 amount,
        uint256 deadline,
        address freelancer
    ) external returns (uint256 jobId) {
        if (bytes(title).length == 0) revert EmptyField();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (freelancer == address(0) || freelancer == msg.sender) revert InvalidAddress();

        jobId = ++jobCount;
        Job storage j = jobs[jobId];
        j.id = jobId;
        j.client = msg.sender;
        j.freelancer = freelancer;
        j.title = title;
        j.description = description;
        j.amount = amount;
        j.deadline = deadline;
        j.status = Status.Created;
        j.createdAt = block.timestamp;

        clientJobs[msg.sender].push(jobId);
        freelancerJobs[freelancer].push(jobId);

        emit JobCreated(jobId, msg.sender, freelancer, title, amount, deadline);
    }

    /// @notice ผู้ว่าจ้างยกเลิกข้อตกลงได้เฉพาะก่อนฝากเงิน
    function cancelJob(uint256 jobId) external jobExists(jobId) {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Created) revert InvalidStatus(j.status);
        j.status = Status.Cancelled;
        j.closedAt = block.timestamp;
        emit JobCancelled(jobId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // 2. Deposit Payment
    // ---------------------------------------------------------------------

    /// @notice ผู้ว่าจ้างโอน ETH เท่ากับค่าจ้างเข้าสู่ Escrow
    function deposit(uint256 jobId) external payable jobExists(jobId) {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Created) revert InvalidStatus(j.status);
        if (msg.value != j.amount) revert InvalidAmount();

        j.escrowBalance = msg.value;
        j.status = Status.Funded;
        emit PaymentDeposited(jobId, msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------
    // 3. Submit Work
    // ---------------------------------------------------------------------

    /// @notice ฟรีแลนซ์บันทึกหลักฐานการส่งมอบงาน (ส่งซ้ำเพื่อแก้ไขได้ก่อนได้รับอนุมัติ)
    function submitWork(uint256 jobId, string calldata evidence) external jobExists(jobId) {
        Job storage j = jobs[jobId];
        if (msg.sender != j.freelancer) revert NotFreelancer();
        if (j.status != Status.Funded && j.status != Status.Submitted) revert InvalidStatus(j.status);
        if (bytes(evidence).length == 0) revert EmptyField();

        j.workEvidence = evidence;
        j.submittedAt = block.timestamp;
        j.status = Status.Submitted;
        emit WorkSubmitted(jobId, msg.sender, evidence);
    }

    // ---------------------------------------------------------------------
    // 4. Approve & Release Payment
    // ---------------------------------------------------------------------

    /// @notice ผู้ว่าจ้างอนุมัติงาน ระบบโอน ETH ให้ฟรีแลนซ์ทันที
    function approveAndRelease(uint256 jobId) external nonReentrant jobExists(jobId) {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Submitted) revert InvalidStatus(j.status);

        uint256 payout = j.escrowBalance;
        // Effects ก่อน Interactions: ล้างยอดและเปลี่ยนสถานะ => จ่ายซ้ำไม่ได้
        j.escrowBalance = 0;
        j.status = Status.Released;
        j.closedAt = block.timestamp;

        _send(j.freelancer, payout);
        emit PaymentReleased(jobId, j.freelancer, payout);
    }

    // ---------------------------------------------------------------------
    // 5. Dispute Management
    // ---------------------------------------------------------------------

    /// @notice ผู้ว่าจ้างหรือฟรีแลนซ์แจ้งข้อพิพาท (หลังฝากเงินและก่อนปิดงาน)
    function raiseDispute(uint256 jobId, string calldata reason) external jobExists(jobId) {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client && msg.sender != j.freelancer) revert NotParty();
        if (j.status != Status.Funded && j.status != Status.Submitted) revert InvalidStatus(j.status);
        if (bytes(reason).length == 0) revert EmptyField();

        j.status = Status.Disputed;
        j.disputeReason = reason;
        j.disputeRaisedBy = msg.sender;
        emit DisputeRaised(jobId, msg.sender, reason);
    }

    /**
     * @notice ผู้ดูแลตัดสินข้อพิพาท โดยกำหนดสัดส่วนที่ฟรีแลนซ์ได้รับ (basis points, 0-10000)
     *         0 = คืนเงินผู้ว่าจ้างทั้งหมด, 10000 = จ่ายฟรีแลนซ์ทั้งหมด, ค่าระหว่างกลาง = แบ่งจ่าย
     */
    function resolveDispute(uint256 jobId, uint256 freelancerBps) external onlyArbiter nonReentrant jobExists(jobId) {
        Job storage j = jobs[jobId];
        if (j.status != Status.Disputed) revert InvalidStatus(j.status);
        if (msg.sender == j.client || msg.sender == j.freelancer) revert ArbiterIsParty();
        if (freelancerBps > 10_000) revert InvalidAmount();

        uint256 total = j.escrowBalance;
        uint256 toFreelancer = (total * freelancerBps) / 10_000;
        uint256 toClient = total - toFreelancer;

        j.escrowBalance = 0;
        j.status = Status.Resolved;
        j.closedAt = block.timestamp;

        if (toFreelancer > 0) _send(j.freelancer, toFreelancer);
        if (toClient > 0) _send(j.client, toClient);
        emit DisputeResolved(jobId, msg.sender, toFreelancer, toClient);
    }

    // ---------------------------------------------------------------------
    // Refund เมื่อฟรีแลนซ์ไม่ส่งงานภายในกำหนด
    // ---------------------------------------------------------------------

    function claimRefund(uint256 jobId) external nonReentrant jobExists(jobId) {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Funded) revert InvalidStatus(j.status);
        if (block.timestamp <= j.deadline) revert DeadlineNotPassed();

        uint256 amount = j.escrowBalance;
        j.escrowBalance = 0;
        j.status = Status.Refunded;
        j.closedAt = block.timestamp;

        _send(j.client, amount);
        emit Refunded(jobId, j.client, amount);
    }

    // ---------------------------------------------------------------------
    // 6. Views (Transaction Tracking)
    // ---------------------------------------------------------------------

    function getJob(uint256 jobId) external view jobExists(jobId) returns (Job memory) {
        return jobs[jobId];
    }

    function getClientJobs(address client) external view returns (uint256[] memory) {
        return clientJobs[client];
    }

    function getFreelancerJobs(address freelancer) external view returns (uint256[] memory) {
        return freelancerJobs[freelancer];
    }

    /// @notice ยอด ETH ทั้งหมดที่ถูกล็อกอยู่ใน Escrow
    function totalEscrowed() external view returns (uint256) {
        return address(this).balance;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _send(address to, uint256 value) private {
        (bool ok, ) = payable(to).call{value: value}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev ปฏิเสธ ETH ที่โอนเข้ามาตรง ๆ โดยไม่ผ่าน deposit()
    receive() external payable {
        revert InvalidAmount();
    }
}
