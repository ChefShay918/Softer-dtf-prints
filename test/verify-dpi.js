const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 8950;

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

function readPhysDpi(buf) {
  // scan chunks for pHYs
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'pHYs') {
      const ppuX = buf.readUInt32BE(offset + 8);
      const unit = buf.readUInt8(offset + 8 + 8);
      return { ppuX, unit, dpi: Math.round(ppuX * 0.0254) };
    }
    offset += 8 + length + 4;
  }
  return null;
}

async function main() {
  const server = serve();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);

  const testPngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(10, 10, 180, 180);
    return c.toDataURL('image/png').split(',')[1];
  });
  const testImgPath = path.join(__dirname, 'test-input-dpi.png');
  fs.writeFileSync(testImgPath, Buffer.from(testPngB64, 'base64'));

  await page.setInputFiles('#fileInput', testImgPath);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'), { timeout: 10000 });

  const size300 = await page.evaluate(() => document.getElementById('processedCanvas').width);

  await page.selectOption('#dpi', '600');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'), { timeout: 10000 });
  const size600 = await page.evaluate(() => document.getElementById('processedCanvas').width);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#downloadColor')
  ]);
  const dlPath = await download.path();
  const suggestedName = download.suggestedFilename();
  const buf = fs.readFileSync(dlPath);
  const phys = readPhysDpi(buf);

  console.log(JSON.stringify({ size300, size600, ratio: size600 / size300, suggestedName, phys }, null, 2));

  await browser.close();
  server.close();

  if (size600 <= size300) throw new Error('600 DPI did not increase working resolution');
  if (!phys || phys.dpi !== 600) throw new Error('Downloaded PNG missing correct pHYs DPI metadata: ' + JSON.stringify(phys));
  if (!suggestedName.includes('600dpi')) throw new Error('Filename does not reflect DPI: ' + suggestedName);
  console.log('DPI CHECKS PASSED');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
