const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8958;
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
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto(`http://localhost:${PORT}/`);

  // 1) Non-image file (e.g. a .txt renamed with image-ish content) should be rejected with a clear message, no crash.
  const textFilePath = path.join(__dirname, 'not-an-image.txt');
  fs.writeFileSync(textFilePath, 'this is definitely not an image');
  await page.setInputFiles('#fileInput', textFilePath);
  await page.waitForTimeout(200);
  const afterTextFile = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    hasImageState: document.getElementById('originalCanvas').style.display
  }));
  console.log('NON-IMAGE FILE:', JSON.stringify(afterTextFile));

  // 2) Corrupted "image" file (png extension, garbage bytes) should hit img.onerror, not hang silently.
  const corruptPngPath = path.join(__dirname, 'corrupt.png');
  fs.writeFileSync(corruptPngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03])); // PNG magic bytes + garbage
  await page.setInputFiles('#fileInput', corruptPngPath);
  await page.waitForFunction(
    () => document.getElementById('status').textContent.includes("doesn't look like a valid image"),
    { timeout: 5000 }
  );
  const afterCorrupt = await page.evaluate(() => document.getElementById('status').textContent);
  console.log('CORRUPT IMAGE:', afterCorrupt);

  // 3) Oversized file should be rejected before even attempting to read it.
  const bigFilePath = path.join(__dirname, 'big.png');
  // Fake a big PNG by writing a valid tiny PNG then padding with junk bytes past the size cap.
  const tinyPngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2; c.height = 2;
    return c.toDataURL('image/png').split(',')[1];
  });
  const tinyPngBuf = Buffer.from(tinyPngB64, 'base64');
  const padding = Buffer.alloc(31 * 1024 * 1024); // pushes file size over the 30MB cap
  fs.writeFileSync(bigFilePath, Buffer.concat([tinyPngBuf, padding]));
  await page.setInputFiles('#fileInput', bigFilePath);
  await page.waitForTimeout(200);
  const afterBig = await page.evaluate(() => document.getElementById('status').textContent);
  console.log('OVERSIZED FILE:', afterBig);

  await browser.close();
  server.close();
  fs.unlinkSync(textFilePath);
  fs.unlinkSync(corruptPngPath);
  fs.unlinkSync(bigFilePath);

  if (pageErrors.length > 0) throw new Error('Uncaught page errors: ' + JSON.stringify(pageErrors));
  if (!afterTextFile.status.includes("isn't an image")) throw new Error('Non-image file should be rejected with a clear message, got: ' + afterTextFile.status);
  if (afterTextFile.hasImageState === 'block') throw new Error('Non-image file should not have loaded into the canvas');
  if (!afterCorrupt.includes("doesn't look like a valid image")) throw new Error('Corrupt image should trigger img.onerror message, got: ' + afterCorrupt);
  if (!afterBig.includes('too large')) throw new Error('Oversized file should be rejected before reading, got: ' + afterBig);
  console.log('ERROR HANDLING CHECKS PASSED');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
