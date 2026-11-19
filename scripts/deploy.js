const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { exportArtifact, saveDeployment } = require("./lib");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const Escrow = await ethers.getContractFactory("FreelanceEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  const address = await escrow.getAddress();
  const deployTx = escrow.deploymentTransaction();
  const receipt = await deployTx.wait();
  console.log(`FreelanceEscrow deployed at ${address} (tx ${deployTx.hash})`);

  // บนเครือข่าย local: ตั้งบัญชี #3 เป็นผู้ดูแลข้อพิพาทเพิ่ม เพื่อสาธิต
  if (network.name === "localhost" || network.name === "hardhat") {
    const signers = await ethers.getSigners();
    if (signers[3]) {
      await (await escrow.setArbiter(signers[3].address, true)).wait();
      console.log(`Arbiter added: ${signers[3].address} (Account #3)`);
    }
  }

  const { chainId } = await ethers.provider.getNetwork();
  await exportArtifact(hre);
  saveDeployment(Number(chainId), { address, deployBlock: receipt.blockNumber, txHash: deployTx.hash, network: network.name });
  console.log(`Saved frontend/deployments.json (chainId ${chainId})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
