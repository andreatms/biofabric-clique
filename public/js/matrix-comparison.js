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
  let graphData;
  let ilpOrder;

  backLink.href = `/result.html${window.location.search}`;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
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
    const size = nodes.length;
    if (!size) {
      container.innerHTML = '<div class="placeholder">This graph has no nodes.</div>';
      return;
    }
    const cellSize = Math.max(12, Math.min(28, 720 / size));
    const labelSize = Math.max(8, Math.min(12, cellSize * .55));
    const labelSpace = Math.max(40, nodes.reduce((max, node) => Math.max(max, String(node.id).length * labelSize * .65), 0) + 14);
    const matrixSize = size * cellSize;
    const width = labelSpace + matrixSize + 14;
    const height = labelSpace + matrixSize + 14;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
    const labels = svg.append('g').attr('fill', '#263238').attr('font-size', labelSize).attr('font-family', 'inherit');
    nodes.forEach((node, index) => {
      const center = labelSpace + index * cellSize + cellSize / 2;
      labels.append('text').attr('x', center).attr('y', labelSpace - 7).attr('text-anchor', 'middle').text(`n${node.id}`);
      labels.append('text').attr('x', labelSpace - 7).attr('y', center).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').text(`n${node.id}`);
    });
    const cells = [];
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) cells.push({ row, column, edge: matrix[row][column] });
    const cellSelection = svg.append('g').attr('transform', `translate(${labelSpace},${labelSpace})`).selectAll('rect').data(cells).enter().append('rect')
      .attr('x', (cell) => cell.column * cellSize + .5).attr('y', (cell) => cell.row * cellSize + .5)
      .attr('width', Math.max(1, cellSize - 1)).attr('height', Math.max(1, cellSize - 1))
      .attr('fill', (cell) => cell.edge ? '#2f6eb2' : '#f3f6fa').attr('stroke', '#fff').attr('stroke-width', 1);
    cellSelection.append('title').text((cell) => `${nodes[cell.row].id} – ${nodes[cell.column].id}${cell.edge ? ' | edge' : ' | no edge'}`);
  }

  function renderReorder() {
    const methodName = methodSelect.options[methodSelect.selectedIndex].text;
    const ordered = reorderNodes(methodSelect.value);
    document.getElementById('reorder-title').textContent = `${methodName}`;
    document.getElementById('reorder-order-info').textContent = `${ordered.length} nodes`;
    drawMatrix('reorder-matrix', ordered);
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
    methodSelect.disabled = false;
    renderReorder();
  }

  methodSelect.addEventListener('change', () => { errorBox.style.display = 'none'; renderReorder(); });
  load().catch((error) => { subtitle.textContent = 'Data unavailable'; showError(error.message); });
})();
