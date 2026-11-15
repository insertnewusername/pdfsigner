/* ============================================================
   PDF Signer — complete logic (with localStorage)
   ============================================================ */
(function () {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }

  function boot() {
    if (typeof pdfjsLib === 'undefined') {
      alert('PDF.js failed to load. Check your internet connection.');
      return;
    }
    if (typeof PDFLib === 'undefined') {
      alert('pdf-lib failed to load. Check your internet connection.');
      return;
    }
    init();
  }

  const RENDER_SCALE = 2.0;
  const MIN_OVERLAY_SIZE = 20;
  const STORAGE_KEY = 'pdf_signer_signatures_v1';
  const SETTINGS_KEY = 'pdf_signer_settings_v1';

  const FONT_MAP = {
    'Helvetica':      { lib: 'Helvetica',      css: 'Helvetica, Arial, sans-serif',      weight: '400' },
    'Helvetica-Bold': { lib: 'HelveticaBold',  css: 'Helvetica, Arial, sans-serif',      weight: '700' },
    'Times-Roman':    { lib: 'TimesRoman',     css: '"Times New Roman", Times, serif',   weight: '400' },
    'Times-Bold':     { lib: 'TimesRomanBold', css: '"Times New Roman", Times, serif',   weight: '700' },
    'Courier':        { lib: 'Courier',        css: 'Courier, "Courier New", monospace', weight: '400' },
    'Courier-Bold':   { lib: 'CourierBold',    css: 'Courier, "Courier New", monospace', weight: '700' },
  };

  /* ---------- State ---------- */
  let pdfDoc = null;
  let pdfjsDoc = null;
  let currentPdfBytes = null;
  let pdfPages = [];
  let signatureLibrary = [];      // [{ id, name, dataUrl, width, height }]
  let selectedSigId = null;       // library signature currently "active"
  let overlays = [];
  let selectedId = null;
  let nextOverlayId = 1;
  let nextSigId = 1;

  /* ---------- DOM refs ---------- */
  const els = {};

  function cacheDom() {
    els.pdfInput          = document.getElementById('pdfInput');
    els.fileStatus        = document.getElementById('fileStatus');
    els.addSignatureBtn   = document.getElementById('addSignatureBtn');
    els.addDateBtn        = document.getElementById('addDateBtn');
    els.downloadBtn       = document.getElementById('downloadBtn');
    els.emptyState        = document.getElementById('emptyState');
    els.pagesContainer    = document.getElementById('pagesContainer');
    els.sigLibrary        = document.getElementById('sigLibrary');
    els.sigWidthInput     = document.getElementById('sigWidthInput');
    els.sigHeightInput    = document.getElementById('sigHeightInput');
    els.applySigSizeBtn   = document.getElementById('applySigSizeBtn');
    els.signatureInput    = document.getElementById('signatureInput');
    els.sigPreview        = document.getElementById('sigPreview');
    els.dateTextInput     = document.getElementById('dateTextInput');
    els.dateFontSelect    = document.getElementById('dateFontSelect');
    els.dateFontSizeInput = document.getElementById('dateFontSizeInput');
    els.updateDateBtn     = document.getElementById('updateDateBtn');
    els.deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    els.errorBanner       = document.getElementById('errorBanner');
    els.errorBannerText   = document.getElementById('errorBannerText');
    els.errorBannerClose  = document.getElementById('errorBannerClose');
  }

  function showError(msg) {
    console.error('[PDF Signer]', msg);
    if (els.errorBanner && els.errorBannerText) {
      els.errorBannerText.textContent = String(msg);
      els.errorBanner.hidden = false;
    } else {
      alert(msg);
    }
  }

  function hideError() {
    if (!els.errorBanner) return;
    els.errorBanner.hidden = true;
    if (els.errorBannerText) els.errorBannerText.textContent = '';
  }

  function setStatus(msg) {
    console.log('[PDF Signer]', msg);
    if (els.fileStatus) els.fileStatus.textContent = msg;
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function getFontInfo(name) { return FONT_MAP[name] || FONT_MAP['Helvetica']; }
  function getSigById(id) { return signatureLibrary.find(s => s.id === id) || null; }

  /* ============================================================
     LOCAL STORAGE (Save & Load Signatures + Settings)
     ============================================================ */
  function loadSignaturesFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          signatureLibrary = parsed;
          const maxId = Math.max(...signatureLibrary.map(s => s.id || 0));
          nextSigId = maxId + 1;
          console.log('[PDF Signer] loaded', signatureLibrary.length, 'signatures from localStorage');
        }
      }
    } catch (err) {
      console.error('[PDF Signer] Failed to load from localStorage:', err);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function saveSignaturesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(signatureLibrary));
    } catch (err) {
      console.error('[PDF Signer] Failed to save to localStorage:', err);
      if (err.name === 'QuotaExceededError' || err.code === 22) {
        showError('Your browser storage is full. The signature was added to the current session, but it might not be saved for next time.');
      }
    }
  }

  function loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.width) els.sigWidthInput.value = parsed.width;
        if (parsed.height) els.sigHeightInput.value = parsed.height;
      }
    } catch (err) {
      console.error('[PDF Signer] Failed to load settings:', err);
    }
  }

  function saveSettings(w, h) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ width: w, height: h }));
    } catch (err) {
      console.error('[PDF Signer] Failed to save settings:', err);
    }
  }

  /* ---------- Init ---------- */
  function init() {
    cacheDom();
    console.log('[PDF Signer] init — DOM cached');

    loadSignaturesFromStorage();
    loadSettings(); // Load saved width/height

    const t = new Date();
    els.dateTextInput.value =
      `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

    els.pdfInput.addEventListener('change', onPdfSelected);
    els.signatureInput.addEventListener('change', onSignatureSelected);
    els.addSignatureBtn.addEventListener('click', addSignatureOverlay);
    els.addDateBtn.addEventListener('click', addDateOverlay);
    els.downloadBtn.addEventListener('click', downloadSignedPdf);
    els.applySigSizeBtn.addEventListener('click', applySigSizeToSelected);
    els.updateDateBtn.addEventListener('click', updateSelectedDate);
    els.deleteSelectedBtn.addEventListener('click', deleteSelected);

    // Save width/height immediately if the user manually types in the inputs
    els.sigWidthInput.addEventListener('change', () => saveSettings(els.sigWidthInput.value, els.sigHeightInput.value));
    els.sigHeightInput.addEventListener('change', () => saveSettings(els.sigWidthInput.value, els.sigHeightInput.value));

    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'errorBannerClose') {
        e.preventDefault();
        hideError();
      }
    });

    renderSignatureLibrary();
    console.log('[PDF Signer] ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ============================================================
     SIGNATURE LIBRARY (UI)
     ============================================================ */
  function renderSignatureLibrary() {
    if (!els.sigLibrary) return;
    els.sigLibrary.innerHTML = '';

    if (signatureLibrary.length === 0) {
      els.sigLibrary.classList.add('empty');
      const span = document.createElement('span');
      span.textContent = 'No signatures yet — add a PNG below';
      els.sigLibrary.appendChild(span);
      return;
    }

    els.sigLibrary.classList.remove('empty');
    signatureLibrary.forEach(sig => {
      const thumb = document.createElement('div');
      thumb.className = 'sig-thumb' + (sig.id === selectedSigId ? ' selected' : '');
      thumb.dataset.sigId = sig.id;
      thumb.title = sig.name;

      const img = document.createElement('img');
      img.src = sig.dataUrl;
      img.alt = sig.name;
      thumb.appendChild(img);

      const name = document.createElement('div');
      name.className = 'sig-name';
      name.textContent = sig.name;
      thumb.appendChild(name);

      const rm = document.createElement('div');
      rm.className = 'sig-remove';
      rm.textContent = '×';
      rm.title = 'Remove signature';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSignature(sig.id);
      });
      thumb.appendChild(rm);

      thumb.addEventListener('click', () => {
        selectedSigId = sig.id;
        renderSignatureLibrary();
      });

      els.sigLibrary.appendChild(thumb);
    });
  }

  function removeSignature(id) {
    signatureLibrary = signatureLibrary.filter(s => s.id !== id);
    if (selectedSigId === id) selectedSigId = null;
    saveSignaturesToStorage();
    renderSignatureLibrary();
  }

  /* ============================================================
     SIGNATURE FILE
     ============================================================ */
  function onSignatureSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.type !== 'image/png') {
      showError('Please choose a PNG file.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const data = x.getImageData(0, 0, c.width, c.height).data;

        let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
        for (let yy = 0; yy < c.height; yy++) {
          for (let xx = 0; xx < c.width; xx++) {
            const a = data[(yy * c.width + xx) * 4 + 3];
            if (a > 5) {
              if (xx < minX) minX = xx;
              if (yy < minY) minY = yy;
              if (xx > maxX) maxX = xx;
              if (yy > maxY) maxY = yy;
            }
          }
        }

        let finalUrl = dataUrl, fw = img.width, fh = img.height;
        if (maxX >= minX && maxY >= minY) {
          const cw = maxX - minX + 1;
          const ch = maxY - minY + 1;
          const cropped = document.createElement('canvas');
          cropped.width = cw;
          cropped.height = ch;
          cropped.getContext('2d').drawImage(img, minX, minY, cw, ch, 0, 0, cw, ch);
          finalUrl = cropped.toDataURL('image/png');
          fw = cw; fh = ch;
        }

        const baseName = file.name.replace(/\.png$/i, '') || `Signature ${signatureLibrary.length + 1}`;
        const sig = {
          id: nextSigId++,
          name: baseName,
          dataUrl: finalUrl,
          width: fw,
          height: fh,
        };
        signatureLibrary.push(sig);
        selectedSigId = sig.id;

        els.sigPreview.classList.remove('empty');
        els.sigPreview.innerHTML = `<img src="${finalUrl}" alt="preview">`;

        saveSignaturesToStorage();
        renderSignatureLibrary();
        e.target.value = '';
      };
      img.onerror = () => showError('Could not decode PNG.');
      img.src = dataUrl;
    };
    reader.onerror = () => showError('Could not read file.');
    reader.readAsDataURL(file);
  }

  /* ============================================================
     PDF LOADING
     ============================================================ */
  async function onPdfSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setStatus('Reading file…');
    try {
      const buffer = await file.arrayBuffer();
      await loadPdf(buffer, file.name);
    } catch (err) {
      console.error('[PDF Signer] load error:', err);
      showError('Failed to load PDF: ' + (err && err.message ? err.message : err));
      setStatus('Error loading PDF');
    }
  }

  async function loadPdf(arrayBuffer, fileName) {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
    pdfjsDoc = await loadingTask.promise;

    const numPages = pdfjsDoc.numPages;
    pdfPages = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfjsDoc.getPage(i);
      const vp = page.getViewport({ scale: 1.0 });
      pdfPages.push({ pageIndex: i - 1, width: vp.width, height: vp.height });
    }

    currentPdfBytes = new Uint8Array(arrayBuffer.slice(0));
    pdfDoc = await PDFLib.PDFDocument.load(currentPdfBytes, { ignoreEncryption: true });

    clearAllOverlays();
    els.emptyState.style.display = 'none';
    els.pagesContainer.hidden = false;

    await renderAllPages();

    els.addSignatureBtn.disabled = false;
    els.addDateBtn.disabled = false;
    els.downloadBtn.disabled = false;
    setStatus(`${numPages} page${numPages > 1 ? 's' : ''} — ${fileName}`);
  }

  async function renderAllPages() {
    els.pagesContainer.innerHTML = '';

    for (let i = 0; i < pdfPages.length; i++) {
      const pageInfo = pdfPages[i];
      const pdfPage = await pdfjsDoc.getPage(i + 1);
      const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });

      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.pageIndex = i;
      wrapper.dataset.scale = RENDER_SCALE;
      wrapper.dataset.origWidth = pageInfo.width;
      wrapper.dataset.origHeight = pageInfo.height;
      wrapper.style.width = viewport.width + 'px';
      wrapper.style.height = viewport.height + 'px';

      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      const ctx = canvas.getContext('2d');
      await pdfPage.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
      wrapper.appendChild(canvas);

      overlays
        .filter(o => o.pageIndex === i)
        .forEach(o => createOverlayDOM(o, wrapper));

      els.pagesContainer.appendChild(wrapper);
    }
  }

  /* ============================================================
     OVERLAYS
     ============================================================ */
  function clearAllOverlays() {
    overlays = [];
    selectedId = null;
    document.querySelectorAll('.overlay-item').forEach(el => el.remove());
    updateSelectionUI();
  }

  function getPageWrapper(pageIndex) {
    return document.querySelector(`.page-wrapper[data-page-index="${pageIndex}"]`);
  }

  function createOverlayDOM(overlay, wrapper) {
    const scale = parseFloat(wrapper.dataset.scale);
    const origHeight = parseFloat(wrapper.dataset.origHeight);

    const cssLeft = overlay.x * scale;
    const cssTop = (origHeight - overlay.y - overlay.height) * scale;
    const cssW = overlay.width * scale;
    const cssH = overlay.height * scale;

    const el = document.createElement('div');
    el.className = 'overlay-item';
    el.dataset.id = overlay.id;
    el.dataset.pageIndex = overlay.pageIndex;
    el.style.left = cssLeft + 'px';
    el.style.top = cssTop + 'px';
    el.style.width = cssW + 'px';
    el.style.height = cssH + 'px';

    if (overlay.type === 'signature') {
      const sig = getSigById(overlay.sigId);
      const img = document.createElement('img');
      img.src = sig ? sig.dataUrl : '';
      img.alt = 'signature';
      img.draggable = false;
      el.appendChild(img);
    } else {
      const d = document.createElement('div');
      d.className = 'date-content';
      d.textContent = overlay.text;
      const fm = getFontInfo(overlay.font);
      d.style.fontFamily = fm.css;
      d.style.fontWeight = fm.weight;
      d.style.fontSize = (overlay.fontSize * scale) + 'px';
      el.appendChild(d);
    }

    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    el.appendChild(resizer);

    const delBtn = document.createElement('div');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '×';
    el.appendChild(delBtn);

    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resizer') || e.target.classList.contains('delete-btn')) return;
      e.preventDefault();
      selectOverlay(overlay.id);
      startDrag(e, overlay, el, wrapper);
    });

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectOverlay(overlay.id);
      startResize(e, overlay, el, wrapper);
    });

    delBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeOverlay(overlay.id);
    });

    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('resizer') || e.target.classList.contains('delete-btn')) return;
      selectOverlay(overlay.id);
    });

    wrapper.appendChild(el);
  }

  function startDrag(e, overlay, el, wrapper) {
    const scale = parseFloat(wrapper.dataset.scale);
    const origHeight = parseFloat(wrapper.dataset.origHeight);
    const startX = e.clientX, startY = e.clientY;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    const maxLeft = wrapper.clientWidth - el.offsetWidth;
    const maxTop = wrapper.clientHeight - el.offsetHeight;

    function onMove(ev) {
      const nl = Math.max(0, Math.min(startLeft + ev.clientX - startX, maxLeft));
      const nt = Math.max(0, Math.min(startTop + ev.clientY - startY, maxTop));
      el.style.left = nl + 'px';
      el.style.top = nt + 'px';
      overlay.x = round2(nl / scale);
      overlay.y = round2(origHeight - nt / scale - overlay.height);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startResize(e, overlay, el, wrapper) {
    const scale = parseFloat(wrapper.dataset.scale);
    const origHeight = parseFloat(wrapper.dataset.origHeight);
    const startX = e.clientX, startY = e.clientY;
    const sw = parseFloat(el.style.width), sh = parseFloat(el.style.height);
    const sl = parseFloat(el.style.left), st = parseFloat(el.style.top);
    const maxW = wrapper.clientWidth - sl;
    const maxH = wrapper.clientHeight - st;

    function onMove(ev) {
      const nw = Math.max(MIN_OVERLAY_SIZE, Math.min(sw + ev.clientX - startX, maxW));
      const nh = Math.max(MIN_OVERLAY_SIZE, Math.min(sh + ev.clientY - startY, maxH));
      el.style.width = nw + 'px';
      el.style.height = nh + 'px';
      overlay.width = round2(nw / scale);
      overlay.height = round2(nh / scale);
      overlay.y = round2(origHeight - st / scale - overlay.height);
      
      // Update the inputs live when resizing
      els.sigWidthInput.value = Math.round(overlay.width);
      els.sigHeightInput.value = Math.round(overlay.height);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Save dimensions when resize finishes
      if (overlay.type === 'signature') {
        saveSettings(overlay.width, overlay.height);
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function selectOverlay(id) {
    selectedId = id;
    document.querySelectorAll('.overlay-item').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.id) === id);
    });
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const ov = selectedId != null ? overlays.find(o => o.id === selectedId) : null;
    if (!ov) {
      els.applySigSizeBtn.disabled = true;
      els.updateDateBtn.disabled = true;
      els.deleteSelectedBtn.disabled = true;
      return;
    }
    if (ov.type === 'signature') {
      els.sigWidthInput.value = Math.round(ov.width);
      els.sigHeightInput.value = Math.round(ov.height);
      els.applySigSizeBtn.disabled = false;
      els.updateDateBtn.disabled = true;
    } else {
      els.dateTextInput.value = ov.text;
      if (els.dateFontSelect) els.dateFontSelect.value = ov.font || 'Helvetica';
      els.dateFontSizeInput.value = ov.fontSize;
      els.applySigSizeBtn.disabled = true;
      els.updateDateBtn.disabled = false;
    }
    els.deleteSelectedBtn.disabled = false;
  }

  function removeOverlay(id) {
    const i = overlays.findIndex(o => o.id === id);
    if (i !== -1) overlays.splice(i, 1);
    document.querySelectorAll(`.overlay-item[data-id="${id}"]`).forEach(el => el.remove());
    if (selectedId === id) { selectedId = null; updateSelectionUI(); }
  }

  /* ============================================================
     ADD / UPDATE
     ============================================================ */
  function addSignatureOverlay() {
    if (signatureLibrary.length === 0) {
      showError('Add a signature PNG first.');
      return;
    }
    if (!selectedSigId && signatureLibrary.length > 0) {
      selectedSigId = signatureLibrary[0].id;
    }
    if (!selectedSigId) {
      showError('Select a signature from the library.');
      return;
    }
    if (!pdfDoc || pdfPages.length === 0) {
      showError('Load a PDF first.');
      return;
    }

    const sig = getSigById(selectedSigId);
    if (!sig) return;

    // Use the saved dimensions from the inputs
    const w = parseFloat(els.sigWidthInput.value) || 150;
    const h = parseFloat(els.sigHeightInput.value) || 60;
    
    const page = pdfPages[0];
    const ov = {
      id: nextOverlayId++,
      type: 'signature',
      pageIndex: 0,
      x: round2(Math.max(10, page.width - w - 40)),
      y: 40,
      width: w,
      height: h,
      sigId: sig.id,
    };
    overlays.push(ov);
    const wrapper = getPageWrapper(0);
    if (wrapper) createOverlayDOM(ov, wrapper);
    selectOverlay(ov.id);
  }

  function addDateOverlay() {
    if (!pdfDoc || pdfPages.length === 0) {
      showError('Load a PDF first.');
      return;
    }
    const text = els.dateTextInput.value.trim() || '2025-01-01';
    const font = els.dateFontSelect ? els.dateFontSelect.value : 'Helvetica';
    const fontSize = parseFloat(els.dateFontSizeInput.value) || 16;
    const w = 120;
    const h = Math.max(30, fontSize * 1.6);
    const page = pdfPages[0];

    const ov = {
      id: nextOverlayId++,
      type: 'date',
      pageIndex: 0,
      x: round2(Math.max(10, page.width - w - 40)),
      y: 100,
      width: w,
      height: round2(h),
      text,
      font,
      fontSize,
    };
    overlays.push(ov);
    const wrapper = getPageWrapper(0);
    if (wrapper) createOverlayDOM(ov, wrapper);
    selectOverlay(ov.id);
  }

  function applySigSizeToSelected() {
    if (selectedId == null) return;
    const ov = overlays.find(o => o.id === selectedId);
    if (!ov || ov.type !== 'signature') return;
    
    const w = parseFloat(els.sigWidthInput.value);
    const h = parseFloat(els.sigHeightInput.value);
    if (!(w > 0) || !(h > 0)) return;

    ov.width = round2(w);
    ov.height = round2(h);
    saveSettings(ov.width, ov.height); // Save dimensions when applied

    const el = document.querySelector(`.overlay-item[data-id="${ov.id}"]`);
    if (!el) return;
    const wrapper = el.closest('.page-wrapper');
    const scale = parseFloat(wrapper.dataset.scale);
    const origHeight = parseFloat(wrapper.dataset.origHeight);

    const cssLeft = parseFloat(el.style.left);
    const cssTop = parseFloat(el.style.top);

    el.style.width = (ov.width * scale) + 'px';
    el.style.height = (ov.height * scale) + 'px';
    ov.x = round2(cssLeft / scale);
    ov.y = round2(origHeight - cssTop / scale - ov.height);
  }

  function updateSelectedDate() {
    if (selectedId == null) return;
    const ov = overlays.find(o => o.id === selectedId);
    if (!ov || ov.type !== 'date') return;
    ov.text = els.dateTextInput.value.trim() || '2025-01-01';
    ov.font = els.dateFontSelect ? els.dateFontSelect.value : 'Helvetica';
    ov.fontSize = parseFloat(els.dateFontSizeInput.value) || 16;

    const el = document.querySelector(`.overlay-item[data-id="${ov.id}"]`);
    if (el) {
      const wrapper = el.closest('.page-wrapper');
      const scale = parseFloat(wrapper.dataset.scale);
      const d = el.querySelector('.date-content');
      if (d) {
        const fm = getFontInfo(ov.font);
        d.textContent = ov.text;
        d.style.fontFamily = fm.css;
        d.style.fontWeight = fm.weight;
        d.style.fontSize = (ov.fontSize * scale) + 'px';
      }
    }
  }

  function deleteSelected() {
    if (selectedId != null) removeOverlay(selectedId);
  }

  /* ============================================================
     DOWNLOAD
     ============================================================ */
  async function downloadSignedPdf() {
    if (!currentPdfBytes) return;
    try {
      setStatus('Generating PDF…');
      const freshDoc = await PDFLib.PDFDocument.load(currentPdfBytes, { ignoreEncryption: true });
      const pages = freshDoc.getPages();

      // Embed each unique signature once
      const sigCache = new Map();
      for (const ov of overlays) {
        if (ov.type === 'signature') {
          const sig = getSigById(ov.sigId);
          if (sig && !sigCache.has(sig.id)) {
            const base64 = sig.dataUrl.split(',')[1];
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            sigCache.set(sig.id, await freshDoc.embedPng(bytes));
          }
        }
      }

      // Embed each unique font once
      const fontCache = new Map();
      async function getFont(name) {
        if (fontCache.has(name)) return fontCache.get(name);
        const key = getFontInfo(name).lib;
        const stdKey = PDFLib.StandardFonts[key];
        const f = await freshDoc.embedFont(stdKey);
        fontCache.set(name, f);
        return f;
      }

      for (const ov of overlays) {
        const page = pages[ov.pageIndex];
        if (!page) continue;

        if (ov.type === 'signature') {
          const sig = getSigById(ov.sigId);
          const embedded = sig ? sigCache.get(sig.id) : null;
          if (embedded) {
            page.drawImage(embedded, {
              x: ov.x,
              y: ov.y,
              width: ov.width,
              height: ov.height,
            });
          }
        } else if (ov.type === 'date') {
          const font = await getFont(ov.font || 'Helvetica');
          page.drawText(ov.text, {
            x: ov.x + 2,
            y: ov.y + (ov.height - ov.fontSize) / 2 + 2,
            size: ov.fontSize,
            font,
            color: PDFLib.rgb(0, 0, 0),
          });
        }
      }

      const pdfBytes = await freshDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'signed_document.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('PDF downloaded!');
    } catch (err) {
      console.error('[PDF Signer] download error:', err);
      showError('Error generating PDF: ' + (err && err.message ? err.message : err));
    }
  }
})();