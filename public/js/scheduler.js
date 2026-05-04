let availableJsonFiles = [];
let queueDraftJobs = [];
let graphSets = [];
let expandedSetName = null;
let expandedQueueIds = new Set();
let latestQueuesSnapshot = [];
let queuedGraphSets = [];
let workflowRegistry = null;

function formatStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

function sanitizeNamePart(str) {
  return String(str || 'graph')
    .replace(/\.json$/i, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getGraphNameById(jsonFileId) {
  const file = availableJsonFiles.find(f => f.id === jsonFileId);
  return file ? sanitizeNamePart(file.name) : 'graph';
}

function buildDynamicJobName(job) {
  const stamp = formatStamp(job.createdAt || new Date());
  const graphName = getGraphNameById(job.jsonFileId);
  const optType = sanitizeNamePart(job.optType || 'max');
  return `job_${stamp}_${graphName}_${optType}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWorkflowSummary() {
  const el = document.getElementById('workflow-summary');
  if (!el) return;
  if (!workflowRegistry) {
    el.textContent = 'Workflow status not available.';
    return;
  }

  const p = workflowRegistry.pipelines || {};
  const q = workflowRegistry.queues || {};
  const pTime = p.updatedAt ? new Date(p.updatedAt).toLocaleString('it-IT') : '-';
  const qTime = q.updatedAt ? new Date(q.updatedAt).toLocaleString('it-IT') : '-';
  el.textContent = `Pipeline registry: ${p.count ?? 0} (updated ${pTime}) | Queue registry: ${q.count ?? 0} (updated ${qTime})`;
}

async function loadWorkflowRegistry() {
  try {
    const r = await fetch('/workflow/registry');
    const data = await r.json();
    workflowRegistry = data;
    renderWorkflowSummary();
  } catch (_) {
    workflowRegistry = null;
    renderWorkflowSummary();
  }
}

async function clearWorkflow(scope) {
  const label = scope === 'all' ? 'the entire workflow' : `workflow ${scope}`;
  if (!confirm(`Confirm clearing ${label} in logs/workflow?`)) return;

  const err = document.getElementById('workflow-error');
  const msg = document.getElementById('workflow-msg');
  try {
    const r = await fetch(`/workflow/registry?scope=${encodeURIComponent(scope)}`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Workflow cleanup error');

    workflowRegistry = data.registry || null;
    renderWorkflowSummary();
    msg.textContent = data.message || 'Workflow cleared successfully.';
    msg.style.display = 'block';
    if (err) err.style.display = 'none';
  } catch (e) {
    if (err) {
      err.textContent = 'Error: ' + e.message;
      err.style.display = 'block';
    }
  }
}

function statusBadge(s) {
  const cls = `badge-${s || 'pending'}`;
  return `<span class="badge ${cls}">${esc(s || 'pending')}</span>`;
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function formatDuration(start, end) {
  if (!start) return '-';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '-';
  const sec = Math.max(0, Math.floor((e - s) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function renderQueuedGraphSets() {
  const tbody = document.getElementById('set-queue-tbody');
  const tbl = document.getElementById('set-queue-tbl');
  const empty = document.getElementById('set-queue-empty');
  if (!tbody || !tbl || !empty) return;

  if (!queuedGraphSets.length) {
    tbody.innerHTML = '';
    tbl.style.display = 'none';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  tbl.style.display = '';
  tbody.innerHTML = queuedGraphSets.map((setName, idx) => {
    const meta = graphSets.find((s) => s.setName === setName);
    const total = meta && Number.isInteger(meta.totalGraphs) ? meta.totalGraphs : '-';
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(setName)}</td>
        <td>${esc(String(total))}</td>
        <td><button class="btn-sm btn-del" onclick="removeGraphSetFromQueue('${esc(setName)}')">Remove</button></td>
      </tr>`;
  }).join('');
}

function addGraphSetToQueue(setName) {
  if (!setName) return;
  if (!queuedGraphSets.includes(setName)) {
    queuedGraphSets.push(setName);
    renderQueuedGraphSets();
    return;
  }
  alert(`Set already in queue: ${setName}`);
}

function removeGraphSetFromQueue(setName) {
  queuedGraphSets = queuedGraphSets.filter((s) => s !== setName);
  renderQueuedGraphSets();
}

async function buildSetQueueJobs(setNames, optType) {
  const jobs = [];
  for (const setName of setNames) {
    const r = await fetch(`/graph-sets/${encodeURIComponent(setName)}`);
    const data = await r.json();
    if (!r.ok || data.error) {
      throw new Error(data.error || `Error loading set ${setName}`);
    }

    const setJobs = (data.graphs || []).map((g) => ({
      mode: 'dataset-set',
      name: `set_${setName}_${g.id}`,
      setName,
      graphPath: g.filePath,
      jsonFileId: `${setName}/${g.filePath}`,
      optType,
      solverParams: {},
    }));
    jobs.push(...setJobs);
  }
  return jobs;
}

async function startGraphSetQueue() {
  if (!queuedGraphSets.length) {
    alert('Add at least one graph set to the queue.');
    return;
  }

  const btn = document.getElementById('start-set-queue-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting set queue...';
  }

  try {
    const optSel = document.getElementById('set-queue-opt');
    const optType = optSel ? String(optSel.value || 'max').toLowerCase() : 'max';
    const jobs = await buildSetQueueJobs(queuedGraphSets, optType);

    if (!jobs.length) {
      throw new Error('No jobs generated from selected sets.');
    }

    const queueName = `set_batch_${formatStamp(new Date())}`;
    const r = await fetch('/pipeline-queues/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: queueName, jobs }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error starting set queue');

    queuedGraphSets = [];
    renderQueuedGraphSets();
    await loadQueues();
    await loadGraphSets();
    alert(`Set queue started (${data.queueId}).`);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Start set queue';
    }
  }
}

async function loadJsonFiles() {
  const r = await fetch('/uploaded-json-files');
  const data = await r.json();
  availableJsonFiles = data.files || [];

  queueDraftJobs.forEach((job) => {
    if (job.autoName) {
      job.name = buildDynamicJobName(job);
    }
  });
}

function makeDefaultJob() {
  const first = availableJsonFiles[0];
  const job = {
    createdAt: new Date().toISOString(),
    name: '',
    jsonFileId: first ? first.id : '',
    optType: 'max',
    timeLimit: '',
    mipGap: '',
    nodeLimit: '',
    autoName: true,
  };
  job.name = buildDynamicJobName(job);
  return job;
}

function addJobRow() {
  queueDraftJobs.push(makeDefaultJob());
  renderDraftJobs();
}

function removeJobRow(i) {
  queueDraftJobs.splice(i, 1);
  renderDraftJobs();
}

function onDraftChange(i, key, value) {
  if (key === 'name') {
    queueDraftJobs[i][key] = value;
    queueDraftJobs[i].autoName = false;
    return;
  }

  queueDraftJobs[i][key] = value;

  if ((key === 'jsonFileId' || key === 'optType') && queueDraftJobs[i].autoName) {
    queueDraftJobs[i].name = buildDynamicJobName(queueDraftJobs[i]);
    renderDraftJobs();
  }
}

function renderDraftJobs() {
  const tbody = document.getElementById('jobs-tbody');
  if (!tbody) return;

  tbody.innerHTML = queueDraftJobs.map((j, i) => {
    const opts = availableJsonFiles.map(f => `<option value="${esc(f.id)}" ${f.id === j.jsonFileId ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    return `
      <tr>
        <td>${i + 1}</td>
        <td><input value="${esc(j.name)}" onchange="onDraftChange(${i}, 'name', this.value)"></td>
        <td>
          <select onchange="onDraftChange(${i}, 'jsonFileId', this.value)">
            ${opts}
          </select>
        </td>
        <td>
          <select onchange="onDraftChange(${i}, 'optType', this.value)">
            <option value="max" ${j.optType === 'max' ? 'selected' : ''}>max</option>
            <option value="min" ${j.optType === 'min' ? 'selected' : ''}>min</option>
          </select>
        </td>
        <td><input type="number" min="1" value="${esc(j.timeLimit)}" onchange="onDraftChange(${i}, 'timeLimit', this.value)"></td>
        <td><input type="number" min="0" step="0.001" value="${esc(j.mipGap)}" onchange="onDraftChange(${i}, 'mipGap', this.value)"></td>
        <td><input type="number" min="1" value="${esc(j.nodeLimit)}" onchange="onDraftChange(${i}, 'nodeLimit', this.value)"></td>
        <td><button class="btn-sm btn-del" onclick="removeJobRow(${i})">x</button></td>
      </tr>`;
  }).join('');
}

function validateQueue() {
  const errors = [];
  if (queueDraftJobs.length === 0) {
    errors.push('Add at least one job.');
  }

  queueDraftJobs.forEach((j, i) => {
    const p = `Job ${i + 1}: `;
    if (!j.name || !j.name.trim()) errors.push(p + 'nome obbligatorio.');
    if (!j.jsonFileId) errors.push(p + 'dataset JSON obbligatorio.');
    if (!['max', 'min'].includes(String(j.optType))) errors.push(p + 'optType non valido.');
  });

  return errors;
}

function buildPayloadJobs() {
  return queueDraftJobs.map(j => {
    const solverParams = {};
    if (j.timeLimit !== '') solverParams.timeLimit = j.timeLimit;
    if (j.mipGap !== '') solverParams.mipGap = j.mipGap;
    if (j.nodeLimit !== '') solverParams.nodeLimit = j.nodeLimit;

    return {
      mode: 'dataset',
      name: j.name.trim(),
      jsonFileId: j.jsonFileId,
      optType: j.optType,
      solverParams,
    };
  });
}

async function startQueue() {
  const errEl = document.getElementById('queue-error');
  const okEl = document.getElementById('queue-ok');
  const errors = validateQueue();
  if (errors.length) {
    errEl.textContent = errors.join(' | ');
    errEl.style.display = 'block';
    okEl.style.display = 'none';
    return;
  }

  errEl.style.display = 'none';
  okEl.style.display = 'none';

  const btn = document.getElementById('start-queue-btn');
  btn.disabled = true;
  btn.textContent = 'Starting queue...';

  try {
    const body = {
      name: document.getElementById('queue-name').value.trim(),
      jobs: buildPayloadJobs(),
    };
    const r = await fetch('/pipeline-queues/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error starting queue');

    okEl.textContent = `Queue started with id ${data.queueId}`;
    okEl.style.display = 'block';
    await loadQueues();
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start sequential queue';
  }
}

function renderQueues(queues) {
  const wrap = document.getElementById('queues-wrap');
  const empty = document.getElementById('no-queues');

  if (!queues || queues.length === 0) {
    empty.style.display = '';
    wrap.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  const queueIdSet = new Set((queues || []).map((q) => q.id));
  expandedQueueIds = new Set(Array.from(expandedQueueIds).filter((id) => queueIdSet.has(id)));

  wrap.innerHTML = [...queues].reverse().map(q => {
    const isExpanded = expandedQueueIds.has(q.id);
    const actions = [];
    if (q.status === 'running') {
      actions.push(`<button class="btn-sm btn-stop" onclick="stopQueue('${esc(q.id)}')">Stop</button>`);
    }
    actions.push(`<button class="btn-sm btn-del" onclick="deleteQueue('${esc(q.id)}')">Delete</button>`);

    const jobsRows = (q.items || []).map((it, idx) => {
      const pipeCell = it.pipelineId
        ? `<a href="/pipeline.html" target="_blank">${esc(it.pipelineId)}</a>`
        : '-';
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(it.name)}</td>
          <td>${esc(it.mode)}</td>
          <td>${esc(it.jsonFileId || '-')}</td>
          <td>${statusBadge(it.status)}</td>
          <td>${pipeCell}</td>
          <td>${esc(it.error || '-')}</td>
        </tr>`;
    }).join('');

    return `
      <div class="queue-card">
        <div class="queue-header">
          <div>
            <strong>${esc(q.name)}</strong>
            <span style="margin-left:8px;">${statusBadge(q.status)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:12px;color:#666;">job: ${q.totalItems} | corrente: ${q.currentIndex >= 0 ? (q.currentIndex + 1) : '-'}</span>
            <button class="btn-sm btn-fold" onclick="toggleQueueCard('${esc(q.id)}')">${isExpanded ? 'Hide details' : 'Show details'}</button>
            ${actions.join('')}
          </div>
        </div>
        <table class="queue-jobs ${isExpanded ? '' : 'queue-jobs-collapsed'}">
          <thead>
            <tr>
              <th>#</th>
              <th>Nome</th>
              <th>Mode</th>
              <th>JSON</th>
              <th>Status</th>
              <th>Pipeline</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>${jobsRows}</tbody>
        </table>
      </div>`;
  }).join('');
}

function toggleQueueCard(queueId) {
  if (expandedQueueIds.has(queueId)) {
    expandedQueueIds.delete(queueId);
  } else {
    expandedQueueIds.add(queueId);
  }
  renderQueues(latestQueuesSnapshot);
}

async function stopQueue(queueId) {
  if (!confirm('Stop this queue? The current job will be interrupted and subsequent jobs canceled.')) return;
  try {
    const r = await fetch(`/pipeline-queues/${encodeURIComponent(queueId)}?action=stop`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error stopping queue');
    await loadQueues();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteQueue(queueId) {
  if (!confirm('Delete this queue from history? If active it will be stopped first.')) return;
  try {
    const r = await fetch(`/pipeline-queues/${encodeURIComponent(queueId)}?action=delete`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error deleting queue');
    await loadQueues();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function loadQueues() {
  try {
    const r = await fetch('/pipeline-queues');
    const data = await r.json();
    latestQueuesSnapshot = data.queues || [];
    renderQueues(latestQueuesSnapshot);
  } catch (e) {
    console.error('Error loading queues', e);
  }
}

function renderGraphSetDetails(data) {
  const wrap = document.getElementById('set-details-wrap');
  if (!wrap) return;

  const rows = (data.graphs || []).map((g, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${esc(g.id)}</td>
      <td>${Number.isInteger(g.nodes) ? g.nodes : '-'}</td>
      <td>${Number.isInteger(g.edges) ? g.edges : '-'}</td>
      <td>${Array.isArray(g.cliques) ? esc(g.cliques.join(', ')) : '-'}</td>
      <td>${statusBadge(g.status || 'idle')}</td>
      <td>${esc(formatDateTime(g.startTime))}</td>
      <td>${esc(formatDateTime(g.endTime))}</td>
      <td>${esc(formatDuration(g.startTime, g.endTime))}</td>
      <td>${g.pipelineId ? `<a href="/pipeline.html" target="_blank">${esc(g.pipelineId)}</a>` : '-'}</td>
      <td>${esc(g.error || '-')}</td>
    </tr>
  `).join('');

  const q = data.queue || {};
  const queueTiming = `Start: ${formatDateTime(q.startTime)} | End: ${formatDateTime(q.endTime)} | Duration: ${formatDuration(q.startTime, q.endTime)}`;

  wrap.innerHTML = `
    <div class="set-detail-card">
      <div class="set-detail-head">
        <strong>Set details: ${esc(data.setName)}</strong>
        <span>Queue: ${statusBadge(data.queue && data.queue.status ? data.queue.status : 'idle')}</span>
      </div>
      <div style="font-size:12px;color:#556; margin-bottom:8px;">${esc(queueTiming)}</div>
      <table class="queue-jobs">
        <thead>
          <tr>
            <th>#</th>
            <th>Graph ID</th>
            <th>Nodes</th>
            <th>Edges</th>
            <th>Clique list</th>
            <th>Status</th>
            <th>Start</th>
            <th>End</th>
            <th>Duration</th>
            <th>Pipeline</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function toggleGraphSetDetails(setName) {
  const nextName = expandedSetName === setName ? null : setName;
  expandedSetName = nextName;
  if (!expandedSetName) {
    const wrap = document.getElementById('set-details-wrap');
    if (wrap) wrap.innerHTML = '';
    renderGraphSets();
    return;
  }

  try {
    const r = await fetch(`/graph-sets/${encodeURIComponent(expandedSetName)}`);
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error loading set details');
    renderGraphSetDetails(data);
  } catch (e) {
    alert('Error: ' + e.message);
  }
  renderGraphSets();
}

async function loadExpandedGraphSetDetails() {
  if (!expandedSetName) return;
  try {
    const r = await fetch(`/graph-sets/${encodeURIComponent(expandedSetName)}`);
    const data = await r.json();
    if (!r.ok || data.error) return;
    renderGraphSetDetails(data);
  } catch (_) {}
}

async function runGraphSetQueue(setName) {
  try {
    const r = await fetch(`/graph-sets/${encodeURIComponent(setName)}/run-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optType: 'max' }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error starting set queue');
    await loadGraphSets();
    if (expandedSetName === setName) await loadExpandedGraphSetDetails();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function cancelGraphSetQueue(setName) {
  if (!confirm(`Stop the queue for set ${setName}?`)) return;
  try {
    const r = await fetch(`/graph-sets/${encodeURIComponent(setName)}/queue`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error stopping set queue');
    await loadGraphSets();
    if (expandedSetName === setName) await loadExpandedGraphSetDetails();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteGraphSetQueueExecution(setName) {
  if (!confirm(`Delete the set queue execution for ${setName} from active history? Already computed results will NOT be deleted.`)) return;
  try {
    const r = await fetch(`/graph-sets/${encodeURIComponent(setName)}/queue?action=delete`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error deleting set queue');
    await loadQueues();
    await loadGraphSets();
    if (expandedSetName === setName) await loadExpandedGraphSetDetails();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteGraphSet(setName) {
  try {
    const previewResp = await fetch(`/graph-sets/${encodeURIComponent(setName)}/delete-preview`);
    const preview = await previewResp.json();
    if (!previewResp.ok || preview.error) throw new Error(preview.error || 'Error preparing set delete preview');

    const confirmMsg = [
      `Permanently delete graph set ${setName}?`,
      ``,
      `The following will be deleted:`,
      `- set metadata: ${preview.metadataFile || `${setName}.json`}`,
      `- graph files: ${preview.graphFiles || 0}`,
      `- imported status: ${preview.hasImportedExecution ? 'yes' : 'no'}`,
      `- active/history queue references: ${preview.queueRefs || 0}`,
      ``,
      `Computed results will NOT be deleted (solutions/logs already produced).`,
    ].join('\n');
    if (!confirm(confirmMsg)) return;

    const r = await fetch(`/graph-sets/${encodeURIComponent(setName)}`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error deleting graph set');

    queuedGraphSets = queuedGraphSets.filter((s) => s !== setName);
    if (expandedSetName === setName) {
      expandedSetName = null;
      const wrap = document.getElementById('set-details-wrap');
      if (wrap) wrap.innerHTML = '';
    }

    renderQueuedGraphSets();
    await loadQueues();
    await loadGraphSets();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function exportGraphSetResults(setName) {
  if (!setName) return;
  const url = `/graph-sets/${encodeURIComponent(setName)}/execution-results/export`;
  window.open(url, '_blank');
}

function triggerImportGraphSetResults() {
  const input = document.getElementById('import-set-results-file');
  if (!input) return;
  input.value = '';
  input.click();
}

async function onImportGraphSetResultsFile(inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0] ? inputEl.files[0] : null;
  if (!file) return;

  try {
    const fd = new FormData();
    fd.append('file', file);

    const r = await fetch('/graph-sets/execution-results/import-zip', {
      method: 'POST',
      body: fd,
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error importing results');

    await loadGraphSets();
    if (data.setName && expandedSetName === data.setName) {
      await loadExpandedGraphSetDetails();
    }
    alert(`Import completato per set ${data.setName}.`);
  } catch (e) {
    alert('Import error: ' + e.message);
  } finally {
    if (inputEl) inputEl.value = '';
  }
}

function renderGraphSets() {
  const tbody = document.getElementById('sets-tbody');
  const empty = document.getElementById('no-sets');
  if (!tbody || !empty) return;

  if (!graphSets || graphSets.length === 0) {
    empty.style.display = '';
    tbody.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = graphSets.map((s) => {
    const isRunning = s.queueStatus === 'running';
    const hasExecution = s.queueStatus && s.queueStatus !== 'idle';
    const isQueued = queuedGraphSets.includes(s.setName);
    const actionBtn = isRunning
      ? `<button class="btn-sm btn-stop" onclick="cancelGraphSetQueue('${esc(s.setName)}')">Cancel</button>`
      : `<button class="btn-sm btn-ok" onclick="runGraphSetQueue('${esc(s.setName)}')">Run Queue</button>`;
    const deleteExecutionBtn = hasExecution
      ? `<button class="btn-sm btn-del" onclick="deleteGraphSetQueueExecution('${esc(s.setName)}')">Delete execution</button>`
      : '';
    const enqueueBtn = isQueued
      ? `<button class="btn-sm btn-del" onclick="removeGraphSetFromQueue('${esc(s.setName)}')">Remove from queue</button>`
      : `<button class="btn-sm btn-fold" onclick="addGraphSetToQueue('${esc(s.setName)}')">Add to queue</button>`;
    const exportBtn = `<button class="btn-sm btn-fold" onclick="exportGraphSetResults('${esc(s.setName)}')">Export results</button>`;
    const deleteSetBtn = `<button class="btn-sm btn-del" onclick="deleteGraphSet('${esc(s.setName)}')">Delete set</button>`;
    const progress = s.progress ? `${s.progress.processed}/${s.progress.total}` : `0/${s.totalGraphs || 0}`;
    const selectedClass = expandedSetName === s.setName ? 'set-row-active' : '';
    const timing = `Q: ${formatDuration(s.queueStartTime, s.queueEndTime)}`;

    return `
      <tr class="set-row ${selectedClass}">
        <td><button class="set-link" onclick="toggleGraphSetDetails('${esc(s.setName)}')">${esc(s.setName)}</button></td>
        <td>${esc(formatDateTime(s.createdAt))}</td>
        <td>${esc(String(s.totalGraphs || 0))}</td>
        <td>${s.minNodes !== null && s.maxNodes !== null ? `${s.minNodes} -> ${s.maxNodes}` : '-'}</td>
        <td>${s.minCliques !== null && s.maxCliques !== null ? `${s.minCliques} -> ${s.maxCliques}` : '-'}</td>
        <td>${statusBadge(s.queueStatus || 'idle')}</td>
        <td>${esc(progress)}</td>
        <td>${esc(timing)}</td>
        <td>${actionBtn} ${deleteExecutionBtn} ${enqueueBtn} ${exportBtn} ${deleteSetBtn}</td>
      </tr>`;
  }).join('');
}

async function loadGraphSets() {
  try {
    const r = await fetch('/graph-sets');
    const data = await r.json();
    graphSets = data.sets || [];
    renderGraphSets();
    await loadExpandedGraphSetDetails();
  } catch (e) {
    console.error('Error loading graph sets', e);
  }
}

async function init() {
  await loadWorkflowRegistry();
  await loadJsonFiles();
  if (queueDraftJobs.length === 0) addJobRow();
  renderDraftJobs();
  await loadQueues();
  await loadGraphSets();
  renderQueuedGraphSets();
  setInterval(loadQueues, 2000);
  setInterval(loadGraphSets, 2500);
}

init();
