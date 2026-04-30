























function orderEdgesForBiofabricV1(graph, cliques) {
  const edges = graph.links || graph.edges || [];

  
  const edgeToCliques = new Map();
  const cliqueToEdges = new Map();
  for (const c of cliques) cliqueToEdges.set(c.id, new Set());
  for (const e of edges) edgeToCliques.set(e.id, new Set());
  for (const c of cliques) {
    const nodeSet = new Set(c.nodes);
    for (const e of edges) {
      if (nodeSet.has(e.source) && nodeSet.has(e.target)) {
        edgeToCliques.get(e.id).add(c.id);
        cliqueToEdges.get(c.id).add(e.id);
      }
    }
  }

  
  const cliqueIds = cliques.map(c => c.id);
  const cliqueAdj = new Map();
  for (const ci of cliqueIds) {
    cliqueAdj.set(ci, new Map());
    for (const cj of cliqueIds) if (ci !== cj) cliqueAdj.get(ci).set(cj, 0);
  }
  for (const [, cSet] of edgeToCliques) {
    const arr = [...cSet];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const ci = arr[i], cj = arr[j];
        cliqueAdj.get(ci).set(cj, (cliqueAdj.get(ci).get(cj) || 0) + 1);
        cliqueAdj.get(cj).set(ci, (cliqueAdj.get(cj).get(ci) || 0) + 1);
      }
    }
  }

  
  function greedyChain(startId) {
    const remaining = new Set(cliqueIds);
    remaining.delete(startId);
    const chain = [startId];
    while (remaining.size > 0) {
      const right = chain[chain.length - 1];
      let bestR = null, scoreR = -1;
      for (const cj of remaining) {
        const s = cliqueAdj.get(right).get(cj) || 0;
        if (s > scoreR || (s === scoreR && (bestR === null || cj < bestR))) { scoreR = s; bestR = cj; }
      }
      const left = chain[0];
      let bestL = null, scoreL = -1;
      for (const cj of remaining) {
        const s = cliqueAdj.get(left).get(cj) || 0;
        if (s > scoreL || (s === scoreL && (bestL === null || cj < bestL))) { scoreL = s; bestL = cj; }
      }
      if (scoreR >= scoreL) { chain.push(bestR); remaining.delete(bestR); }
      else { chain.unshift(bestL); remaining.delete(bestL); }
    }
    return chain;
  }

  let order = [];
  if (cliqueIds.length > 0) {
    const sorted = [...cliqueIds].sort((a, b) => {
      const diff = cliqueToEdges.get(b).size - cliqueToEdges.get(a).size;
      return diff !== 0 ? diff : a - b;
    });
    order = greedyChain(sorted[0]);
  }

  
  console.log('[orderEdgesForBiofabricV1] Clique order:', order);

  
  const emitted = new Set();
  const result = [];

  for (let i = 0; i < order.length; i++) {
    const K = order[i];
    const prev = i > 0 ? order[i - 1] : null;
    const next = i < order.length - 1 ? order[i + 1] : null;
    const kSet = cliqueToEdges.get(K) || new Set();

    const prevEdges = prev ? (cliqueToEdges.get(prev) || new Set()) : new Set();
    const nextEdges = next ? (cliqueToEdges.get(next) || new Set()) : new Set();

    const boundaryPrev = [...kSet].filter(e => prevEdges.has(e)).sort((a, b) => a - b);
    const boundaryNext = [...kSet].filter(e => nextEdges.has(e)).sort((a, b) => a - b);
    const boundaryAll = new Set([...boundaryPrev, ...boundaryNext]);
    const internal = [...kSet].filter(e => !boundaryAll.has(e)).sort((a, b) => a - b);

    if (boundaryPrev.length > 0 || boundaryNext.length > 0) {
      console.log(
        `[orderEdgesForBiofabricV1] Clique ${K}:`,
        `boundaryPrev=[${boundaryPrev}]`,
        `internal=[${internal}]`,
        `boundaryNext=[${boundaryNext}]`,
      );
    }

    for (const e of [...boundaryPrev, ...internal, ...boundaryNext]) {
      if (!emitted.has(e)) { result.push({ id: e, clique: K }); emitted.add(e); }
    }
  }

  
  for (const e of edges) {
    if (!emitted.has(e.id)) { result.push({ id: e.id, clique: 0 }); emitted.add(e.id); }
  }

  return result.map((r, idx) => ({ id: r.id, pos: idx, clique: r.clique }));
}


const _params = new URLSearchParams(window.location.search);
const _graphId = _params.get('graph');
const _setName = _params.get('set');
const _setGraphId = _params.get('setGraph');
const _solId = _params.get('sol');
const _jobId = _params.get('job');

const _biofabricModeSelect = document.getElementById('biofabric-mode-select');
const _biofabricContiguousCheckbox = document.getElementById('biofabric-contiguous-checkbox');
const _biofabricHideSyntheticCheckbox = document.getElementById('biofabric-hide-synthetic-checkbox');
const _biofabricCliqueOpacitySlider = document.getElementById('biofabric-clique-opacity-slider');
const _biofabricCliqueOpacityValue = document.getElementById('biofabric-clique-opacity-value');
const _biofabricNegativeHoleWidthSlider = document.getElementById('biofabric-negative-hole-width-slider');
const _biofabricNegativeHoleWidthValue = document.getElementById('biofabric-negative-hole-width-value');
const _biofabricShowAllCliqueMarkersCheckbox = document.getElementById('biofabric-show-all-clique-markers-checkbox');
const _biofabricEdgeStrokeWidthInput = document.getElementById('biofabric-edge-stroke-width');
const _biofabricEdgeStrokeWidthValue = document.getElementById('biofabric-edge-stroke-width-value');
const _biofabricNodeAxisSpacingInput = document.getElementById('biofabric-node-axis-spacing');
const _biofabricNodeAxisSpacingValue = document.getElementById('biofabric-node-axis-spacing-value');
const _biofabricNodeLabelSizeInput = document.getElementById('biofabric-node-label-size');
const _biofabricNodeLabelSizeValue = document.getElementById('biofabric-node-label-size-value');
const _biofabricCliqueBorderWidthInput = document.getElementById('biofabric-clique-border-width');
const _biofabricCliqueBorderWidthValue = document.getElementById('biofabric-clique-border-width-value');
const _biofabricMarkerStrokeWidthInput = document.getElementById('biofabric-marker-stroke-width');
const _biofabricMarkerStrokeWidthValue = document.getElementById('biofabric-marker-stroke-width-value');
const _biofabricLockNodeAxisSpacingCheckbox = document.getElementById('biofabric-lock-node-axis-spacing');
const _biofabricExportFormatSelect = document.getElementById('biofabric-export-format');
const _biofabricExportButton = document.getElementById('biofabric-export-button');
const _graphExportFormatSelect = document.getElementById('graph-export-format');
const _graphExportButton = document.getElementById('graph-export-button');


let _pollTimer = null;
let _lastGraphData = null;
let _lastSolData = null;

function getBiofabricMode() {
  const mode = _biofabricModeSelect?.value;
  if (mode === 'clique-squares-only') return 'clique-squares-only';
  if (mode === 'clique-negative-holes') return 'clique-negative-holes';
  if (mode === 'clique-squares-negative-holes') return 'clique-squares-negative-holes';
  return 'full';
}

function getContiguousOnlyMode() {
  return !!_biofabricContiguousCheckbox?.checked;
}

function getHideSyntheticEdgesMode() {
  return !!_biofabricHideSyntheticCheckbox?.checked;
}

function getShowAllCliqueMarkersMode() {
  return !!_biofabricShowAllCliqueMarkersCheckbox?.checked;
}

function getBiofabricCliqueFillOpacity() {
  const raw = Number(_biofabricCliqueOpacitySlider?.value);
  if (!Number.isFinite(raw)) return 0.32;
  return Math.max(0.05, Math.min(1, raw));
}

function updateBiofabricOpacityLabel() {
  if (!_biofabricCliqueOpacityValue) return;
  const pct = Math.round(getBiofabricCliqueFillOpacity() * 100);
  _biofabricCliqueOpacityValue.textContent = `${pct}%`;
}

function getBiofabricNegativeHoleWidth() {
  const raw = Number(_biofabricNegativeHoleWidthSlider?.value);
  if (!Number.isFinite(raw)) return null;
  return Math.max(1, Math.min(24, raw));
}

function updateBiofabricNegativeHoleWidthLabel() {
  if (!_biofabricNegativeHoleWidthValue) return;
  const value = getBiofabricNegativeHoleWidth();
  _biofabricNegativeHoleWidthValue.textContent = Number.isFinite(value) ? `${value.toFixed(1)} px` : 'auto';
}

function getBiofabricEdgeStrokeWidth() {
  const raw = Number(_biofabricEdgeStrokeWidthInput?.value);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(0.5, Math.min(16, raw));
}

function updateBiofabricEdgeStrokeWidthLabel() {
  if (!_biofabricEdgeStrokeWidthValue) return;
  _biofabricEdgeStrokeWidthValue.textContent = `${getBiofabricEdgeStrokeWidth().toFixed(1)} px`;
}

function getBiofabricNodeAxisSpacing() {
  const raw = Number(_biofabricNodeAxisSpacingInput?.value);
  if (!Number.isFinite(raw)) return 8;
  return Math.max(4, Math.min(120, raw));
}

function isBiofabricNodeAxisSpacingLocked() {
  return !!_biofabricLockNodeAxisSpacingCheckbox?.checked;
}

function updateBiofabricNodeAxisSpacingLabel() {
  if (!_biofabricNodeAxisSpacingValue) return;
  const spacing = getBiofabricNodeAxisSpacing();
  const modeLabel = isBiofabricNodeAxisSpacingLocked() ? 'bloccato' : 'auto';
  _biofabricNodeAxisSpacingValue.textContent = `${spacing.toFixed(1)} px (${modeLabel})`;
}

function getBiofabricNodeLabelSize() {
  const raw = Number(_biofabricNodeLabelSizeInput?.value);
  if (!Number.isFinite(raw)) return 12;
  return Math.max(8, Math.min(36, raw));
}

function updateBiofabricNodeLabelSizeLabel() {
  if (!_biofabricNodeLabelSizeValue) return;
  _biofabricNodeLabelSizeValue.textContent = `${getBiofabricNodeLabelSize().toFixed(1)} px`;
}

function getBiofabricCliqueBorderWidth() {
  const raw = Number(_biofabricCliqueBorderWidthInput?.value);
  if (!Number.isFinite(raw)) return 1.4;
  return Math.max(0.5, Math.min(12, raw));
}

function updateBiofabricCliqueBorderWidthLabel() {
  if (!_biofabricCliqueBorderWidthValue) return;
  _biofabricCliqueBorderWidthValue.textContent = `${getBiofabricCliqueBorderWidth().toFixed(1)} px`;
}

function getBiofabricMarkerStrokeWidth() {
  const raw = Number(_biofabricMarkerStrokeWidthInput?.value);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(0.5, Math.min(12, raw));
}

function updateBiofabricMarkerStrokeWidthLabel() {
  if (!_biofabricMarkerStrokeWidthValue) return;
  _biofabricMarkerStrokeWidthValue.textContent = `${getBiofabricMarkerStrokeWidth().toFixed(1)} px`;
}

function getBiofabricExportFormat() {
  const format = String(_biofabricExportFormatSelect?.value || 'pdf').toLowerCase();
  if (format === 'svg' || format === 'png') return format;
  return 'pdf';
}

function getGraphExportFormat() {
  const format = String(_graphExportFormatSelect?.value || 'pdf').toLowerCase();
  if (format === 'svg' || format === 'png') return format;
  return 'pdf';
}

function getSvgElementForContainer(containerSelector) {
  return document.querySelector(`${containerSelector} svg`);
}

function getExportBaseFilename() {
  const raw = (_solId || _graphId || _setGraphId || 'biofabric')
    .replace(/\.[a-z0-9]+$/i, '')
    .trim();
  const safe = raw.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, '_');
  return safe || 'biofabric';
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyComputedSvgStyles(sourceEl, targetEl) {
  if (!(sourceEl instanceof Element) || !(targetEl instanceof Element)) return;
  const computed = window.getComputedStyle(sourceEl);
  const styleProps = [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'word-spacing',
    'text-anchor',
    'dominant-baseline',
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-dasharray',
    'opacity',
    'paint-order',
    'shape-rendering',
  ];
  const inlineStyle = styleProps
    .map((prop) => {
      const value = computed.getPropertyValue(prop);
      return value ? `${prop}:${value}` : '';
    })
    .filter(Boolean)
    .join(';');
  if (inlineStyle) targetEl.setAttribute('style', inlineStyle);
}

function inlineSvgComputedStyles(sourceRoot, targetRoot) {
  const sourceNodes = [sourceRoot, ...sourceRoot.querySelectorAll('*')];
  const targetNodes = [targetRoot, ...targetRoot.querySelectorAll('*')];
  const count = Math.min(sourceNodes.length, targetNodes.length);
  for (let i = 0; i < count; i++) {
    copyComputedSvgStyles(sourceNodes[i], targetNodes[i]);
  }
}

function serializeBiofabricSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  inlineSvgComputedStyles(svgEl, clone);
  const viewBox = svgEl.viewBox?.baseVal;
  const width = Math.max(1, Math.round(viewBox?.width || svgEl.width?.baseVal?.value || 1200));
  const height = Math.max(1, Math.round(viewBox?.height || svgEl.height?.baseVal?.value || 1000));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  return {
    width,
    height,
    svgText: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`,
  };
}

function svgTextToImage(svgText) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossibile caricare l\'SVG per l\'esportazione.'));
    };
    image.src = url;
  });
}

async function exportSvgFigure({ svgEl, format, filenameBase, emptyMessage }) {
  if (!svgEl) {
    showError(emptyMessage);
    return;
  }

  const { svgText, width, height } = serializeBiofabricSvg(svgEl);

  if (format === 'svg') {
    triggerBlobDownload(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), `${filenameBase}.svg`);
    return;
  }

  const image = await svgTextToImage(svgText);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D non disponibile nel browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  if (format === 'png') {
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('Impossibile generare il file PNG.');
    triggerBlobDownload(pngBlob, `${filenameBase}.png`);
    return;
  }

  const jsPdfCtor = window.jspdf?.jsPDF;
  if (!jsPdfCtor) {
    throw new Error('Libreria PDF non caricata.');
  }
  const pdf = new jsPdfCtor({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [width, height],
    compress: true,
  });
  const pngDataUrl = canvas.toDataURL('image/png');
  pdf.addImage(pngDataUrl, 'PNG', 0, 0, width, height);
  pdf.save(`${filenameBase}.pdf`);
}

async function exportBiofabricFigure() {
  await exportSvgFigure({
    svgEl: getSvgElementForContainer('#result-biofabric'),
    format: getBiofabricExportFormat(),
    filenameBase: `${getExportBaseFilename()}_biofabric`,
    emptyMessage: 'Nessuna figura Biofabric disponibile da esportare.',
  });
}

async function exportGraphFigure() {
  await exportSvgFigure({
    svgEl: getSvgElementForContainer('#result-graph'),
    format: getGraphExportFormat(),
    filenameBase: `${getExportBaseFilename()}_graph`,
    emptyMessage: 'Nessun grafo node-link disponibile da esportare.',
  });
}

// -€-€ DOM helpers -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function showBanner(type, text) {
  const b = document.getElementById('status-banner');
  b.className = type;
  document.getElementById('banner-text').textContent = text;
}
function hideBanner() {
  document.getElementById('status-banner').className = '';
  document.getElementById('status-banner').style.display = 'none';
}
function showError(msg) {
  const el = document.getElementById('load-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// -€-€ Gap chip -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function updateGapChip(gap) {
  const chip = document.getElementById('chip-gap');
  if (gap === null || gap === undefined) { chip.style.display = 'none'; return; }
  chip.textContent = `Gap: ${Number(gap).toFixed(2)}%`;
  chip.style.display = '';
}

// -€-€ Entry point -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
(function init() {
  if (!_solId) {
    showError('Nessun parametro ?sol=<filename> fornito. Torna alla pagina precedente.');
    return;
  }

  if (_biofabricModeSelect) {
    _biofabricModeSelect.addEventListener('change', () => {
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricContiguousCheckbox) {
    _biofabricContiguousCheckbox.addEventListener('change', () => {
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricHideSyntheticCheckbox) {
    _biofabricHideSyntheticCheckbox.addEventListener('change', () => {
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricShowAllCliqueMarkersCheckbox) {
    _biofabricShowAllCliqueMarkersCheckbox.addEventListener('change', () => {
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricCliqueOpacitySlider) {
    updateBiofabricOpacityLabel();
    _biofabricCliqueOpacitySlider.addEventListener('input', () => {
      updateBiofabricOpacityLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricNegativeHoleWidthSlider) {
    updateBiofabricNegativeHoleWidthLabel();
    _biofabricNegativeHoleWidthSlider.addEventListener('input', () => {
      updateBiofabricNegativeHoleWidthLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricEdgeStrokeWidthInput) {
    updateBiofabricEdgeStrokeWidthLabel();
    _biofabricEdgeStrokeWidthInput.addEventListener('input', () => {
      updateBiofabricEdgeStrokeWidthLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricNodeAxisSpacingInput) {
    updateBiofabricNodeAxisSpacingLabel();
    _biofabricNodeAxisSpacingInput.addEventListener('input', () => {
      updateBiofabricNodeAxisSpacingLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricLockNodeAxisSpacingCheckbox) {
    updateBiofabricNodeAxisSpacingLabel();
    _biofabricLockNodeAxisSpacingCheckbox.addEventListener('change', () => {
      updateBiofabricNodeAxisSpacingLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricNodeLabelSizeInput) {
    updateBiofabricNodeLabelSizeLabel();
    _biofabricNodeLabelSizeInput.addEventListener('input', () => {
      updateBiofabricNodeLabelSizeLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricCliqueBorderWidthInput) {
    updateBiofabricCliqueBorderWidthLabel();
    _biofabricCliqueBorderWidthInput.addEventListener('input', () => {
      updateBiofabricCliqueBorderWidthLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricMarkerStrokeWidthInput) {
    updateBiofabricMarkerStrokeWidthLabel();
    _biofabricMarkerStrokeWidthInput.addEventListener('input', () => {
      updateBiofabricMarkerStrokeWidthLabel();
      if (_lastGraphData && _lastSolData) drawAll(_lastGraphData, _lastSolData);
    });
  }

  if (_biofabricExportButton) {
    _biofabricExportButton.addEventListener('click', async () => {
      const prevText = _biofabricExportButton.textContent;
      _biofabricExportButton.disabled = true;
      _biofabricExportButton.textContent = 'Esporto...';
      try {
        await exportBiofabricFigure();
      } catch (err) {
        showError(`Errore esportazione figura: ${err.message}`);
      } finally {
        _biofabricExportButton.disabled = false;
        _biofabricExportButton.textContent = prevText;
      }
    });
  }

  if (_graphExportButton) {
    _graphExportButton.addEventListener('click', async () => {
      const prevText = _graphExportButton.textContent;
      _graphExportButton.disabled = true;
      _graphExportButton.textContent = 'Esporto...';
      try {
        await exportGraphFigure();
      } catch (err) {
        showError(`Errore esportazione grafo: ${err.message}`);
      } finally {
        _graphExportButton.disabled = false;
        _graphExportButton.textContent = prevText;
      }
    });
  }

  // Header chips
  if (_solId) {
    const c = document.getElementById('chip-sol');
    c.textContent = 'Soluzione: ' + _solId;
    c.style.display = '';
    document.getElementById('result-title').textContent = _solId.replace(/\.sol$/i, '');

    // download link
    const dl = document.getElementById('dl-link');
    dl.href = `/results/${encodeURIComponent(_solId)}`;
    dl.download = _solId;
    dl.style.display = '';
  }

  if (_jobId) {
    // Job-aware mode: poll until done, then render
    pollJobAndRender();
  } else {
    // Direct mode: load immediately (solution must already exist)
    loadAndRender();
  }
})();

// -€-€ Job polling -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function pollJobAndRender() {
  showBanner('running', 'Job in esecuzione - in attesa del completamento...');

  function poll() {
    fetch(`/jobs`)
      .then(r => r.json())
      .then(data => {
        const job = (data.jobs || []).find(j => j.jobId === _jobId);
        if (!job) {
          // Job dismissed or server restarted - try loading the solution anyway
          clearInterval(_pollTimer);
          loadAndRender();
          return;
        }

        updateGapChip(job.gap);

        if (job.gap !== null && job.gap !== undefined) {
          showBanner('running', `Job in esecuzione - MIP Gap: ${Number(job.gap).toFixed(2)}%`);
        }

        if (job.status === 'completed' || job.status === 'done') {
          clearInterval(_pollTimer);
          showBanner('done', 'Job completato! Caricamento risultati...');
          setTimeout(loadAndRender, 400);
        } else if (job.status === 'failed' || job.status === 'error' || job.status === 'killed') {
          clearInterval(_pollTimer);
          showBanner('failed', `Job terminato con stato: ${job.status}`);
          loadAndRender();
        }
      })
      .catch(() => { }); // silent - keep polling
  }

  poll();
  _pollTimer = setInterval(poll, 1500);
}

// -€-€ Load graph + solution and render -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function loadAndRender() {
  showBanner('waiting', 'Caricamento dati...');

  // Determine graph source: graph-set params, explicit graph param, or auto-detect fallback.
  let graphPromise;
  if (_setName && _setGraphId) {
    graphPromise = fetch(`/graph-sets/${encodeURIComponent(_setName)}/graphs/${encodeURIComponent(_setGraphId)}`).then(r => {
      if (!r.ok) throw new Error(`Grafo set non trovato: ${_setName}/${_setGraphId}`);
      return r.json();
    });
  } else if (_graphId) {
    graphPromise = fetch(`/jsonFiles/${encodeURIComponent(_graphId)}`).then(r => {
      if (!r.ok) throw new Error(`Grafo non trovato: ${_graphId}`);
      return r.json();
    });
  } else {
    graphPromise = fetchGraphByName(_solId);
  }

  const solPromise = fetch(`/results/${encodeURIComponent(_solId)}`)
    .then(r => {
      if (!r.ok) throw new Error(`Soluzione non trovata: ${_solId}`);
      return r.text();
    });

  Promise.all([graphPromise, solPromise])
    .then(([graphData, solData]) => {
      const c = document.getElementById('chip-graph');
      if (_setName && _setGraphId) {
        c.textContent = `Grafo set: ${_setName}/${_setGraphId}`;
        c.style.display = '';
      } else if (_graphId) {
        c.textContent = 'Grafo: ' + (graphData.name || _graphId);
        c.style.display = '';
      }
      hideBanner();
      document.getElementById('load-error').style.display = 'none';
      _lastGraphData = graphData;
      _lastSolData = solData;
      drawAll(graphData, solData);
    })
    .catch(err => {
      hideBanner();
      showError('Errore nel caricamento: ' + err.message);
    });
}

/**
 * Try to find a matching graph JSON by looking at all uploaded JSONs and
 * matching by name embedded in the solution filename.
 */
function fetchGraphByName(solName) {
  return fetch('/uploaded-json-files')
    .then(r => r.json())
    .then(data => {
      const files = data.files || [];
      // Strip timestamp prefix from solName to get a clean base
      const solBase = solName.replace(/\.sol$/i, '').replace(/^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_/, '');
      // Try to find a JSON whose originalname appears in solBase
      const best = files.find(f => {
        const jBase = f.name.replace(/\.json$/i, '');
        return solBase.startsWith(jBase) || solBase.includes(jBase);
      });
      if (!best) throw new Error('Grafo non trovato automaticamente. Usa ?graph=<id> per specificarlo.');
      const c = document.getElementById('chip-graph');
      c.textContent = 'Grafo: ' + best.name;
      c.style.display = '';
      return fetch(`/jsonFiles/${encodeURIComponent(best.id)}`).then(r => r.json());
    });
}

// -€-€ Draw both panels -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function drawAll(graphData, solData) {
  const coloredLinks = drawBiofabric(graphData, solData, 'result-biofabric', {
    contiguousOnly: getContiguousOnlyMode(),
    hideSyntheticEdges: getHideSyntheticEdgesMode(),
    showAllCliqueMarkers: getShowAllCliqueMarkersMode(),
    cliqueFillOpacity: getBiofabricCliqueFillOpacity(),
    negativeHoleStrokeWidth: getBiofabricNegativeHoleWidth(),
    edgeStrokeWidth: getBiofabricEdgeStrokeWidth(),
    nodeAxisSpacing: getBiofabricNodeAxisSpacing(),
    nodeLabelSize: getBiofabricNodeLabelSize(),
    cliqueBorderWidth: getBiofabricCliqueBorderWidth(),
    markerStrokeWidth: getBiofabricMarkerStrokeWidth(),
    lockNodeAxisSpacing: isBiofabricNodeAxisSpacingLocked(),
  });
  if (coloredLinks) renderGraph(graphData, coloredLinks, 'result-graph');
}

function getContiguousCliques(cliques, orderedNodes) {
  if (!Array.isArray(cliques) || cliques.length === 0) return [];
  if (!Array.isArray(orderedNodes) || orderedNodes.length === 0) return [];

  const rankByNode = new Map(orderedNodes.map((node, idx) => [node.id, idx]));
  return cliques.filter((clique) => {
    const ranks = (clique.nodes || [])
      .map((nodeId) => rankByNode.get(nodeId))
      .filter((rank) => Number.isFinite(rank))
      .sort((a, b) => a - b);

    if (ranks.length !== (clique.nodes || []).length) return false;
    if (ranks.length <= 1) return true;

    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] - ranks[i - 1] !== 1) return false;
    }
    return true;
  });
}

function normalizeEdgeEndpointId(raw) {
  return typeof raw === 'object' ? raw?.id : raw;
}

function makeUndirectedEdgeKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function buildNegativeCliqueHoleEdges(effectiveCliques, edges, orderedNodes, originalBiofabricEdges) {
  if (!Array.isArray(effectiveCliques) || effectiveCliques.length === 0) return [];

  const rankByNodeId = new Map(orderedNodes.map((n, idx) => [n.id, idx]));
  const existingPairKeys = new Set();
  for (const edge of edges || []) {
    const sourceId = normalizeEdgeEndpointId(edge.source);
    const targetId = normalizeEdgeEndpointId(edge.target);
    const key = makeUndirectedEdgeKey(sourceId, targetId);
    if (key) existingPairKeys.add(key);
  }

  const cliqueSlotsById = new Map(effectiveCliques.map((c) => [c.id, []]));
  for (let idx = 0; idx < originalBiofabricEdges.length; idx++) {
    const edge = originalBiofabricEdges[idx];
    for (const cid of edge.cliques || []) {
      if (cliqueSlotsById.has(cid)) cliqueSlotsById.get(cid).push(idx);
    }
  }

  const syntheticCandidates = [];
  for (const clique of effectiveCliques) {
    const cliqueNodes = [...new Set((clique.nodes || []).filter((nodeId) => rankByNodeId.has(nodeId)))];
    if (cliqueNodes.length <= 1) continue;
    cliqueNodes.sort((a, b) => rankByNodeId.get(a) - rankByNodeId.get(b));

    const missingPairs = [];
    for (let i = 0; i < cliqueNodes.length; i++) {
      for (let j = i + 1; j < cliqueNodes.length; j++) {
        const sourceId = cliqueNodes[i];
        const targetId = cliqueNodes[j];
        const key = makeUndirectedEdgeKey(sourceId, targetId);
        if (!key || existingPairKeys.has(key)) continue;
        missingPairs.push({ sourceId, targetId });
      }
    }
    if (missingPairs.length === 0) continue;

    const slots = (cliqueSlotsById.get(clique.id) || []).slice().sort((a, b) => a - b);
    const slotMin = slots.length > 0 ? slots[0] : 0;
    const slotMax = slots.length > 0 ? slots[slots.length - 1] : slotMin;

    for (let i = 0; i < missingPairs.length; i++) {
      const pair = missingPairs[i];
      const desiredSlot = missingPairs.length === 1
        ? (slotMin + slotMax) / 2
        : slotMin + ((i + 1) * (slotMax - slotMin + 1) / (missingPairs.length + 1));

      syntheticCandidates.push({
        sortPos: desiredSlot + (clique.id * 1e-5) + (i * 1e-7),
        edge: {
          id: `neg_c${clique.id}_${pair.sourceId}_${pair.targetId}`,
          name: `e_neg_c${clique.id}_${pair.sourceId}_${pair.targetId}`,
          sourceId: pair.sourceId,
          targetId: pair.targetId,
          cliques: [clique.id],
          synthetic: true,
          negative: true,
        },
      });
    }
  }

  syntheticCandidates.sort((a, b) => {
    if (a.sortPos !== b.sortPos) return a.sortPos - b.sortPos;
    return String(a.edge.id).localeCompare(String(b.edge.id));
  });

  const baseWithPos = originalBiofabricEdges.map((edge, idx) => ({ sortPos: idx, edge }));
  const merged = [...baseWithPos, ...syntheticCandidates].sort((a, b) => {
    if (a.sortPos !== b.sortPos) return a.sortPos - b.sortPos;
    const aIsSynthetic = !!a.edge.synthetic;
    const bIsSynthetic = !!b.edge.synthetic;
    if (aIsSynthetic !== bIsSynthetic) return aIsSynthetic ? 1 : -1;
    return String(a.edge.id).localeCompare(String(b.edge.id));
  });

  return merged.map((item) => ({
    ...item.edge,
    cliques: [...(item.edge.cliques || [])],
  }));
}

// -€-€ Biofabric V2 renderer (self-contained) -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function drawBiofabricOLD(gfData, slData, containerId, options = {}) {
  const nodes = gfData.nodes;
  const edges = gfData.links || gfData.edges || [];
  const cliques = gfData.cliques || [];

  const nodesPositions = [];
  let orderedNodes = [];
  let orderedEdges = [];
  let counter = 0;

  const lines = slData.split('\n');

  // Parse node positions
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('pos_n')) {
      const parts = t.split(/\s+/);
      const id = parseInt(parts[0].substring(5));
      const pos = parseInt(parts[1]);
      const n = nodes.find(n => n.id === id);
      if (n) nodesPositions.push({ id: n.id, pos });
    }
  }

  if (nodesPositions.length === 0) {
    document.getElementById(containerId).innerHTML =
      '<div class="placeholder">Nessun dato di posizione (pos_n) trovato nella soluzione.</div>';
    return null;
  }

  orderedNodes = nodesPositions.slice().sort((a, b) => a.pos - b.pos);

  const contiguousOnly = !!options.contiguousOnly;
  const effectiveCliques = contiguousOnly ? getContiguousCliques(cliques, orderedNodes) : cliques;

  // Edge positions: explicit pos_e or clique-fallback
  let isEdgeOrdered = lines.some(l => l.trim().startsWith('pos_e'));

  if (isEdgeOrdered) {
    for (const l of lines) {
      const t = l.trim();
      if (t.startsWith('pos_e')) {
        const parts = t.split(/\s+/);
        const id = parseInt(parts[0].substring(5));
        const pos = parseInt(parts[1]);
        const e = edges.find(e => e.id === id);
        if (e) orderedEdges.push({ id: e.id, pos });
      }
    }
    orderedEdges.sort((a, b) => a.pos - b.pos);
  } else {
    // Feature flag: set to false to restore legacy clique-node traversal ordering
    const USE_CLIQUE_BOUNDARY_ORDERING = true;

    if (USE_CLIQUE_BOUNDARY_ORDERING && effectiveCliques.length > 0) {
      orderedEdges = orderEdgesForBiofabricV1({ ...gfData, cliques: effectiveCliques }, effectiveCliques);
    } else {
      // Legacy ordering: traverse nodes in solve order, emit clique-internal edges
      for (const on of orderedNodes) {
        const cliqueOfNode = effectiveCliques.find(c => c.nodes.includes(on.id));
        if (cliqueOfNode) {
          for (const e of edges) {
            const isCliqueEdge = cliqueOfNode.nodes.includes(e.source) && cliqueOfNode.nodes.includes(e.target);
            if (isCliqueEdge && !orderedEdges.find(oe => oe.id === e.id)) {
              orderedEdges.push({ id: e.id, pos: counter++, clique: cliqueOfNode.id });
            }
          }
        }
      }
      for (const e of edges) {
        if (!orderedEdges.find(oe => oe.id === e.id)) {
          orderedEdges.push({ id: e.id, pos: counter++, clique: 0 });
        }
      }
    }
  }

  // Assign cliques to each ordered edge
  for (const oe of orderedEdges) {
    const thisEdge = edges.find(e => e.id === oe.id);
    if (!thisEdge) { oe.cliques = [0]; continue; }
    const ac = effectiveCliques
      .filter(c => c.nodes.includes(thisEdge.source) && c.nodes.includes(thisEdge.target))
      .map(c => c.id);
    oe.cliques = ac.length > 0 ? ac : [0];
  }

  // Build coloredLinks for graph renderer
  const coloredLinks = orderedEdges.map(oe => {
    const orig = edges.find(e => e.id === oe.id);
    return { id: oe.id, source: orig.source, target: orig.target, cliques: oe.cliques };
  });

  // -€-€ SVG -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
  const width = 1200;
  const height = 1000;
  const padding = { top: 40, left: 200, right: 40 };

  const svg = d3.create('svg')
    .attr('viewBox', [0, 0, width, height])
    .attr('width', width)
    .attr('height', height)
    .attr('style', 'max-width:100%; height:auto;');

  document.getElementById(containerId).innerHTML = '';
  d3.select('#' + containerId).append(() => svg.node());

  const rawVSpacing = (height - padding.top) / Math.max(orderedNodes.length, 1);
  const rawHSpacing = (width - padding.left - padding.right) / Math.max(orderedEdges.length, 1);
  const gridSpacing = Math.max(6, Math.min(rawVSpacing, rawHSpacing));
  const vSpacing = gridSpacing;
  const hSpacing = gridSpacing;

  // Build node layout
  const nodesLayout = orderedNodes.map(on => ({ id: on.id, name: 'n' + on.id, y: on.pos * vSpacing }));

  // Build edge layout
  const edgesLayout = orderedEdges.map(oe => {
    const x = oe.pos * hSpacing;
    const link = gfData.links.find(l => l.id === oe.id);
    const srcN = nodesLayout.find(n => n.id === link.source);
    const tgtN = nodesLayout.find(n => n.id === link.target);
    const active = (oe.cliques || []).filter(c => c > 0);
    return {
      id: oe.id, name: 'e' + oe.id, source: srcN, target: tgtN, cliques: active, x,
      color: active.length > 0 ? d3.schemeCategory10[active[0] % 10] : 'black'
    };
  });

  const biofabricMode = getBiofabricMode();
  const renderedEdges = biofabricMode === 'clique-squares-only'
    ? edgesLayout.filter(edge => edge.cliques.length === 0)
    : edgesLayout;

  // Node lines + labels
  svg.append('g').selectAll('line').data(nodesLayout).enter().append('line')
    .attr('x1', padding.left).attr('x2', width - padding.right)
    .attr('y1', d => padding.top + d.y).attr('y2', d => padding.top + d.y)
    .attr('stroke', '#ddd').attr('stroke-width', 3)
    .style('stroke-linecap', 'round');

  const nodeLabels = svg.append('g').selectAll('text').data(nodesLayout).enter().append('text')
    .attr('x', padding.left - 24).attr('y', d => padding.top + d.y)
    .text(d => d.name)
    .style('text-anchor', 'end')
    .style('font-size', '12px')
    .style('fill', '#333');

  const nodeMarkersGroup = svg.append('g').attr('class', 'node-markers-group');
  const markerBaseX = padding.left - 62;
  const markerHalfHeight = Math.max(vSpacing * 0.34, 6);
  const markerSpacing = 9;
  // Aggressive merge so nearby markers appear as one continuous vertical guide.
  const markerMergeGap = Math.max(vSpacing * 0.85, 10);

  function updateNodeMarkers(activeCliques) {
    const laneByCliqueId = new Map(activeCliques.map((c, idx) => [c.id, idx]));
    const laneCount = Math.max(activeCliques.length, 1);
    const rawMarkers = [];

    for (const node of nodesLayout) {
      for (const clique of activeCliques) {
        if (!clique.nodeSet.has(node.id)) continue;
        const lane = laneByCliqueId.get(clique.id) || 0;
        const x = markerBaseX + (lane - (laneCount - 1) / 2) * markerSpacing;
        rawMarkers.push({
          y: padding.top + node.y,
          color: clique.color,
          lane,
          x,
        });
      }
    }

    const groupedByLane = new Map();
    for (const marker of rawMarkers) {
      const laneKey = `${marker.lane}-${marker.color}`;
      if (!groupedByLane.has(laneKey)) groupedByLane.set(laneKey, []);
      groupedByLane.get(laneKey).push(marker);
    }

    const markerData = [];
    for (const [laneKey, entries] of groupedByLane.entries()) {
      entries.sort((a, b) => a.y - b.y);
      let segStart = entries[0].y - markerHalfHeight;
      let segEnd = entries[0].y + markerHalfHeight;
      let segX = entries[0].x;
      let segColor = entries[0].color;

      for (let i = 1; i < entries.length; i++) {
        const nextStart = entries[i].y - markerHalfHeight;
        const nextEnd = entries[i].y + markerHalfHeight;
        if (nextStart <= segEnd + markerMergeGap) {
          segEnd = Math.max(segEnd, nextEnd);
        } else {
          markerData.push({
            key: `${laneKey}-${segStart}-${segEnd}`,
            x: segX,
            y1: segStart,
            y2: segEnd,
            color: segColor,
          });
          segStart = nextStart;
          segEnd = nextEnd;
          segX = entries[i].x;
          segColor = entries[i].color;
        }
      }
      markerData.push({
        key: `${laneKey}-${segStart}-${segEnd}`,
        x: segX,
        y1: segStart,
        y2: segEnd,
        color: segColor,
      });
    }

    nodeMarkersGroup
      .selectAll('line')
      .data(markerData, d => d.key)
      .join(
        enter => enter.append('line')
          .attr('x1', d => d.x)
          .attr('x2', d => d.x)
          .attr('y1', d => d.y1)
          .attr('y2', d => d.y2)
          .attr('stroke', d => d.color)
          .attr('stroke-width', 3)
          .attr('stroke-linecap', 'round')
          .attr('opacity', 0.96),
        update => update
          .attr('x1', d => d.x)
          .attr('x2', d => d.x)
          .attr('y1', d => d.y1)
          .attr('y2', d => d.y2)
          .attr('stroke', d => d.color),
        exit => exit.remove(),
      );
  }

  function clearNodeHighlight() {
    nodeLabels
      .style('fill', '#333')
      .style('font-weight', '400');
    updateNodeMarkers([]);
  }

  function highlightCliqueNodes(activeCliques) {
    const activeCliqueByNode = new Map();
    const isSingleCliqueSelection = activeCliques.length === 1;
    for (const clique of activeCliques) {
      for (const nodeId of clique.nodeSet) {
        if (!activeCliqueByNode.has(nodeId)) {
          activeCliqueByNode.set(nodeId, clique.color);
        }
      }
    }

    nodeLabels
      .style('fill', d => (isSingleCliqueSelection && activeCliqueByNode.has(d.id)) ? activeCliqueByNode.get(d.id) : '#333')
      .style('font-weight', d => activeCliqueByNode.has(d.id) ? '700' : '400');

    updateNodeMarkers(activeCliques);
  }

  // Clique highlight rectangles
  const cliqueIds = [...new Set(orderedEdges.flatMap(oe => oe.cliques || []).filter(c => c > 0))];
  const cliqueGroup = svg.insert('g', ':first-child');
  const gridMinX = padding.left;
  const gridMaxX = width - padding.right;
  const preparedCliqueRegions = [];
  const cliqueRegions = [];
  for (const cliqueId of cliqueIds) {
    const ceEdges = edgesLayout.filter(e => e.cliques.includes(cliqueId));
    if (ceEdges.length === 0) continue;
    const visibleCliqueEdges = renderedEdges.filter(e => e.cliques.includes(cliqueId));
    const hasNoVisibleEdges = visibleCliqueEdges.length === 0;
    const xs = ceEdges.map(e => e.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const cd = effectiveCliques.find(c => c.id === cliqueId);
    if (!cd) continue;
    const ys = cd.nodes.map(nid => { const n = nodesLayout.find(n => n.id === nid); return n ? n.y : null; }).filter(y => y !== null);
    if (ys.length === 0) continue;
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const color = d3.schemeCategory10[cliqueId % 10];
    const hPad = hSpacing * 0.5, vPad = vSpacing * 0.5;
    const cliqueNodesSet = new Set(cd.nodes);
    const baseRegionX = padding.left + xMin - hPad;
    const baseRegionY = padding.top + yMin - vPad;
    const baseRegionW = xMax - xMin + hPad * 2;
    const baseRegionH = yMax - yMin + vPad * 2;
    const regionSize = baseRegionH;
    let regionX = hasNoVisibleEdges ? (baseRegionX + (regionSize - baseRegionW) / 2) : baseRegionX;
    const regionY = baseRegionY;
    const regionW = hasNoVisibleEdges ? regionSize : baseRegionW;
    const regionH = hasNoVisibleEdges ? regionSize : baseRegionH;

    // Keep all clique regions inside the BioFabric grid bounds.
    const maxRegionX = gridMaxX - regionW;
    if (maxRegionX <= gridMinX) {
      regionX = gridMinX;
    } else {
      regionX = Math.max(gridMinX, Math.min(regionX, maxRegionX));
    }

    preparedCliqueRegions.push({
      id: cliqueId,
      color,
      nodeSet: cliqueNodesSet,
      baseX: baseRegionX,
      baseW: baseRegionW,
      edgeSet: new Set(ceEdges.map((edge) => edge.id)),
      x1: regionX,
      x2: regionX + regionW,
      y1: regionY,
      y2: regionY + regionH,
      ys,
      vPad,
      hasNoVisibleEdges,
    });
  }

  const compressionCuts = preparedCliqueRegions
    .filter((region) => region.hasNoVisibleEdges)
    .map((region) => ({
      cutX: region.baseX + region.baseW,
      reduction: Math.max(0, region.baseW - (region.x2 - region.x1)),
    }))
    .filter((entry) => entry.reduction > 0)
    .sort((a, b) => a.cutX - b.cutX);

  function getCompactionOffsetX(rawX) {
    let offset = 0;
    for (const cut of compressionCuts) {
      if (rawX >= cut.cutX) offset += cut.reduction;
    }
    return offset;
  }

  const minEdgeX = renderedEdges.length
    ? d3.min(renderedEdges, (edge) => {
      const rawX = padding.left + edge.x;
      return rawX - getCompactionOffsetX(rawX);
    })
    : Number.POSITIVE_INFINITY;
  const minCliqueX = preparedCliqueRegions.length
    ? d3.min(preparedCliqueRegions, (region) => region.x1 - getCompactionOffsetX(region.baseX))
    : Number.POSITIVE_INFINITY;
  const minContentX = Math.min(minEdgeX, minCliqueX);
  const leftInset = Math.max(8, hSpacing * 0.35);
  const desiredMinX = gridMinX + leftInset;
  const shiftLeft = Number.isFinite(minContentX) ? Math.max(0, minContentX - desiredMinX) : 0;
  const contentOffsetX = -shiftLeft;

  const laidOutCliqueRegions = preparedCliqueRegions.map((region) => {
    const width = region.x2 - region.x1;
    const projectedX1 = region.x1 - getCompactionOffsetX(region.baseX) + contentOffsetX;
    return {
      ...region,
      projectedX1,
      x1: projectedX1,
      x2: projectedX1 + width,
    };
  });

  function regionsShareEdges(a, b) {
    if (!a.edgeSet || !b.edgeSet) return false;
    const smaller = a.edgeSet.size <= b.edgeSet.size ? a.edgeSet : b.edgeSet;
    const larger = a.edgeSet.size <= b.edgeSet.size ? b.edgeSet : a.edgeSet;
    for (const edgeId of smaller) {
      if (larger.has(edgeId)) return true;
    }
    return false;
  }

  const sortedForCollision = [...laidOutCliqueRegions].sort((a, b) => a.x1 - b.x1);
  const nonOverlapGap = Math.max(2, hSpacing * 0.1);
  for (let i = 1; i < sortedForCollision.length; i++) {
    const prev = sortedForCollision[i - 1];
    const curr = sortedForCollision[i];
    const overlap = prev.x2 + nonOverlapGap - curr.x1;
    if (overlap > 0 && !regionsShareEdges(prev, curr)) {
      curr.x1 += overlap;
      curr.x2 += overlap;
    }
  }

  const maxRegionX2 = sortedForCollision.length ? d3.max(sortedForCollision, (region) => region.x2) : null;
  if (maxRegionX2 !== null && Number.isFinite(maxRegionX2) && maxRegionX2 > gridMaxX) {
    const overflow = maxRegionX2 - gridMaxX;
    sortedForCollision.forEach((region) => {
      region.x1 -= overflow;
      region.x2 -= overflow;
    });
  }

  const minRegionX1 = sortedForCollision.length ? d3.min(sortedForCollision, (region) => region.x1) : null;
  if (minRegionX1 !== null && Number.isFinite(minRegionX1) && minRegionX1 < desiredMinX) {
    const underflow = desiredMinX - minRegionX1;
    sortedForCollision.forEach((region) => {
      region.x1 += underflow;
      region.x2 += underflow;
    });
  }

  const cliqueDeltaById = new Map();
  for (const region of laidOutCliqueRegions) {
    cliqueDeltaById.set(region.id, region.x1 - region.projectedX1);
  }

  function getEdgeCliqueDelta(edge) {
    const activeCliques = (edge.cliques || []).filter((cid) => cid > 0);
    if (!activeCliques.length) return 0;
    const deltas = activeCliques
      .map((cid) => cliqueDeltaById.get(cid))
      .filter((delta) => Number.isFinite(delta));
    if (!deltas.length) return 0;
    return d3.mean(deltas);
  }

  for (const region of laidOutCliqueRegions) {
    const regionX = region.x1;
    const regionY = region.y1;
    const regionW = region.x2 - region.x1;
    const regionH = region.y2 - region.y1;

    cliqueRegions.push({
      id: region.id,
      color: region.color,
      nodeSet: region.nodeSet,
      x1: regionX,
      x2: regionX + regionW,
      y1: regionY,
      y2: regionY + regionH,
    });

    for (const ny of region.ys) {
      cliqueGroup.append('rect')
        .attr('x', regionX).attr('y', padding.top + ny - region.vPad)
        .attr('width', regionW).attr('height', region.vPad * 2)
        .attr('fill', region.color).attr('fill-opacity', 0.34).attr('stroke', 'none');
    }
    cliqueGroup.append('rect')
      .attr('x', regionX).attr('y', regionY)
      .attr('width', regionW).attr('height', regionH)
      .attr('fill', 'none').attr('stroke', region.color)
      .attr('stroke-width', 1.5).attr('stroke-dasharray', '6,3').attr('rx', 8);
  }

  if (cliqueRegions.length > 0) {
    svg.append('rect')
      .attr('x', padding.left)
      .attr('y', padding.top)
      .attr('width', width - padding.left - padding.right)
      .attr('height', height - padding.top)
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const activeCliques = cliqueRegions.filter(r => mx >= r.x1 && mx <= r.x2 && my >= r.y1 && my <= r.y2);
        if (activeCliques.length === 0) {
          clearNodeHighlight();
          return;
        }
        highlightCliqueNodes(activeCliques);
      })
      .on('mouseleave', () => clearNodeHighlight());
  }

  // Edge stripes + labels
  const stripeW = 4;
  for (const edge of renderedEdges) {
    const edgeGroup = svg.append('g').attr('class', 'biofabric-edge-group');
    const rawXBase = padding.left + edge.x;
    const compactedXBase = rawXBase - getCompactionOffsetX(rawXBase) + contentOffsetX;
    const xBase = Math.max(desiredMinX, compactedXBase + getEdgeCliqueDelta(edge));
    const y1 = padding.top + edge.source.y;
    const y2 = padding.top + edge.target.y;
    if (edge.cliques.length <= 1) {
      edgeGroup.append('line')
        .attr('x1', xBase).attr('x2', xBase).attr('y1', y1).attr('y2', y2)
        .attr('stroke', edge.color).attr('stroke-width', 3).style('stroke-linecap', 'round');
    } else {
      edge.cliques.forEach((cid, i) => {
        const offset = (i - (edge.cliques.length - 1) / 2) * stripeW;
        edgeGroup.append('line')
          .attr('x1', xBase + offset).attr('x2', xBase + offset)
          .attr('y1', y1).attr('y2', y2)
          .attr('stroke', d3.schemeCategory10[cid % 10])
          .attr('stroke-width', stripeW).style('stroke-linecap', 'round');
      });
    }

    const edgeLabel = edgeGroup.append('text')
      .attr('x', xBase + (edge.cliques.length > 1 ? edge.cliques.length * 2 + 4 : 6))
      .attr('y', (y1 + y2) / 2).attr('dy', '0.35em')
      .text(edge.name).style('font-size', '12px').style('fill', '#333')
      .style('opacity', 0)
      .style('pointer-events', 'none');

    edgeGroup.selectAll('line')
      .style('cursor', 'pointer')
      .on('mouseenter', () => edgeLabel.style('opacity', 1))
      .on('mouseleave', () => edgeLabel.style('opacity', 0));
  }

  return coloredLinks;
}

function drawBiofabric(gfData, slData, containerId, options = {}) {
  const nodes = gfData.nodes || [];
  const edges = gfData.links || gfData.edges || [];
  const cliques = gfData.cliques || [];
  const hideSyntheticEdges = !!options.hideSyntheticEdges;
  const showAllCliqueMarkers = !!options.showAllCliqueMarkers;
  const lockNodeAxisSpacing = !!options.lockNodeAxisSpacing;
  const requestedNodeAxisSpacing = Number(options.nodeAxisSpacing);
  const requestedNodeLabelSize = Number(options.nodeLabelSize);
  const requestedCliqueBorderWidth = Number(options.cliqueBorderWidth);
  const requestedMarkerStrokeWidth = Number(options.markerStrokeWidth);
  const requestedEdgeStrokeWidth = Number(options.edgeStrokeWidth);
  const requestedNegativeHoleStrokeWidth = Number(options.negativeHoleStrokeWidth);
  const cliqueFillOpacity = Number.isFinite(Number(options.cliqueFillOpacity))
    ? Math.max(0.05, Math.min(1, Number(options.cliqueFillOpacity)))
    : 0.32;

  const nodesPositions = [];
  let orderedNodes = [];
  let orderedEdges = [];
  let counter = 0;

  const lines = slData.split('\n');

  for (const l of lines) {
    const t = l.trim();
    if (!t.startsWith('pos_n')) continue;
    const parts = t.split(/\s+/);
    const id = parseInt(parts[0].substring(5));
    const pos = parseInt(parts[1]);
    const n = nodes.find((node) => node.id === id);
    if (n) nodesPositions.push({ id: n.id, pos });
  }

  if (nodesPositions.length === 0) {
    document.getElementById(containerId).innerHTML =
      '<div class="placeholder">Nessun dato di posizione (pos_n) trovato nella soluzione.</div>';
    return null;
  }

  orderedNodes = nodesPositions.slice().sort((a, b) => a.pos - b.pos);

  const contiguousOnly = !!options.contiguousOnly;
  const effectiveCliques = contiguousOnly ? getContiguousCliques(cliques, orderedNodes) : cliques;

  const USE_CLIQUE_BOUNDARY_ORDERING = true;
  if (USE_CLIQUE_BOUNDARY_ORDERING && effectiveCliques.length > 0) {
    orderedEdges = orderEdgesForBiofabricV1({ ...gfData, cliques: effectiveCliques }, effectiveCliques);
  } else {
    for (const on of orderedNodes) {
      const cliqueOfNode = effectiveCliques.find((c) => c.nodes.includes(on.id));
      if (!cliqueOfNode) continue;
      for (const e of edges) {
        const isCliqueEdge = cliqueOfNode.nodes.includes(e.source) && cliqueOfNode.nodes.includes(e.target);
        if (isCliqueEdge && !orderedEdges.find((oe) => oe.id === e.id)) {
          orderedEdges.push({ id: e.id, pos: counter++, clique: cliqueOfNode.id });
        }
      }
    }
    for (const e of edges) {
      if (!orderedEdges.find((oe) => oe.id === e.id)) {
        orderedEdges.push({ id: e.id, pos: counter++, clique: 0 });
      }
    }
  }

  for (const oe of orderedEdges) {
    const thisEdge = edges.find((e) => e.id === oe.id);
    if (!thisEdge) {
      oe.cliques = [0];
      continue;
    }
    const ac = effectiveCliques
      .filter((c) => c.nodes.includes(thisEdge.source) && c.nodes.includes(thisEdge.target))
      .map((c) => c.id);
    oe.cliques = ac.length > 0 ? ac : [0];
  }

  const coloredLinks = orderedEdges
    .map((oe) => {
      const orig = edges.find((e) => e.id === oe.id);
      if (!orig) return null;
      return { id: oe.id, source: orig.source, target: orig.target, cliques: oe.cliques };
    })
    .filter(Boolean);

  const width = 1200;
  const height = 1000;
  const estimatedMarkerSpacing = 10;
  const estimatedMarkerStrokeWidth = 4;
  const estimatedLabelWidth = nodes.reduce((maxWidth, node) => {
    const label = `n${node.id ?? ''}`;
    return Math.max(maxWidth, Math.ceil(label.length * 8.5));
  }, 18);
  const estimatedMarkerLaneWidth = effectiveCliques.length > 0
    ? ((effectiveCliques.length - 1) * estimatedMarkerSpacing) + estimatedMarkerStrokeWidth
    : 0;
  const padding = {
    top: 40,
    left: Math.max(50, estimatedMarkerLaneWidth + estimatedLabelWidth + 34),
    right: 40,
    bottom: 30,
  };

  const svg = d3.create('svg')
    .attr('viewBox', [0, 0, width, height])
    .attr('width', width)
    .attr('height', height)
    .attr('style', 'max-width:100%; height:auto;');

  document.getElementById(containerId).innerHTML = '';
  d3.select('#' + containerId).append(() => svg.node());

  svg.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', width)
    .attr('height', height)
    .attr('fill', '#ffffff');

  const biofabricMode = getBiofabricMode();
  const useSquareCliqueBoxes = biofabricMode === 'clique-squares-only' || biofabricMode === 'clique-squares-negative-holes';
  const useNegativeCliqueHoleMode = biofabricMode === 'clique-negative-holes' || biofabricMode === 'clique-squares-negative-holes';
  const useSquareWithNegativeHolesMode = biofabricMode === 'clique-squares-negative-holes';
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

  // Lista base (immutata) degli archi per il BioFabric, ancora senza coordinate di layout.
  const originalBiofabricEdges = orderedEdges
    .map((oe) => {
      const link = edgeById.get(oe.id);
      if (!link) return null;
      return {
        id: oe.id,
        name: 'e' + oe.id,
        orderPos: oe.pos,
        sourceId: link.source,
        targetId: link.target,
        cliques: (oe.cliques || []).filter((c) => c > 0),
      };
    })
    .filter(Boolean);

  // Lista usata dal renderer: modificabile senza toccare la lista originale.
  let biofabricEdgesForRender = originalBiofabricEdges.map((edge) => ({
    ...edge,
    cliques: [...(edge.cliques || [])],
  }));

  if (useSquareCliqueBoxes) {
    // PLACEHOLDER: modifica qui la lista `biofabricEdgesForRender` per la modalità square.
    // Esempio:
    // biofabricEdgesForRender = biofabricEdgesForRender.filter((edge) => edge.cliques.length === 0);

    const cliqueById = new Map(effectiveCliques.map((clique) => [clique.id, clique]));
    const rankByNodeId = new Map(orderedNodes.map((node, idx) => [node.id, idx]));

    const originalCliqueEdges = originalBiofabricEdges.filter((edge) => (edge.cliques || []).length > 0);

    const syntheticCliqueEdges = [];

    const cliqueExtremesById = new Map();
    for (const clique of effectiveCliques) {
      const orderedCliqueNodes = [...new Set((clique.nodes || []).filter((nodeId) => rankByNodeId.has(nodeId)))]
        .sort((a, b) => rankByNodeId.get(a) - rankByNodeId.get(b));
      if (orderedCliqueNodes.length === 0) continue;
      cliqueExtremesById.set(clique.id, {
        firstNodeId: orderedCliqueNodes[0],
        lastNodeId: orderedCliqueNodes[orderedCliqueNodes.length - 1],
        orderedNodes: orderedCliqueNodes,
      });
    }

    const remainingSyntheticByClique = new Map();
    for (const clique of effectiveCliques) {
      const count = Math.max(1, (clique.nodes || []).length);
      remainingSyntheticByClique.set(clique.id, count);
    }

    // Raggruppa gli archi originali per insieme di clique condivise, così ogni overlap produce archi sintetici unici.
    const sharedGroupCount = new Map();
    for (const edge of originalCliqueEdges) {
      const activeCliques = [...new Set((edge.cliques || []).filter((cid) => cliqueById.has(cid)))].sort((a, b) => a - b);
      if (activeCliques.length <= 1) continue;
      const key = activeCliques.join('|');
      sharedGroupCount.set(key, (sharedGroupCount.get(key) || 0) + 1);
    }

    for (const [groupKey, groupCount] of sharedGroupCount.entries()) {
      const cliqueIds = groupKey.split('|').map(Number).filter((cid) => cliqueById.has(cid));
      if (cliqueIds.length <= 1) continue;
      const alloc = Math.max(0, Math.min(groupCount, ...cliqueIds.map((cid) => remainingSyntheticByClique.get(cid) || 0)));
      if (alloc <= 0) continue;

      const groupNodes = [];
      for (const cid of cliqueIds) {
        const ex = cliqueExtremesById.get(cid);
        if (!ex) continue;
        groupNodes.push(...ex.orderedNodes);
      }
      const orderedGroupNodes = [...new Set(groupNodes)].sort((a, b) => rankByNodeId.get(a) - rankByNodeId.get(b));
      if (orderedGroupNodes.length === 0) continue;
      const sourceId = orderedGroupNodes[0];
      const targetId = orderedGroupNodes[orderedGroupNodes.length - 1];

      for (let i = 0; i < alloc; i++) {
        syntheticCliqueEdges.push({
          id: `syn_shared_${groupKey.replace(/\|/g, '_')}_${i}`,
          name: `e_syn_shared_${groupKey.replace(/\|/g, '_')}_${i}`,
          orderPos: i,
          sourceId,
          targetId,
          cliques: [...cliqueIds],
          synthetic: true,
        });
      }

      for (const cid of cliqueIds) {
        remainingSyntheticByClique.set(cid, Math.max(0, (remainingSyntheticByClique.get(cid) || 0) - alloc));
      }
    }

    // Completa con archi esclusivi per rispettare il numero archi per ciascuna clique.
    for (const clique of effectiveCliques) {
      const ex = cliqueExtremesById.get(clique.id);
      if (!ex) continue;
      const left = Math.max(0, remainingSyntheticByClique.get(clique.id) || 0);
      for (let i = 0; i < left; i++) {
        syntheticCliqueEdges.push({
          id: `syn_c${clique.id}_${i}`,
          name: `e_syn_c${clique.id}_${i}`,
          orderPos: i,
          sourceId: ex.firstNodeId,
          targetId: ex.lastNodeId,
          cliques: [clique.id],
          synthetic: true,
        });
      }
    }

    const cliqueOrderById = new Map(effectiveCliques.map((clique, idx) => [clique.id, idx]));
    const cliqueSlotIndices = [];
    const cliqueSlotsById = new Map(effectiveCliques.map((clique) => [clique.id, []]));
    for (let idx = 0; idx < originalBiofabricEdges.length; idx++) {
      const baseEdge = originalBiofabricEdges[idx];
      if (!(baseEdge.cliques || []).length) continue;
      cliqueSlotIndices.push(idx);
      for (const cid of baseEdge.cliques || []) {
        if (cliqueSlotsById.has(cid)) cliqueSlotsById.get(cid).push(idx);
      }
    }

    // Clique compatte nel layout rettangolo: slot contigui senza buchi.
    const compactCliqueIntervalById = new Map();
    for (const clique of effectiveCliques) {
      const slots = (cliqueSlotsById.get(clique.id) || []).slice().sort((a, b) => a - b);
      if (slots.length === 0) continue;
      let isCompact = true;
      for (let i = 1; i < slots.length; i++) {
        if (slots[i] - slots[i - 1] !== 1) {
          isCompact = false;
          break;
        }
      }
      if (isCompact) {
        compactCliqueIntervalById.set(clique.id, { min: slots[0], max: slots[slots.length - 1] });
      }
    }

    function median(arr) {
      if (!arr || arr.length === 0) return null;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    }

    function desiredSlotForCliques(cliqueIds) {
      const ids = [...new Set((cliqueIds || []).filter((cid) => cliqueSlotsById.has(cid)))]
        .sort((a, b) => (cliqueOrderById.get(a) ?? Number.MAX_SAFE_INTEGER) - (cliqueOrderById.get(b) ?? Number.MAX_SAFE_INTEGER));
      if (ids.length === 0) return 0;
      if (ids.length === 1) {
        const slots = cliqueSlotsById.get(ids[0]) || [];
        return median(slots) ?? 0;
      }

      const boundaries = [];
      for (let i = 0; i < ids.length - 1; i++) {
        const leftSlots = cliqueSlotsById.get(ids[i]) || [];
        const rightSlots = cliqueSlotsById.get(ids[i + 1]) || [];
        if (!leftSlots.length || !rightSlots.length) continue;
        boundaries.push((leftSlots[leftSlots.length - 1] + rightSlots[0]) / 2);
      }
      if (boundaries.length > 0) {
        return boundaries.reduce((sum, v) => sum + v, 0) / boundaries.length;
      }

      const medians = ids
        .map((cid) => median(cliqueSlotsById.get(cid) || []))
        .filter((v) => Number.isFinite(v));
      if (!medians.length) return 0;
      return medians.reduce((sum, v) => sum + v, 0) / medians.length;
    }

    const syntheticSorted = [...syntheticCliqueEdges].sort((a, b) => {
      const aHasCompact = (a.cliques || []).some((cid) => compactCliqueIntervalById.has(cid)) ? 0 : 1;
      const bHasCompact = (b.cliques || []).some((cid) => compactCliqueIntervalById.has(cid)) ? 0 : 1;
      if (aHasCompact !== bHasCompact) return aHasCompact - bHasCompact;

      const aShared = (a.cliques || []).length > 1 ? 0 : 1;
      const bShared = (b.cliques || []).length > 1 ? 0 : 1;
      if (aShared !== bShared) return aShared - bShared;
      const aTarget = desiredSlotForCliques(a.cliques || []);
      const bTarget = desiredSlotForCliques(b.cliques || []);
      if (aTarget !== bTarget) return aTarget - bTarget;
      return String(a.id).localeCompare(String(b.id));
    });

    const availableSlots = new Set(cliqueSlotIndices);
    const syntheticBySlot = new Map();
    const unplacedSynthetic = [];

    for (const synEdge of syntheticSorted) {
      if (availableSlots.size === 0) {
        unplacedSynthetic.push(synEdge);
        continue;
      }
      const target = desiredSlotForCliques(synEdge.cliques || []);

      // Se coinvolge clique compatte, prova a restare nel loro intervallo originale.
      let candidateSlots = [...availableSlots];
      const compactIntervals = (synEdge.cliques || [])
        .map((cid) => compactCliqueIntervalById.get(cid))
        .filter(Boolean);
      if (compactIntervals.length > 0) {
        const intersectionMin = Math.max(...compactIntervals.map((it) => it.min));
        const intersectionMax = Math.min(...compactIntervals.map((it) => it.max));
        if (intersectionMin <= intersectionMax) {
          const insideIntersection = candidateSlots.filter((slot) => slot >= intersectionMin && slot <= intersectionMax);
          if (insideIntersection.length > 0) {
            candidateSlots = insideIntersection;
          }
        } else {
          const unionMin = Math.min(...compactIntervals.map((it) => it.min));
          const unionMax = Math.max(...compactIntervals.map((it) => it.max));
          const insideUnion = candidateSlots.filter((slot) => slot >= unionMin && slot <= unionMax);
          if (insideUnion.length > 0) {
            candidateSlots = insideUnion;
          }
        }
      }

      let bestSlot = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const slot of candidateSlots) {
        const dist = Math.abs(slot - target);
        if (dist < bestDist || (dist === bestDist && (bestSlot === null || slot < bestSlot))) {
          bestDist = dist;
          bestSlot = slot;
        }
      }
      syntheticBySlot.set(bestSlot, synEdge);
      availableSlots.delete(bestSlot);
    }

    // Mantiene l'ordinamento originale: sostituisce solo gli slot degli archi di clique.
    const rebuiltEdges = [];
    for (let idx = 0; idx < originalBiofabricEdges.length; idx++) {
      const baseEdge = originalBiofabricEdges[idx];
      const isCliqueEdge = (baseEdge.cliques || []).length > 0;
      if (!isCliqueEdge) {
        rebuiltEdges.push({ ...baseEdge, cliques: [...(baseEdge.cliques || [])] });
        continue;
      }
      const syntheticAtSlot = syntheticBySlot.get(idx);
      if (syntheticAtSlot) rebuiltEdges.push(syntheticAtSlot);
    }
    if (unplacedSynthetic.length > 0) rebuiltEdges.push(...unplacedSynthetic);

    biofabricEdgesForRender = rebuiltEdges;

    if (useSquareWithNegativeHolesMode) {
      biofabricEdgesForRender = buildNegativeCliqueHoleEdges(
        effectiveCliques,
        edges,
        orderedNodes,
        biofabricEdgesForRender,
      );
    }
  } else if (useNegativeCliqueHoleMode) {
    // Completa le clique con archi mancanti sintetici (negativi), utili per i buchi nel riempimento.
    biofabricEdgesForRender = buildNegativeCliqueHoleEdges(
      effectiveCliques,
      edges,
      orderedNodes,
      originalBiofabricEdges,
    );
  }

  // Layout calcolato dopo la personalizzazione della lista archi.
  // Riduce leggermente la distanza tra archi mantenendo proporzioni con la distanza assi nodi.
  const EDGE_SPACING_RATIO = 0.8;
  const MIN_NODE_AXIS_SPACING = 4;
  const MAX_NODE_AXIS_SPACING = 120;
  const rawVSpacing = (height - padding.top - padding.bottom) / Math.max(orderedNodes.length, 1);
  const layoutCarrierEdges = useSquareWithNegativeHolesMode
    ? biofabricEdgesForRender.filter((edge) => !edge.negative)
    : biofabricEdgesForRender;
  const rawHSpacing = (width - padding.left - padding.right) / Math.max(layoutCarrierEdges.length, 1);
  const autoAxisSpacing = Math.max(
    MIN_NODE_AXIS_SPACING,
    Math.min(rawVSpacing, rawHSpacing / EDGE_SPACING_RATIO)
  );
  const clampedRequestedAxisSpacing = Number.isFinite(requestedNodeAxisSpacing)
    ? Math.max(MIN_NODE_AXIS_SPACING, Math.min(MAX_NODE_AXIS_SPACING, requestedNodeAxisSpacing))
    : autoAxisSpacing;
  const vSpacing = lockNodeAxisSpacing ? clampedRequestedAxisSpacing : autoAxisSpacing;
  const hSpacing = Math.max(2, vSpacing * EDGE_SPACING_RATIO);
  const spacingScale = autoAxisSpacing > 0 ? (vSpacing / autoAxisSpacing) : 1;

  const nodesLayout = orderedNodes.map((on) => ({
    id: on.id,
    name: 'n' + on.id,
    y: on.pos * vSpacing,
  }));
  const nodeById = new Map(nodesLayout.map((node) => [node.id, node]));
  const nodeRankById = new Map(nodesLayout.map((node, idx) => [node.id, idx]));
  const isCliqueContiguousById = new Map();
  for (const clique of effectiveCliques) {
    const ranks = (clique.nodes || [])
      .map((nodeId) => nodeRankById.get(nodeId))
      .filter((rank) => Number.isFinite(rank))
      .sort((a, b) => a - b);
    let isContiguous = ranks.length === (clique.nodes || []).length;
    if (isContiguous && ranks.length > 1) {
      for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] - ranks[i - 1] !== 1) {
          isContiguous = false;
          break;
        }
      }
    }
    isCliqueContiguousById.set(clique.id, isContiguous);
  }

  // Applica automaticamente coordinate e riferimenti nodo alla lista finale.
  const mapEdgeWithLayout = (edge, x, orderPos) => {
      const sourceId = edge.sourceId ?? (typeof edge.source === 'object' ? edge.source?.id : edge.source);
      const targetId = edge.targetId ?? (typeof edge.target === 'object' ? edge.target?.id : edge.target);
      const source = nodeById.get(sourceId);
      const target = nodeById.get(targetId);
      if (!source || !target) return null;
      return {
        ...edge,
        orderPos,
        source,
        target,
        x,
        cliques: [...(edge.cliques || [])],
      };
  };

  if (useSquareWithNegativeHolesMode) {
    const nonNegativeEdges = biofabricEdgesForRender.filter((edge) => !edge.negative);
    const negativeEdges = biofabricEdgesForRender.filter((edge) => !!edge.negative);

    const laidOutEdges = [];
    const syntheticColumnsByClique = new Map();
    const anyColumnsByClique = new Map();

    for (let i = 0; i < nonNegativeEdges.length; i++) {
      const edge = nonNegativeEdges[i];
      const x = (i + 0.5) * hSpacing;
      const mapped = mapEdgeWithLayout(edge, x, i);
      if (!mapped) continue;
      laidOutEdges.push(mapped);

      const cliqueIds = (mapped.cliques || []).filter((cid) => cid > 0);
      for (const cid of cliqueIds) {
        if (!anyColumnsByClique.has(cid)) anyColumnsByClique.set(cid, []);
        anyColumnsByClique.get(cid).push(x);
        if (mapped.synthetic) {
          if (!syntheticColumnsByClique.has(cid)) syntheticColumnsByClique.set(cid, []);
          syntheticColumnsByClique.get(cid).push(x);
        }
      }
    }

    const holeCursorByClique = new Map();
    for (let i = 0; i < negativeEdges.length; i++) {
      const edge = negativeEdges[i];
      const cliqueIds = (edge.cliques || []).filter((cid) => cid > 0);
      let selectedX = null;

      for (const cid of cliqueIds) {
        const cols = syntheticColumnsByClique.get(cid) || [];
        if (!cols.length) continue;
        const cursor = holeCursorByClique.get(cid) || 0;
        selectedX = cols[cursor % cols.length];
        holeCursorByClique.set(cid, cursor + 1);
        break;
      }

      if (selectedX === null) {
        for (const cid of cliqueIds) {
          const cols = anyColumnsByClique.get(cid) || [];
          if (!cols.length) continue;
          const cursor = holeCursorByClique.get(cid) || 0;
          selectedX = cols[cursor % cols.length];
          holeCursorByClique.set(cid, cursor + 1);
          break;
        }
      }

      if (selectedX === null) selectedX = 0.5 * hSpacing;
      const mapped = mapEdgeWithLayout(edge, selectedX, nonNegativeEdges.length + i);
      if (mapped) laidOutEdges.push(mapped);
    }

    biofabricEdgesForRender = laidOutEdges;
  } else {
    biofabricEdgesForRender = biofabricEdgesForRender
      .map((edge, index) => mapEdgeWithLayout(edge, (index + 0.5) * hSpacing, index))
      .filter(Boolean);
  }

  const negativeHolesByClique = new Map();
  if (useNegativeCliqueHoleMode) {
    for (const edge of biofabricEdgesForRender) {
      if (!edge.negative) continue;
      const xAbs = padding.left + edge.x;
      const yA = padding.top + edge.source.y;
      const yB = padding.top + edge.target.y;
      const yTop = Math.min(yA, yB);
      const yBottom = Math.max(yA, yB);
      for (const cid of edge.cliques || []) {
        if (cid <= 0) continue;
        if (!negativeHolesByClique.has(cid)) negativeHolesByClique.set(cid, []);
        negativeHolesByClique.get(cid).push({
          id: edge.id,
          x: xAbs,
          yTop,
          yBottom,
        });
      }
    }
  }

  svg.append('g').selectAll('line').data(nodesLayout).enter().append('line')
    .attr('x1', padding.left)
    .attr('x2', width - padding.right)
    .attr('y1', (d) => padding.top + d.y)
    .attr('y2', (d) => padding.top + d.y)
    .attr('stroke', '#dbdbdb')
    .attr('stroke-width', 1.2);

  const autoNodeLabelSize = Math.max(12, Math.min(18, vSpacing * 0.52));
  const nodeLabelSize = Number.isFinite(requestedNodeLabelSize)
    ? Math.max(8, Math.min(36, requestedNodeLabelSize))
    : autoNodeLabelSize;
  const nodeLabelAnchorX = padding.left - 12;
  const nodeLabels = svg.append('g').selectAll('text').data(nodesLayout).enter().append('text')
    .attr('x', nodeLabelAnchorX)
    .attr('y', (d) => padding.top + d.y)
    .attr('dy', '0.33em')
    .text((d) => d.name)
    .style('text-anchor', 'end')
    .style('font-size', `${nodeLabelSize}px`)
    .style('fill', '#111');

  const nodeMarkersGroup = svg.append('g').attr('class', 'node-markers-group');
  const nodeLabelMaxWidth = nodeLabels.nodes().reduce((maxW, el) => {
    const w = typeof el.getComputedTextLength === 'function' ? el.getComputedTextLength() : 0;
    return Math.max(maxW, w || 0);
  }, 0);
  const markerRightX = nodeLabelAnchorX - Math.max(8, nodeLabelMaxWidth + 10);
  const markerHalfHeight = Math.max(vSpacing * 0.34, 4);
  const markerSpacing = Math.max(5, 8 * spacingScale);
  const markerMergeGap = Math.max(vSpacing * 0.85, 8);
  const autoMarkerStrokeWidth = Math.max(1.8, 3 * spacingScale);
  const markerStrokeWidth = Number.isFinite(requestedMarkerStrokeWidth)
    ? Math.max(0.5, Math.min(12, requestedMarkerStrokeWidth))
    : autoMarkerStrokeWidth;
  const markerPixelOffset = markerStrokeWidth % 2 === 1 ? 0.5 : 0;
  const cliqueBorderWidth = Number.isFinite(requestedCliqueBorderWidth)
    ? Math.max(0.5, Math.min(12, requestedCliqueBorderWidth))
    : 1.4;
  let defaultMarkerCliques = [];

  const cliqueRegionById = new Map();

  function getMarkerCliqueOrder(activeCliques) {
    return [...activeCliques].sort((a, b) => {
      const regionA = cliqueRegionById.get(a.id);
      const regionB = cliqueRegionById.get(b.id);
      const ax = regionA ? regionA.boxX : Number.POSITIVE_INFINITY;
      const bx = regionB ? regionB.boxX : Number.POSITIVE_INFINITY;
      if (ax !== bx) return bx - ax;
      return b.id - a.id;
    });
  }

  function updateNodeMarkers(activeCliques) {
    const orderedCliques = getMarkerCliqueOrder(activeCliques);
    const laneByCliqueId = new Map(orderedCliques.map((c, idx) => [c.id, idx]));
    const laneCount = Math.max(orderedCliques.length, 1);
    const rawMarkers = [];

    for (const node of nodesLayout) {
      for (const clique of orderedCliques) {
        if (!clique.nodeSet.has(node.id)) continue;
        const lane = laneByCliqueId.get(clique.id) || 0;
        const rawX = markerRightX - (laneCount - 1 - lane) * markerSpacing;
        const x = Math.round(rawX) + markerPixelOffset;
        rawMarkers.push({
          y: padding.top + node.y,
          color: clique.color,
          lane,
          x,
        });
      }
    }

    const safeMinMarkerX = Math.ceil((markerStrokeWidth / 2) + 2);
    const minMarkerX = rawMarkers.length ? d3.min(rawMarkers, (marker) => marker.x) : null;
    const markerShiftX = Number.isFinite(minMarkerX) && minMarkerX < safeMinMarkerX
      ? (safeMinMarkerX - minMarkerX)
      : 0;
    if (markerShiftX > 0) {
      rawMarkers.forEach((marker) => {
        marker.x += markerShiftX;
      });
    }

    const groupedByLane = new Map();
    for (const marker of rawMarkers) {
      const laneKey = `${marker.lane}-${marker.color}`;
      if (!groupedByLane.has(laneKey)) groupedByLane.set(laneKey, []);
      groupedByLane.get(laneKey).push(marker);
    }

    const markerData = [];
    for (const [laneKey, entries] of groupedByLane.entries()) {
      entries.sort((a, b) => a.y - b.y);
      let segStart = entries[0].y - markerHalfHeight;
      let segEnd = entries[0].y + markerHalfHeight;
      let segX = entries[0].x;
      let segColor = entries[0].color;

      for (let i = 1; i < entries.length; i++) {
        const nextStart = entries[i].y - markerHalfHeight;
        const nextEnd = entries[i].y + markerHalfHeight;
        if (nextStart <= segEnd + markerMergeGap) {
          segEnd = Math.max(segEnd, nextEnd);
        } else {
          markerData.push({
            key: `${laneKey}-${segStart}-${segEnd}`,
            x: segX,
            y1: segStart,
            y2: segEnd,
            color: segColor,
          });
          segStart = nextStart;
          segEnd = nextEnd;
          segX = entries[i].x;
          segColor = entries[i].color;
        }
      }

      markerData.push({
        key: `${laneKey}-${segStart}-${segEnd}`,
        x: segX,
        y1: segStart,
        y2: segEnd,
        color: segColor,
      });
    }

    nodeMarkersGroup
      .selectAll('line')
      .data(markerData, (d) => d.key)
      .join(
        (enter) => enter.append('line')
          .attr('x1', (d) => d.x)
          .attr('x2', (d) => d.x)
          .attr('y1', (d) => d.y1)
          .attr('y2', (d) => d.y2)
          .attr('stroke', (d) => d.color)
          .attr('stroke-width', markerStrokeWidth)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('stroke-linecap', 'round')
          .attr('opacity', 0.96),
        (update) => update
          .attr('x1', (d) => d.x)
          .attr('x2', (d) => d.x)
          .attr('y1', (d) => d.y1)
          .attr('y2', (d) => d.y2)
          .attr('stroke', (d) => d.color)
          .attr('stroke-width', markerStrokeWidth)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('stroke-linecap', 'round')
          .attr('opacity', 0.96),
        (exit) => exit.remove(),
      );
  }

  function clearCliqueNodeHover() {
    nodeLabels
      .style('fill', '#111')
      .style('font-weight', '400');
    updateNodeMarkers(showAllCliqueMarkers ? defaultMarkerCliques : []);
  }

  function applyCliqueNodeHover(activeCliques) {
    const orderedCliques = getMarkerCliqueOrder(activeCliques);
    const activeCliqueByNode = new Map();
    const activeCliqueCountByNode = new Map();
    for (const clique of orderedCliques) {
      for (const nodeId of clique.nodeSet) {
        activeCliqueCountByNode.set(nodeId, (activeCliqueCountByNode.get(nodeId) || 0) + 1);
        if (!activeCliqueByNode.has(nodeId)) {
          activeCliqueByNode.set(nodeId, clique.color);
        }
      }
    }

    nodeLabels
      .style('fill', (d) => {
        if (!activeCliqueByNode.has(d.id)) return '#111';
        const hitCount = activeCliqueCountByNode.get(d.id) || 0;
        if (hitCount > 1) return '#111';
        return activeCliqueByNode.get(d.id);
      })
      .style('font-weight', (d) => (activeCliqueByNode.has(d.id) ? '700' : '400'));

    updateNodeMarkers(showAllCliqueMarkers ? defaultMarkerCliques : orderedCliques);
  }

  const cliqueGroup = svg.append('g').attr('class', 'biofabric-clique-boxes');
  const cliqueMaskDefs = useNegativeCliqueHoleMode ? svg.append('defs') : null;
  const hPad = Math.max(2, hSpacing * 0.35);
  const vPad = Math.max(1.5, vSpacing * 0.3);
  const cliqueTopInset = Math.max(6, Math.min(18, vPad));
  const gridMinX = padding.left;
  const gridMaxX = width - padding.right;
  const gridMinY = Math.max(2, padding.top - cliqueTopInset);
  const gridMaxY = height - padding.bottom;
  const cliqueRegions = [];

  const markerSize = Math.max(6, Math.min(11, vSpacing * 0.42));
  const autoEdgeStroke = Math.max(2.1, Math.min(3.8, markerSize * 0.28));
  const edgeStroke = Number.isFinite(requestedEdgeStrokeWidth)
    ? Math.max(0.5, Math.min(16, requestedEdgeStrokeWidth))
    : autoEdgeStroke;
  const autoNegativeHoleStrokeWidth = Math.max(3, Math.min(14, hSpacing * 0.58));
  const negativeHoleStrokeWidth = Number.isFinite(requestedNegativeHoleStrokeWidth)
    ? Math.max(1, Math.min(24, requestedNegativeHoleStrokeWidth))
    : autoNegativeHoleStrokeWidth;

  for (const clique of effectiveCliques) {
    const cliqueColor = d3.schemeCategory10[clique.id % 10];
    const cliqueNodeSet = new Set(clique.nodes || []);
    const cliqueEdgeXs = biofabricEdgesForRender
      .filter((edge) => edge.cliques.includes(clique.id) && !edge.negative)
      .map((edge) => padding.left + edge.x);
    if (cliqueEdgeXs.length === 0) continue;

    const cliqueNodeYs = (clique.nodes || [])
      .map((nodeId) => {
        const node = nodesLayout.find((n) => n.id === nodeId);
        return node ? padding.top + node.y : null;
      })
      .filter((y) => y !== null);
    if (cliqueNodeYs.length === 0) continue;

    // Calcola altezza una volta sulla base dei nodi (con padding)
    const minNodeY = Math.min(...cliqueNodeYs);
    const maxNodeY = Math.max(...cliqueNodeYs);

    // Calcola posizione X basata sugli archi effettivamente visualizzati
    const x1 = Math.min(...cliqueEdgeXs) - hPad;
    const x2 = Math.max(...cliqueEdgeXs) + hPad;
    let y1 = minNodeY - vPad;
    let y2 = maxNodeY + vPad;

    // Applica clamping ai grid bounds
    let x1Clamped = Math.max(gridMinX, x1);
    let x2Clamped = Math.min(gridMaxX, x2);
    y1 = Math.max(gridMinY, y1);
    y2 = Math.min(gridMaxY, y2);

    let boxX;
    let boxY;
    let boxW;
    let boxH;

    // Usa la stessa logica per entrambi i modi
    boxX = x1Clamped;
    boxY = y1;
    boxW = Math.max(2, x2Clamped - x1Clamped);
    boxH = Math.max(2, y2 - y1);

    if (boxX < gridMinX) boxX = gridMinX;
    if (boxX + boxW > gridMaxX) boxX = gridMaxX - boxW;
    if (boxY < gridMinY) boxY = gridMinY;
    if (boxY + boxH > gridMaxY) boxY = gridMaxY - boxH;

    cliqueRegions.push({
      id: clique.id,
      color: cliqueColor,
      nodeSet: cliqueNodeSet,
      isContiguous: !!isCliqueContiguousById.get(clique.id),
      boxX,
      boxY,
      boxW,
      boxH,
      edgeXMin: Math.min(...cliqueEdgeXs),
      edgeXMax: Math.max(...cliqueEdgeXs),
    });
  }

  const laidOutCliqueRegions = [...cliqueRegions].sort((a, b) => a.boxX - b.boxX);

  if (laidOutCliqueRegions.length > 0) {
    const maxX2 = d3.max(laidOutCliqueRegions, (r) => r.boxX + r.boxW);
    if (Number.isFinite(maxX2) && maxX2 > gridMaxX) {
      const overflow = maxX2 - gridMaxX;
      laidOutCliqueRegions.forEach((r) => { r.boxX -= overflow; });
    }

    const minX1 = d3.min(laidOutCliqueRegions, (r) => r.boxX);
    if (Number.isFinite(minX1) && minX1 < gridMinX) {
      const underflow = gridMinX - minX1;
      laidOutCliqueRegions.forEach((r) => { r.boxX += underflow; });
    }
  }

  for (const region of laidOutCliqueRegions) {
    cliqueRegionById.set(region.id, region);
    const regionGroup = cliqueGroup.append('g').attr('class', 'biofabric-clique-region');
    const regionFillGroup = regionGroup.append('g').attr('class', 'biofabric-clique-fill');

    if (useNegativeCliqueHoleMode && cliqueMaskDefs) {
      const rawHoles = (negativeHolesByClique.get(region.id) || []).filter((hole) => {
        return hole.x >= region.boxX && hole.x <= (region.boxX + region.boxW);
      });

      if (rawHoles.length > 0) {
        const maskId = `clique-hole-mask-${region.id}`;
        const mask = cliqueMaskDefs.append('mask')
          .attr('id', maskId)
          .attr('maskUnits', 'userSpaceOnUse')
          .attr('x', region.boxX)
          .attr('y', region.boxY)
          .attr('width', region.boxW)
          .attr('height', region.boxH);

        mask.append('rect')
          .attr('x', region.boxX)
          .attr('y', region.boxY)
          .attr('width', region.boxW)
          .attr('height', region.boxH)
          .attr('fill', '#fff');

        for (const hole of rawHoles) {
          const yTop = Math.max(region.boxY, hole.yTop);
          const yBottom = Math.min(region.boxY + region.boxH, hole.yBottom);
          if (yBottom - yTop <= 0.5) continue;

          mask.append('line')
            .attr('x1', hole.x)
            .attr('x2', hole.x)
            .attr('y1', yTop)
            .attr('y2', yBottom)
            .attr('stroke', '#000')
            .attr('stroke-width', negativeHoleStrokeWidth)
            .attr('stroke-linecap', 'round');
        }

        regionFillGroup.attr('mask', `url(#${maskId})`);
      }
    }

    if (useSquareCliqueBoxes && region.isContiguous) {
      regionFillGroup.append('rect')
        .attr('x', region.boxX + 1)
        .attr('y', region.boxY + 1)
        .attr('width', Math.max(2, region.boxW - 2))
        .attr('height', Math.max(2, region.boxH - 2))
        .attr('fill', region.color)
        .attr('fill-opacity', cliqueFillOpacity)
        .attr('stroke', 'none')
        .style('pointer-events', 'none');

      regionGroup.append('rect')
        .attr('x', region.boxX)
        .attr('y', region.boxY)
        .attr('width', region.boxW)
        .attr('height', region.boxH)
        .attr('fill', 'none')
        .attr('stroke', region.color)
        .attr('stroke-width', cliqueBorderWidth)
        .attr('stroke-dasharray', null)
        .attr('rx', 4)
        .style('pointer-events', 'none');
    } else if (region.isContiguous) {
      // Clique contigua: rendering pieno standard.
      regionFillGroup.append('rect')
        .attr('x', region.boxX + 1)
        .attr('y', region.boxY + 1)
        .attr('width', Math.max(2, region.boxW - 2))
        .attr('height', Math.max(2, region.boxH - 2))
        .attr('fill', region.color)
        .attr('fill-opacity', cliqueFillOpacity)
        .attr('stroke', 'none')
        .style('pointer-events', 'none');

      regionGroup.append('rect')
        .attr('x', region.boxX)
        .attr('y', region.boxY)
        .attr('width', region.boxW)
        .attr('height', region.boxH)
        .attr('fill', 'none')
        .attr('stroke', region.color)
        .attr('stroke-width', cliqueBorderWidth)
        .attr('stroke-dasharray', null)
        .attr('rx', 4)
        .style('pointer-events', 'none');
    } else {
      // Clique non contigua: riempi solo le fasce dei nodi della clique.
      const top = region.boxY;
      const bottom = region.boxY + region.boxH;
      const rows = nodesLayout
        .map((node) => ({
          id: node.id,
          yAbs: padding.top + node.y,
          inClique: region.nodeSet.has(node.id),
        }))
        .filter((row) => row.yAbs >= top && row.yAbs <= bottom)
        .sort((a, b) => a.yAbs - b.yAbs);

      if (rows.length === 0) {
        regionFillGroup.append('rect')
          .attr('x', region.boxX + 1)
          .attr('y', region.boxY + 1)
          .attr('width', Math.max(2, region.boxW - 2))
          .attr('height', Math.max(2, region.boxH - 2))
          .attr('fill', region.color)
          .attr('fill-opacity', cliqueFillOpacity)
          .attr('stroke', 'none')
          .style('pointer-events', 'none');

        regionGroup.append('rect')
          .attr('x', region.boxX)
          .attr('y', region.boxY)
          .attr('width', region.boxW)
          .attr('height', region.boxH)
          .attr('fill', 'none')
          .attr('stroke', region.color)
          .attr('stroke-width', cliqueBorderWidth)
          .attr('stroke-dasharray', null)
          .attr('rx', 4)
          .style('pointer-events', 'none');
      } else {
        const bands = [];
        for (let i = 0; i < rows.length; i++) {
          const y1 = i === 0 ? top : (rows[i - 1].yAbs + rows[i].yAbs) / 2;
          const y2 = i === rows.length - 1 ? bottom : (rows[i].yAbs + rows[i + 1].yAbs) / 2;
          bands.push({ y1, y2, inClique: rows[i].inClique });
        }

        for (const band of bands) {
          if (!band.inClique) continue;
          const yStart = Math.max(top, band.y1);
          const yEnd = Math.min(bottom, band.y2);
          regionFillGroup.append('rect')
            .attr('x', region.boxX + 1)
            .attr('y', yStart)
            .attr('width', Math.max(2, region.boxW - 2))
            .attr('height', Math.max(0, yEnd - yStart))
            .attr('fill', region.color)
            .attr('fill-opacity', cliqueFillOpacity)
            .attr('stroke', 'none')
            .attr('shape-rendering', 'crispEdges')
            .style('pointer-events', 'none');
        }

        const cornerRadius = Math.max(2, 4 * spacingScale);
        const leftX = region.boxX;
        const rightX = region.boxX + region.boxW;

        // Segmenti orizzontali accorciati per lasciare spazio agli angoli curvi.
        regionGroup.append('line')
          .attr('x1', leftX + cornerRadius)
          .attr('x2', rightX - cornerRadius)
          .attr('y1', top)
          .attr('y2', top)
          .attr('stroke', region.color)
          .attr('stroke-width', cliqueBorderWidth)
          .style('pointer-events', 'none');

        regionGroup.append('line')
          .attr('x1', leftX + cornerRadius)
          .attr('x2', rightX - cornerRadius)
          .attr('y1', bottom)
          .attr('y2', bottom)
          .attr('stroke', region.color)
          .attr('stroke-width', cliqueBorderWidth)
          .style('pointer-events', 'none');

        // Angoli arrotondati espliciti.
        const cornerPaths = [
          `M ${leftX + cornerRadius} ${top} Q ${leftX} ${top} ${leftX} ${top + cornerRadius}`,
          `M ${rightX - cornerRadius} ${top} Q ${rightX} ${top} ${rightX} ${top + cornerRadius}`,
          `M ${leftX} ${bottom - cornerRadius} Q ${leftX} ${bottom} ${leftX + cornerRadius} ${bottom}`,
          `M ${rightX} ${bottom - cornerRadius} Q ${rightX} ${bottom} ${rightX - cornerRadius} ${bottom}`,
        ];
        for (const d of cornerPaths) {
          regionGroup.append('path')
            .attr('d', d)
            .attr('fill', 'none')
            .attr('stroke', region.color)
            .attr('stroke-width', cliqueBorderWidth)
            .style('pointer-events', 'none');
        }

        // Bordi verticali: pieni sulle fasce in clique, tratteggiati sulle altre,
        // con trimming vicino agli angoli per preservare la curvatura.
        for (const band of bands) {
          const dash = band.inClique ? null : '5,3';
          let yStart = Math.max(top, band.y1);
          let yEnd = Math.min(bottom, band.y2);
          if (yStart <= top) yStart = Math.min(yEnd, top + cornerRadius);
          if (yEnd >= bottom) yEnd = Math.max(yStart, bottom - cornerRadius);
          if (yEnd - yStart <= 0.2) continue;

          regionGroup.append('line')
            .attr('x1', leftX)
            .attr('x2', leftX)
            .attr('y1', yStart)
            .attr('y2', yEnd)
            .attr('stroke', region.color)
            .attr('stroke-width', cliqueBorderWidth)
            .attr('stroke-dasharray', dash)
            .style('pointer-events', 'none');

          regionGroup.append('line')
            .attr('x1', rightX)
            .attr('x2', rightX)
            .attr('y1', yStart)
            .attr('y2', yEnd)
            .attr('stroke', region.color)
            .attr('stroke-width', cliqueBorderWidth)
            .attr('stroke-dasharray', dash)
            .style('pointer-events', 'none');
        }
      }
    }

    regionGroup.append('rect')
      .attr('x', region.boxX)
      .attr('y', region.boxY)
      .attr('width', region.boxW)
      .attr('height', region.boxH)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .style('pointer-events', 'none');
  }

  defaultMarkerCliques = laidOutCliqueRegions.map((region) => ({
    id: region.id,
    color: region.color,
    nodeSet: region.nodeSet,
  }));
  updateNodeMarkers(showAllCliqueMarkers ? defaultMarkerCliques : []);

  if (laidOutCliqueRegions.length > 0) {
    svg.append('rect')
      .attr('x', gridMinX)
      .attr('y', gridMinY)
      .attr('width', gridMaxX - gridMinX)
      .attr('height', gridMaxY - gridMinY)
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .style('cursor', 'pointer')
      .on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const activeCliques = laidOutCliqueRegions.filter((region) => (
          mx >= region.boxX
          && mx <= region.boxX + region.boxW
          && my >= region.boxY
          && my <= region.boxY + region.boxH
        ));
        if (activeCliques.length === 0) {
          clearCliqueNodeHover();
          return;
        }
        applyCliqueNodeHover(activeCliques);
      })
      .on('mouseleave', () => clearCliqueNodeHover());
  }

  const edgeGroup = svg.append('g').attr('class', 'biofabric-edges');

  for (const edge of biofabricEdgesForRender) {
    const gx = edgeGroup.append('g').attr('class', 'biofabric-edge-group');
    const hideThisNegativeEdge = !!edge.negative;
    const hideThisSyntheticEdge = (hideSyntheticEdges && !!edge.synthetic) || hideThisNegativeEdge;
    const edgeOpacity = hideThisSyntheticEdge ? 0 : 1;

    const x = padding.left + edge.x;
    const yA = padding.top + edge.source.y;
    const yB = padding.top + edge.target.y;
    const yTop = Math.min(yA, yB);
    const yBottom = Math.max(yA, yB);

    const vertical = gx.append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', yTop)
      .attr('y2', yBottom)
      .attr('stroke', '#202020')
      .attr('stroke-width', edgeStroke)
      .style('stroke-linecap', 'round')
      .attr('opacity', edgeOpacity);

    const edgeLabel = gx.append('text')
      .attr('x', x)
      .attr('y', Math.max(10, yTop - 8))
      .attr('dy', '-0.25em')
      .style('text-anchor', 'middle')
      .text(edge.name)
      .style('font-size', '12px')
      .style('fill', '#222')
      .style('opacity', 0)
      .style('pointer-events', 'none');

    const hoverTargets = gx.selectAll('line')
      .style('cursor', hideThisSyntheticEdge ? 'default' : 'pointer')
      .style('pointer-events', hideThisSyntheticEdge ? 'none' : 'all');

    if (!hideThisSyntheticEdge) {
      hoverTargets
        .on('mouseenter', () => {
          vertical.attr('stroke-width', edgeStroke + 0.4);
          edgeLabel.style('opacity', 1);
        })
        .on('mouseleave', () => {
          vertical.attr('stroke-width', edgeStroke);
          edgeLabel.style('opacity', 0);
        });
    }
  }

  return coloredLinks;
}

// -€-€ Force-directed graph renderer (self-contained) -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function renderGraph(graphData, coloredLinks, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const width = Math.max(760, (container.clientWidth || 980) - 32);
  const height = Math.max(620, Math.round(width * 0.68));
  const svg = d3.select('#' + containerId).append('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', [0, 0, width, height])
    .attr('style', 'width:100%; height:auto; border:1px solid #eee; border-radius:6px; background:#fff;');

  const graphRoot = svg.append('g').attr('class', 'graph-root');

  const zoom = d3.zoom()
    .scaleExtent([0.35, 4])
    .on('zoom', (event) => {
      graphRoot.attr('transform', event.transform);
    });
  svg.call(zoom);

  // Work on copies of the node objects to avoid tainting graphData
  const nodesCopy = graphData.nodes.map(n => ({ ...n }));

  // Expand stripes
  const edgeStrokeWidth = getBiofabricEdgeStrokeWidth();
  const stripeW = Math.max(0.5, edgeStrokeWidth);
  const stripeData = [];
  coloredLinks.forEach(link => {
    const cliques = (link.cliques && link.cliques.length > 0) ? link.cliques : [0];
    cliques.forEach((cid, i) => stripeData.push({ link, cid, i, total: cliques.length }));
  });

  // Simulation with copied node objects
  const simLinks = coloredLinks.map(l => ({ ...l, source: l.source, target: l.target }));
  const simulation = d3.forceSimulation(nodesCopy)
    .force('link', d3.forceLink(simLinks).id(d => d.id).distance(110))
    .force('charge', d3.forceManyBody().strength(-180))
    .force('center', d3.forceCenter(width / 2, height / 2));

  const stripeLines = graphRoot.append('g').selectAll('line').data(stripeData).enter().append('line')
    .attr('stroke-width', d => d.total > 1 ? stripeW : edgeStrokeWidth)
    .attr('stroke', d => d.cid > 0 ? d3.schemeCategory10[d.cid % 10] : '#999')
    .style('cursor', 'pointer');

  const edgeLabels = graphRoot.append('g').selectAll('text')
    .data(coloredLinks).enter().append('text')
    .attr('font-size', 10).attr('fill', '#778').attr('dy', -4)
    .style('opacity', 0)
    .style('pointer-events', 'none')
    .text(d => d.id);

  stripeLines
    .on('mouseenter', (event, d) => {
      edgeLabels.filter(e => e.id === d.link.id).style('opacity', 1);
    })
    .on('mouseleave', (event, d) => {
      edgeLabels.filter(e => e.id === d.link.id).style('opacity', 0);
    });

  const nodeCircles = graphRoot.append('g').selectAll('circle').data(nodesCopy).enter().append('circle')
    .attr('r', 9).attr('fill', '#999').attr('stroke', '#fff').attr('stroke-width', 1.5)
    .call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

  const nodeLabels = graphRoot.append('g').selectAll('text').data(nodesCopy).enter().append('text')
    .attr('font-size', 12).attr('fill', '#222').attr('text-anchor', 'middle').attr('dy', -14)
    .text(d => d.id);

  nodeCircles.append('title').text(d => 'n' + d.id);

  function fitGraphToViewport(animated = true) {
    let bounds = null;
    try {
      bounds = graphRoot.node()?.getBBox?.() || null;
    } catch (_) {
      bounds = null;
    }

    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
      const xs = nodesCopy.map((n) => n.x).filter(Number.isFinite);
      const ys = nodesCopy.map((n) => n.y).filter(Number.isFinite);
      if (!xs.length || !ys.length) return;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      bounds = {
        x: minX,
        y: minY,
        width: Math.max(maxX - minX, 1),
        height: Math.max(maxY - minY, 1),
      };
    }

    const pad = 16;
    const graphW = Math.max(bounds.width, 1);
    const graphH = Math.max(bounds.height, 1);
    const scale = Math.min((width - pad * 2) / graphW, (height - pad * 2) / graphH, 2.2);
    const centerX = bounds.x + (bounds.width / 2);
    const centerY = bounds.y + (bounds.height / 2);
    const tx = width / 2 - scale * centerX;
    const ty = height / 2 - scale * centerY;
    const target = d3.zoomIdentity.translate(tx, ty).scale(scale);

    if (animated) {
      svg.transition().duration(420).call(zoom.transform, target);
    } else {
      svg.call(zoom.transform, target);
    }
  }

  simulation.on('tick', () => {
    const linkMap = {};
    simLinks.forEach(l => { linkMap[l.id] = l; });

    stripeLines
      .attr('x1', d => { const l = linkMap[d.link.id]; const s = l.source, t = l.target; const ln = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1; const nx = -(t.y - s.y) / ln; return s.x + nx * (d.i - (d.total - 1) / 2) * stripeW; })
      .attr('y1', d => { const l = linkMap[d.link.id]; const s = l.source, t = l.target; const ln = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1; const ny = (t.x - s.x) / ln; return s.y + ny * (d.i - (d.total - 1) / 2) * stripeW; })
      .attr('x2', d => { const l = linkMap[d.link.id]; const s = l.source, t = l.target; const ln = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1; const nx = -(t.y - s.y) / ln; return t.x + nx * (d.i - (d.total - 1) / 2) * stripeW; })
      .attr('y2', d => { const l = linkMap[d.link.id]; const s = l.source, t = l.target; const ln = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1; const ny = (t.x - s.x) / ln; return t.y + ny * (d.i - (d.total - 1) / 2) * stripeW; });

    nodeCircles.attr('cx', d => d.x).attr('cy', d => d.y);
    nodeLabels.attr('x', d => d.x).attr('y', d => d.y);

    edgeLabels
      .attr('x', d => { const l = linkMap[d.id]; if (!l) return 0; return (l.source.x + l.target.x) / 2; })
      .attr('y', d => { const l = linkMap[d.id]; if (!l) return 0; return (l.source.y + l.target.y) / 2; });
  });

  simulation.on('end', () => {
    fitGraphToViewport(true);
  });

  // Fallback fit in case simulation keeps tiny residual movement for long time.
  setTimeout(() => fitGraphToViewport(false), 1100);
}

