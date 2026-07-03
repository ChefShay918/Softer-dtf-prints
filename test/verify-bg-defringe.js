const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8956;
function serve() {
  return http.createServer((req, res) => {
    let file = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(ROOT, file);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(filePath);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  }).listen(PORT);
}
async function main() {
  const server = serve();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);

  const SRC = 300;
  const testImgPath = path.join(__dirname, 'test-input-fringe.png');
  const b64 = await page.evaluate((SRC) => {
    const c = document.createElement('canvas'); c.width = SRC; c.height = SRC;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, SRC, SRC);
    // JPEG-noise-like specks scattered in the background, slightly off-white
    let seed = 42;
    function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(rand() * SRC), y = Math.floor(rand() * SRC);
      // skip if inside the logo region so we don't contaminate the logo test
      if (x >= 90 && x < 210 && y >= 90 && y < 210) continue;
      const off = Math.floor(rand() * 12); // small deviation from pure white
      ctx.fillStyle = `rgb(${255 - off},${255 - off},${255 - off})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // anti-aliased circle "logo" -- canvas arc fill naturally blends edge pixels
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(150, 150, 60, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png').split(',')[1];
  }, SRC);
  fs.writeFileSync(testImgPath, Buffer.from(b64, 'base64'));

  await page.setInputFiles('#fileInput', testImgPath);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'));

  const result = await page.evaluate((SRC) => {
    const orig = document.getElementById('originalCanvas');
    const octx = orig.getContext('2d');
    const w = orig.width, h = orig.height;
    const scale = w / SRC;
    const data = octx.getImageData(0, 0, w, h).data;

    // Count remaining opaque pixels far from the logo (should be ~0 after cleanup)
    let strayOpaque = 0;
    const cx = Math.round(150 * scale), cy = Math.round(150 * scale);
    const farRadius = Math.round(90 * scale); // outside a ring around the 60px-radius logo
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) {
        const dx = x - cx, dy = y - cy;
        if (Math.sqrt(dx * dx + dy * dy) < farRadius) continue; // skip near the logo/edge
        const idx = (y * w + x) * 4;
        if (data[idx + 3] > 0) strayOpaque++;
      }
    }

    // Ring immediately around the logo edge (radius 60-65px scaled) should be fully transparent (no fringe)
    let fringeOpaque = 0, fringeChecked = 0;
    const ringInner = Math.round(61 * scale), ringOuter = Math.round(68 * scale);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < ringInner || d > ringOuter) continue;
        fringeChecked++;
        const idx = (y * w + x) * 4;
        if (data[idx + 3] > 0) fringeOpaque++;
      }
    }

    // Logo interior should remain solidly opaque
    const centerIdx = (cy * w + cx) * 4;
    const centerAlpha = data[centerIdx + 3];

    return { strayOpaque, fringeOpaque, fringeChecked, centerAlpha, w, h };
  }, SRC);
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
  server.close();
  fs.unlinkSync(testImgPath);

  if (result.strayOpaque > 0) throw new Error('Stray noise specks survived in background: ' + result.strayOpaque);
  if (result.fringeOpaque > 0) throw new Error('Fringe/halo pixels survived around logo edge: ' + result.fringeOpaque + '/' + result.fringeChecked);
  if (result.centerAlpha !== 255) throw new Error('Logo center should remain fully opaque, got ' + result.centerAlpha);
  console.log('DEFRINGE/DESPECKLE CHECKS PASSED');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
