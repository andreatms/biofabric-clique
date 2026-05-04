let cliqueRows = [
  { nodesMin: 3, nodesMax: 7, intraProbMin: 1.0, intraProbMax: 1.0, interProbMin: 0.05, interProbMax: 0.15 },
  { nodesMin: 3, nodesMax: 7, intraProbMin: 1.0, intraProbMax: 1.0, interProbMin: 0.05, interProbMax: 0.15 },
];

let lastGraphId = null;
let generatedGraphData = null;

function getNumberFieldValue(id) {
  const raw = document.getElementById(id).value;
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getIntFieldValue(id) {
  const n = getNumberFieldValue(id);
  return n === null ? null : Math.trunc(n);
}

function updateStrategySections() {
  const strategy = document.getElementById('graph-strategy').value;
  const isDatasetExp = strategy === 'dataset-sperimentazione';

  const clusterSec = document.getElementById('cluster-params-section');
  const expSec = document.getElementById('dataset-exp-params-section');
  if (clusterSec) clusterSec.style.display = isDatasetExp ? 'none' : '';
  if (expSec) expSec.style.display = isDatasetExp ? '' : 'none';

  updateDatasetExpModeFields();
}

function updateDatasetExpModeFields() {
  const mode = document.getElementById('exp-mode') ? document.getElementById('exp-mode').value : 'single';
  const setOnly = document.getElementById('exp-set-only-fields');
  if (setOnly) setOnly.style.display = mode === 'set' ? '' : 'none';
}

function renderCliqueTable() {
  document.getElementById('clique-tbody').innerHTML = cliqueRows.map((r, i) => `
    <tr>
      <td class="clique-idx">${i + 1}</td>
      <td><input type="number" class="c-nmin" data-i="${i}" value="${r.nodesMin}" min="1" onchange="syncClique(${i})"></td>
      <td><input type="number" class="c-nmax" data-i="${i}" value="${r.nodesMax}" min="1" onchange="syncClique(${i})"></td>
      <td><input type="number" class="c-imin" data-i="${i}" value="${r.intraProbMin}" min="0" max="1" step="0.01" onchange="syncClique(${i})"></td>
      <td><input type="number" class="c-imax" data-i="${i}" value="${r.intraProbMax}" min="0" max="1" step="0.01" onchange="syncClique(${i})"></td>
      <td><input type="number" class="c-emin" data-i="${i}" value="${r.interProbMin}" min="0" max="1" step="0.01" onchange="syncClique(${i})"></td>
      <td><input type="number" class="c-emax" data-i="${i}" value="${r.interProbMax}" min="0" max="1" step="0.01" onchange="syncClique(${i})"></td>
      <td>${cliqueRows.length > 1 ? `<button class="btn-sm btn-del" onclick="removeClique(${i})">x</button>` : ''}</td>
    </tr>`).join('');
}

function syncClique(i) {
  const q = sel => document.querySelector(`${sel}[data-i="${i}"]`);
  cliqueRows[i] = {
    nodesMin: parseInt(q('.c-nmin').value, 10) || 1,
    nodesMax: parseInt(q('.c-nmax').value, 10) || 1,
    intraProbMin: parseFloat(q('.c-imin').value) || 0,
    intraProbMax: parseFloat(q('.c-imax').value) || 0,
    interProbMin: parseFloat(q('.c-emin').value) || 0,
    interProbMax: parseFloat(q('.c-emax').value) || 0,
  };
}

function syncAllCliques() {
  for (let i = 0; i < cliqueRows.length; i++) syncClique(i);
}

function addClique() {
  syncAllCliques();
  cliqueRows.push({ nodesMin: 3, nodesMax: 7, intraProbMin: 1.0, intraProbMax: 1.0, interProbMin: 0.05, interProbMax: 0.15 });
  renderCliqueTable();
}

function removeClique(i) {
  syncAllCliques();
  cliqueRows.splice(i, 1);
  renderCliqueTable();
}

function validateForm() {
  const errors = [];
  const name = document.getElementById('graph-name').value.trim();
  if (!name) errors.push('Graph name is required.');

  const strategy = document.getElementById('graph-strategy').value;
  if (strategy === 'dataset-sperimentazione') {
    const mode = document.getElementById('exp-mode').value;

    const minNodes = getIntFieldValue('exp-min-nodes');
    const maxNodes = getIntFieldValue('exp-max-nodes');
    const minCliqueSize = getIntFieldValue('exp-min-clique-size');
    const maxCliqueSize = getIntFieldValue('exp-max-clique-size');
    const avgCliqueSize = getNumberFieldValue('exp-avg-clique-size');
    const minCliques = getIntFieldValue('exp-min-cliques');
    const maxCliques = getIntFieldValue('exp-max-cliques');

    if (!Number.isInteger(minNodes) || minNodes < 1) errors.push('minNodes must be an integer >= 1.');
    if (!Number.isInteger(maxNodes) || maxNodes < 1) errors.push('maxNodes must be an integer >= 1.');
    if (Number.isInteger(minNodes) && Number.isInteger(maxNodes) && minNodes > maxNodes) {
      errors.push('minNodes cannot be greater than maxNodes.');
    }

    if (!Number.isInteger(minCliqueSize) || minCliqueSize < 1) errors.push('minCliqueSize must be an integer >= 1.');
    if (!Number.isInteger(maxCliqueSize) || maxCliqueSize < 1) errors.push('maxCliqueSize must be an integer >= 1.');
    if (Number.isInteger(minCliqueSize) && Number.isInteger(maxCliqueSize) && minCliqueSize > maxCliqueSize) {
      errors.push('minCliqueSize cannot be greater than maxCliqueSize.');
    }

    if (typeof avgCliqueSize !== 'number' || Number.isNaN(avgCliqueSize)) {
      errors.push('avgCliqueSize must be a valid number.');
    }

    if (!Number.isInteger(minCliques) || minCliques < 1) errors.push('minCliques must be an integer >= 1.');
    if (!Number.isInteger(maxCliques) || maxCliques < 1) errors.push('maxCliques must be an integer >= 1.');
    if (Number.isInteger(minCliques) && Number.isInteger(maxCliques) && minCliques > maxCliques) {
      errors.push('minCliques cannot be greater than maxCliques.');
    }

    if (mode === 'set') {
      const setName = document.getElementById('exp-set-name').value.trim();
      if (!setName) errors.push('setName is required in set mode.');

      const nodeStep = getIntFieldValue('exp-node-step');
      const graphsPerNodeStep = getIntFieldValue('exp-graphs-per-node-step');
      const cliqueStep = getIntFieldValue('exp-clique-step');
      const graphsPerCliqueStep = getIntFieldValue('exp-graphs-per-clique-step');

      const hasNodeAxis = nodeStep !== null || graphsPerNodeStep !== null;
      const hasCliqueAxis = cliqueStep !== null || graphsPerCliqueStep !== null;

      if (!hasNodeAxis && !hasCliqueAxis) {
        errors.push('For mode=set you must define at least nodeStep+graphsPerNodeStep or cliqueStep+graphsPerCliqueStep.');
      }

      if (hasNodeAxis) {
        if (!Number.isInteger(nodeStep) || nodeStep < 1) errors.push('nodeStep must be an integer >= 1.');
        if (!Number.isInteger(graphsPerNodeStep) || graphsPerNodeStep < 1) errors.push('graphsPerNodeStep must be an integer >= 1.');
      }

      if (hasCliqueAxis) {
        if (!Number.isInteger(cliqueStep) || cliqueStep < 1) errors.push('cliqueStep must be an integer >= 1.');
        if (!Number.isInteger(graphsPerCliqueStep) || graphsPerCliqueStep < 1) errors.push('graphsPerCliqueStep must be an integer >= 1.');
      }
    }

    return errors;
  }

  syncAllCliques();
  cliqueRows.forEach((r, i) => {
    const p = `Clique ${i + 1}: `;
    if (!Number.isInteger(r.nodesMin) || r.nodesMin < 1) errors.push(p + 'nodesMin must be >= 1.');
    if (!Number.isInteger(r.nodesMax) || r.nodesMax < r.nodesMin) errors.push(p + 'nodesMax must be >= nodesMin.');
    if (r.intraProbMin < 0 || r.intraProbMin > 1) errors.push(p + 'intraProbMin out of [0,1].');
    if (r.intraProbMax < r.intraProbMin) errors.push(p + 'intraProbMax < intraProbMin.');
    if (r.interProbMin < 0 || r.interProbMin > 1) errors.push(p + 'interProbMin out of [0,1].');
    if (r.interProbMax < r.interProbMin) errors.push(p + 'interProbMax < interProbMin.');
  });

  return errors;
}

function buildDatasetSperimentazioneParams(name, seed) {
  const mode = document.getElementById('exp-mode').value;
  const params = {
    mode,
    minNodes: getIntFieldValue('exp-min-nodes'),
    maxNodes: getIntFieldValue('exp-max-nodes'),
    minCliqueSize: getIntFieldValue('exp-min-clique-size'),
    maxCliqueSize: getIntFieldValue('exp-max-clique-size'),
    avgCliqueSize: getNumberFieldValue('exp-avg-clique-size'),
    minCliques: getIntFieldValue('exp-min-cliques'),
    maxCliques: getIntFieldValue('exp-max-cliques'),
  };

  if (mode === 'set') {
    const setNameRaw = document.getElementById('exp-set-name').value.trim();
    params.setName = setNameRaw || name;

    const nodeStep = getIntFieldValue('exp-node-step');
    const graphsPerNodeStep = getIntFieldValue('exp-graphs-per-node-step');
    const cliqueStep = getIntFieldValue('exp-clique-step');
    const graphsPerCliqueStep = getIntFieldValue('exp-graphs-per-clique-step');

    if (nodeStep !== null) params.nodeStep = nodeStep;
    if (graphsPerNodeStep !== null) params.graphsPerNodeStep = graphsPerNodeStep;
    if (cliqueStep !== null) params.cliqueStep = cliqueStep;
    if (graphsPerCliqueStep !== null) params.graphsPerCliqueStep = graphsPerCliqueStep;
  }

  if (seed !== undefined) params.seed = seed;
  return params;
}

function generateGraph() {
  const errEl = document.getElementById('generate-error');
  const okEl = document.getElementById('generate-ok');
  const errors = validateForm();
  if (errors.length) {
    errEl.textContent = errors.join(' | ');
    errEl.style.display = 'block';
    okEl.style.display = 'none';
    return;
  }

  errEl.style.display = 'none';
  okEl.style.display = 'none';

  const name = document.getElementById('graph-name').value.trim();
  const strategy = document.getElementById('graph-strategy').value;
  const seedStr = document.getElementById('graph-seed').value;
  const seed = seedStr !== '' ? parseInt(seedStr, 10) : undefined;

  const body = { name, strategy, params: {} };
  if (strategy === 'dataset-sperimentazione') {
    body.params = buildDatasetSperimentazioneParams(name, seed);
  } else {
    body.params = { customParams: [...cliqueRows] };
    if (seed !== undefined) body.params.seed = seed;
  }

  const btn = document.getElementById('generate-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  fetch('/generate-graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);

      if (data.mode === 'set' && data.graphSet) {
        lastGraphId = null;
        generatedGraphData = null;
        document.getElementById('open-graph-page').style.display = 'none';
        d3.select('#generated-graph').selectAll('*').remove();

        const total = Array.isArray(data.graphSet.graphs) ? data.graphSet.graphs.length : 0;
        const failed = Array.isArray(data.graphSet.failures) ? data.graphSet.failures.length : 0;
        document.getElementById('graph-meta').textContent = `Set: ${data.graphSet.setName} | graphs: ${total} | failed: ${failed}`;

        okEl.textContent = `Set generated successfully: ${data.graphSet.setName}.`;
        okEl.style.display = 'block';

        const graphSection = document.getElementById('generated-graph-section');
        if (graphSection) graphSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      lastGraphId = data.id;
      generatedGraphData = data.graph || null;
      document.getElementById('open-graph-page').style.display = '';

      if (generatedGraphData) {
        const n = (generatedGraphData.nodes || []).length;
        const e = (generatedGraphData.links || generatedGraphData.edges || []).length;
        const c = (generatedGraphData.cliques || []).length;
        document.getElementById('graph-meta').textContent = `File: ${data.id} | nodes: ${n} | edges: ${e} | cliques: ${c}`;
        renderGraph(generatedGraphData);
      }

      okEl.textContent = 'Graph generated and saved successfully.';
      okEl.style.display = 'block';

      const graphSection = document.getElementById('generated-graph-section');
      if (graphSection) graphSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
    .catch(err => {
      errEl.textContent = 'Error: ' + err.message;
      errEl.style.display = 'block';
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Generate Graph';
    });
}

function openInGraphPage() {
  if (!lastGraphId) return;
  window.location.href = `/graph.html?graph=${encodeURIComponent(lastGraphId)}`;
}

function renderGraph(graphData) {
  d3.select('#generated-graph').selectAll('*').remove();
  if (!graphData) return;

  const width = 1100;
  const height = 620;
  const stripeW = 4;

  const cliques = graphData.cliques || [];
  const edgeCliqueMap = new Map();
  graphData.links.forEach(l => edgeCliqueMap.set(l.id, []));
  cliques.forEach(c => {
    const cSet = new Set(c.nodes);
    graphData.links.forEach(l => {
      const s = (typeof l.source === 'object') ? l.source.id : l.source;
      const t = (typeof l.target === 'object') ? l.target.id : l.target;
      if (cSet.has(s) && cSet.has(t)) edgeCliqueMap.get(l.id).push(c.id);
    });
  });

  const coloredLinks = graphData.links.map(l => ({ ...l, cliques: edgeCliqueMap.get(l.id) || [] }));
  const stripeData = [];
  coloredLinks.forEach(link => {
    const lc = link.cliques.length > 0 ? link.cliques : [0];
    lc.forEach((cliqueId, i) => stripeData.push({ link, cliqueId, index: i, total: lc.length }));
  });

  const svg = d3.select('#generated-graph').append('svg').attr('width', width).attr('height', height);

  const simulation = d3.forceSimulation(graphData.nodes)
    .force('link', d3.forceLink(coloredLinks).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-100))
    .force('center', d3.forceCenter(width / 2, height / 2));

  const linkStripes = svg.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(stripeData)
    .enter().append('line')
    .attr('stroke-width', d => d.total > 1 ? stripeW : 2)
    .attr('stroke', d => d.cliqueId > 0 ? d3.schemeCategory10[d.cliqueId % 10] : '#999');

  const linkLabel = svg.append('g')
    .attr('class', 'link-labels')
    .selectAll('text')
    .data(coloredLinks)
    .enter().append('text')
    .attr('font-size', 12)
    .attr('fill', '#555')
    .attr('dy', -5)
    .text(d => d.id);

  const node = svg.append('g')
    .attr('class', 'nodes')
    .selectAll('circle')
    .data(graphData.nodes)
    .enter().append('circle')
    .attr('r', 10)
    .attr('fill', '#69b3a2')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

  const nodeLabel = svg.append('g')
    .attr('class', 'node-labels')
    .selectAll('text')
    .data(graphData.nodes)
    .enter().append('text')
    .attr('font-size', 14)
    .attr('fill', '#222')
    .attr('text-anchor', 'middle')
    .attr('dy', -15)
    .text(d => d.id);

  simulation.on('tick', () => {
    linkStripes
      .attr('x1', d => {
        const s = d.link.source, t = d.link.target;
        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
        const nx = -(t.y - s.y) / len;
        const off = (d.index - (d.total - 1) / 2) * stripeW;
        return s.x + nx * off;
      })
      .attr('y1', d => {
        const s = d.link.source, t = d.link.target;
        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
        const ny = (t.x - s.x) / len;
        const off = (d.index - (d.total - 1) / 2) * stripeW;
        return s.y + ny * off;
      })
      .attr('x2', d => {
        const s = d.link.source, t = d.link.target;
        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
        const nx = -(t.y - s.y) / len;
        const off = (d.index - (d.total - 1) / 2) * stripeW;
        return t.x + nx * off;
      })
      .attr('y2', d => {
        const s = d.link.source, t = d.link.target;
        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
        const ny = (t.x - s.x) / len;
        const off = (d.index - (d.total - 1) / 2) * stripeW;
        return t.y + ny * off;
      });

    node.attr('cx', d => d.x).attr('cy', d => d.y);
    nodeLabel.attr('x', d => d.x).attr('y', d => d.y);
    linkLabel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2);
  });

  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
}

renderCliqueTable();
updateStrategySections();

document.getElementById('graph-strategy').addEventListener('change', updateStrategySections);
document.getElementById('exp-mode').addEventListener('change', updateDatasetExpModeFields);
