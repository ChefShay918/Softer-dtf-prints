const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8953;
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

  const SRC = 300; // source image is 300x300, logo occupies [100,200)x[100,200)
  const testImgPath = path.join(__dirname, 'test-input-bg.png');
  const b64 = await page.evaluate((SRC) => {
    const c = document.createElement('canvas'); c.width = SRC; c.height = SRC;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, SRC, SRC); // fully opaque white background, like a flattened JPG
    ctx.fillStyle = 'black';
    ctx.fillRect(100, 100, 100, 100); // logo, well inside the border
    return c.toDataURL('image/png').split(',')[1];
  }, SRC);
  fs.writeFileSync(testImgPath, Buffer.from(b64, 'base64'));

  await page.setInputFiles('#fileInput', testImgPath);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'));

  const result = await page.evaluate((SRC) => {
    const orig = document.getElementById('originalCanvas');
    const octx = orig.getContext('2d');
    const scale = orig.width / SRC;
    const bgXY = [Math.round(10 * scale), Math.round(10 * scale)];
    const logoXY = [Math.round(150 * scale), Math.round(150 * scale)];

    const bgPixel = octx.getImageData(bgXY[0], bgXY[1], 1, 1).data;
    const logoPixel = octx.getImageData(logoXY[0], logoXY[1], 1, 1).data;

    const proc = document.getElementById('processedCanvas');
    const pctx = proc.getContext('2d');
    const procData = pctx.getImageData(0, 0, proc.width, proc.height).data;

    function countInk(cx, cy, halfSize) {
      let n = 0;
      for (let y = Math.max(0, cy - halfSize); y < Math.min(proc.height, cy + halfSize); y++) {
        for (let x = Math.max(0, cx - halfSize); x < Math.min(proc.width, cx + halfSize); x++) {
          if (procData[(y * proc.width + x) * 4 + 3] > 0) n++;
        }
      }
      return n;
    }

    const bgInk = countInk(bgXY[0], bgXY[1], 15);
    const logoInk = countInk(logoXY[0], logoXY[1], 15);

    return {
      bgPixelAlpha: bgPixel[3],
      logoPixelAlpha: logoPixel[3],
      bgInk,
      logoInk,
      scale
    };
  }, SRC);
  console.log('WITH BG REMOVAL:', JSON.stringify(result));

  await page.uncheck('#removeBg');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'));
  const withoutRemoval = await page.evaluate((SRC) => {
    const orig = document.getElementById('originalCanvas');
    const octx = orig.getContext('2d');
    const scale = orig.width / SRC;
    const bgPixel = octx.getImageData(Math.round(10 * scale), Math.round(10 * scale), 1, 1).data;
    return { bgPixelAlpha: bgPixel[3] };
  }, SRC);
  console.log('WITHOUT BG REMOVAL:', JSON.stringify(withoutRemoval));

  await browser.close();
  server.close();
  fs.unlinkSync(testImgPath);

  if (result.bgPixelAlpha !== 0) throw new Error('Background pixel should be transparent after removal, got alpha=' + result.bgPixelAlpha);
  if (result.logoPixelAlpha !== 255) throw new Error('Logo pixel should remain opaque, got alpha=' + result.logoPixelAlpha);
  if (result.bgInk !== 0) throw new Error('Halftone should not draw dots in removed background area, found ' + result.bgInk);
  if (result.logoInk === 0) throw new Error('Halftone should still draw dots over the logo area');
  if (withoutRemoval.bgPixelAlpha !== 255) throw new Error('With removal disabled, background should stay opaque (whole image treated as ink)');
  console.log('BG REMOVAL CHECKS PASSED');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
