// เซิร์ฟเวอร์ไฟล์ static ขนาดเล็กสำหรับเปิดหน้าเว็บ (MetaMask ต้องใช้ http:// ไม่ใช่ file://)
// มี endpoint POST /api/deployments ให้หน้าเว็บบันทึกที่อยู่สัญญาหลัง deploy ผ่าน MetaMask
const http = require("http");
const fs = require("fs");
const path = require("path");
const { saveDeployment } = require("./lib");

const root = path.join(__dirname, "..", "frontend");
const port = Number(process.env.PORT) || 5173;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

function handleSave(req, res) {
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 10_000) req.destroy();
  });
  req.on("end", () => {
    try {
      const d = JSON.parse(body);
      const ok =
        Number.isInteger(d.chainId) && d.chainId > 0 &&
        /^0x[0-9a-fA-F]{40}$/.test(d.address) &&
        Number.isInteger(d.deployBlock) && d.deployBlock >= 0 &&
        (d.txHash === undefined || /^0x[0-9a-fA-F]{64}$/.test(d.txHash));
      if (!ok) throw new Error("invalid payload");
      saveDeployment(d.chainId, { address: d.address, deployBlock: d.deployBlock, txHash: d.txHash, network: String(d.network || "").slice(0, 40) });
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (req.method === "POST" && urlPath === "/api/deployments") return handleSave(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
    const file = path.normalize(path.join(root, urlPath === "/" ? "index.html" : urlPath));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) {
        if (urlPath === "/deployments.json") return res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
        return res.writeHead(404).end("Not found");
      }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`Frontend: http://localhost:${port}`));
