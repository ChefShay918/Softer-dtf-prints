const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 8934;

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
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  page.on('pageerror', (err) => logs.push('PAGEERROR: ' + err.message));

  await page.goto(`http://localhost:${PORT}/`);

  // Build a synthetic test PNG: solid black square (heavy ink), a gradient, and a red circle, on transparent bg.
  const testPngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 400;
    const ctx = c.getContext('2d');
    // heavy solid black block (top-left)
    ctx.fillStyle = 'black';
    ctx.fillRect(20, 20, 150, 150);
    // gradient block (top-right)
    const grad = ctx.createLinearGradient(220, 20, 380, 170);
    grad.addColorStop(0, 'white');
    grad.addColorStop(1, 'black');
    ctx.fillStyle = grad;
    ctx.fillRect(220, 20, 160, 150);
    // red circle (bottom)
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(200, 280, 90, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png').split(',')[1];
  });

  const testImgPath = path.join(__dirname, 'test-input.png');
  fs.writeFileSync(testImgPath, Buffer.from(testPngB64, 'base64'));

  await page.setInputFiles('#fileInput', testImgPath);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'), { timeout: 10000 });

  const state1 = await page.evaluate(() => {
    const orig = document.getElementById('originalCanvas');
    const proc = document.getElementById('processedCanvas');
    return {
      origSize: [orig.width, orig.height],
      procSize: [proc.width, proc.height],
      colorBtnDisabled: document.getElementById('downloadColor').disabled,
      underbaseBtnDisabled: document.getElementById('downloadUnderbase').disabled,
      procHasContent: (() => {
        const ctx = proc.getContext('2d');
        const d = ctx.getImageData(0, 0, proc.width, proc.height).data;
        let nonTransparent = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) nonTransparent++;
        return nonTransparent;
      })()
    };
  });
  console.log('DARK FABRIC STATE:', JSON.stringify(state1));

  // check underbase canvas has white silhouette content
  const underbaseInfo = await page.evaluate(() => {
    // underbaseCanvas is created dynamically in app.js closure, not in DOM.
    // Trigger a download via blob and inspect via toDataURL through a hack: re-run generate by dispatching click won't expose canvas directly.
    return null;
  });

  // Switch to light fabric, verify underbase button disables
  await page.click('.fabric-btn[data-fabric="light"]');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'), { timeout: 10000 });
  const lightState = await page.evaluate(() => ({
    underbaseBtnDisabled: document.getElementById('downloadUnderbase').disabled,
    hint: document.getElementById('fabricHint').textContent
  }));
  console.log('LIGHT FABRIC STATE:', JSON.stringify(lightState));

  // Switch back to dark, test ink cap slider lowers coverage (heavy black block should shrink dot count/radius, not crash)
  await page.click('.fabric-btn[data-fabric="dark"]');
  await page.fill('#inkCap', '40');
  await page.dispatchEvent('#inkCap', 'input');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'), { timeout: 10000 });

  // test download actually produces a non-trivial PNG blob for both color and underbase
  const [colorDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#downloadColor')
  ]);
  const colorPath = await colorDownload.path();
  const colorSize = fs.statSync(colorPath).size;

  const [underbaseDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#downloadUnderbase')
  ]);
  const underbasePath = await underbaseDownload.path();
  const underbaseSize = fs.statSync(underbasePath).size;

  console.log('DOWNLOAD SIZES:', JSON.stringify({ colorSize, underbaseSize }));

  console.log('CONSOLE LOGS:', JSON.stringify(logs));

  await browser.close();
  server.close();

  if (!state1.procHasContent || state1.colorBtnDisabled) {
    throw new Error('Halftone did not produce visible content on dark fabric');
  }
  if (!lightState.underbaseBtnDisabled) {
    throw new Error('Underbase button should be disabled for light fabric');
  }
  if (colorSize < 500 || underbaseSize < 200) {
    throw new Error('Downloaded PNGs look too small / empty');
  }
  console.log('ALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
