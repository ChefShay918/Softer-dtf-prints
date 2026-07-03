(() => {
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const dropzone = document.getElementById('dropzone');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const fabricBtns = document.querySelectorAll('.fabric-btn');
  const fabricHint = document.getElementById('fabricHint');
  const removeBgInput = document.getElementById('removeBg');
  const bgToleranceInput = document.getElementById('bgTolerance');
  const bgToleranceVal = document.getElementById('bgToleranceVal');
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

  const PRESETS = {
    'soft-realistic': { lpi: 45, angle: 22.5, inkCap: 75, choke: 2 },
    'heavy-knockout': { lpi: 18, angle: 22.5, inkCap: 45, choke: 3 },
    'vintage-halftone': { lpi: 24, angle: 45, inkCap: 88, choke: 1 },
    'high-contrast': { lpi: 55, angle: 45, inkCap: 100, choke: 0 }
  };

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    presetBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.preset === name));
    lpiInput.value = preset.lpi;
    angleInput.value = preset.angle;
    inkCapInput.value = preset.inkCap;
    chokeInput.value = preset.choke;
    lpiVal.textContent = preset.lpi;
    angleVal.textContent = preset.angle;
    inkCapVal.textContent = preset.inkCap;
    chokeVal.textContent = preset.choke;
    if (state.hasImage) runProcess();
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  function syncSliderLabel(input, label, formatter) {
    input.addEventListener('input', () => {
      label.textContent = formatter ? formatter(input.value) : input.value;
      presetBtns.forEach(btn => btn.classList.remove('active'));
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

  removeBgInput.addEventListener('change', () => {
    if (state.img) rebuildFromImage();
  });
  bgToleranceInput.addEventListener('input', () => {
    bgToleranceVal.textContent = bgToleranceInput.value;
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

  const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB — generous for a design file, cheap to sanity-check

  function loadFile(file) {
    if (!file.type.startsWith('image/')) {
      status.textContent = `"${file.name}" isn't an image file. Please upload a PNG or JPG.`;
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      status.textContent = `"${file.name}" is too large (${Math.round(file.size / 1024 / 1024)}MB). Please upload a file under 30MB.`;
      return;
    }

    status.textContent = 'Loading…';
    const reader = new FileReader();
    reader.onerror = () => {
      status.textContent = `Couldn't read "${file.name}" — the file may be corrupted. Please try again.`;
    };
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => {
        status.textContent = `"${file.name}" doesn't look like a valid image. Please try a different file.`;
      };
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

    if (removeBgInput.checked) {
      const imageData = octx.getImageData(0, 0, w, h);
      const tolerance = Number(bgToleranceInput.value);
      if (removeBackground(imageData, w, h, tolerance)) {
        octx.putImageData(imageData, 0, 0);
      }
    }

    if (state.hasImage) runProcess();
  }

  // Samples opaque border pixels to find the background color. Uses a
  // per-channel median rather than a mean so a corner glare, shadow, or a
  // few noisy pixels can't drag the reference color off — a plain average
  // is exactly what lets a speckled/gradient background survive removal.
  function detectBackgroundColor(data, w, h) {
    const rs = [], gs = [], bs = [];
    const step = Math.max(1, Math.floor(Math.min(w, h) / 200));

    function sample(x, y) {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] < 200) return;
      rs.push(data[idx]);
      gs.push(data[idx + 1]);
      bs.push(data[idx + 2]);
    }

    for (let x = 0; x < w; x += step) {
      sample(x, 0);
      sample(x, h - 1);
    }
    for (let y = 0; y < h; y += step) {
      sample(0, y);
      sample(w - 1, y);
    }

    if (rs.length === 0) return null;
    const median = (arr) => {
      arr.sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)];
    };
    return [median(rs), median(gs), median(bs)];
  }

  function colorDistance(r, g, b, bgR, bgG, bgB) {
    const dr = r - bgR, dg = g - bgG, db = b - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  // Removes a solid/near-solid background, then cleans up the two artifacts
  // a plain chroma-key always leaves behind: a ring of half-blended,
  // anti-aliased edge pixels the strict threshold missed (defringe), and
  // isolated single-pixel noise specks from JPEG compression (despeckle).
  function removeBackground(imageData, w, h, tolerancePct) {
    const data = imageData.data;
    const bg = detectBackgroundColor(data, w, h);
    if (!bg) return false;
    const [bgR, bgG, bgB] = bg;
    const maxDist = Math.sqrt(255 * 255 * 3);
    const threshold = (tolerancePct / 100) * maxDist;

    for (let p = 0; p < w * h; p++) {
      const idx = p * 4;
      if (data[idx + 3] === 0) continue;
      const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB);
      if (dist <= threshold) data[idx + 3] = 0;
    }

    defringe(data, w, h, bgR, bgG, bgB, threshold);
    despeckle(data, w, h);
    return true;
  }

  // Any surviving opaque pixel that touches a transparent one is an edge
  // pixel by definition. If it's also within a wider tolerance of the
  // background color, it's a blended fringe pixel rather than real ink —
  // knock it out too. Iterated a couple of passes since anti-aliasing can
  // blend across 2px.
  function defringe(data, w, h, bgR, bgG, bgB, threshold) {
    const wideThreshold = threshold * 1.6;
    for (let pass = 0; pass < 2; pass++) {
      const toClear = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (data[idx + 3] === 0) continue;
          let touchesTransparent = false;
          for (let dy = -1; dy <= 1 && !touchesTransparent; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              if (data[(ny * w + nx) * 4 + 3] === 0) { touchesTransparent = true; break; }
            }
          }
          if (!touchesTransparent) continue;
          const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB);
          if (dist <= wideThreshold) toClear.push(idx);
        }
      }
      if (toClear.length === 0) break;
      for (const idx of toClear) data[idx + 3] = 0;
    }
  }

  // Removes single opaque pixels fully surrounded by transparency — the
  // salt-and-pepper noise a chroma-key leaves in an otherwise-cleared
  // background from JPEG compression artifacts.
  function despeckle(data, w, h) {
    const toClear = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] === 0) continue;
        let hasOpaqueNeighbor = false;
        for (let dy = -1; dy <= 1 && !hasOpaqueNeighbor; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            if (data[(ny * w + nx) * 4 + 3] > 0) { hasOpaqueNeighbor = true; break; }
          }
        }
        if (!hasOpaqueNeighbor) toClear.push(idx);
      }
    }
    for (const idx of toClear) data[idx + 3] = 0;
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

  let processGeneration = 0;

  function runProcess() {
    if (!state.hasImage) return;
    const myGeneration = ++processGeneration;
    status.textContent = 'Processing…';
    processBtn.disabled = true;
    requestAnimationFrame(() => {
      // If the user dragged a slider again before this frame ran, a newer
      // call already superseded it — skip the redundant work instead of
      // reprocessing once per input event.
      if (myGeneration !== processGeneration) return;
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
  // IHDR must be the first chunk in any valid PNG (spec-guaranteed), but we
  // verify it rather than assume it, so a malformed input fails safe instead
  // of producing a corrupted file.
  function withDpiMetadata(pngBytes, dpi) {
    const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + IHDR (length+type+data+crc)
    const isPng = pngBytes[0] === 0x89 && pngBytes[1] === 0x50 && pngBytes[2] === 0x4e && pngBytes[3] === 0x47;
    const hasIhdr = pngBytes[12] === 0x49 && pngBytes[13] === 0x48 && pngBytes[14] === 0x44 && pngBytes[15] === 0x52;
    if (!isPng || !hasIhdr || pngBytes.length < ihdrEnd) {
      return pngBytes; // not the PNG structure we expect — skip tagging rather than risk corrupting it
    }

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
      if (!blob) {
        status.textContent = 'Export failed — please try again.';
        return;
      }
      let taggedBlob = blob;
      try {
        const buf = new Uint8Array(await blob.arrayBuffer());
        taggedBlob = new Blob([withDpiMetadata(buf, dpi)], { type: 'image/png' });
      } catch {
        // Fall back to the untagged PNG rather than failing the download outright —
        // it'll just default to 72 DPI metadata instead of the selected export DPI.
      }
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
