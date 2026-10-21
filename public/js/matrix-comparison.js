(() => {
  const params = new URLSearchParams(window.location.search);
  const graphId = params.get('graph');
  const setName = params.get('set');
  const setGraphId = params.get('setGraph');
  const solId = params.get('sol');
  const methodSelect = document.getElementById('reorder-method');
  const subtitle = document.getElementById('comparison-subtitle');
  const errorBox = document.getElementById('comparison-error');
  const backLink = document.getElementById('back-to-results');
  const glyphMode = document.getElementById('glyph-mode');
  const showCliqueMarkers = document.getElementById('show-clique-markers');
  const labelSizeInput = document.getElementById('matrix-label-size');
  const labelSizeValue = document.getElementById('matrix-label-size-value');
  const horizontalMarkerDistanceInput = document.getElementById('matrix-horizontal-marker-distance');
  const horizontalMarkerDistanceValue = document.getElementById('matrix-horizontal-marker-distance-value');
  const verticalMarkerDistanceInput = document.getElementById('matrix-vertical-marker-distance');
  const verticalMarkerDistanceValue = document.getElementById('matrix-vertical-marker-distance-value');
  const clusterOpacityInput = document.getElementById('matrix-cluster-opacity');
  const clusterOpacityValue = document.getElementById('matrix-cluster-opacity-value');
  let graphData;
  let ilpOrder;
  let activeGlyphId = null;

  backLink.href = `/result.html${window.location.search}`;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function limitedInputValue(input, fallback, min, max) {
    const value = Number(input?.value);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }

  function matrixLabelSize() {
    return limitedInputValue(labelSizeInput, 12, 8, 28);
  }

  function markerDistance(input) {
    return limitedInputValue(input, 10, 0, 40);
  }

  function clusterOpacity() {
    return limitedInputValue(clusterOpacityInput, .82, .05, 1);
  }

  function updateControlLabels() {
    labelSizeValue.textContent = `${matrixLabelSize().toFixed(1)} px`;
    horizontalMarkerDistanceValue.textContent = `${markerDistance(horizontalMarkerDistanceInput).toFixed(0)} px`;
    verticalMarkerDistanceValue.textContent = `${markerDistance(verticalMarkerDistanceInput).toFixed(0)} px`;
    clusterOpacityValue.textContent = `${Math.round(clusterOpacity() * 100)}%`;
  }

  function endpointId(value) {
    return typeof value === 'object' && value !== null ? value.id : value;
  }

  function nodeKey(value) {
    return String(endpointId(value));
  }

  function getIlpOrder(graph, solution) {
    const positions = new Map();
    for (const line of String(solution || '').split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || !parts[0].startsWith('pos_n')) continue;
      const id = Number(parts[0].slice(5));
      const position = Number(parts[1]);
      if (Number.isFinite(id) && Number.isFinite(position)) positions.set(id, position);
    }
    const nodesById = new Map((graph.nodes || []).map((node) => [Number(node.id), node]));
    const ordered = [...positions.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => nodesById.get(id))
      .filter(Boolean);
    // A malformed/partial solution should still leave every graph node visible.
    const used = new Set(ordered.map((node) => nodeKey(node.id)));
    return ordered.concat((graph.nodes || []).filter((node) => !used.has(nodeKey(node.id))));
  }

  async function fetchGraphBySolutionName(solutionName) {
    const response = await fetch('/uploaded-json-files');
    if (!response.ok) throw new Error('Unable to find the graph for this solution.');
    const files = (await response.json()).files || [];
    const solutionBase = solutionName
      .replace(/\.sol$/i, '')
      .replace(/^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_/, '');
    const match = files.find((file) => {
      const graphBase = String(file.name || '').replace(/\.json$/i, '');
      return solutionBase.startsWith(graphBase) || solutionBase.includes(graphBase);
    });
    if (!match) throw new Error('Graph not found automatically. Open Results with an explicit graph first.');
    const graphResponse = await fetch(`/jsonFiles/${encodeURIComponent(match.id)}`);
    if (!graphResponse.ok) throw new Error('Graph not found.');
    return graphResponse.json();
  }

  function buildAdjacency(nodes) {
    const index = new Map(nodes.map((node, i) => [nodeKey(node.id), i]));
    const matrix = Array.from({ length: nodes.length }, () => Array(nodes.length).fill(0));
    for (const edge of graphData.links || graphData.edges || []) {
      const source = index.get(nodeKey(edge.source));
      const target = index.get(nodeKey(edge.target));
      if (source === undefined || target === undefined) continue;
      matrix[source][target] = 1;
      matrix[target][source] = 1;
    }
    return matrix;
  }

  function buildClusterMembership(nodes) {
    const index = new Map(nodes.map((node, position) => [nodeKey(node.id), position]));
    const memberships = new Map();
    const addMembership = (row, column, clusterId) => {
      const key = row <= column ? `${row}|${column}` : `${column}|${row}`;
      if (!memberships.has(key)) memberships.set(key, new Set());
      memberships.get(key).add(clusterId);
    };
    for (const edge of graphData.links || graphData.edges || []) {
      const source = index.get(nodeKey(edge.source));
      const target = index.get(nodeKey(edge.target));
      if (source === undefined || target === undefined) continue;
      const clusterIds = (graphData.cliques || [])
        .filter((clique) => {
          const nodeIds = new Set((clique.nodes || []).map(nodeKey));
          return nodeIds.has(nodeKey(edge.source)) && nodeIds.has(nodeKey(edge.target));
        })
        .map((clique) => Number(clique.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      (clusterIds.length ? clusterIds : [0]).forEach((id) => addMembership(source, target, id));
    }
    return memberships;
  }

  // Same criterion used by Analysis: a clique is compact when all of its
  // nodes form one uninterrupted interval in the current ordering.
  function calculateCompactness(nodes) {
    const positionByNode = new Map(nodes.map((node, index) => [nodeKey(node.id), index]));
    const cliques = graphData.cliques || [];
    let compact = 0;
    for (const clique of cliques) {
      const cliqueNodeIds = [...new Set((clique.nodes || []).map(nodeKey))];
      const positions = cliqueNodeIds.map((id) => positionByNode.get(id)).filter((position) => position !== undefined);
      const isCompact = positions.length === cliqueNodeIds.length && positions.length > 0
        && Math.max(...positions) - Math.min(...positions) + 1 === positions.length;
      if (isCompact) compact++;
    }
    return {
      compact,
      total: cliques.length,
      percentage: cliques.length ? (compact / cliques.length) * 100 : null,
    };
  }

  function displayCompactness(prefix, nodes) {
    const metric = calculateCompactness(nodes);
    document.getElementById(`${prefix}-compactness`).textContent = metric.percentage === null
      ? 'n/a'
      : `${metric.percentage.toFixed(2)}%`;
    document.getElementById(`${prefix}-compactness-detail`).textContent = metric.total
      ? `${metric.compact} / ${metric.total} compact cliques`
      : 'No cliques in this graph';
  }

  function validPermutation(permutation, size) {
    return Array.isArray(permutation)
      && permutation.length === size
      && new Set(permutation).size === size
      && permutation.every((index) => Number.isInteger(index) && index >= 0 && index < size);
  }

  function reorderNodes(method) {
    const baseNodes = (graphData.nodes || []).slice();
    const matrix = buildAdjacency(baseNodes);
    if (baseNodes.length < 2) return baseNodes;
    let permutation;
    try {
      if (!window.reorder) throw new Error('reorder.js was not loaded');
      if (method === 'optimal-leaf') permutation = window.reorder.optimal_leaf_order()(matrix);
      else if (method === 'pca') permutation = window.reorder.pca_order(matrix);
      else {
        const graph = window.reorder.mat2graph(matrix);
        permutation = method === 'cuthill-mckee'
          ? window.reorder.cuthill_mckee_order(graph)
          : method === 'spectral'
            ? window.reorder.spectral_order(graph)
            : window.reorder.reverse_cuthill_mckee_order(graph);
      }
    } catch (error) {
      showError(`Unable to calculate the selected ordering: ${error.message}. The original node order is shown.`);
      return baseNodes;
    }
    if (!validPermutation(permutation, baseNodes.length)) {
      showError('The selected method returned an invalid permutation. The original node order is shown.');
      return baseNodes;
    }
    return permutation.map((index) => baseNodes[index]);
  }

  function drawMatrix(containerId, nodes) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const matrix = buildAdjacency(nodes);
    const memberships = buildClusterMembership(nodes);
    const size = nodes.length;
    if (!size) {
      container.innerHTML = '<div class="placeholder">This graph has no nodes.</div>';
      return;
    }
    const cellSize = Math.max(12, Math.min(28, 720 / size));
    const labelSize = matrixLabelSize();
    const horizontalMarkerDistance = markerDistance(horizontalMarkerDistanceInput);
    const verticalMarkerDistance = markerDistance(verticalMarkerDistanceInput);
    const labelWidth = nodes.reduce((max, node) => Math.max(max, String(node.id).length * labelSize * .65), 0) + 14;
    const markerLaneCount = Math.max(1, (graphData.cliques || []).filter((clique) => (
      Number(clique.id) > 0 && new Set((clique.nodes || []).map(nodeKey)).size > 1
    )).length);
    const markerLaneSize = 7;
    // Keep the hover markers inside the SVG and leave a visible gap between
    // them and the labels/matrix, exactly what the distance controls modify.
    const labelSpace = Math.max(
      40,
      labelWidth,
      27 + horizontalMarkerDistance + (markerLaneCount - 1) * markerLaneSize,
      27 + verticalMarkerDistance + (markerLaneCount - 1) * markerLaneSize,
    );
    const matrixSize = size * cellSize;
    const width = labelSpace + matrixSize + 14;
    const height = labelSpace + matrixSize + 14;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
    const defs = svg.append('defs');
    let gradientCount = 0;
    const fillForClusters = (clusterIds) => {
      const colors = [...clusterIds].filter((id) => id > 0).map((id) => d3.schemeCategory10[id % d3.schemeCategory10.length]);
      if (!colors.length) return clusterIds.has(0) ? '#9aa7b5' : '#f3f6fa';
      if (colors.length === 1) return colors[0];
      const gradientId = `${containerId}-cluster-gradient-${gradientCount++}`;
      const gradient = defs.append('linearGradient').attr('id', gradientId).attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
      colors.forEach((color, index) => {
        gradient.append('stop').attr('offset', `${(index / colors.length) * 100}%`).attr('stop-color', color);
        gradient.append('stop').attr('offset', `${((index + 1) / colors.length) * 100}%`).attr('stop-color', color);
      });
      return `url(#${gradientId})`;
    };
    const labels = svg.append('g').attr('fill', '#263238').attr('font-size', labelSize).attr('font-family', 'inherit');
    nodes.forEach((node, index) => {
      const center = labelSpace + index * cellSize + cellSize / 2;
      labels.append('text').attr('class', 'matrix-column-label').attr('x', center).attr('y', labelSpace - 7).attr('text-anchor', 'middle').text(`n${node.id}`);
      labels.append('text').attr('class', 'matrix-row-label').attr('x', labelSpace - 7).attr('y', center).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').text(`n${node.id}`);
    });
    const cells = [];
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const key = row <= column ? `${row}|${column}` : `${column}|${row}`;
        cells.push({ row, column, edge: matrix[row][column], clusters: memberships.get(key) || new Set() });
      }
    }
    const matrixLayer = svg.append('g').attr('transform', `translate(${labelSpace},${labelSpace})`);
    const cellSelection = matrixLayer.selectAll('rect.matrix-cell').data(cells).enter().append('rect')
      .attr('class', 'matrix-cell')
      .attr('x', (cell) => cell.column * cellSize + .5).attr('y', (cell) => cell.row * cellSize + .5)
      .attr('width', Math.max(1, cellSize - 1)).attr('height', Math.max(1, cellSize - 1))
      .attr('fill', (cell) => fillForClusters(cell.clusters)).attr('stroke', '#fff').attr('stroke-width', 1);
    cellSelection.append('title').text((cell) => `${nodes[cell.row].id} – ${nodes[cell.column].id}${cell.edge ? ' | edge' : ' | no edge'}`);
    const nodeIndex = new Map(nodes.map((node, index) => [nodeKey(node.id), index]));
    const glyphs = (graphData.cliques || []).map((clique) => {
      const indexes = [...new Set((clique.nodes || []).map(nodeKey).map((id) => nodeIndex.get(id)).filter((index) => index !== undefined))].sort((a, b) => a - b);
      const id = Number(clique.id);
      return indexes.length > 1 && Number.isFinite(id) && id > 0 ? { id, indexes, min: indexes[0], max: indexes[indexes.length - 1] } : null;
    }).filter(Boolean);
    const glyphLayer = matrixLayer.append('g').attr('class', 'glyph-layer');
    const glyphCells = glyphs.flatMap((glyph) => glyph.indexes.flatMap((row) => glyph.indexes.map((column) => {
      const key = row <= column ? `${row}|${column}` : `${column}|${row}`;
      const clusters = memberships.get(key) || new Set();
      return { ...glyph, row, column, present: row === column || clusters.has(glyph.id) };
    })));
    const glyphFrames = glyphLayer.selectAll('rect.glyph-frame').data(glyphs).enter().append('rect')
      .attr('class', 'glyph-frame').attr('x', (glyph) => glyph.min * cellSize + 1).attr('y', (glyph) => glyph.min * cellSize + 1)
      .attr('width', (glyph) => (glyph.max - glyph.min + 1) * cellSize - 2).attr('height', (glyph) => (glyph.max - glyph.min + 1) * cellSize - 2)
      .attr('fill', 'none').attr('stroke', (glyph) => d3.schemeCategory10[glyph.id % d3.schemeCategory10.length]).attr('stroke-width', 1.5).attr('stroke-opacity', clusterOpacity());
    // Like the Results renderer, use one path per cluster rather than inset
    // rectangles: adjacent present cells therefore join with no white gaps.
    const glyphEdges = glyphLayer.selectAll('path.glyph-edge').data(glyphs.map((glyph) => ({
      ...glyph,
      cells: glyphCells.filter((cell) => cell.id === glyph.id && cell.present),
    })).filter((glyph) => glyph.cells.length)).enter().append('path')
      .attr('class', 'glyph-edge')
      .attr('d', (glyph) => glyph.cells.map((cell) => {
        const x = cell.column * cellSize;
        const y = cell.row * cellSize;
        return `M${x},${y}h${cellSize}v${cellSize}h-${cellSize}Z`;
      }).join(''))
      .attr('fill', (glyph) => d3.schemeCategory10[glyph.id % d3.schemeCategory10.length])
      .attr('fill-opacity', clusterOpacity());
    const glyphHoles = glyphLayer.selectAll('rect.glyph-hole').data(glyphCells.filter((cell) => !cell.present)).enter().append('rect')
      .attr('class', 'glyph-hole').attr('x', (cell) => cell.column * cellSize + 2).attr('y', (cell) => cell.row * cellSize + 2)
      .attr('width', Math.max(1, cellSize - 4)).attr('height', Math.max(1, cellSize - 4)).attr('fill', '#fff');
    const isInsideGlyph = (cell) => glyphs.some((glyph) => cell.row >= glyph.min && cell.row <= glyph.max && cell.column >= glyph.min && cell.column <= glyph.max);
    glyphLayer.selectAll('rect.glyph-outside').data(cells.filter((cell) => ![...cell.clusters].some((id) => id > 0) && !isInsideGlyph(cell))).enter().append('rect')
      .attr('class', 'glyph-outside').attr('x', (cell) => cell.column * cellSize + .5).attr('y', (cell) => cell.row * cellSize + .5)
      .attr('width', Math.max(1, cellSize - 1)).attr('height', Math.max(1, cellSize - 1)).attr('fill', (cell) => fillForClusters(cell.clusters)).attr('stroke', '#fff').attr('stroke-width', 1);
    const markerLayer = svg.append('g').attr('class', 'matrix-markers');
    const rowLabels = labels.selectAll('.matrix-row-label');
    const columnLabels = labels.selectAll('.matrix-column-label');
    const matrixElements = matrixLayer.selectAll('.matrix-cell, .glyph-frame, .glyph-edge, .glyph-hole, .glyph-outside');
    const glyphForId = (id) => glyphs.find((glyph) => glyph.id === id);
    const markerRuns = (glyph) => {
      const runs = [];
      glyph.indexes.forEach((index) => {
        const last = runs[runs.length - 1];
        if (last && index === last.end + 1) last.end = index;
        else runs.push({ start: index, end: index });
      });
      return runs;
    };
    const drawMarkerBars = (markerGlyphs) => {
      markerLayer.selectAll('*').remove();
      markerGlyphs.forEach((glyph, lane) => {
        const color = d3.schemeCategory10[glyph.id % d3.schemeCategory10.length];
        const runs = markerRuns(glyph);
        markerLayer.selectAll(`rect.matrix-row-marker-${glyph.id}`).data(runs).enter().append('rect')
          .attr('class', 'matrix-row-marker')
          .attr('x', labelSpace - 22 - verticalMarkerDistance - lane * markerLaneSize)
          .attr('y', (run) => labelSpace + run.start * cellSize + 3)
          .attr('width', 5)
          .attr('height', (run) => Math.max(2, (run.end - run.start + 1) * cellSize - 6))
          .attr('rx', 2)
          .attr('fill', color);
        markerLayer.selectAll(`rect.matrix-column-marker-${glyph.id}`).data(runs).enter().append('rect')
          .attr('class', 'matrix-column-marker')
          .attr('x', (run) => labelSpace + run.start * cellSize + 3)
          .attr('y', labelSpace - 22 - horizontalMarkerDistance - lane * markerLaneSize)
          .attr('width', (run) => Math.max(2, (run.end - run.start + 1) * cellSize - 6))
          .attr('height', 5)
          .attr('rx', 2)
          .attr('fill', color);
      });
    };
    const clearGlyphMarkers = () => {
      activeGlyphId = null;
      matrixElements.style('opacity', 1);
      rowLabels.attr('fill', '#263238').attr('font-weight', '400');
      columnLabels.attr('fill', '#263238').attr('font-weight', '400');
      drawMarkerBars(showCliqueMarkers.checked ? glyphs : []);
    };
    const showGlyphMarkers = (glyph) => {
      if (!glyph) return;
      clearGlyphMarkers();
      activeGlyphId = glyph.id;
      const color = d3.schemeCategory10[glyph.id % d3.schemeCategory10.length];
      const indexes = glyph.indexes;
      matrixElements.style('opacity', .22);
      glyphLayer.selectAll('.glyph-frame, .glyph-edge, .glyph-hole')
        .filter((candidate) => candidate.id === glyph.id)
        .style('opacity', 1);
      drawMarkerBars(showCliqueMarkers.checked ? glyphs : [glyph]);
      rowLabels.filter((_, index) => indexes.includes(index)).attr('fill', color).attr('font-weight', '700');
      columnLabels.filter((_, index) => indexes.includes(index)).attr('fill', color).attr('font-weight', '700');
    };
    glyphFrames.on('mouseenter', (_, glyph) => showGlyphMarkers(glyph)).on('mouseleave', clearGlyphMarkers);
    glyphEdges.on('mouseenter', (_, glyph) => showGlyphMarkers(glyph)).on('mouseleave', clearGlyphMarkers);
    glyphHoles.on('mouseenter', (_, cell) => showGlyphMarkers(glyphForId(cell.id))).on('mouseleave', clearGlyphMarkers);
    glyphLayer.style('display', glyphMode.checked ? null : 'none');
    cellSelection.style('display', glyphMode.checked ? 'none' : null);
    if (showCliqueMarkers.checked) drawMarkerBars(glyphs);
    if (showCliqueMarkers.checked && activeGlyphId !== null) {
      const activeGlyph = glyphForId(activeGlyphId);
      if (activeGlyph) showGlyphMarkers(activeGlyph);
    }
  }

  function renderReorder() {
    const methodName = methodSelect.options[methodSelect.selectedIndex].text;
    const ordered = reorderNodes(methodSelect.value);
    document.getElementById('reorder-title').textContent = `${methodName}`;
    document.getElementById('reorder-order-info').textContent = `${ordered.length} nodes`;
    drawMatrix('reorder-matrix', ordered);
    displayCompactness('reorder', ordered);
  }

  async function load() {
    if (!solId) throw new Error('Missing ?sol=<filename> parameter.');
    let graphPromise;
    if (setName && setGraphId) {
      graphPromise = fetch(`/graph-sets/${encodeURIComponent(setName)}/graphs/${encodeURIComponent(setGraphId)}`)
        .then((response) => {
          if (!response.ok) throw new Error('Graph not found.');
          return response.json();
        });
    } else if (graphId) {
      graphPromise = fetch(`/jsonFiles/${encodeURIComponent(graphId)}`)
        .then((response) => {
          if (!response.ok) throw new Error('Graph not found.');
          return response.json();
        });
    } else {
      graphPromise = fetchGraphBySolutionName(solId);
    }
    const [loadedGraph, solutionResponse] = await Promise.all([graphPromise, fetch(`/results/${encodeURIComponent(solId)}`)]);
    if (!solutionResponse.ok) throw new Error('ILP solution not found.');
    graphData = loadedGraph;
    ilpOrder = getIlpOrder(graphData, await solutionResponse.text());
    subtitle.textContent = `${graphData.name || graphId || `${setName}/${setGraphId}`} · ${ilpOrder.length} nodes`;
    document.getElementById('ilp-order-info').textContent = `${ilpOrder.length} nodes`;
    drawMatrix('ilp-matrix', ilpOrder);
    displayCompactness('ilp', ilpOrder);
    methodSelect.disabled = false;
    renderReorder();
  }

  methodSelect.addEventListener('change', () => { errorBox.style.display = 'none'; renderReorder(); });
  glyphMode.addEventListener('change', () => {
    if (!graphData || !ilpOrder) return;
    drawMatrix('ilp-matrix', ilpOrder);
    renderReorder();
  });
  showCliqueMarkers.addEventListener('change', () => {
    if (!graphData || !ilpOrder) return;
    drawMatrix('ilp-matrix', ilpOrder);
    renderReorder();
  });
  [
    labelSizeInput,
    horizontalMarkerDistanceInput,
    verticalMarkerDistanceInput,
    clusterOpacityInput,
  ].forEach((input) => input.addEventListener('input', () => {
    updateControlLabels();
    if (!graphData || !ilpOrder) return;
    drawMatrix('ilp-matrix', ilpOrder);
    renderReorder();
  }));
  updateControlLabels();
  load().catch((error) => { subtitle.textContent = 'Data unavailable'; showError(error.message); });
})();
