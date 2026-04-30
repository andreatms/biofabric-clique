const assert = require('assert');
const fs = require('fs');
const path = require('path');
const utils = require('../utils');

function cleanupSet(setName) {
  const setsDir = path.join(__dirname, '..', 'data', 'sets');
  const metaPath = path.join(setsDir, `${setName}.json`);
  const graphDir = path.join(setsDir, 'graphs', setName);
  try { fs.rmSync(metaPath, { force: true }); } catch (_) {}
  try { fs.rmSync(graphDir, { recursive: true, force: true }); } catch (_) {}
}

function assertConnectedAndNoIsolated(graph, label) {
  assert.ok(Array.isArray(graph.nodes), `${label}: nodes must be an array`);
  assert.ok(Array.isArray(graph.links), `${label}: links must be an array`);

  const nodeIds = graph.nodes.map((n) => n.id);
  const adj = new Map(nodeIds.map((id) => [id, new Set()]));
  for (const e of graph.links) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source).add(e.target);
    adj.get(e.target).add(e.source);
  }

  if (nodeIds.length > 1) {
    for (const id of nodeIds) {
      assert.ok(adj.get(id).size > 0, `${label}: node ${id} is isolated`);
    }
  }

  if (nodeIds.length === 0) return;
  const visited = new Set();
  const stack = [nodeIds[0]];
  visited.add(nodeIds[0]);

  while (stack.length > 0) {
    const cur = stack.pop();
    for (const nb of adj.get(cur)) {
      if (!visited.has(nb)) {
        visited.add(nb);
        stack.push(nb);
      }
    }
  }

  assert.strictEqual(visited.size, nodeIds.length, `${label}: graph is not connected`);
}

function testValidation() {
  assert.throws(() => {
    utils.generateGraphJsonDatasetSperimentazione('bad_case', {
      mode: 'single',
      minNodes: 20,
      maxNodes: 10,
      minCliqueSize: 3,
      maxCliqueSize: 5,
      avgCliqueSize: 4,
      minCliques: 2,
      maxCliques: 4,
    });
  }, /minNodes/);

  assert.throws(() => {
    utils.generateGraphJsonDatasetSperimentazione('bad_set', {
      mode: 'set',
      setName: 'bad_set',
      minNodes: 10,
      maxNodes: 20,
      minCliqueSize: 3,
      maxCliqueSize: 6,
      avgCliqueSize: 4,
      minCliques: 2,
      maxCliques: 5,
    });
  }, /nodeStep\+graphsPerNodeStep o cliqueStep\+graphsPerCliqueStep/);
}

function testSetGenerationIntegration() {
  const setName = `integration_set_${Date.now()}`;
  cleanupSet(setName);

  const result = utils.generateGraphJsonDatasetSperimentazione('integration', {
    mode: 'set',
    setName,
    seed: 123,
    minNodes: 12,
    maxNodes: 18,
    nodeStep: 3,
    graphsPerNodeStep: 2,
    minCliqueSize: 3,
    maxCliqueSize: 6,
    avgCliqueSize: 4,
    minCliques: 2,
    maxCliques: 6,
  });

  assert.strictEqual(result.setName, setName);
  assert.ok(Array.isArray(result.graphs));
  assert.ok(result.graphs.length > 0);

  const setsDir = path.join(__dirname, '..', 'data', 'sets');
  const metadataPath = path.join(setsDir, `${setName}.json`);
  assert.ok(fs.existsSync(metadataPath), 'metadata file should exist');

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.strictEqual(metadata.setName, setName);
  assert.strictEqual(metadata.graphs.length, result.graphs.length);

  const firstOk = metadata.graphs.find((g) => g.status === 'ok');
  assert.ok(firstOk, 'at least one generated graph should be successful');

  const graphPath = path.join(setsDir, 'graphs', setName, firstOk.filePath);
  assert.ok(fs.existsSync(graphPath), 'graph file for successful item should exist');

  const graphObj = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  assert.ok(Array.isArray(graphObj.nodes));
  assert.ok(Array.isArray(graphObj.links));
  assert.ok(Array.isArray(graphObj.cliques));
  assertConnectedAndNoIsolated(graphObj, 'set graph');

  cleanupSet(setName);
}

function testSingleGraphConnectivity() {
  const graph = utils.generateGraphJsonDatasetSperimentazione('single_connected', {
    mode: 'single',
    seed: 99,
    minNodes: 14,
    maxNodes: 18,
    minCliqueSize: 3,
    maxCliqueSize: 6,
    avgCliqueSize: 4,
    minCliques: 2,
    maxCliques: 6,
  });

  assertConnectedAndNoIsolated(graph, 'single graph');
}

function main() {
  testValidation();
  testSingleGraphConnectivity();
  testSetGenerationIntegration();
  console.log('All dataset-sperimentazione graph generation tests passed.');
}

main();
