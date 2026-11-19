require("@nomicfoundation/hardhat-toolbox");

// การ deploy ด้วยสคริปต์ขึ้น testnet (ไม่บังคับ — ใช้ปุ่ม Deploy ด้วย MetaMask บนหน้าเว็บแทนได้)
//   PRIVATE_KEY, HOODI_RPC_URL (มีค่าเริ่มต้น), SEPOLIA_RPC_URL
const { PRIVATE_KEY, SEPOLIA_RPC_URL, HOODI_RPC_URL = "https://ethereum-hoodi-rpc.publicnode.com" } = process.env;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    hoodi: { url: HOODI_RPC_URL, chainId: 560048, accounts },
    ...(SEPOLIA_RPC_URL ? { sepolia: { url: SEPOLIA_RPC_URL, chainId: 11155111, accounts } } : {}),
  },
};
