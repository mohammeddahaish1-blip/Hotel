// Renders the Nuzul social posts from posts.json into out/<id>.png (1080x1350) and out/grid.png (3x3 preview).
// Run from anywhere: node marketing/social/render.js [id ...]   (no ids = every post)
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DIR = __dirname;
const W = 1080, H = 1350;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One post: photo below, headline over the teal top, two small cards from the system, the same bottom bar on every post. */
function postHtml(p, brand) {
  // where the photo's flat top band ends, in post pixels; a photo whose scene starts higher than the end of the
  // headline area is moved down, so the headline and subtitle never sit on a face (the band above it is plain teal)
  const HEAD_END = 480;
  const shift = Math.max(0, HEAD_END - (p.cut || HEAD_END));
  const cut = (p.cut || HEAD_END) + shift;
  const chips = (p.chips || []).map((c, i) => `
    <div class="chip c${i + 1} ${c.tone || "ok"}"><i>${esc(c.icon || "✓")}</i><span>${esc(c.title)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</span></div>`).join("");
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<base href="file://${DIR}/">
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@700&family=IBM+Plex+Sans+Arabic:wght@500;600;700&display=block" rel="stylesheet">
<style>
  :root { --deep: #0e4643; --gold: #d9a531; }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; background: var(--deep); }
  .post { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: "IBM Plex Sans Arabic", sans-serif; color: #fff; }
  .bg { position: absolute; top: ${shift}px; inset-inline: 0; width: 100%; height: ${H}px; object-fit: cover; object-position: center top; }
  /* the generated photos leave a flat teal top that ends in a hard line at "cut": stay solid just past it, then fade
     quickly into the photo, so the line disappears and faces just below it stay visible */
  .shade { position: absolute; inset: 0 0 auto 0; height: ${cut + 210}px;
    background: linear-gradient(180deg, #0e4643 0px, #145a54 ${Math.round(cut * 0.6)}px, #17625c ${cut + 24}px, rgba(23, 98, 92, 0.7) ${cut + 80}px, rgba(23, 98, 92, 0) ${cut + 210}px); }
  .head { text-shadow: 0 2px 18px rgba(8, 40, 37, 0.55); }
  .glow { position: absolute; top: -180px; inset-inline-start: -160px; width: 620px; height: 620px; border-radius: 50%;
    background: radial-gradient(circle, rgba(217, 165, 49, 0.22), transparent 65%); }
  .top { position: absolute; top: 56px; inset-inline: 64px; display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand b { font-family: "Amiri", serif; font-size: 76px; line-height: 1; }
  .brand span { font-size: 22px; font-weight: 500; color: rgba(255, 255, 255, 0.78); padding-inline-start: 16px; border-inline-start: 2px solid rgba(217, 165, 49, 0.7); line-height: 1.4; }
  .tag { font-size: 20px; font-weight: 600; color: var(--gold); border: 1.5px solid rgba(217, 165, 49, 0.6); border-radius: 999px; padding: 8px 22px; }
  .head { position: absolute; top: 210px; inset-inline: 64px; }
  h1 { font-size: ${p.size || 84}px; font-weight: 700; line-height: 1.2; letter-spacing: -0.5px; text-shadow: 0 4px 24px rgba(0, 0, 0, 0.18); }
  h1 .hl { display: inline-block; margin-top: 10px; background: var(--gold); color: #2b1d00; border-radius: 22px; padding: 0 26px 6px; }
  .sub { margin-top: 22px; font-size: 28px; font-weight: 500; line-height: 1.6; color: rgba(255, 255, 255, 0.88); max-width: 800px; }
  .chip { position: absolute; display: flex; align-items: center; gap: 14px; background: #fff; color: #1c2321; border-radius: 22px;
    padding: 16px 22px; font-size: 24px; font-weight: 600; white-space: nowrap; box-shadow: 0 22px 40px -18px rgba(0, 0, 0, 0.55); }
  .chip i { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; font-style: normal; font-size: 22px; font-weight: 700; }
  .chip small { display: block; font-size: 17px; font-weight: 500; color: #66706c; }
  .chip.ok i { background: #e6f4ea; color: #157f3b; } .chip.warn i { background: #fbf1d6; color: #9a6700; }
  .chip.bad i { background: #fdecea; color: #b42318; } .chip.info i { background: #e3f1ee; color: #0d6b5f; }
  .c1 { top: ${p.chipTop || 640}px; ${p.chipSide === "start" ? "inset-inline-start: 56px" : "inset-inline-end: 56px"}; }
  .c2 { top: ${(p.chipTop || 640) + 150}px; ${p.chipSide === "start" ? "inset-inline-start: 96px" : "inset-inline-end: 96px"}; }
  .bar { position: absolute; inset: auto 40px 40px 40px; display: flex; align-items: center; justify-content: space-between; gap: 24px;
    background: rgba(14, 70, 67, 0.9); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 30px; padding: 24px 30px; }
  .cta { background: var(--gold); color: #2b1d00; font-weight: 700; font-size: 28px; border-radius: 999px; padding: 14px 34px; white-space: nowrap; }
  .meta { font-size: 22px; line-height: 1.5; color: rgba(255, 255, 255, 0.85); }
  .meta b { display: block; font-size: 26px; color: #fff; }
  .url { direction: ltr; font-size: 22px; font-weight: 600; color: rgba(255, 255, 255, 0.9); letter-spacing: 0.3px; }
</style></head>
<body><div class="post">
  <img class="bg" src="images/${esc(p.image)}" alt="">
  <div class="shade"></div><div class="glow"></div>
  <div class="top">
    <div class="brand"><b>نُزُل</b><span>${esc(brand.tagline[0])}<br>${esc(brand.tagline[1])}</span></div>
    <div class="tag">${esc(brand.tag)}</div>
  </div>
  <div class="head">
    <h1>${esc(p.title[0])}<br><span class="hl">${esc(p.title[1])}</span></h1>
    ${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ""}
  </div>
  ${chips}
  <div class="bar">
    <div class="meta"><b>${esc(brand.offer[0])}</b>${esc(brand.offer[1])}</div>
    <div class="url">${esc(brand.url)}</div>
    <div class="cta">${esc(brand.cta)}</div>
  </div>
</div></body></html>`;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, "posts.json"), "utf8"));
  const only = process.argv.slice(2);
  const posts = data.posts.filter((p) => !only.length || only.includes(p.id));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const p of posts) {
    const tmp = path.join(DIR, "out", `.${p.id}.html`);
    fs.writeFileSync(tmp, postHtml(p, data.brand));
    await page.goto("file://" + tmp, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(DIR, "out", `${p.id}.png`) });
    fs.unlinkSync(tmp);
    console.log("rendered", p.id);
  }
  // 3x3 preview of the whole series, the way it looks on an Instagram profile
  if (!only.length) {
    const cells = data.posts.map((p) => `<img src="file://${path.join(DIR, "out", p.id + ".png")}">`).join("");
    await page.setViewportSize({ width: 1080, height: 1350 });
    await page.setContent(`<style>body{margin:0;background:#000}div{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:1080px}img{width:100%;display:block}</style><div>${cells}</div>`);
    await page.waitForLoadState("networkidle");
    await page.locator("div").screenshot({ path: path.join(DIR, "out", "grid.png") });
    console.log("rendered grid");
  }
  await browser.close();
})();
