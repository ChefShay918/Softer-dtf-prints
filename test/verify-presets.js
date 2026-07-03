const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8951;
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
  const testImgPath = path.join(__dirname, 'test-input-presets.png');
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width=100; c.height=100;
    const ctx = c.getContext('2d'); ctx.fillStyle='black'; ctx.fillRect(0,0,100,100);
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(testImgPath, Buffer.from(b64,'base64'));
  await page.setInputFiles('#fileInput', testImgPath);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'));

  await page.click('.preset-btn[data-preset="high-contrast"]');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ready'));
  const afterPreset = await page.evaluate(() => ({
    lpi: document.getElementById('lpi').value,
    angle: document.getElementById('angle').value,
    inkCap: document.getElementById('inkCap').value,
    choke: document.getElementById('choke').value,
    activeClass: document.querySelector('.preset-btn[data-preset="high-contrast"]').classList.contains('active')
  }));
  console.log('AFTER PRESET:', JSON.stringify(afterPreset));

  await page.fill('#lpi', '30');
  await page.dispatchEvent('#lpi', 'input');
  const afterManualChange = await page.evaluate(() => document.querySelector('.preset-btn.active'));
  console.log('ACTIVE AFTER MANUAL CHANGE (should be null):', afterManualChange);

  await browser.close();
  server.close();
  fs.unlinkSync(testImgPath);

  if (afterPreset.lpi !== '55' || afterPreset.angle !== '45' || afterPreset.inkCap !== '100' || afterPreset.choke !== '0') {
    throw new Error('Preset did not apply expected values: ' + JSON.stringify(afterPreset));
  }
  if (!afterPreset.activeClass) throw new Error('Preset button did not get active class');
  console.log('PRESET CHECKS PASSED');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
