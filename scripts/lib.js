const fs = require("fs");
const path = require("path");

const FRONTEND = path.join(__dirname, "..", "frontend");
const DEPLOYMENTS = path.join(FRONTEND, "deployments.json");

/** อ่านที่อยู่สัญญาที่ deploy แล้ว แยกตาม chainId */
function readDeployments() {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8"));
  } catch {
    return {};
  }
}

function saveDeployment(chainId, info) {
  const all = readDeployments();
  all[String(chainId)] = { ...info, savedAt: new Date().toISOString() };
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(all, null, 2) + "\n");
}

/** เขียน ABI + bytecode ให้หน้าเว็บใช้ (ทั้งเรียกใช้สัญญาและ deploy ผ่าน MetaMask) */
async function exportArtifact(hre) {
  await hre.run("compile", { quiet: true });
  const a = await hre.artifacts.readArtifact("FreelanceEscrow");
  const body = { contractName: a.contractName, abi: a.abi, bytecode: a.bytecode };
  fs.writeFileSync(
    path.join(FRONTEND, "contract.js"),
    `// สร้างอัตโนมัติโดย scripts — อย่าแก้ไขด้วยมือ\nwindow.ESCROW_ARTIFACT = ${JSON.stringify(body)};\n`
  );
}

module.exports = { readDeployments, saveDeployment, exportArtifact, DEPLOYMENTS };
