// Nuzul card bridge: lets the web app read ID cards from a reader attached to this PC.
// Browsers cannot talk to smart-card readers, so this helper does and answers on localhost.
//
//   node server.mjs --mock                         # simulator: returns a test card (for trying the flow)
//   node server.mjs --cmd "C:\Vendor\read.exe --json"  # run the reader vendor's command-line tool
//
// The web app calls GET /status and POST /read on http://127.0.0.1:47290.
// /read answers: { "mrz": ["line1", "line2", ...] }             (MRZ text)
//            or: { "fields": { full_name, full_name_ar, nationality, doc_type, doc_number,
//                              doc_expiry, date_of_birth, gender }, "image": "data:image/jpeg;base64,..." }
// No Node packages needed (Node 18+).
import { createServer } from "node:http";
import { exec } from "node:child_process";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(process.env.PORT ?? 47290);
const MOCK = args.includes("--mock");
const CMD = arg("--cmd") ?? process.env.CARD_READER_CMD;
// Only these sites may ask for card data (comma-separated)
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "https://nuzul-hotel.vercel.app,http://localhost:3000").split(",").map((s) => s.trim());

if (!MOCK && !CMD) {
  console.error("Choose a mode: --mock (test card) or --cmd \"<reader tool>\". See README.md.");
  process.exit(1);
}

// Fictional test card with valid check digits
const TEST_CARD = { mrz: ["IDOMNT0000001<6<<<<<<<<<<<<<<<", "9001011M3104150OMN<<<<<<<<<<<4", "TEST<<CARD<<<<<<<<<<<<<<<<<<<<"] };

function readWithCommand() {
  return new Promise((resolve, reject) => {
    exec(CMD, { timeout: 25_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return reject(err);
      const out = stdout.trim();
      try {
        resolve(JSON.parse(out)); // tool printed JSON in the format above
      } catch {
        resolve({ mrz: out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) }); // tool printed MRZ lines
      }
    });
  });
}

let busy = false;
const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  if (origin && !ORIGINS.includes(origin)) {
    res.writeHead(403).end();
    return;
  }
  const headers = {
    "Access-Control-Allow-Origin": origin || ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (req.method === "OPTIONS") return res.writeHead(204, headers).end();
  if (req.method === "GET" && req.url === "/status") {
    return res.writeHead(200, headers).end(JSON.stringify({ ok: true, device: MOCK ? "simulator" : "reader" }));
  }
  if (req.method === "POST" && req.url === "/read") {
    if (busy) return res.writeHead(409, headers).end(JSON.stringify({ error: "busy" }));
    busy = true;
    try {
      const body = MOCK ? (await new Promise((r) => setTimeout(r, 800)), TEST_CARD) : await readWithCommand();
      console.log(`${new Date().toISOString()} card read for ${origin}`); // never log the card data
      res.writeHead(200, headers).end(JSON.stringify(body));
    } catch (e) {
      console.error("read failed:", e.message);
      res.writeHead(502, headers).end(JSON.stringify({ error: "read_failed" }));
    } finally {
      busy = false;
    }
    return;
  }
  res.writeHead(404, headers).end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Nuzul card bridge on http://127.0.0.1:${PORT} (${MOCK ? "simulator" : CMD}) for ${ORIGINS.join(", ")}`);
});
