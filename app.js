(() => {
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const dropzone = document.getElementById('dropzone');
  const fabricBtns = document.querySelectorAll('.fabric-btn');
  const fabricHint = document.getElementById('fabricHint');
  const dpiInput = document.getElementById('dpi');
  const lpiInput = document.getElementById('lpi');
  const lpiVal = document.getElementById('lpiVal');
  const angleInput = document.getElementById('angle');
  const angleVal = document.getElementById('angleVal');
  const inkCapInput = document.getElementById('inkCap');
  const inkCapVal = document.getElementById('inkCapVal');
  const chokeInput = document.getElementById('choke');
  const chokeVal = document.getElementById('chokeVal');
  const chokeGroup = document.getElementById('chokeGroup');
  const processBtn = document.getElementById('processBtn');
  const status = document.getElementById('status');
  const originalCanvas = document.getElementById('originalCanvas');
  const processedCanvas = document.getElementById('processedCanvas');
  const compareSlider = document.getElementById('compareSlider');
  const compareHandle = document.getElementById('compareHandle');
  const placeholderText = document.getElementById('placeholderText');
  const downloadColorBtn = document.getElementById('downloadColor');
  const downloadUnderbaseBtn = document.getElementById('downloadUnderbase');

  const underbaseCanvas = document.createElement('canvas');

  const fabricHints = {
    dark: "Dark fabric: generates a color halftone layer plus a choked white underbase.",
    light: "Light fabric: no underbase needed — only the color halftone layer is exported.",
    color: "Color fabric: generates a color halftone layer plus a light underbase for opacity."
  };

  const state = {
    fabric: 'dark',
    hasImage: false,
    img: null
  };

  function setFabric(fabric) {
    state.fabric = fabric;
    fabricBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.fabric === fabric));
    fabricHint.textContent = fabricHints[fabric];
    chokeGroup.style.display = fabric === 'light' ? 'none' : 'block';
    if (state.hasImage) runProcess();
  }

  fabricBtns.forEach(btn => {
    btn.addEventListener('click', () => setFabric(btn.dataset.fabric));
  });

  function syncSliderLabel(input, label, formatter) {
    input.addEventListener('input', () => {
      label.textContent = formatter ? formatter(input.value) : input.value;
      if (state.hasImage) runProcess();
    });
  }
  syncSliderLabel(lpiInput, lpiVal);
  syncSliderLabel(angleInput, angleVal);
  syncSliderLabel(inkCapInput, inkCapVal);
  syncSliderLabel(chokeInput, chokeVal);

  dpiInput.addEventListener('change', () => {
    if (state.img) rebuildFromImage();
  });

  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  ['dragover', 'dragenter'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  processBtn.addEventListener('click', () => runProcess());

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.img = img;
        initFromImage();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Base working resolution is tuned for a 300 DPI export; higher export
  // DPI selections scale the working canvas up proportionally, and the
  // halftone cell size (dpi / lpi) scales with it to stay physically accurate.
  const BASE_MAX_DIM = 1400;
  const MAX_WORKING_DIM = 3600;

  function initFromImage() {
    rebuildFromImage();
    originalCanvas.style.display = 'block';
    processedCanvas.style.display = 'block';
    compareHandle.style.display = 'block';
    compareSlider.style.display = 'block';
    placeholderText.style.display = 'none';
    processBtn.disabled = false;
    state.hasImage = true;
    runProcess();
  }

  function rebuildFromImage() {
    const img = state.img;
    const dpi = Number(dpiInput.value);
    const maxDim = Math.min(MAX_WORKING_DIM, Math.round(BASE_MAX_DIM * (dpi / 300)));

    let w = img.width;
    let h = img.height;
    // Always scale to the DPI-driven target size (up or down) so raising the
    // export DPI actually yields more pixels, even for small source images.
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    originalCanvas.width = w;
    originalCanvas.height = h;
    processedCanvas.width = w;
    processedCanvas.height = h;

    const octx = originalCanvas.getContext('2d', { willReadFrequently: true });
    octx.clearRect(0, 0, w, h);
    octx.drawImage(img, 0, 0, w, h);

    if (state.hasImage) runProcess();
  }

  function getPixel(data, w, h, x, y) {
    const px = Math.min(w - 1, Math.max(0, Math.round(x)));
    const py = Math.min(h - 1, Math.max(0, Math.round(y)));
    const idx = (py * w + px) * 4;
    return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
  }

  function generateHalftone(srcData, w, h, dpi, lpi, angleDeg, inkCap) {
    const ctx = processedCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Standard halftone screen relationship: cell size in pixels = DPI / LPI.
    const cellSize = Math.max(2, dpi / lpi);
    const theta = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const corners = [[0, 0], [w, 0], [0, h], [w, h]];
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    corners.forEach(([x, y]) => {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    });

    const iStart = Math.floor(uMin / cellSize) - 1;
    const iEnd = Math.ceil(uMax / cellSize) + 1;
    const jStart = Math.floor(vMin / cellSize) - 1;
    const jEnd = Math.ceil(vMax / cellSize) + 1;
    const data = srcData.data;

    for (let j = jStart; j <= jEnd; j++) {
      const v = (j + 0.5) * cellSize;
      for (let i = iStart; i <= iEnd; i++) {
        const u = (i + 0.5) * cellSize;
        const x = u * cos - v * sin;
        const y = u * sin + v * cos;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;

        const [r, g, b, a] = getPixel(data, w, h, x, y);
        const alphaFrac = a / 255;
        if (alphaFrac < 0.05) continue;
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        let ink = alphaFrac * (1 - luminance);
        ink = Math.min(ink, inkCap);
        if (ink <= 0.02) continue;

        const radius = Math.sqrt(ink) * (cellSize / 2) * 0.92;
        if (radius < 0.35) continue;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fill();
      }
    }
  }

  function generateUnderbase(srcData, w, h, chokePx) {
    const data = srcData.data;
    const size = w * h;
    let mask = new Uint8Array(size);
    for (let p = 0; p < size; p++) {
      mask[p] = data[p * 4 + 3] > 20 ? 1 : 0;
    }

    for (let iter = 0; iter < chokePx; iter++) {
      const next = new Uint8Array(size);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (!mask[p]) continue;
          const left = x > 0 ? mask[p - 1] : 0;
          const right = x < w - 1 ? mask[p + 1] : 0;
          const up = y > 0 ? mask[p - w] : 0;
          const down = y < h - 1 ? mask[p + w] : 0;
          next[p] = left && right && up && down ? 1 : 0;
        }
      }
      mask = next;
    }

    const out = underbaseCanvas.getContext('2d').createImageData(w, h);
    for (let p = 0; p < size; p++) {
      const idx = p * 4;
      if (mask[p]) {
        out.data[idx] = 255;
        out.data[idx + 1] = 255;
        out.data[idx + 2] = 255;
        out.data[idx + 3] = 255;
      }
    }
    underbaseCanvas.getContext('2d').putImageData(out, 0, 0);
  }

  function runProcess() {
    if (!state.hasImage) return;
    status.textContent = 'Processing…';
    processBtn.disabled = true;
    requestAnimationFrame(() => {
      const w = originalCanvas.width;
      const h = originalCanvas.height;
      const octx = originalCanvas.getContext('2d');
      const srcData = octx.getImageData(0, 0, w, h);

      const dpi = Number(dpiInput.value);
      const lpi = Number(lpiInput.value);
      const angleDeg = Number(angleInput.value);
      const inkCap = Number(inkCapInput.value) / 100;
      const chokePx = Number(chokeInput.value);

      generateHalftone(srcData, w, h, dpi, lpi, angleDeg, inkCap);

      if (state.fabric !== 'light') {
        underbaseCanvas.width = w;
        underbaseCanvas.height = h;
        generateUnderbase(srcData, w, h, chokePx);
        downloadUnderbaseBtn.disabled = false;
      } else {
        downloadUnderbaseBtn.disabled = true;
      }

      downloadColorBtn.disabled = false;
      processBtn.disabled = false;
      status.textContent = 'Halftone ready.';
    });
  }

  compareSlider.addEventListener('input', () => {
    const value = compareSlider.value;
    processedCanvas.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    compareHandle.style.left = `${value}%`;
  });

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Inserts a pHYs chunk right after IHDR so the exported PNG carries real
  // DPI metadata (Photoshop / RIP software reads this instead of assuming 72 DPI).
  function withDpiMetadata(pngBytes, dpi) {
    const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + IHDR (length+type+data+crc)
    const before = pngBytes.slice(0, ihdrEnd);
    const after = pngBytes.slice(ihdrEnd);

    const pxPerMeter = Math.round(dpi / 0.0254);
    const typeAndData = new Uint8Array(13);
    const tdView = new DataView(typeAndData.buffer);
    typeAndData.set([0x70, 0x48, 0x59, 0x73], 0); // 'pHYs'
    tdView.setUint32(4, pxPerMeter, false);
    tdView.setUint32(8, pxPerMeter, false);
    typeAndData[12] = 1; // unit: meters

    const chunk = new Uint8Array(4 + 13 + 4);
    new DataView(chunk.buffer).setUint32(0, 9, false); // data length
    chunk.set(typeAndData, 4);
    new DataView(chunk.buffer).setUint32(17, crc32(typeAndData), false);

    const result = new Uint8Array(before.length + chunk.length + after.length);
    result.set(before, 0);
    result.set(chunk, before.length);
    result.set(after, before.length + chunk.length);
    return result;
  }

  function downloadCanvas(canvas, baseName) {
    const dpi = Number(dpiInput.value);
    canvas.toBlob(async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const tagged = withDpiMetadata(buf, dpi);
      const taggedBlob = new Blob([tagged], { type: 'image/png' });
      const url = URL.createObjectURL(taggedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}-${dpi}dpi.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  downloadColorBtn.addEventListener('click', () => {
    downloadCanvas(processedCanvas, 'design-color-halftone');
  });
  downloadUnderbaseBtn.addEventListener('click', () => {
    downloadCanvas(underbaseCanvas, 'design-white-underbase');
  });

  setFabric('dark');
})();
