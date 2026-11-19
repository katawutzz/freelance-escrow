// คอมไพล์และส่งออก ABI + bytecode ไปที่ frontend/contract.js (ไม่ deploy)
const hre = require("hardhat");
const { exportArtifact } = require("./lib");

exportArtifact(hre)
  .then(() => console.log("Wrote frontend/contract.js"))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
