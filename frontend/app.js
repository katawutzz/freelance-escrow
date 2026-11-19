/* global ethers */
"use strict";

const LOCAL_RPC = "http://127.0.0.1:8545";
const NETWORKS = {
  560048: { name: "Hoodi Testnet", rpc: "https://ethereum-hoodi-rpc.publicnode.com", explorer: "https://hoodi.etherscan.io", poll: 4000 },
  11155111: { name: "Sepolia Testnet", rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", poll: 4000 },
  31337: { name: "Hardhat Local", rpc: LOCAL_RPC, explorer: null, poll: 1000 },
};
const ART = window.ESCROW_ARTIFACT; // { abi, bytecode } จาก scripts/export.js
let ACTIVE_CHAIN = 560048; // เครือข่ายที่หน้าเว็บกำลังใช้
let CFG = null; // { chainId, address, deployBlock, abi } ของสัญญาบนเครือข่ายที่ใช้อยู่
const LOCAL_LABELS = ["เจ้าของระบบ/ผู้ดูแล", "ผู้ว่าจ้าง", "ฟรีแลนซ์", "ผู้ดูแลข้อพิพาท", "ผู้ว่าจ้าง 2", "ฟรีแลนซ์ 2"];

const STATUS = ["รอฝากเงิน", "ฝากเงินแล้ว", "ส่งงานแล้ว", "จ่ายเงินแล้ว", "ข้อพิพาท", "ตัดสินแล้ว", "คืนเงินแล้ว", "ยกเลิก"];
const S = { Created: 0, Funded: 1, Submitted: 2, Released: 3, Disputed: 4, Resolved: 5, Refunded: 6, Cancelled: 7 };

const ERRORS = {
  NotOwner: "เฉพาะเจ้าของระบบเท่านั้น",
  NotArbiter: "เฉพาะผู้ดูแลข้อพิพาทที่ได้รับสิทธิ์เท่านั้น",
  NotClient: "เฉพาะผู้ว่าจ้างของงานนี้เท่านั้น",
  NotFreelancer: "เฉพาะฟรีแลนซ์ของงานนี้เท่านั้น",
  NotParty: "เฉพาะคู่สัญญาของงานนี้เท่านั้น",
  JobNotFound: "ไม่พบงานนี้",
  InvalidStatus: "สถานะงานปัจจุบันไม่อนุญาตให้ทำรายการนี้",
  InvalidAddress: "Wallet Address ไม่ถูกต้อง (ห้ามว่าง และห้ามเป็นตัวเอง)",
  InvalidAmount: "จำนวนเงินไม่ถูกต้อง",
  InvalidDeadline: "กำหนดส่งต้องอยู่ในอนาคต",
  EmptyField: "กรุณากรอกข้อมูลให้ครบ",
  DeadlineNotPassed: "ยังไม่เลยกำหนดส่ง จึงยังขอคืนเงินไม่ได้",
  ArbiterIsParty: "ผู้ดูแลที่เป็นคู่สัญญาของงานนี้ตัดสินเองไม่ได้",
  TransferFailed: "การโอน ETH ล้มเหลว",
  Reentrancy: "ตรวจพบการเรียกซ้ำ",
};

const EVENT_LABEL = {
  JobCreated: "สร้างข้อตกลง",
  PaymentDeposited: "ฝากเงินเข้า Escrow",
  WorkSubmitted: "ส่งมอบงาน",
  PaymentReleased: "อนุมัติและจ่ายเงิน",
  DisputeRaised: "แจ้งข้อพิพาท",
  DisputeResolved: "ผู้ดูแลตัดสินข้อพิพาท",
  Refunded: "คืนเงินผู้ว่าจ้าง",
  JobCancelled: "ยกเลิกข้อตกลง",
};

const state = {
  readProvider: null,
  readContract: null,
  signer: null,
  account: null,
  writeContract: null,
  mode: null, // "metamask" | "local"
  isOwner: false,
  isArbiter: false,
  jobs: [],
  selectedId: null,
  tab: "all",
  blockTimes: new Map(),
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–");
const fmtEth = (wei) => `${Number(ethers.formatEther(wei)).toLocaleString("th-TH", { maximumFractionDigits: 6 })} ETH`;
const fmtTime = (ts) => (ts ? new Date(Number(ts) * 1000).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "–");
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

function explorerTx(hash) {
  const ex = NETWORKS[ACTIVE_CHAIN]?.explorer;
  return ex ? `${ex}/tx/${hash}` : null;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};
function hashHtml(hash) {
  const url = explorerTx(hash);
  const label = `${hash.slice(0, 10)}…${hash.slice(-8)}`;
  return url
    ? `<a class="hash" href="${url}" target="_blank" rel="noopener" title="${hash}">${label}</a>`
    : `<button class="hash" data-copy="${hash}" title="คลิกเพื่อคัดลอก: ${hash}">${label}</button>`;
}
function evidenceHtml(ev) {
  if (!ev) return "–";
  if (/^https?:\/\//i.test(ev)) return `<a href="${esc(ev)}" target="_blank" rel="noopener noreferrer">${esc(ev)}</a>`;
  if (/^ipfs:\/\//i.test(ev)) return `<a href="https://ipfs.io/ipfs/${esc(ev.slice(7))}" target="_blank" rel="noopener noreferrer">${esc(ev)}</a>`;
  return `<span class="mono">${esc(ev)}</span>`;
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 9000 : 7000);
}

function decodeError(err) {
  if (err?.code === "ACTION_REJECTED" || err?.info?.error?.code === 4001) return "ผู้ใช้ยกเลิกรายการใน Wallet";
  const rpcCode = err?.info?.error?.code ?? err?.error?.code ?? err?.code;
  if (rpcCode === 4100) return "บัญชีนี้ยังไม่ได้เชื่อมต่อกับเว็บใน MetaMask — กด “เปลี่ยนบัญชี” แล้วเลือกบัญชีที่ต้องการ";
  let name = err?.revert?.name;
  if (!name) {
    const data = err?.data || err?.info?.error?.data?.data || err?.info?.error?.data || err?.error?.data;
    if (typeof data === "string" && data.startsWith("0x") && state.readContract) {
      try { name = state.readContract.interface.parseError(data)?.name; } catch { /* ignore */ }
    }
  }
  if (name && ERRORS[name]) return `${ERRORS[name]} (${name})`;
  if (err?.code === "INSUFFICIENT_FUNDS") return "ยอด ETH ในกระเป๋าไม่พอ";
  return err?.shortMessage || err?.reason || err?.message || String(err);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function showWarning(text) {
  const w = $("configWarning");
  w.textContent = text;
  w.classList.toggle("hidden", !text);
}

async function loadDeployments() {
  let deps = {};
  try {
    deps = await (await fetch("deployments.json", { cache: "no-store" })).json();
  } catch { /* ignore */ }
  // สำรอง: ที่อยู่ที่บันทึกในเบราว์เซอร์ กรณีบันทึกลงเซิร์ฟเวอร์ไม่สำเร็จ
  for (const id of Object.keys(NETWORKS)) {
    const local = store.get(`escrow.dep.${id}`);
    if (!deps[id] && local) try { deps[id] = JSON.parse(local); } catch { /* ignore */ }
  }
  return deps;
}

function pickChain(deps) {
  const q = Number(new URLSearchParams(location.search).get("chain"));
  if (NETWORKS[q]) return q;
  const saved = Number(store.get("escrow.chain"));
  if (NETWORKS[saved]) return saved;
  return 560048; // ค่าเริ่มต้น: Hoodi Testnet
}

function renderNetworkSelect() {
  const sel = $("networkSelect");
  sel.innerHTML = Object.entries(NETWORKS).map(([id, n]) => `<option value="${id}">${n.name}</option>`).join("");
  sel.value = String(ACTIVE_CHAIN);
  sel.onchange = async () => {
    const id = Number(sel.value);
    store.set("escrow.chain", String(id));
    if (state.mode === "metamask") {
      try {
        await switchChain(id); // chainChanged จะรีโหลดหน้าให้
        return;
      } catch (err) {
        toast(`สลับเครือข่ายใน MetaMask ไม่สำเร็จ: ${esc(decodeError(err))}`, "err");
      }
    }
    location.reload();
  };
}

async function initRead(deps) {
  const net = NETWORKS[ACTIVE_CHAIN];
  state.readProvider = new ethers.JsonRpcProvider(net.rpc, ACTIVE_CHAIN, { staticNetwork: true, pollingInterval: net.poll });
  $("connectLocal").classList.toggle("hidden", ACTIVE_CHAIN !== 31337);
  $("deployNetName").textContent = net.name;

  const dep = deps[String(ACTIVE_CHAIN)];
  if (!dep) {
    $("deployPanel").classList.remove("hidden");
    $("statContract").textContent = "ยังไม่ deploy";
    $("jobList").innerHTML = `<div class="empty">ยังไม่มีสัญญาบน ${net.name}</div>`;
    return false;
  }
  CFG = { chainId: ACTIVE_CHAIN, address: dep.address, deployBlock: dep.deployBlock ?? 0, abi: ART.abi };
  $("statContract").innerHTML = net.explorer
    ? `<a class="hash" style="font-size:1rem" href="${net.explorer}/address/${CFG.address}" target="_blank" rel="noopener" title="${CFG.address}">${short(CFG.address)}</a>`
    : short(CFG.address);
  $("statContract").title = CFG.address;
  state.readContract = new ethers.Contract(CFG.address, CFG.abi, state.readProvider);
  let code;
  try {
    code = await state.readProvider.getCode(CFG.address);
  } catch {
    showWarning(ACTIVE_CHAIN === 31337
      ? "เชื่อมต่อ Hardhat node ที่ 127.0.0.1:8545 ไม่ได้ — รัน npm run node แล้วตามด้วย npm run deploy:local หรือสลับไป Hoodi Testnet"
      : `เชื่อมต่อ RPC ของ ${net.name} ไม่ได้ ลองรีเฟรชอีกครั้ง`);
    return false;
  }
  if (code === "0x") {
    state.readContract = null;
    CFG = null;
    showWarning(`ไม่พบสัญญาที่ address ที่บันทึกไว้บน ${net.name} (เครือข่ายอาจถูกรีเซ็ต) — deploy ใหม่ได้ด้านล่าง`);
    $("deployPanel").classList.remove("hidden");
    return false;
  }
  state.readProvider.on("block", debounce(() => refreshAll(false), 400));
  return true;
}

async function saveDeploymentInfo(info) {
  store.set(`escrow.dep.${info.chainId}`, JSON.stringify(info));
  try {
    const r = await fetch("api/deployments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(info) });
    if (!r.ok) throw new Error(await r.text());
  } catch (err) {
    console.warn("บันทึกลง deployments.json ไม่สำเร็จ ใช้ค่าที่เก็บในเบราว์เซอร์แทน", err);
  }
}

/**
 * รอผลยืนยันธุรกรรมผ่าน RPC ของเครือข่ายโดยตรง
 * (ไม่ใช้ tx.wait() ผ่าน MetaMask เพราะบางเวอร์ชันตอบกลับรูปแบบที่ ethers อ่านไม่ได้ -> "could not coalesce error")
 */
async function waitReceipt(hash) {
  const receipt = await state.readProvider.waitForTransaction(hash, 1, 5 * 60 * 1000);
  if (!receipt) throw new Error("หมดเวลารอการยืนยัน ลองกดรีเฟรชภายหลัง");
  if (receipt.status === 0) throw new Error("ธุรกรรมถูกปฏิเสธโดยสัญญา (reverted)");
  return receipt;
}

/**
 * หาสัญญาที่บัญชีนี้เคย deploy ไว้แล้ว (เช่น deploy สำเร็จแต่หน้าเว็บบันทึกไม่ทัน)
 * โดยคำนวณ address จาก nonce ย้อนหลัง แล้วตรวจว่าเป็น FreelanceEscrow ที่บัญชีนี้เป็นเจ้าของ
 */
async function findExistingDeployment(account) {
  const p = state.readProvider;
  const nonce = await p.getTransactionCount(account);
  for (let n = nonce - 1; n >= Math.max(0, nonce - 15); n--) {
    const address = ethers.getCreateAddress({ from: account, nonce: n });
    if ((await p.getCode(address)) === "0x") continue;
    const c = new ethers.Contract(address, ART.abi, p);
    try {
      if (!same(await c.owner(), account)) continue;
      await c.jobCount();
    } catch {
      continue;
    }
    // หาบล็อกที่ deploy จาก event OwnershipTransferred ใน constructor
    const latest = await p.getBlockNumber();
    const STEP = 40000;
    for (let end = latest; end > 0 && end > latest - STEP * 15; end -= STEP) {
      const logs = await c.queryFilter(c.filters.OwnershipTransferred(ethers.ZeroAddress), Math.max(0, end - STEP + 1), end);
      if (logs.length) return { chainId: ACTIVE_CHAIN, address, deployBlock: logs[0].blockNumber, txHash: logs[0].transactionHash, network: NETWORKS[ACTIVE_CHAIN].name };
    }
    return { chainId: ACTIVE_CHAIN, address, deployBlock: Math.max(0, latest - STEP * 15), network: NETWORKS[ACTIVE_CHAIN].name };
  }
  return null;
}

async function deployWithMetaMask() {
  if (state.mode !== "metamask") {
    await connectMetaMask();
    if (state.mode !== "metamask") return;
  }
  const btn = $("deployBtn");
  btn.disabled = true;
  try {
    const factory = new ethers.ContractFactory(ART.abi, ART.bytecode, state.signer);
    toast("กรุณายืนยันการ Deploy ใน MetaMask");
    const contract = await factory.deploy();
    const tx = contract.deploymentTransaction();
    toast(`ส่งรายการ Deploy แล้ว รอยืนยัน (ประมาณ 12–30 วินาที) · ${hashHtml(tx.hash)}`);
    const receipt = await waitReceipt(tx.hash);
    const address = receipt.contractAddress || (await contract.getAddress());
    await saveDeploymentInfo({ chainId: ACTIVE_CHAIN, address, deployBlock: receipt.blockNumber, txHash: tx.hash, network: NETWORKS[ACTIVE_CHAIN].name });
    toast(`<b>Deploy สำเร็จ</b><br/>สัญญา ${address}<br/>${hashHtml(tx.hash)}`, "ok");
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    console.error(err);
    toast(`<b>Deploy ไม่สำเร็จ</b><br/>${esc(decodeError(err))}`, "err");
  } finally {
    btn.disabled = false;
  }
}

async function connectMetaMask() {
  if (!window.ethereum) {
    toast("ไม่พบ MetaMask ในเบราว์เซอร์นี้ — เปิดหน้านี้ใน Chrome/Edge/Brave ที่ติดตั้ง MetaMask", "err");
    return;
  }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    store.set("escrow.mm", "1");
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== ACTIVE_CHAIN) {
      await switchChain(ACTIVE_CHAIN);
      return; // chainChanged จะรีโหลดหน้าแล้วเชื่อมต่อใหม่อัตโนมัติ
    }
    await setSigner(await provider.getSigner(), "metamask");
  } catch (err) {
    toast(`เชื่อมต่อไม่สำเร็จ: ${esc(decodeError(err))}`, "err");
  }
}

function watchMetaMask() {
  if (!window.ethereum?.on) return;
  window.ethereum.on("chainChanged", (hex) => {
    if (store.get("escrow.mm") !== "1") return;
    const id = Number(hex);
    if (NETWORKS[id]) store.set("escrow.chain", String(id));
    location.reload();
  });
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (state.mode !== "metamask") return;
    if (!accounts.length) {
      store.set("escrow.mm", null);
      return location.reload();
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await setSigner(await provider.getSigner(), "metamask");
  });
}

async function autoReconnect() {
  if (!window.ethereum || store.get("escrow.mm") !== "1") return;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    const chainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
    if (accounts.length && chainId === ACTIVE_CHAIN) {
      await setSigner(await new ethers.BrowserProvider(window.ethereum).getSigner(), "metamask");
    }
  } catch { /* ignore */ }
}

async function switchChain(id) {
  const net = NETWORKS[id];
  const chainIdHex = ethers.toQuantity(id);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (err) {
    if (err.code === 4902 || err?.data?.originalError?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainIdHex,
          chainName: net.name,
          rpcUrls: [net.rpc],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          ...(net.explorer ? { blockExplorerUrls: [net.explorer] } : {}),
        }],
      });
    } else throw err;
  }
}

async function connectLocal() {
  if (ACTIVE_CHAIN !== 31337) {
    toast("บัญชีทดสอบใช้ได้เฉพาะเครือข่าย Hardhat Local", "err");
    return;
  }
  try {
    const signers = await state.readProvider.listAccounts();
    const sel = $("accountSelect");
    sel.innerHTML = signers
      .slice(0, 10)
      .map((s, i) => `<option value="${i}">#${i} ${LOCAL_LABELS[i] ? LOCAL_LABELS[i] + " · " : ""}${short(s.address)}</option>`)
      .join("");
    sel.value = "1";
    sel.classList.remove("hidden");
    sel.onchange = () => setSigner(signers[Number(sel.value)], "local");
    $("connectMetaMask").classList.add("hidden");
    $("connectLocal").classList.add("hidden");
    await setSigner(signers[1], "local");
  } catch (err) {
    toast(`เชื่อมต่อ Hardhat node ไม่ได้: ${esc(decodeError(err))}`, "err");
  }
}

async function setSigner(signer, mode) {
  state.signer = signer;
  state.mode = mode;
  state.account = await signer.getAddress();
  if (mode === "metamask") {
    $("connectMetaMask").classList.add("hidden");
    $("connectLocal").classList.add("hidden");
  }
  if (!state.readContract) {
    state.writeContract = null;
    await renderWallet();
    if (mode === "metamask" && ART) {
      try {
        const found = await findExistingDeployment(state.account);
        if (found) {
          await saveDeploymentInfo(found);
          toast(`<b>พบสัญญาที่คุณ deploy ไว้แล้ว</b><br/>${found.address}<br/>กำลังโหลด…`, "ok");
          setTimeout(() => location.reload(), 1500);
        }
      } catch (err) {
        console.warn("ค้นหาสัญญาเดิมไม่สำเร็จ", err);
      }
    }
    return;
  }
  state.writeContract = new ethers.Contract(CFG.address, CFG.abi, signer);
  [state.isOwner, state.isArbiter] = await Promise.all([
    state.readContract.owner().then((o) => same(o, state.account)),
    state.readContract.isArbiter(state.account),
  ]);
  $("adminCard").classList.toggle("hidden", !state.isOwner);
  await refreshAll();
}

async function renderWallet() {
  const info = $("walletInfo");
  if (!state.account) return info.classList.add("hidden");
  const bal = await state.readProvider.getBalance(state.account);
  info.innerHTML = `<span class="dot"></span><span class="mono" title="${state.account}">${short(state.account)}</span><span>${fmtEth(bal)}</span>`;
  info.classList.remove("hidden");
  $("faucetBtn").classList.toggle("hidden", ACTIVE_CHAIN !== 31337);
  $("switchAccountBtn").classList.toggle("hidden", state.mode !== "metamask");
  const roles = [];
  if (state.isOwner) roles.push("เจ้าของระบบ");
  if (state.isArbiter) roles.push("ผู้ดูแลข้อพิพาท");
  roles.push("ผู้ว่าจ้าง / ฟรีแลนซ์");
  $("statRole").textContent = roles.join(" · ");
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function toJob(r) {
  return {
    id: Number(r.id), client: r.client, freelancer: r.freelancer, title: r.title, description: r.description,
    amount: r.amount, deadline: Number(r.deadline), escrowBalance: r.escrowBalance, workEvidence: r.workEvidence,
    disputeReason: r.disputeReason, disputeRaisedBy: r.disputeRaisedBy, status: Number(r.status),
    createdAt: Number(r.createdAt), submittedAt: Number(r.submittedAt), closedAt: Number(r.closedAt),
  };
}

async function loadJobs() {
  const count = Number(await state.readContract.jobCount());
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  state.jobs = (await Promise.all(ids.map((id) => state.readContract.getJob(id)))).map(toJob).reverse();
  $("statJobs").textContent = count.toLocaleString("th-TH");
  $("statEscrow").textContent = fmtEth(await state.readContract.totalEscrowed());
}

async function blockTime(n) {
  if (!state.blockTimes.has(n)) {
    const b = await state.readProvider.getBlock(n);
    state.blockTimes.set(n, b?.timestamp ?? 0);
  }
  return state.blockTimes.get(n);
}

async function loadEvents(jobId) {
  const c = state.readContract;
  const from = CFG.deployBlock ?? 0;
  const latest = await state.readProvider.getBlockNumber();
  // RPC สาธารณะบางเจ้าจำกัดช่วงบล็อกต่อการค้นหา จึงแบ่งเป็นช่วงละ 40,000 บล็อก
  const STEP = 40000;
  let logs = [];
  for (let s = from; s <= latest; s += STEP) {
    logs.push(...(await c.queryFilter("*", s, Math.min(s + STEP - 1, latest))));
  }
  logs = logs.filter((l) => l.fragment && EVENT_LABEL[l.fragment.name] && (!jobId || Number(l.args.jobId) === jobId));
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  await Promise.all([...new Set(logs.map((l) => l.blockNumber))].map(blockTime));
  return logs.map((l) => ({ name: l.fragment.name, args: l.args, hash: l.transactionHash, block: l.blockNumber, time: state.blockTimes.get(l.blockNumber) }));
}

function eventDetail(e) {
  const a = e.args;
  switch (e.name) {
    case "JobCreated": return { amt: fmtEth(a.amount), note: `กำหนดส่ง ${fmtTime(a.deadline)}` };
    case "PaymentDeposited": return { amt: fmtEth(a.amount), note: `โดย ${short(a.client)}` };
    case "WorkSubmitted": return { amt: "", note: `หลักฐาน: ${esc(a.evidence)}` };
    case "PaymentReleased": return { amt: fmtEth(a.amount), note: `โอนให้ ${short(a.freelancer)}` };
    case "DisputeRaised": return { amt: "", note: `โดย ${short(a.raisedBy)} — ${esc(a.reason)}` };
    case "DisputeResolved": return { amt: fmtEth(a.freelancerAmount + a.clientAmount), note: `ฟรีแลนซ์ ${fmtEth(a.freelancerAmount)} · ผู้ว่าจ้าง ${fmtEth(a.clientAmount)}` };
    case "Refunded": return { amt: fmtEth(a.amount), note: `คืนให้ ${short(a.client)}` };
    case "JobCancelled": return { amt: "", note: "" };
    default: return { amt: "", note: "" };
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function myRole(job) {
  const r = [];
  if (same(job.client, state.account)) r.push("ผู้ว่าจ้าง");
  if (same(job.freelancer, state.account)) r.push("ฟรีแลนซ์");
  return r;
}

function renderJobList() {
  const list = state.jobs.filter((j) => {
    if (state.tab === "client") return same(j.client, state.account);
    if (state.tab === "freelancer") return same(j.freelancer, state.account);
    if (state.tab === "disputed") return j.status === S.Disputed;
    return true;
  });
  const el = $("jobList");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${state.tab !== "all" && !state.account ? "เชื่อมต่อ Wallet เพื่อดูงานของคุณ" : "ยังไม่มีงานในหมวดนี้"}</div>`;
    return;
  }
  el.innerHTML = list
    .map((j) => {
      const roles = myRole(j).map((r) => `<span class="badge role">${r}</span>`).join(" ");
      return `<button class="job-item ${j.id === state.selectedId ? "selected" : ""}" data-id="${j.id}">
        <span class="job-id">#${j.id}</span>
        <span class="job-title">${esc(j.title)} ${roles}</span>
        <span class="job-amt">${fmtEth(j.amount)}</span>
        <span class="badge s-${j.status}">${STATUS[j.status]}</span>
      </button>`;
    })
    .join("");
}

function stepperHtml(job) {
  const steps = ["สร้างข้อตกลง", "ฝากเงิน", "ส่งงาน", "อนุมัติ/จ่ายเงิน"];
  let reached; let bad = null;
  switch (job.status) {
    case S.Created: reached = 0; break;
    case S.Funded: reached = 1; break;
    case S.Submitted: reached = 2; break;
    case S.Released: reached = 4; break;
    case S.Disputed: reached = job.submittedAt ? 2 : 1; bad = "ข้อพิพาท"; break;
    case S.Resolved: reached = 4; steps[3] = "ตัดสินข้อพิพาท"; break;
    case S.Refunded: reached = 4; steps[3] = "คืนเงิน"; break;
    case S.Cancelled: reached = 0; bad = "ยกเลิก"; break;
  }
  return `<div class="stepper">${steps
    .map((s, i) => {
      let cls = i < reached || (i === reached && reached === 4) ? "done" : i === reached ? "current" : "";
      if (i === 0 && job.status !== S.Created) cls = "done";
      if (bad && i === Math.min(reached + 1, 3)) return `<div class="step bad">${bad}</div>`;
      return `<div class="step ${cls}">${s}</div>`;
    })
    .join("")}</div>`;
}

function actionsHtml(job) {
  if (!state.account) return `<div class="actions"><div class="hint">เชื่อมต่อ Wallet เพื่อทำรายการกับงานนี้</div></div>`;
  const isClient = same(job.client, state.account);
  const isFree = same(job.freelancer, state.account);
  const now = Math.floor(Date.now() / 1000);
  const parts = [];

  if (isClient && job.status === S.Created) {
    parts.push(`<div class="action-row"><button class="btn primary" data-act="deposit">ฝากเงิน ${fmtEth(job.amount)} เข้า Escrow</button><button class="btn danger-ghost" data-act="cancel">ยกเลิกข้อตกลง</button></div>`);
  }
  if (isFree && (job.status === S.Funded || job.status === S.Submitted)) {
    parts.push(`<div class="action-row"><input id="evidenceInput" placeholder="URL หรือ Hash ของไฟล์ผลงาน เช่น https://… / ipfs://…" value="${job.status === S.Submitted ? esc(job.workEvidence) : ""}" /><button class="btn primary" data-act="submit">${job.status === S.Submitted ? "ส่งงานแก้ไข" : "ส่งมอบงาน"}</button></div>`);
  }
  if (isClient && job.status === S.Submitted) {
    parts.push(`<div class="action-row"><button class="btn ok" data-act="approve">อนุมัติงานและจ่ายเงิน ${fmtEth(job.escrowBalance)}</button></div>`);
  }
  if (isClient && job.status === S.Funded && now > job.deadline) {
    parts.push(`<div class="action-row"><button class="btn warn" data-act="refund">เลยกำหนดส่งแล้ว — ขอคืนเงิน</button></div>`);
  }
  if ((isClient || isFree) && (job.status === S.Funded || job.status === S.Submitted)) {
    parts.push(`<div class="action-row"><input id="reasonInput" placeholder="เหตุผลการแจ้งข้อพิพาท" /><button class="btn danger-ghost" data-act="dispute">แจ้งข้อพิพาท</button></div>`);
  }
  if (state.isArbiter && job.status === S.Disputed) {
    if (isClient || isFree) {
      parts.push(`<div class="hint">คุณเป็นคู่สัญญาของงานนี้ จึงตัดสินข้อพิพาทเองไม่ได้</div>`);
    } else {
      parts.push(`<div class="split">
        <div class="hint">ตัดสินข้อพิพาท: เลือกสัดส่วนเงิน ${fmtEth(job.escrowBalance)} ที่จะจ่ายให้ฟรีแลนซ์</div>
        <input id="splitRange" type="range" min="0" max="100" step="5" value="50" />
        <div class="split-labels"><span>ผู้ว่าจ้างได้คืน <b id="splitClient"></b></span><span>ฟรีแลนซ์ได้ <b id="splitFree"></b></span></div>
        <div class="action-row"><button class="btn sm" data-preset="0">คืนเงินทั้งหมด</button><button class="btn sm" data-preset="50">แบ่งครึ่ง</button><button class="btn sm" data-preset="100">จ่ายฟรีแลนซ์ทั้งหมด</button><span style="flex:1"></span><button class="btn primary" data-act="resolve">ยืนยันคำตัดสิน</button></div>
      </div>`);
    }
  }
  if (!parts.length) {
    const why = [S.Released, S.Resolved, S.Refunded, S.Cancelled].includes(job.status)
      ? "งานนี้ปิดแล้ว ไม่มีรายการที่ทำได้"
      : isClient || isFree
        ? "ยังไม่มีรายการที่คุณทำได้ในสถานะนี้"
        : "คุณไม่ใช่คู่สัญญาของงานนี้";
    parts.push(`<div class="hint">${why}</div>`);
  }
  return `<div class="actions">${parts.join("")}</div>`;
}

async function renderDetail() {
  const el = $("jobDetail");
  const job = state.jobs.find((j) => j.id === state.selectedId);
  if (!job) {
    el.innerHTML = `<div class="empty">เลือกงานจากรายการเพื่อดูรายละเอียด สถานะ และประวัติธุรกรรม</div>`;
    return;
  }
  const events = await loadEvents(job.id);
  if (job.id !== state.selectedId) return;
  const overdue = job.status <= S.Funded && Date.now() / 1000 > job.deadline;
  el.innerHTML = `
    <div class="detail-head">
      <div><h3>#${job.id} · ${esc(job.title)}</h3><div class="sub">สร้างเมื่อ ${fmtTime(job.createdAt)}</div></div>
      <span class="badge s-${job.status}">${STATUS[job.status]}</span>
    </div>
    ${stepperHtml(job)}
    <dl class="kv">
      <dt>รายละเอียดงาน</dt><dd>${esc(job.description) || "–"}</dd>
      <dt>ค่าจ้าง</dt><dd><b>${fmtEth(job.amount)}</b></dd>
      <dt>เงินใน Escrow</dt><dd>${fmtEth(job.escrowBalance)}</dd>
      <dt>กำหนดส่ง</dt><dd>${fmtTime(job.deadline)} ${overdue ? '<span class="badge s-4">เลยกำหนด</span>' : ""}</dd>
      <dt>ผู้ว่าจ้าง</dt><dd class="mono">${job.client}</dd>
      <dt>ฟรีแลนซ์</dt><dd class="mono">${job.freelancer}</dd>
      <dt>หลักฐานการส่งงาน</dt><dd>${evidenceHtml(job.workEvidence)}${job.submittedAt ? ` <span class="sub">(${fmtTime(job.submittedAt)})</span>` : ""}</dd>
      ${job.disputeReason ? `<dt>ข้อพิพาท</dt><dd>${esc(job.disputeReason)} <span class="sub">— แจ้งโดย ${same(job.disputeRaisedBy, job.client) ? "ผู้ว่าจ้าง" : "ฟรีแลนซ์"}</span></dd>` : ""}
    </dl>
    ${actionsHtml(job)}
    <h3 style="margin-bottom:10px">ไทม์ไลน์ธุรกรรม</h3>
    <ul class="timeline">${events
      .map((e) => {
        const d = eventDetail(e);
        return `<li><div class="t-title">${EVENT_LABEL[e.name]} ${d.amt ? `· ${d.amt}` : ""}</div>
          <div class="t-meta">${fmtTime(e.time)} · บล็อก ${e.block} · ${hashHtml(e.hash)}</div>
          ${d.note ? `<div class="t-meta">${d.note}</div>` : ""}</li>`;
      })
      .join("")}</ul>`;
  wireSplit(job);
}

function wireSplit(job) {
  const range = $("splitRange");
  if (!range) return;
  const update = () => {
    const bps = BigInt(Number(range.value) * 100);
    const toF = (job.escrowBalance * bps) / 10000n;
    $("splitFree").textContent = `${range.value}% · ${fmtEth(toF)}`;
    $("splitClient").textContent = `${100 - Number(range.value)}% · ${fmtEth(job.escrowBalance - toF)}`;
  };
  range.oninput = update;
  document.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => { range.value = b.dataset.preset; update(); }));
  update();
}

async function renderActivity() {
  const events = (await loadEvents()).reverse().slice(0, 25);
  $("activityBody").innerHTML = events.length
    ? events
        .map((e) => {
          const d = eventDetail(e);
          return `<tr><td>${fmtTime(e.time)}</td><td><button class="hash" data-job="${e.args.jobId}">#${e.args.jobId}</button></td><td>${EVENT_LABEL[e.name]}</td><td class="num">${d.amt || "–"}</td><td>${hashHtml(e.hash)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="empty">ยังไม่มีธุรกรรม</td></tr>`;
}

let refreshing = null;
let lastSnapshot = "";
// force=false (จาก block ใหม่): วาดหน้าใหม่เฉพาะเมื่อข้อมูลงานเปลี่ยน เพื่อไม่ให้ช่องที่ผู้ใช้กำลังพิมพ์ถูกล้าง
async function refreshAll(force = true) {
  if (!state.readContract) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      await loadJobs();
      const snap = state.jobs.map((j) => `${j.id}:${j.status}:${j.escrowBalance}:${j.workEvidence}`).join("|") + `@${state.account}`;
      if (!force && snap === lastSnapshot) {
        await renderWallet();
        return;
      }
      lastSnapshot = snap;
      renderJobList();
      await Promise.all([renderDetail(), renderActivity(), renderWallet()]);
    } catch (err) {
      console.error(err);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * ก่อนส่งธุรกรรม ตรวจว่าบัญชีที่หน้าเว็บใช้อยู่ยังได้รับอนุญาตใน MetaMask
 * (ถ้าผู้ใช้สลับบัญชีหรือ MetaMask ล็อก จะเกิด error 4100 "not been authorized by the user")
 */
async function ensureWalletAccount() {
  if (state.mode !== "metamask" || !window.ethereum) return true;
  let accounts = await window.ethereum.request({ method: "eth_accounts" }).catch(() => []);
  if (!accounts.length) {
    try {
      accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    } catch (err) {
      toast(`กรุณาปลดล็อกและเชื่อมต่อ MetaMask ก่อน: ${esc(decodeError(err))}`, "err");
      return false;
    }
  }
  if (accounts.some((a) => a.toLowerCase() === state.account.toLowerCase())) return true;
  const prev = state.account;
  await setSigner(await new ethers.BrowserProvider(window.ethereum).getSigner(), "metamask");
  toast(`<b>บัญชีใน MetaMask เปลี่ยนไป</b><br/>${short(prev)} → ${short(state.account)}<br/>ตรวจบทบาทและข้อมูล แล้วกดอีกครั้ง`, "err");
  return false;
}

async function sendTx(label, fn) {
  if (!state.writeContract) {
    toast(state.account && !state.readContract ? "ยังไม่มีสัญญาบนเครือข่ายนี้ — กด Deploy ด้านบนก่อน" : "กรุณาเชื่อมต่อ Wallet ก่อน", "err");
    return null;
  }
  if (!(await ensureWalletAccount())) return null;
  const buttons = document.querySelectorAll("button[data-act], #createForm button, #arbiterForm button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    const tx = await fn(state.writeContract);
    toast(`ส่งรายการ “${label}” แล้ว รอยืนยัน · ${hashHtml(tx.hash)}`);
    const receipt = await waitReceipt(tx.hash);
    toast(`<b>${label} สำเร็จ</b><br/>บล็อก ${receipt.blockNumber} · ${hashHtml(tx.hash)}`, "ok");
    await refreshAll();
    return receipt;
  } catch (err) {
    console.error(err);
    toast(`<b>${label} ไม่สำเร็จ</b><br/>${esc(decodeError(err))}`, "err");
    return null;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function onAction(act) {
  const job = state.jobs.find((j) => j.id === state.selectedId);
  if (!job) return;
  const id = job.id;
  switch (act) {
    case "deposit":
      return sendTx("ฝากเงินเข้า Escrow", (c) => c.deposit(id, { value: job.amount }));
    case "cancel":
      if (!confirm("ยืนยันยกเลิกข้อตกลงนี้?")) return;
      return sendTx("ยกเลิกข้อตกลง", (c) => c.cancelJob(id));
    case "submit": {
      const ev = $("evidenceInput").value.trim();
      if (!ev) return toast("กรุณาใส่ URL หรือ Hash ของผลงาน", "err");
      return sendTx("ส่งมอบงาน", (c) => c.submitWork(id, ev));
    }
    case "approve":
      if (!confirm(`ยืนยันอนุมัติงานและโอน ${fmtEth(job.escrowBalance)} ให้ฟรีแลนซ์? รายการนี้ย้อนกลับไม่ได้`)) return;
      return sendTx("อนุมัติและจ่ายเงิน", (c) => c.approveAndRelease(id));
    case "refund":
      return sendTx("ขอคืนเงิน", (c) => c.claimRefund(id));
    case "dispute": {
      const reason = $("reasonInput").value.trim();
      if (!reason) return toast("กรุณาระบุเหตุผลการแจ้งข้อพิพาท", "err");
      return sendTx("แจ้งข้อพิพาท", (c) => c.raiseDispute(id, reason));
    }
    case "resolve": {
      const pct = Number($("splitRange").value);
      if (!confirm(`ยืนยันคำตัดสิน: ฟรีแลนซ์ได้ ${pct}% ผู้ว่าจ้างได้คืน ${100 - pct}%? รายการนี้ย้อนกลับไม่ได้`)) return;
      return sendTx("ตัดสินข้อพิพาท", (c) => c.resolveDispute(id, pct * 100));
    }
  }
}

async function onCreate(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const title = f.get("title").trim();
  const description = f.get("description").trim();
  const freelancer = f.get("freelancer").trim();
  let amount;
  try {
    amount = ethers.parseEther(String(f.get("amount")));
  } catch {
    return toast("จำนวนเงินไม่ถูกต้อง", "err");
  }
  if (!ethers.isAddress(freelancer)) return toast("Wallet Address ของฟรีแลนซ์ไม่ถูกต้อง", "err");
  const deadline = Math.floor(new Date(f.get("deadline")).getTime() / 1000);
  if (!deadline) return toast("กรุณาเลือกกำหนดส่ง", "err");

  const receipt = await sendTx("สร้างข้อตกลง", (c) => c.createJob(title, description, amount, deadline, freelancer));
  if (!receipt) return;
  const ev = receipt.logs.map((l) => { try { return state.readContract.interface.parseLog(l); } catch { return null; } }).find((l) => l?.name === "JobCreated");
  const jobId = ev ? Number(ev.args.jobId) : null;
  e.target.reset();
  setDefaultDeadline();
  if (jobId) {
    state.selectedId = jobId;
    if (f.get("depositNow")) await sendTx("ฝากเงินเข้า Escrow", (c) => c.deposit(jobId, { value: amount }));
    else await refreshAll();
  }
}

async function onArbiter(e) {
  e.preventDefault();
  const enable = e.submitter?.dataset.enable === "true";
  const addr = new FormData(e.target).get("addr").trim();
  if (!ethers.isAddress(addr)) return toast("Address ไม่ถูกต้อง", "err");
  await sendTx(enable ? "ให้สิทธิ์ผู้ดูแล" : "ถอนสิทธิ์ผู้ดูแล", (c) => c.setArbiter(addr, enable));
  state.isArbiter = await state.readContract.isArbiter(state.account);
  await refreshAll();
}

function setDefaultDeadline() {
  const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  document.querySelector('#createForm [name=deadline]').value = d.toISOString().slice(0, 16);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.addEventListener("click", (e) => {
  const item = e.target.closest(".job-item");
  if (item) {
    state.selectedId = Number(item.dataset.id);
    renderJobList();
    renderDetail();
    return;
  }
  const jobLink = e.target.closest("[data-job]");
  if (jobLink) {
    state.selectedId = Number(jobLink.dataset.job);
    state.tab = "all";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "all"));
    renderJobList();
    renderDetail();
    $("detailCard").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast("คัดลอก Transaction Hash แล้ว", "ok"), () => {});
    return;
  }
  const act = e.target.closest("[data-act]");
  if (act) onAction(act.dataset.act);
  const tab = e.target.closest(".tab");
  if (tab) {
    state.tab = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    renderJobList();
  }
});

$("connectMetaMask").onclick = connectMetaMask;
$("connectLocal").onclick = connectLocal;
$("createForm").onsubmit = onCreate;
$("arbiterForm").onsubmit = onArbiter;
$("refreshBtn").onclick = () => refreshAll();
// เติม ETH ปลอมให้บัญชีที่เชื่อมต่อ (ใช้ได้เฉพาะ Hardhat node ในเครื่อง)
$("faucetBtn").onclick = async () => {
  if (!state.account || ACTIVE_CHAIN !== 31337) return;
  try {
    const current = await state.readProvider.getBalance(state.account);
    const next = current + ethers.parseEther("100");
    await state.readProvider.send("hardhat_setBalance", [state.account, ethers.toQuantity(next)]);
    await state.readProvider.send("evm_mine", []);
    toast(`เติม 100 ETH ทดสอบให้ ${short(state.account)} แล้ว`, "ok");
    await refreshAll();
  } catch (err) {
    toast(`เติม ETH ไม่สำเร็จ: ${esc(decodeError(err))}`, "err");
  }
};

$("deployBtn").onclick = deployWithMetaMask;
// เปิดหน้าต่าง MetaMask ให้เลือก/อนุญาตบัญชีอื่น (บัญชีที่ยังไม่เคยเชื่อมกับเว็บนี้ เว็บจะมองไม่เห็นจนกว่าจะอนุญาต)
$("switchAccountBtn").onclick = async () => {
  try {
    await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    const provider = new ethers.BrowserProvider(window.ethereum);
    await setSigner(await provider.getSigner(), "metamask");
    toast(`ใช้บัญชี ${short(state.account)} แล้ว`, "ok");
  } catch (err) {
    toast(`เปลี่ยนบัญชีไม่สำเร็จ: ${esc(decodeError(err))}`, "err");
  }
};

(async function main() {
  setDefaultDeadline();
  const deps = await loadDeployments();
  ACTIVE_CHAIN = pickChain(deps);
  renderNetworkSelect();
  watchMetaMask();
  if (await initRead(deps)) await refreshAll();
  await autoReconnect();
})();
