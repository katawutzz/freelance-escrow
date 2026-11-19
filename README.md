# Freelance Escrow & Smart Payment Platform

ระบบจ้างงานฟรีแลนซ์และชำระเงินตามผลงาน (โจทย์ที่ 1) — Smart Contract บน Ethereum ทำหน้าที่ถือเงินค่าจ้างไว้ (Escrow) และโอนให้ฟรีแลนซ์อัตโนมัติเมื่อผู้ว่าจ้างอนุมัติงาน

## สมาชิกกลุ่ม

| รหัสนักศึกษา | ชื่อ-นามสกุล |
|---|---|
| 66002022 | คฑาวุธ เมืองพรหม |
| 66031036 | ธนภัทร หนูบุญมี |
| 66016519 | พบพร จิตโสภา |
| 66050731 | อชิรยุ นวลสกลุวัฒน์ |
| 66050180 | นพรัตน์ สวัสดิ์เอื้อ |

## ลิงก์

- **หน้าเว็บ (GitHub Pages):** https://katawutxz.github.io/freelance-escrow/frontend/ — เปิดในเบราว์เซอร์ที่มี MetaMask แล้วเลือกเครือข่าย Hoodi Testnet

## สัญญาที่ deploy แล้ว (Hoodi Testnet)

- Contract Address: `0x320C00e416D180ef22b35901627E4a28b51afAFb`
- Etherscan: https://hoodi.etherscan.io/address/0x320C00e416D180ef22b35901627E4a28b51afAFb

## โครงสร้างโปรเจกต์

```
freelance-escrow/
├── contracts/
│   ├── FreelanceEscrow.sol          ← Smart Contract หลัก
│   └── test/ReentrantFreelancer.sol ← สัญญาจำลองผู้โจมตี (ใช้ในเทสต์เท่านั้น)
├── test/FreelanceEscrow.test.js     ← Unit tests 20 กรณี
├── scripts/
│   ├── deploy.js                    ← Deploy ด้วยสคริปต์ (local / hoodi)
│   ├── export.js, lib.js            ← ส่งออก ABI+bytecode, บันทึกที่อยู่สัญญา
│   └── serve.js                     ← เว็บเซิร์ฟเวอร์ + API บันทึกที่อยู่สัญญาหลัง deploy
├── frontend/                        ← หน้าเว็บ (HTML + ethers.js v6)
│   ├── index.html, styles.css, app.js
│   ├── contract.js                  ← ABI + bytecode (สร้างอัตโนมัติ)
│   └── deployments.json             ← ที่อยู่สัญญาแยกตามเครือข่าย (สร้างอัตโนมัติ)
└── hardhat.config.js
```

## วิธีรันบน Hoodi Testnet ด้วย MetaMask (แนะนำสำหรับนำเสนอ)

ใช้ ETH ทดสอบของ Hoodi ในกระเป๋า MetaMask จริง ธุรกรรมทุกรายการตรวจสอบได้บน [hoodi.etherscan.io](https://hoodi.etherscan.io)

```bash
npm install
```

```bash
npm run web
```

1. เปิด http://localhost:5173 ใน Chrome/Edge/Brave ที่ติดตั้ง MetaMask แล้วเลือกเครือข่าย **Hoodi Testnet** ที่ dropdown มุมขวาบน
2. กด **เชื่อมต่อ MetaMask** ระบบจะสลับ (หรือเพิ่ม) เครือข่าย Hoodi ใน MetaMask ให้เอง
3. ครั้งแรกจะมีแถบ **"Deploy สัญญาด้วย MetaMask"** ให้กดแล้วยืนยันใน MetaMask ระบบจะบันทึกที่อยู่สัญญาลง `frontend/deployments.json` ครั้งต่อไปจึงไม่ต้อง deploy ซ้ำ
4. **ต้องใช้อย่างน้อย 3 บัญชีใน MetaMask** (Add account) และทุกบัญชีต้องมี Hoodi ETH
   - **บัญชี A** (ที่ใช้ deploy): เจ้าของระบบ + ผู้ดูแลข้อพิพาท
   - **บัญชี B**: ผู้ว่าจ้าง
   - **บัญชี C**: ฟรีแลนซ์
   - ผู้ดูแลตัดสินงานที่ตัวเองเป็นคู่สัญญาไม่ได้ จึงไม่ควรใช้บัญชี A เป็นผู้ว่าจ้าง หรือให้บัญชี A เพิ่มบัญชีอื่นเป็นผู้ดูแลในการ์ด "ผู้ดูแลระบบ" แทนก็ได้
5. สลับบัญชีใน MetaMask ระหว่างทดสอบได้ตามปกติ หน้าเว็บจะอัปเดตเอง
6. แต่ละธุรกรรมใช้เวลารอยืนยันประมาณ 12–30 วินาที (1 บล็อก)

> ทางเลือก: deploy ด้วยสคริปต์ `PRIVATE_KEY=0x... npm run deploy:hoodi` แต่วิธีนี้ต้องใส่ private key จึงแนะนำให้ใช้ปุ่มบนหน้าเว็บมากกว่า

## วิธีรัน (บล็อกเชนจำลองในเครื่อง)

ต้องมี Node.js 18 ขึ้นไป เปิด terminal 3 หน้าต่างในโฟลเดอร์ `freelance-escrow`

```bash
npm install
```

```bash
npm test
```

**Terminal 1:** เปิดบล็อกเชนจำลอง (ปล่อยทิ้งไว้)

```bash
npm run node
```

**Terminal 2:** Deploy สัญญา

```bash
npm run deploy:local
```

**Terminal 3:** เปิดหน้าเว็บ แล้วเข้า http://localhost:5173

```bash
npm run web
```

บนหน้าเว็บเลือกเครือข่าย **Hardhat Local** แล้วกด **“ใช้บัญชีทดสอบ (Hardhat)”** สลับบัญชีจาก dropdown ได้เลย ไม่ต้องติดตั้ง MetaMask

| บัญชี | บทบาทในการสาธิต | Address |
|---|---|---|
| #0 | เจ้าของระบบ + ผู้ดูแลข้อพิพาท | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| #1 | ผู้ว่าจ้าง | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| #2 | ฟรีแลนซ์ | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| #3 | ผู้ดูแลข้อพิพาท | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

> ถ้ารีสตาร์ท `npm run node` ต้องรัน `npm run deploy:local` ใหม่ทุกครั้ง เพราะบล็อกเชนจำลองจะเริ่มจากศูนย์

ถ้าใช้ MetaMask กับเครือข่าย Hardhat Local ให้กดปุ่ม **"รับ 100 ETH ทดสอบ"** ข้างยอดเงินเพื่อเติม ETH ปลอม

## การออกแบบ Smart Contract

### สถานะของงาน (State Machine)

```
Created ──deposit──▶ Funded ──submitWork──▶ Submitted ──approveAndRelease──▶ Released
   │                   │  ▲                     │
 cancelJob      raiseDispute  submitWork(แก้ไข)  raiseDispute
   ▼                   ▼                         ▼
Cancelled           Disputed ◀───────────────────┘
                       │ resolveDispute (ผู้ดูแล)
                       ▼
                    Resolved

Funded + เลยกำหนดส่ง + ยังไม่ส่งงาน ──claimRefund──▶ Refunded
```

### ฟังก์ชันตามข้อกำหนด

| # | ข้อกำหนด | ฟังก์ชัน | ผู้เรียกได้ | เงื่อนไข |
|---|---|---|---|---|
| 1 | Create Contract | `createJob(title, description, amount, deadline, freelancer)` | ใครก็ได้ (กลายเป็นผู้ว่าจ้าง) | ชื่อไม่ว่าง, ค่าจ้าง > 0, กำหนดส่งในอนาคต, ฟรีแลนซ์ไม่ใช่ตัวเอง |
| 2 | Deposit Payment | `deposit(jobId)` payable | ผู้ว่าจ้าง | สถานะ Created และ `msg.value` เท่ากับค่าจ้างพอดี |
| 3 | Submit Work | `submitWork(jobId, evidence)` | ฟรีแลนซ์ | สถานะ Funded/Submitted (ส่งแก้ไขได้ก่อนอนุมัติ) |
| 4 | Approve & Release | `approveAndRelease(jobId)` | ผู้ว่าจ้าง | สถานะ Submitted → โอน ETH ให้ฟรีแลนซ์ทันที |
| 5 | Dispute | `raiseDispute(jobId, reason)` | ผู้ว่าจ้าง / ฟรีแลนซ์ | สถานะ Funded/Submitted |
| 5 | Resolve | `resolveDispute(jobId, freelancerBps)` | ผู้ดูแลที่ได้รับสิทธิ์ (ต้องไม่ใช่คู่สัญญา) | สถานะ Disputed, แบ่งเงินได้ 0–100% |
| 6 | Tracking | `getJob`, `getClientJobs`, `getFreelancerJobs`, `totalEscrowed` + Events | ทุกคน | – |
| – | ยกเลิก | `cancelJob(jobId)` | ผู้ว่าจ้าง | ก่อนฝากเงินเท่านั้น |
| – | คืนเงิน | `claimRefund(jobId)` | ผู้ว่าจ้าง | Funded + เลยกำหนดส่ง + ฟรีแลนซ์ยังไม่ส่งงาน |
| – | จัดการผู้ดูแล | `setArbiter(addr, enabled)` | เจ้าของระบบ | – |

### กฎทางธุรกิจ: ห้ามจ่ายซ้ำ และห้ามเบิกเงินก่อนถึงเงื่อนไข

- **เงินออกจาก Escrow ได้ 3 ทางเท่านั้น** คือ `approveAndRelease`, `resolveDispute` และ `claimRefund` และทุกทางตรวจสถานะก่อนเสมอ ไม่มีฟังก์ชัน withdraw อิสระ แม้แต่เจ้าของระบบก็ดึงเงินออกเองไม่ได้
- **ใช้รูปแบบ Checks-Effects-Interactions:** ตั้ง `escrowBalance = 0` และเปลี่ยนสถานะเป็นสถานะปิดงาน *ก่อน* โอน ETH การเรียกซ้ำจึงเจอ `InvalidStatus`
- **มี `nonReentrant` guard** กันการโจมตีแบบ reentrancy (มีเทสต์ด้วยสัญญาผู้โจมตีจริง)
- **ฝากเงินต้องตรงยอด** และฝากได้ครั้งเดียว ส่วน `receive()` ปฏิเสธ ETH ที่โอนเข้ามาตรง ๆ
- **ระหว่างข้อพิพาท** ทั้งอนุมัติ, คืนเงิน และส่งงานจะถูกล็อกทั้งหมด รอผู้ดูแลตัดสินเท่านั้น
- **ผู้ว่าจ้างดึงเงินคืนเองไม่ได้ถ้าฟรีแลนซ์ส่งงานแล้ว** ต้องอนุมัติหรือแจ้งข้อพิพาทเท่านั้น ฟรีแลนซ์ที่ส่งงานตรงเวลาจึงได้รับความคุ้มครอง

### Events (ใช้แสดงประวัติและ Transaction Hash บนเว็บ)

`JobCreated`, `PaymentDeposited`, `WorkSubmitted`, `PaymentReleased`, `DisputeRaised`, `DisputeResolved`, `Refunded`, `JobCancelled`, `ArbiterUpdated`

## หน้าเว็บ (dApp)

- เลือกเครือข่ายได้ (Hoodi / Sepolia / Hardhat Local) เชื่อมต่อด้วย MetaMask หรือบัญชีทดสอบ Hardhat และ Deploy สัญญาด้วย MetaMask ได้จากหน้าเว็บ
- แสดงสถิติ: จำนวนงาน, ETH ที่ล็อกใน Escrow, บทบาทของผู้ใช้
- ฟอร์มสร้างข้อตกลง (เลือกฝากเงินทันทีได้)
- รายการงานแยกแท็บ: ทั้งหมด / ฉันเป็นผู้ว่าจ้าง / ฉันเป็นฟรีแลนซ์ / ข้อพิพาท
- หน้ารายละเอียดงานมีแถบสถานะ และแสดงเฉพาะปุ่มที่บทบาทและสถานะปัจจุบันทำได้
- ผู้ดูแลมีแถบเลื่อนกำหนดสัดส่วนเงินตอนตัดสินข้อพิพาท
- ไทม์ไลน์ธุรกรรมของแต่ละงาน และตารางประวัติธุรกรรมล่าสุด พร้อม Transaction Hash (บน Hoodi คลิกเปิด hoodi.etherscan.io ได้, บน local คลิกเพื่อคัดลอก)
- แปลง error ของสัญญาเป็นข้อความภาษาไทย
- รองรับมือถือและโหมดมืด

## ผลการทดสอบ

`npm test` ผ่านทั้งหมด 20 กรณี ครอบคลุมทั้ง 6 ข้อกำหนด กรณีจ่ายซ้ำ, reentrancy, สิทธิ์ผู้เรียก, การล็อกระหว่างข้อพิพาท และการคืนเงินหลังเลยกำหนด
