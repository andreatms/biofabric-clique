function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadDatasets() {
  const select = document.getElementById('dataset-select');
  if (!select) return;

  try {
    const r = await fetch('/uploaded-json-files');
    const data = await r.json();
    const files = data.files || [];
    select.innerHTML = '';

    if (files.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No JSON available';
      select.appendChild(opt);
      return;
    }

    files.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('Error loading JSON dataset', e);
  }
}

function validateForm() {
  const errors = [];
  const name = document.getElementById('pipe-name').value.trim();
  const jsonFileId = document.getElementById('dataset-select').value;
  if (!name) errors.push('Pipeline name is required.');
  if (!jsonFileId) errors.push('Select a JSON dataset.');
  return errors;
}

function launchPipeline() {
  const errEl = document.getElementById('launch-error');
  const errors = validateForm();
  if (errors.length > 0) {
    errEl.textContent = errors.join('  |  ');
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  const name    = document.getElementById('pipe-name').value.trim();
  const jsonFileId = document.getElementById('dataset-select').value;
  const optType = document.getElementById('pipe-opt-type').value;

  const solverParams = {};
  const tl = document.getElementById('pipe-time-limit').value;
  const mg = document.getElementById('pipe-mip-gap').value;
  const nl = document.getElementById('pipe-node-limit').value;
  if (tl) solverParams.timeLimit  = tl;
  if (mg) solverParams.mipGap     = mg;
  if (nl) solverParams.nodeLimit  = nl;

  const body = { name, jsonFileId, optType, solverParams };

  const btn = document.getElementById('launch-btn');
  btn.disabled    = true;
  btn.textContent = 'Launching...';

  fetch('/pipelines/run-from-json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      loadPipelines();
    })
    .catch(err => {
      errEl.textContent  = 'Error: ' + err.message;
      errEl.style.display = 'block';
    })
    .finally(() => {
      btn.disabled    = false;
      btn.textContent = 'Launch Pipeline from JSON';
    });
}

function fmtDuration(start, end) {
  const ms = ((end ? new Date(end) : new Date()) - new Date(start));
  const s  = Math.max(0, Math.floor(ms / 1000));
  if (s < 60)   return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' m ' + (s % 60) + ' s';
  return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' m';
}

function fmtTime(dt) {
  if (!dt) return '-';
  return new Date(dt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const STATUS_META = {
  'generating-graph': { cls: 'badge-gen',  label: 'Graph generation' },
  'generating-lp':    { cls: 'badge-gen',  label: 'LP generation'    },
  'running':          { cls: 'badge-run',  label: 'Running'          },
  'completed':        { cls: 'badge-ok',   label: 'Completed'        },
  'failed':           { cls: 'badge-fail', label: 'Failed'           },
  'stopped':          { cls: 'badge-stop', label: 'Stopped'          },
};

function statusBadge(status) {
  const { cls, label } = STATUS_META[status] || { cls: 'badge-stop', label: status };
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderPipelineList(list, { noMsgId, tableId, tbodyId }) {
  const noMsg = document.getElementById(noMsgId);
  const table = document.getElementById(tableId);
  const tbody = document.getElementById(tbodyId);

  if (!noMsg || !table || !tbody) return;

  if (!list || list.length === 0) {
    noMsg.style.display = '';
    table.style.display = 'none';
    return;
  }
  noMsg.style.display = 'none';
  table.style.display = '';

  const isActive = s => ['generating-graph', 'generating-lp', 'running'].includes(s);
  const isDone   = s => ['completed', 'failed', 'stopped'].includes(s);

  tbody.innerHTML = [...list].reverse().map(p => {
    const gapStr    = (p.gap !== null && p.gap !== undefined) ? p.gap.toFixed(2) + '%' : '-';
    const graphInfo = p.graphInfo ? `${p.graphInfo.nodes} n / ${p.graphInfo.edges} e` : '-';
    const errTip    = p.error ? ` title="${esc(p.error)}"` : '';

    const actions = [
      `<button class="btn-sm btn-log" onclick="showLog('${p.id}')">Log</button>`,
    ];
    if (p.status === 'completed' && p.graphId && p.solFileName) {
      actions.push(`<button class="btn-sm btn-view" onclick="viewInBiofabric('${esc(p.graphId)}','${esc(p.solFileName)}')">Biofabric</button>`);
    }
    if (isActive(p.status)) {
      actions.push(`<button class="btn-sm btn-stop" onclick="stopPipeline('${p.id}')">Stop</button>`);
    }
    if (isDone(p.status)) {
      actions.push(`<button class="btn-sm btn-del" onclick="deletePipeline('${p.id}')">Delete</button>`);
    }

    return `<tr${errTip}>
      <td style="font-weight:600;">${esc(p.name)}</td>
      <td><code>${esc(p.optType)}</code></td>
      <td>${statusBadge(p.status)}</td>
      <td class="gap-cell">${gapStr}</td>
      <td style="font-size:12px;color:#777;">${graphInfo}</td>
      <td style="font-size:12px;">${fmtTime(p.startTime)}</td>
      <td style="font-size:12px;color:#777;">${fmtDuration(p.startTime, p.endTime)}</td>
      <td>${actions.join('')}</td>
    </tr>`;
  }).join('');
}

function loadPipelines() {
  fetch('/pipelines')
    .then(r => r.json())
    .then(data => {
      const all = data.pipelines || [];
      const datasetPipes = all.filter(p => p.mode === 'dataset');
      const setPipes = all.filter(p => p.mode === 'dataset-set');

      renderPipelineList(datasetPipes, {
        noMsgId: 'no-pipelines',
        tableId: 'pipeline-table',
        tbodyId: 'pipeline-tbody',
      });

      renderPipelineList(setPipes, {
        noMsgId: 'no-set-pipelines',
        tableId: 'set-pipeline-table',
        tbodyId: 'set-pipeline-tbody',
      });
    })
    .catch(err => console.error('Error loading pipelines:', err));
}

// Actions

function stopPipeline(id) {
  if (!confirm('Stop this pipeline? The Gurobi job will be terminated.')) return;
  fetch(`/pipelines/${id}?action=stop`, { method: 'DELETE' })
    .then(r => r.json())
    .then(() => loadPipelines())
    .catch(err => alert('Error: ' + err.message));
}

function deletePipeline(id) {
  if (!confirm('Delete the pipeline and all associated files (JSON graph, LP file, .sol solution)?')) return;
  fetch(`/pipelines/${id}?action=delete`, { method: 'DELETE' })
    .then(r => r.json())
    .then(() => loadPipelines())
    .catch(err => alert('Error: ' + err.message));
}

// Log modal

let _logInterval = null;
let _logPipelineId = null;

function showLog(id) {
  _logPipelineId = id;
  document.getElementById('log-modal').style.display = 'flex';

  function fetchLog() {
    Promise.all([
      fetch(`/pipelines/${id}/log`).then(r => r.text()),
      fetch('/pipelines').then(r => r.json()),
    ]).then(([text, data]) => {
      const content = document.getElementById('log-modal-content');
      const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 50;
      content.textContent = text;
      if (atBottom) content.scrollTop = content.scrollHeight;

      const p = (data.pipelines || []).find(x => x.id === id);
      if (p) {
        const { cls, label } = STATUS_META[p.status] || { cls: '', label: p.status };
        document.getElementById('log-modal-title').innerHTML =
          `<strong>${esc(p.name)}</strong> &mdash; <span class="badge ${cls}" style="vertical-align:middle;">${label}</span>` +
          (p.gap !== null && p.gap !== undefined ? ` &mdash; gap: <code>${p.gap.toFixed(2)}%</code>` : '');
      }
    }).catch(() => {});
  }

  fetchLog();
  if (_logInterval) clearInterval(_logInterval);
  _logInterval = setInterval(fetchLog, 1500);
}

function closeLogModal() {
  document.getElementById('log-modal').style.display = 'none';
  if (_logInterval) { clearInterval(_logInterval); _logInterval = null; }
  _logPipelineId = null;
}

// Close modal on background click
document.getElementById('log-modal').addEventListener('click', function (e) {
  if (e.target === this) closeLogModal();
});

// View in Biofabric

function viewInBiofabric(graphId, solFileName) {
  const url = `/result.html?graph=${encodeURIComponent(graphId)}&sol=${encodeURIComponent(solFileName)}`;
  window.open(url, '_blank');
}

// Keyboard shortcut

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLogModal();
});

loadDatasets();
loadPipelines();
setInterval(loadPipelines, 2000);

