const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const Status = { Created: 0n, Funded: 1n, Submitted: 2n, Released: 3n, Disputed: 4n, Resolved: 5n, Refunded: 6n, Cancelled: 7n };
const ONE_ETH = ethers.parseEther("1");

describe("FreelanceEscrow", function () {
  async function deployFixture() {
    const [owner, client, freelancer, arbiter, stranger] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("FreelanceEscrow");
    const escrow = await Escrow.deploy();
    await escrow.setArbiter(arbiter.address, true);
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    return { escrow, owner, client, freelancer, arbiter, stranger, deadline };
  }

  async function createdJobFixture() {
    const f = await deployFixture();
    await f.escrow.connect(f.client).createJob("Website", "Landing page", ONE_ETH, f.deadline, f.freelancer.address);
    return { ...f, jobId: 1n };
  }

  async function fundedJobFixture() {
    const f = await createdJobFixture();
    await f.escrow.connect(f.client).deposit(f.jobId, { value: ONE_ETH });
    return f;
  }

  async function submittedJobFixture() {
    const f = await fundedJobFixture();
    await f.escrow.connect(f.freelancer).submitWork(f.jobId, "https://github.com/me/site");
    return f;
  }

  describe("1. Create Contract", function () {
    it("สร้างข้อตกลงและเก็บข้อมูลครบ", async function () {
      const { escrow, client, freelancer, deadline } = await loadFixture(deployFixture);
      const tx1 = escrow.connect(client).createJob("Website", "Landing page", ONE_ETH, deadline, freelancer.address);
      await expect(tx1).to.emit(escrow, "JobCreated")
        .withArgs(1n, client.address, freelancer.address, "Website", ONE_ETH, deadline);

      const job = await escrow.getJob(1);
      expect(job.title).to.equal("Website");
      expect(job.description).to.equal("Landing page");
      expect(job.amount).to.equal(ONE_ETH);
      expect(job.deadline).to.equal(BigInt(deadline));
      expect(job.freelancer).to.equal(freelancer.address);
      expect(job.status).to.equal(Status.Created);
      expect(await escrow.getClientJobs(client.address)).to.deep.equal([1n]);
      expect(await escrow.getFreelancerJobs(freelancer.address)).to.deep.equal([1n]);
    });

    it("ปฏิเสธข้อมูลไม่ถูกต้อง", async function () {
      const { escrow, client, freelancer, deadline } = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(escrow.connect(client).createJob("", "d", ONE_ETH, deadline, freelancer.address)).to.be.revertedWithCustomError(escrow, "EmptyField");
      await expect(escrow.connect(client).createJob("t", "d", 0, deadline, freelancer.address)).to.be.revertedWithCustomError(escrow, "InvalidAmount");
      await expect(escrow.connect(client).createJob("t", "d", ONE_ETH, now, freelancer.address)).to.be.revertedWithCustomError(escrow, "InvalidDeadline");
      await expect(escrow.connect(client).createJob("t", "d", ONE_ETH, deadline, ethers.ZeroAddress)).to.be.revertedWithCustomError(escrow, "InvalidAddress");
      await expect(escrow.connect(client).createJob("t", "d", ONE_ETH, deadline, client.address)).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });

    it("ยกเลิกได้เฉพาะก่อนฝากเงิน และโดยผู้ว่าจ้างเท่านั้น", async function () {
      const { escrow, client, stranger, jobId } = await loadFixture(createdJobFixture);
      await expect(escrow.connect(stranger).cancelJob(jobId)).to.be.revertedWithCustomError(escrow, "NotClient");
      await expect(escrow.connect(client).cancelJob(jobId)).to.emit(escrow, "JobCancelled");
      expect((await escrow.getJob(jobId)).status).to.equal(Status.Cancelled);
      await expect(escrow.connect(client).deposit(jobId, { value: ONE_ETH })).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("2. Deposit Payment", function () {
    it("ฝากเงินเท่ากับค่าจ้างเข้าสู่ Escrow", async function () {
      const { escrow, client, jobId } = await loadFixture(createdJobFixture);
      const tx = escrow.connect(client).deposit(jobId, { value: ONE_ETH });
      await expect(tx).to.emit(escrow, "PaymentDeposited").withArgs(jobId, client.address, ONE_ETH);
      await expect(tx).to.changeEtherBalances([client, escrow], [-ONE_ETH, ONE_ETH]);
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(Status.Funded);
      expect(job.escrowBalance).to.equal(ONE_ETH);
    });

    it("ปฏิเสธจำนวนเงินไม่ตรง / คนอื่นฝาก / ฝากซ้ำ / โอนตรง", async function () {
      const { escrow, client, stranger, jobId } = await loadFixture(createdJobFixture);
      await expect(escrow.connect(client).deposit(jobId, { value: ONE_ETH - 1n })).to.be.revertedWithCustomError(escrow, "InvalidAmount");
      await expect(escrow.connect(stranger).deposit(jobId, { value: ONE_ETH })).to.be.revertedWithCustomError(escrow, "NotClient");
      await escrow.connect(client).deposit(jobId, { value: ONE_ETH });
      await expect(escrow.connect(client).deposit(jobId, { value: ONE_ETH })).to.be.revertedWithCustomError(escrow, "InvalidStatus");
      await expect(client.sendTransaction({ to: await escrow.getAddress(), value: 1n })).to.be.reverted;
      await expect(escrow.connect(client).deposit(99, { value: ONE_ETH })).to.be.revertedWithCustomError(escrow, "JobNotFound");
    });
  });

  describe("3. Submit Work", function () {
    it("ฟรีแลนซ์ส่งงานพร้อมหลักฐาน และส่งแก้ไขได้", async function () {
      const { escrow, freelancer, jobId } = await loadFixture(fundedJobFixture);
      const tx2 = escrow.connect(freelancer).submitWork(jobId, "ipfs://Qm123");
      await expect(tx2).to.emit(escrow, "WorkSubmitted").withArgs(jobId, freelancer.address, "ipfs://Qm123");
      await escrow.connect(freelancer).submitWork(jobId, "ipfs://Qm456");
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(Status.Submitted);
      expect(job.workEvidence).to.equal("ipfs://Qm456");
    });

    it("ห้ามส่งงานก่อนฝากเงิน / โดยคนอื่น / หลักฐานว่าง", async function () {
      const { escrow, client, freelancer, stranger, jobId } = await loadFixture(createdJobFixture);
      await expect(escrow.connect(freelancer).submitWork(jobId, "x")).to.be.revertedWithCustomError(escrow, "InvalidStatus");
      await escrow.connect(client).deposit(jobId, { value: ONE_ETH });
      await expect(escrow.connect(stranger).submitWork(jobId, "x")).to.be.revertedWithCustomError(escrow, "NotFreelancer");
      await expect(escrow.connect(freelancer).submitWork(jobId, "")).to.be.revertedWithCustomError(escrow, "EmptyField");
    });
  });

  describe("4. Approve & Release Payment", function () {
    it("อนุมัติแล้วโอน ETH ให้ฟรีแลนซ์อัตโนมัติ", async function () {
      const { escrow, client, freelancer, jobId } = await loadFixture(submittedJobFixture);
      const tx = escrow.connect(client).approveAndRelease(jobId);
      await expect(tx).to.emit(escrow, "PaymentReleased").withArgs(jobId, freelancer.address, ONE_ETH);
      await expect(tx).to.changeEtherBalances([escrow, freelancer], [-ONE_ETH, ONE_ETH]);
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(Status.Released);
      expect(job.escrowBalance).to.equal(0n);
      expect(await escrow.totalEscrowed()).to.equal(0n);
    });

    it("ห้ามจ่ายซ้ำ", async function () {
      const { escrow, client, jobId } = await loadFixture(submittedJobFixture);
      await escrow.connect(client).approveAndRelease(jobId);
      await expect(escrow.connect(client).approveAndRelease(jobId)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("ห้ามอนุมัติก่อนส่งงาน หรือโดยคนที่ไม่ใช่ผู้ว่าจ้าง", async function () {
      const { escrow, client, freelancer, jobId } = await loadFixture(fundedJobFixture);
      await expect(escrow.connect(client).approveAndRelease(jobId)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
      await escrow.connect(freelancer).submitWork(jobId, "x");
      await expect(escrow.connect(freelancer).approveAndRelease(jobId)).to.be.revertedWithCustomError(escrow, "NotClient");
    });

    it("กันการเรียกซ้ำแบบ Reentrancy", async function () {
      const { escrow, client, deadline } = await loadFixture(deployFixture);
      const Attacker = await ethers.getContractFactory("ReentrantFreelancer");
      const attacker = await Attacker.deploy(await escrow.getAddress());
      await escrow.connect(client).createJob("t", "d", ONE_ETH, deadline, await attacker.getAddress());
      await escrow.connect(client).deposit(1, { value: ONE_ETH });
      await attacker.submit(1);
      // การ re-enter ล้มเหลว => การโอนทั้งหมดล้มเหลว => สถานะย้อนกลับ ไม่มีเงินรั่ว
      await expect(escrow.connect(client).approveAndRelease(1)).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect(await escrow.totalEscrowed()).to.equal(ONE_ETH);
      expect((await escrow.getJob(1)).status).to.equal(Status.Submitted);
    });
  });

  describe("5. Dispute Management", function () {
    it("คู่สัญญาแจ้งข้อพิพาทได้ คนนอกแจ้งไม่ได้", async function () {
      const { escrow, client, stranger, jobId } = await loadFixture(submittedJobFixture);
      await expect(escrow.connect(stranger).raiseDispute(jobId, "x")).to.be.revertedWithCustomError(escrow, "NotParty");
      const tx3 = escrow.connect(client).raiseDispute(jobId, "งานไม่ตรงสเปก");
      await expect(tx3).to.emit(escrow, "DisputeRaised").withArgs(jobId, client.address, "งานไม่ตรงสเปก");
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(Status.Disputed);
      expect(job.disputeRaisedBy).to.equal(client.address);
    });

    it("ระหว่างข้อพิพาท ห้ามอนุมัติจ่าย / ห้ามคืนเงิน / ห้ามส่งงาน", async function () {
      const { escrow, client, freelancer, jobId } = await loadFixture(submittedJobFixture);
      await escrow.connect(freelancer).raiseDispute(jobId, "ผู้ว่าจ้างไม่ตรวจรับ");
      await expect(escrow.connect(client).approveAndRelease(jobId)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
      await time.increase(30 * 24 * 3600);
      await expect(escrow.connect(client).claimRefund(jobId)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
      await expect(escrow.connect(freelancer).submitWork(jobId, "y")).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("ผู้ดูแลตัดสินคืนเงินทั้งหมด", async function () {
      const { escrow, client, arbiter, jobId } = await loadFixture(fundedJobFixture);
      await escrow.connect(client).raiseDispute(jobId, "ไม่ส่งงาน");
      const tx = escrow.connect(arbiter).resolveDispute(jobId, 0);
      await expect(tx).to.emit(escrow, "DisputeResolved").withArgs(jobId, arbiter.address, 0n, ONE_ETH);
      await expect(tx).to.changeEtherBalances([escrow, client], [-ONE_ETH, ONE_ETH]);
      expect((await escrow.getJob(jobId)).status).to.equal(Status.Resolved);
    });

    it("ผู้ดูแลตัดสินแบ่งจ่าย 70/30", async function () {
      const { escrow, client, freelancer, arbiter, jobId } = await loadFixture(submittedJobFixture);
      await escrow.connect(client).raiseDispute(jobId, "ส่งไม่ครบ");
      const toF = ethers.parseEther("0.7");
      const toC = ethers.parseEther("0.3");
      await expect(escrow.connect(arbiter).resolveDispute(jobId, 7000))
        .to.changeEtherBalances([escrow, freelancer, client], [-ONE_ETH, toF, toC]);
      await expect(escrow.connect(arbiter).resolveDispute(jobId, 7000)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("เฉพาะผู้ดูแลที่ได้รับสิทธิ์ และต้องไม่ใช่คู่สัญญา", async function () {
      const { escrow, owner, client, stranger, arbiter, jobId } = await loadFixture(submittedJobFixture);
      await escrow.connect(client).raiseDispute(jobId, "x");
      await expect(escrow.connect(stranger).resolveDispute(jobId, 5000)).to.be.revertedWithCustomError(escrow, "NotArbiter");
      await expect(escrow.connect(arbiter).resolveDispute(jobId, 10001)).to.be.revertedWithCustomError(escrow, "InvalidAmount");
      await escrow.connect(owner).setArbiter(client.address, true);
      await expect(escrow.connect(client).resolveDispute(jobId, 0)).to.be.revertedWithCustomError(escrow, "ArbiterIsParty");
      await expect(escrow.connect(stranger).setArbiter(stranger.address, true)).to.be.revertedWithCustomError(escrow, "NotOwner");
    });

    it("ห้ามแจ้งข้อพิพาทก่อนฝากเงินหรือหลังปิดงาน", async function () {
      const { escrow, client, jobId } = await loadFixture(createdJobFixture);
      await expect(escrow.connect(client).raiseDispute(jobId, "x")).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("Refund หลังเลยกำหนดส่ง", function () {
    it("คืนเงินไม่ได้ก่อนกำหนดส่ง แต่คืนได้หลังเลยกำหนดถ้ายังไม่มีการส่งงาน", async function () {
      const { escrow, client, jobId, deadline } = await loadFixture(fundedJobFixture);
      await expect(escrow.connect(client).claimRefund(jobId)).to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
      await time.increaseTo(deadline + 1);
      const tx4 = escrow.connect(client).claimRefund(jobId);
      await expect(tx4).to.emit(escrow, "Refunded").withArgs(jobId, client.address, ONE_ETH);
      await expect(tx4).to.changeEtherBalances([escrow, client], [-ONE_ETH, ONE_ETH]);
      await expect(escrow.connect(client).claimRefund(jobId)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("ถ้าส่งงานแล้ว ผู้ว่าจ้างดึงเงินคืนเองไม่ได้ (ต้องอนุมัติหรือแจ้งข้อพิพาท)", async function () {
      const { escrow, client, jobId, deadline } = await loadFixture(submittedJobFixture);
      await time.increaseTo(deadline + 1);
      await expect(escrow.connect(client).claimRefund(jobId)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("6. Transaction Tracking", function () {
    it("ดึงประวัติจาก events ได้ครบตามลำดับ", async function () {
      const { escrow, client, jobId } = await loadFixture(submittedJobFixture);
      await escrow.connect(client).approveAndRelease(jobId);
      const names = ["JobCreated", "PaymentDeposited", "WorkSubmitted", "PaymentReleased"];
      for (const n of names) {
        const logs = await escrow.queryFilter(escrow.filters[n](jobId));
        expect(logs.length, n).to.equal(1);
        expect(logs[0].transactionHash).to.match(/^0x[0-9a-f]{64}$/);
      }
    });
  });
});
