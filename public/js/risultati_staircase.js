const _jsonInput = document.getElementById('json-file-input');
const _solInput = document.getElementById('sol-file-input');
const _loadBtn = document.getElementById('btn-load-files');
const _spacingInput = document.getElementById('biofabric-node-axis-spacing');
const _spacingLabel = document.getElementById('biofabric-node-axis-spacing-value');
const _edgeStrokeInput = document.getElementById('biofabric-edge-stroke-width');
const _edgeStrokeLabel = document.getElementById('biofabric-edge-stroke-width-value');
const _lockSpacingCheckbox = document.getElementById('biofabric-lock-node-axis-spacing');
const _nodeLabelSizeInput = document.getElementById('biofabric-node-label-size');
const _nodeLabelSizeLabel = document.getElementById('biofabric-node-label-size-value');
const _biofabricExportFormatSelect = document.getElementById('biofabric-export-format');
const _biofabricExportButton = document.getElementById('biofabric-export-button');
const _graphExportFormatSelect = document.getElementById('graph-export-format');
const _graphExportButton = document.getElementById('graph-export-button');

let _lastGraphData = null;
let _lastSolParsed = null;

function showBanner(type, text) {
  const el = document.getElementById('status-banner');
  el.className = type;
  document.getElementById('banner-text').textContent = text;
}

function hideBanner() {
  const el = document.getElementById('status-banner');
  el.className = '';
  el.style.display = 'none';
}

function showError(message) {
  const el = document.getElementById('load-error');
  el.textContent = message;
  el.style.display = 'block';
}

function clearError() {
  const el = document.getElementById('load-error');
  el.textContent = '';
  el.style.display = 'none';
}

function getNodeAxisSpacing() {
  const raw = Number(_spacingInput?.value);
  if (!Number.isFinite(raw)) return 8;
  return Math.max(4, Math.min(120, raw));
}

function isNodeAxisSpacingLocked() {
  return !!_lockSpacingCheckbox?.checked;
}

function updateNodeAxisSpacingLabel() {
  if (!_spacingLabel) return;
  const spacing = getNodeAxisSpacing();
  const mode = isNodeAxisSpacingLocked() ? 'bloccato' : 'auto';
  _spacingLabel.textContent = `${spacing.toFixed(1)} px (${mode})`;
}

function getBiofabricEdgeStrokeWidth() {
  const raw = Number(_edgeStrokeInput?.value);
  if (!Number.isFinite(raw)) return 1.35;
  return Math.max(0.4, Math.min(8, raw));
}

function updateBiofabricEdgeStrokeWidthLabel() {
  if (!_edgeStrokeLabel) return;
  _edgeStrokeLabel.textContent = `${getBiofabricEdgeStrokeWidth().toFixed(2)} px`;
}

function getBiofabricNodeLabelSize() {
  const raw = Number(_nodeLabelSizeInput?.value);
  if (!Number.isFinite(raw)) return 12;
  return Math.max(8, Math.min(36, raw));
}

function updateBiofabricNodeLabelSizeLabel() {
  if (!_nodeLabelSizeLabel) return;
  _nodeLabelSizeLabel.textContent = `${getBiofabricNodeLabelSize().toFixed(1)} px`;
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
  const raw = (_lastSolParsed?.fileName || _lastGraphData?.name || 'biofabric')
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

function serializeSvg(svgEl) {
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

  const { svgText, width, height } = serializeSvg(svgEl);

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

function updateHeaderChips(meta) {
  const graphChip = document.getElementById('chip-graph');
  const solChip = document.getElementById('chip-sol');
  const objChip = document.getElementById('chip-obj');
  const nodeChip = document.getElementById('chip-node-order');
  const edgeChip = document.getElementById('chip-edge-order');

  graphChip.textContent = `Grafo: ${meta.graphName}`;
  graphChip.style.display = '';

  solChip.textContent = `Soluzione: ${meta.solName}`;
  solChip.style.display = '';

  if (meta.objectiveValue !== null) {
    objChip.textContent = `Obj: ${meta.objectiveValue}`;
    objChip.style.display = '';
  } else {
    objChip.style.display = 'none';
  }

  nodeChip.textContent = `Nodi: ${meta.nodeOrderMethod}`;
  nodeChip.style.display = '';

  edgeChip.textContent = `Archi: ${meta.edgeOrderMethod}`;
  edgeChip.style.display = '';
}

function updateStaircaseSummary(text) {
  document.getElementById('staircase-summary').textContent = text;
}

function getNumericId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if (value.id !== undefined && value.id !== null) return Number(value.id);
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeGraphData(rawGraph) {
  if (!rawGraph || !Array.isArray(rawGraph.nodes)) {
    throw new Error('JSON non valido: campo nodes mancante.');
  }

  const nodes = rawGraph.nodes
    .map((node) => {
      const id = getNumericId(node && node.id !== undefined ? node.id : node);
      return Number.isFinite(id) ? { id } : null;
    })
    .filter(Boolean);

  if (!nodes.length) {
    throw new Error('JSON non valido: nessun nodo valido trovato.');
  }

  const rawEdges = Array.isArray(rawGraph.links)
    ? rawGraph.links
    : (Array.isArray(rawGraph.edges) ? rawGraph.edges : []);

  const edges = rawEdges
    .map((edge, idx) => {
      const source = getNumericId(edge?.source);
      const target = getNumericId(edge?.target);
      if (!Number.isFinite(source) || !Number.isFinite(target) || source === target) return null;

      const parsedId = getNumericId(edge?.id);
      const id = Number.isFinite(parsedId) ? parsedId : (idx + 1);
      return { id, source, target };
    })
    .filter(Boolean);

  const cliques = Array.isArray(rawGraph.cliques)
    ? rawGraph.cliques.map((clique, idx) => ({
      id: Number.isFinite(Number(clique?.id)) ? Number(clique.id) : (idx + 1),
      nodes: Array.isArray(clique?.nodes)
        ? clique.nodes.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : [],
    }))
    : [];

  return {
    name: rawGraph.name || 'grafo_locale',
    nodes,
    links: edges,
    cliques,
  };
}

function parseSolText(solText) {
  const vars = new Map();

  for (const line of solText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const varName = parts[0];
    const value = Number(parts[1]);
    if (!Number.isFinite(value)) continue;
    vars.set(varName, value);
  }

  const objectiveMatch = solText.match(/#\s*Objective value\s*=\s*([-+]?\d+(?:\.\d+)?)/i);
  const objectiveValue = objectiveMatch ? Number(objectiveMatch[1]) : null;

  return { vars, objectiveValue, rawText: solText };
}

function deriveNodeOrder(nodes, solVars) {
  const nodeIds = nodes.map((n) => n.id).sort((a, b) => a - b);
  const nodeIdSet = new Set(nodeIds);

  const posByNode = new Map();
  for (const [key, value] of solVars.entries()) {
    const m = key.match(/^pos_n(\d+)$/);
    if (!m) continue;
    const nodeId = Number(m[1]);
    if (!Number.isFinite(nodeId)) continue;
    posByNode.set(nodeId, value);
  }

  if (posByNode.size === nodeIds.length) {
    const ordered = nodeIds
      .map((id) => ({ id, pos: Number(posByNode.get(id)) }))
      .sort((a, b) => (a.pos - b.pos) || (a.id - b.id));

    return {
      orderedNodes: ordered.map((entry, idx) => ({ id: entry.id, pos: idx })),
      methodLabel: 'da pos_n',
    };
  }

  const predecessors = new Map(nodeIds.map((id) => [id, 0]));
  let pairCount = 0;
  const seenPairs = new Set();

  for (const [key, value] of solVars.entries()) {
    const m = key.match(/^y_n(\d+)n(\d+)$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!nodeIdSet.has(a) || !nodeIdSet.has(b) || a === b) continue;

    const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    pairCount += 1;
    const y = Number(value);
    if (y >= 0.5) {
      predecessors.set(b, (predecessors.get(b) || 0) + 1);
    } else {
      predecessors.set(a, (predecessors.get(a) || 0) + 1);
    }
  }

  const orderedIds = nodeIds.slice().sort((a, b) => {
    const da = predecessors.get(a) || 0;
    const db = predecessors.get(b) || 0;
    return (da - db) || (a - b);
  });

  const orderedNodes = orderedIds.map((id, idx) => ({ id, pos: idx }));

  const methodLabel = pairCount > 0
    ? `da y_n* (${pairCount} confronti)`
    : 'fallback su id nodo';

  return { orderedNodes, methodLabel };
}

function deriveEdgeOrder(edges, solVars) {
  const edgeIds = edges.map((e) => e.id).sort((a, b) => a - b);
  const edgeIdSet = new Set(edgeIds);

  const posByEdge = new Map();
  for (const [key, value] of solVars.entries()) {
    const m = key.match(/^pos_e(\d+)$/);
    if (!m) continue;
    const edgeId = Number(m[1]);
    if (!Number.isFinite(edgeId)) continue;
    posByEdge.set(edgeId, value);
  }

  if (posByEdge.size === edgeIds.length) {
    const ordered = edgeIds
      .map((id) => ({ id, pos: Number(posByEdge.get(id)) }))
      .sort((a, b) => (a.pos - b.pos) || (a.id - b.id));

    return {
      orderedEdges: ordered.map((entry, idx) => ({ id: entry.id, pos: idx })),
      methodLabel: 'da pos_e',
    };
  }

  const predecessors = new Map(edgeIds.map((id) => [id, 0]));
  let pairCount = 0;
  const seenPairs = new Set();

  for (const [key, value] of solVars.entries()) {
    const m = key.match(/^x_e(\d+)e(\d+)$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!edgeIdSet.has(a) || !edgeIdSet.has(b) || a === b) continue;

    const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    pairCount += 1;
    const x = Number(value);
    if (x >= 0.5) {
      predecessors.set(b, (predecessors.get(b) || 0) + 1);
    } else {
      predecessors.set(a, (predecessors.get(a) || 0) + 1);
    }
  }

  const orderedIds = edgeIds.slice().sort((a, b) => {
    const da = predecessors.get(a) || 0;
    const db = predecessors.get(b) || 0;
    return (da - db) || (a - b);
  });

  const orderedEdges = orderedIds.map((id, idx) => ({ id, pos: idx }));

  const methodLabel = pairCount > 0
    ? `da x_e* (${pairCount} confronti)`
    : 'fallback su id arco';

  return { orderedEdges, methodLabel };
}

function parseActiveStaircases(solVars) {
  const staircaseList = [];

  for (const [key, value] of solVars.entries()) {
    if (value < 0.5) continue;
    const match = key.match(/^c_n(\d+)_((?:e\d+_)+)$/);
    if (!match) continue;

    const nodeId = Number(match[1]);
    if (!Number.isFinite(nodeId)) continue;

    const edgeIds = match[2]
      .split('_')
      .filter((token) => /^e\d+$/.test(token))
      .map((token) => Number(token.slice(1)))
      .filter((n) => Number.isFinite(n));

    if (edgeIds.length < 2) continue;

    staircaseList.push({
      key,
      nodeId,
      edgeIds,
    });
  }

  return staircaseList.sort((a, b) => (a.nodeId - b.nodeId) || a.key.localeCompare(b.key));
}

function drawAll() {
  if (!_lastGraphData || !_lastSolParsed) return;

  const drawResult = drawBiofabricStaircase(_lastGraphData, _lastSolParsed, 'result-biofabric', {
    nodeAxisSpacing: getNodeAxisSpacing(),
    lockNodeAxisSpacing: isNodeAxisSpacingLocked(),
    edgeStrokeWidth: getBiofabricEdgeStrokeWidth(),
    nodeLabelSize: getBiofabricNodeLabelSize(),
  });

  updateHeaderChips({
    graphName: _lastGraphData.name || 'grafo_locale',
    solName: _lastSolParsed.fileName || 'soluzione_locale.sol',
    objectiveValue: _lastSolParsed.objectiveValue,
    nodeOrderMethod: drawResult.nodeOrderMethod,
    edgeOrderMethod: drawResult.edgeOrderMethod,
  });

  updateStaircaseSummary(
    `Staircase attive: ${drawResult.staircaseCount} | Nodi: ${drawResult.nodeOrderMethod} | Archi: ${drawResult.edgeOrderMethod}`,
  );

  renderGraph(_lastGraphData, drawResult.coloredLinks, 'result-graph');
}

function drawBiofabricStaircase(graphData, solParsed, containerId, options = {}) {
  const nodes = graphData.nodes || [];
  const edges = graphData.links || graphData.edges || [];

  const { orderedNodes, methodLabel: nodeOrderMethod } = deriveNodeOrder(nodes, solParsed.vars);
  const { orderedEdges, methodLabel: edgeOrderMethod } = deriveEdgeOrder(edges, solParsed.vars);

  const requestedNodeAxisSpacing = Number(options.nodeAxisSpacing);
  const requestedEdgeStrokeWidth = Number(options.edgeStrokeWidth);
  const requestedNodeLabelSize = Number(options.nodeLabelSize);
  const lockNodeAxisSpacing = !!options.lockNodeAxisSpacing;

  const MIN_NODE_AXIS_SPACING = 4;
  const MAX_NODE_AXIS_SPACING = 120;
  const autoNodeAxisSpacing = Math.max(6, Math.min(18, 860 / Math.max(orderedNodes.length, 1)));
  const clampedRequestedNodeAxisSpacing = Number.isFinite(requestedNodeAxisSpacing)
    ? Math.max(MIN_NODE_AXIS_SPACING, Math.min(MAX_NODE_AXIS_SPACING, requestedNodeAxisSpacing))
    : autoNodeAxisSpacing;
  const nodeAxisSpacing = lockNodeAxisSpacing ? clampedRequestedNodeAxisSpacing : autoNodeAxisSpacing;
  const edgeStrokeWidth = Number.isFinite(requestedEdgeStrokeWidth)
    ? Math.max(0.4, Math.min(8, requestedEdgeStrokeWidth))
    : 1.35;

  const edgeSpacingRatio = 0.8;
  const edgeSpacing = Math.max(4, nodeAxisSpacing * edgeSpacingRatio);

  const padding = { top: 50, left: 66, right: 38, bottom: 28 };
  const width = Math.max(980, Math.round(padding.left + padding.right + (orderedEdges.length + 1) * edgeSpacing));
  const height = Math.max(560, Math.round(padding.top + padding.bottom + (orderedNodes.length + 1) * nodeAxisSpacing));

  const svg = d3.create('svg')
    .attr('viewBox', [0, 0, width, height])
    .attr('width', width)
    .attr('height', height)
    .attr('style', 'max-width:100%; height:auto;');

  const container = document.getElementById(containerId);
  container.innerHTML = '';
  d3.select('#' + containerId).append(() => svg.node());

  svg.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', width)
    .attr('height', height)
    .attr('fill', '#ffffff');

  const nodesLayout = orderedNodes.map((node) => ({
    id: node.id,
    name: 'n' + node.id,
    y: node.pos * nodeAxisSpacing,
  }));

  const nodeById = new Map(nodesLayout.map((node) => [node.id, node]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

  const renderedEdges = orderedEdges
    .map((entry, idx) => {
      const edge = edgeById.get(entry.id);
      if (!edge) return null;

      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return null;

      return {
        id: edge.id,
        name: 'e' + edge.id,
        source,
        target,
        x: padding.left + (idx + 0.5) * edgeSpacing,
      };
    })
    .filter(Boolean);

  const edgeLayoutById = new Map(renderedEdges.map((edge) => [edge.id, edge]));

  svg.append('g').selectAll('line').data(nodesLayout).enter().append('line')
    .attr('x1', padding.left)
    .attr('x2', width - padding.right)
    .attr('y1', (d) => padding.top + d.y)
    .attr('y2', (d) => padding.top + d.y)
    .attr('stroke', '#9a9a9a')
    .attr('stroke-width', 1.2);

  const nodeLabelSize = Number.isFinite(requestedNodeLabelSize)
    ? Math.max(8, Math.min(36, requestedNodeLabelSize))
    : Math.max(12, Math.min(18, nodeAxisSpacing * 0.52));
  const nodeLabelAnchorX = padding.left - 12;
  svg.append('g').selectAll('text').data(nodesLayout).enter().append('text')
    .attr('x', nodeLabelAnchorX)
    .attr('y', (d) => padding.top + d.y)
    .attr('dy', '0.33em')
    .text((d) => d.name)
    .style('text-anchor', 'end')
    .style('font-size', `${nodeLabelSize}px`)
    .style('fill', '#111');

  const staircaseEntries = parseActiveStaircases(solParsed.vars);
  const staircaseEdgeUsage = new Map();

  let staircaseCount = 0;
  for (const staircase of staircaseEntries) {
    const node = nodeById.get(staircase.nodeId);
    if (!node) continue;

    const edgesInOrder = staircase.edgeIds
      .map((edgeId) => edgeLayoutById.get(edgeId))
      .filter(Boolean);

    if (edgesInOrder.length < 2) continue;

    for (const edge of edgesInOrder) {
      staircaseEdgeUsage.set(edge.id, (staircaseEdgeUsage.get(edge.id) || 0) + 1);
    }

    staircaseCount += 1;
  }

  const edgeGroup = svg.append('g').attr('class', 'biofabric-edges');

  for (const edge of renderedEdges) {
    const yA = padding.top + edge.source.y;
    const yB = padding.top + edge.target.y;
    const yTop = Math.min(yA, yB);
    const yBottom = Math.max(yA, yB);

    edgeGroup.append('line')
      .attr('x1', edge.x)
      .attr('x2', edge.x)
      .attr('y1', yTop)
      .attr('y2', yBottom)
      .attr('stroke', '#111')
      .attr('stroke-width', edgeStrokeWidth)
      .attr('opacity', 1);
  }

  const coloredLinks = renderedEdges.map((edge) => ({
    id: edge.id,
    source: edge.source.id,
    target: edge.target.id,
    cliques: [],
    staircaseUsage: staircaseEdgeUsage.get(edge.id) || 0,
  }));

  return {
    coloredLinks,
    staircaseCount,
    nodeOrderMethod,
    edgeOrderMethod,
  };
}

function renderGraph(graphData, coloredLinks, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (!Array.isArray(graphData.nodes) || !graphData.nodes.length) {
    container.innerHTML = '<div class="placeholder">Nessun nodo disponibile nel JSON.</div>';
    return;
  }

  const width = Math.max(760, (container.clientWidth || 980) - 8);
  const height = Math.max(620, Math.round(width * 0.68));

  const svg = d3.select('#' + containerId)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height])
    .attr('style', 'width:100%; height:auto; border:1px solid #eee; border-radius:6px; background:#fff;');

  const graphRoot = svg.append('g').attr('class', 'graph-root');

  const zoom = d3.zoom()
    .scaleExtent([0.35, 4])
    .on('zoom', (event) => {
      graphRoot.attr('transform', event.transform);
    });

  svg.call(zoom);

  const nodesCopy = graphData.nodes.map((node) => ({ ...node }));
  const simLinks = coloredLinks.map((link) => ({ ...link }));

  const simulation = d3.forceSimulation(nodesCopy)
    .force('link', d3.forceLink(simLinks).id((d) => d.id).distance(110))
    .force('charge', d3.forceManyBody().strength(-180))
    .force('center', d3.forceCenter(width / 2, height / 2));

  const linkLines = graphRoot.append('g')
    .selectAll('line')
    .data(simLinks)
    .enter()
    .append('line')
    .attr('stroke-width', 1.8)
    .attr('stroke', '#111')
    .attr('opacity', 0.9)
    .style('cursor', 'pointer');

  const edgeLabels = graphRoot.append('g')
    .selectAll('text')
    .data(simLinks)
    .enter()
    .append('text')
    .attr('font-size', 10)
    .attr('fill', '#778')
    .attr('dy', -4)
    .style('opacity', 0)
    .style('pointer-events', 'none')
    .text((d) => 'e' + d.id);

  linkLines
    .on('mouseenter', (event, d) => {
      edgeLabels.filter((edge) => edge.id === d.id).style('opacity', 1);
    })
    .on('mouseleave', (event, d) => {
      edgeLabels.filter((edge) => edge.id === d.id).style('opacity', 0);
    });

  const nodeCircles = graphRoot.append('g')
    .selectAll('circle')
    .data(nodesCopy)
    .enter()
    .append('circle')
    .attr('r', 9)
    .attr('fill', '#111')
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .call(d3.drag()
      .on('start', (ev, d) => {
        if (!ev.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (ev, d) => {
        d.fx = ev.x;
        d.fy = ev.y;
      })
      .on('end', (ev, d) => {
        if (!ev.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }));

  const nodeLabels = graphRoot.append('g')
    .selectAll('text')
    .data(nodesCopy)
    .enter()
    .append('text')
    .attr('font-size', 12)
    .attr('fill', '#222')
    .attr('text-anchor', 'middle')
    .attr('dy', -14)
    .text((d) => d.id);

  nodeCircles.append('title').text((d) => 'n' + d.id);

  function fitGraphToViewport(animated = true) {
    const xs = nodesCopy.map((n) => n.x).filter(Number.isFinite);
    const ys = nodesCopy.map((n) => n.y).filter(Number.isFinite);
    if (!xs.length || !ys.length) return;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const graphW = Math.max(maxX - minX, 1);
    const graphH = Math.max(maxY - minY, 1);
    const pad = 34;

    const scale = Math.min((width - pad * 2) / graphW, (height - pad * 2) / graphH, 1.45);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
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
    linkLines
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    nodeCircles.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
    nodeLabels.attr('x', (d) => d.x).attr('y', (d) => d.y);

    edgeLabels
      .attr('x', (d) => (d.source.x + d.target.x) / 2)
      .attr('y', (d) => (d.source.y + d.target.y) / 2);
  });

  simulation.on('end', () => {
    fitGraphToViewport(true);
  });

  setTimeout(() => fitGraphToViewport(false), 1100);
}

async function loadFilesAndRender() {
  clearError();

  const jsonFile = _jsonInput?.files?.[0];
  const solFile = _solInput?.files?.[0];

  if (!jsonFile || !solFile) {
    showError('Seleziona sia il file JSON sia il file SOL.');
    return;
  }

  showBanner('waiting', 'Lettura file locali in corso...');

  try {
    const [jsonText, solText] = await Promise.all([jsonFile.text(), solFile.text()]);
    const rawGraph = JSON.parse(jsonText);

    _lastGraphData = normalizeGraphData(rawGraph);
    _lastSolParsed = parseSolText(solText);
    _lastSolParsed.fileName = solFile.name;

    document.getElementById('result-title').textContent = solFile.name.replace(/\.sol$/i, '');

    drawAll();
    hideBanner();
  } catch (err) {
    hideBanner();
    showError('Errore nel caricamento: ' + (err?.message || String(err)));
  }
}

(function init() {
  updateNodeAxisSpacingLabel();
  updateBiofabricEdgeStrokeWidthLabel();
  updateBiofabricNodeLabelSizeLabel();

  if (_spacingInput) {
    _spacingInput.addEventListener('input', () => {
      updateNodeAxisSpacingLabel();
      drawAll();
    });
  }

  if (_edgeStrokeInput) {
    _edgeStrokeInput.addEventListener('input', () => {
      updateBiofabricEdgeStrokeWidthLabel();
      drawAll();
    });
  }

  if (_nodeLabelSizeInput) {
    _nodeLabelSizeInput.addEventListener('input', () => {
      updateBiofabricNodeLabelSizeLabel();
      drawAll();
    });
  }

  if (_lockSpacingCheckbox) {
    _lockSpacingCheckbox.addEventListener('change', () => {
      updateNodeAxisSpacingLabel();
      drawAll();
    });
  }

  if (_loadBtn) {
    _loadBtn.addEventListener('click', loadFilesAndRender);
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
})();
