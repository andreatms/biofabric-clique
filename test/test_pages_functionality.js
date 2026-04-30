/**
 * Integration tests for page-level functionality.
 *
 * Scope:
 * - Static pages served by Express
 * - API endpoints used by Graph / Dataset / Pipeline pages
 *
 * Run with:
 *   node test/test_pages_functionality.js
 */

const { spawn } = require('child_process');
const path = require('path');

const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_PATH = path.join(__dirname, '..', 'server.js');

let passed = 0;
let failed = 0;

function pass(message) {
  console.log('  +', message);
  passed++;
}

function fail(message, details) {
  console.error('  -', message);
  if (details) console.error('    ', details);
  failed++;
}

function assert(condition, message, details) {
  if (condition) pass(message);
  else fail(message, details);
}

async function request(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = null;
  }
  return { res, text, json };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const onReady = (data) => {
      stdoutBuffer += data.toString();
      if (!settled && stdoutBuffer.includes(`Server is running on port ${PORT}`)) {
        settled = true;
        resolve({ child, stdoutBuffer, stderrBuffer });
      }
    };

    const onStderr = (data) => {
      stderrBuffer += data.toString();
    };

    child.stdout.on('data', onReady);
    child.stderr.on('data', onStderr);

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Server exited early with code ${code}. stderr: ${stderrBuffer}`));
      }
    });
  });
}

async function stopServer(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function testStaticPages() {
  console.log('\n=== Static Pages ===');
  const pages = [
    ['/', 'BioFabric'],
    ['/graph.html', 'Graph'],
    ['/pipeline.html', 'Pipeline'],
    ['/dataset.html', 'Dataset'],
    ['/result.html', 'Risultati'],
  ];

  for (const [route, marker] of pages) {
    const { res, text } = await request(route);
    assert(res.status === 200, `${route} responds with 200`, `status=${res.status}`);
    assert(/text\/html/i.test(res.headers.get('content-type') || ''), `${route} returns HTML`);
    assert(text.includes(marker), `${route} contains marker "${marker}"`);
  }
}

async function testGraphPageApis() {
  console.log('\n=== Graph APIs ===');

  const list = await request('/uploaded-json-files');
  assert(list.res.status === 200, '/uploaded-json-files responds with 200', `status=${list.res.status}`);
  assert(Array.isArray(list.json && list.json.files), '/uploaded-json-files returns files array');

  const invalid = await request('/generate-graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(invalid.res.status === 400, '/generate-graph rejects missing payload', `status=${invalid.res.status}`);

  const payload = {
    name: 'integration_graph',
    params: {
      seed: 7,
      customParams: [
        {
          nodesMin: 3,
          nodesMax: 3,
          intraProbMin: 1,
          intraProbMax: 1,
          interProbMin: 0,
          interProbMax: 0,
        },
      ],
    },
  };

  const created = await request('/generate-graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert(created.res.status === 200, '/generate-graph creates a graph', `status=${created.res.status} body=${created.text}`);
  assert(Boolean(created.json && created.json.id), '/generate-graph returns generated id');

  if (!created.json || !created.json.id) return;

  const graphId = created.json.id;
  const graph = await request(`/jsonFiles/${encodeURIComponent(graphId)}`);
  assert(graph.res.status === 200, '/jsonFiles/:id returns generated graph', `status=${graph.res.status}`);
  assert(Array.isArray(graph.json && graph.json.nodes), 'generated graph has nodes array');
  assert(Array.isArray(graph.json && graph.json.links), 'generated graph has links array');
  assert(Array.isArray(graph.json && graph.json.cliques), 'generated graph has cliques array');

  const deleted = await request(`/delete-json-file/${encodeURIComponent(graphId)}`, { method: 'DELETE' });
  assert(deleted.res.status === 200, '/delete-json-file/:id deletes generated graph', `status=${deleted.res.status}`);
}

async function testPipelineApis() {
  console.log('\n=== Pipeline APIs ===');

  const list = await request('/pipelines');
  assert(list.res.status === 200, '/pipelines responds with 200', `status=${list.res.status}`);
  assert(Array.isArray(list.json && list.json.pipelines), '/pipelines returns pipelines array');

  const invalid = await request('/pipelines/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '' }),
  });
  assert(invalid.res.status === 400, '/pipelines/run validates required fields', `status=${invalid.res.status}`);

  const invalidFromJson = await request('/pipelines/run-from-json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });
  assert(invalidFromJson.res.status === 400, '/pipelines/run-from-json validates required fields', `status=${invalidFromJson.res.status}`);
}

async function main() {
  let child = null;
  try {
    console.log('Starting server for integration tests...');
    const started = await startServer();
    child = started.child;

    await testStaticPages();
    await testGraphPageApis();
    await testPipelineApis();
  } catch (err) {
    fail('Test runner crashed', err && err.stack ? err.stack : String(err));
  } finally {
    await stopServer(child);
  }

  console.log(`\n${'-'.repeat(44)}`);
  console.log(`  ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log(`${'-'.repeat(44)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
