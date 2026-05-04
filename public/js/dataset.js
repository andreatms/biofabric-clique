function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function uploadLstFile() {
  const input = document.getElementById('lst-file');
  const msg = document.getElementById('upload-msg');
  const btn = document.getElementById('upload-lst-btn');
  const file = input.files[0];

  if (!file) {
    msg.textContent = 'Select a .lst file first';
    return;
  }

  const fd = new FormData();
  fd.append('lstfile', file);

  btn.disabled = true;
  btn.textContent = 'Uploading...';
  msg.textContent = '';

  try {
    const r = await fetch('/upload-lst', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error converting .lst');

    msg.textContent = `Converted: ${data.stats.nodes} nodes, ${data.stats.edges} edges`;
    input.value = '';
    await loadDatasets();
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload and convert';
  }
}

async function loadDatasets() {
  const tbody = document.getElementById('dataset-tbody');
  const noData = document.getElementById('no-datasets');

  const r = await fetch('/uploaded-json-files');
  const data = await r.json();
  const files = data.files || [];

  tbody.innerHTML = '';

  if (files.length === 0) {
    noData.style.display = '';
    return;
  }
  noData.style.display = 'none';

  for (const f of files) {
    let nodes = '-';
    let edges = '-';
    try {
      const jr = await fetch(`/jsonFiles/${encodeURIComponent(f.id)}`);
      const gj = await jr.json();
      nodes = (gj.nodes || []).length;
      edges = (gj.links || gj.edges || []).length;
    } catch (_) {}

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(f.name)}</td>
      <td>${nodes}</td>
      <td>${edges}</td>
      <td>
        <button class="btn-sm btn-view" onclick="openGraph('${esc(f.id)}')">Graph</button>
        <button class="btn-sm btn-del" onclick="deleteDataset('${esc(f.id)}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function openGraph(fileId) {
  window.location.href = `/graph.html?graph=${encodeURIComponent(fileId)}`;
}

async function deleteDataset(fileId) {
  if (!confirm('Delete this JSON dataset?')) return;
  const r = await fetch(`/delete-json-file/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  const data = await r.json();
  if (!r.ok || data.error) {
    alert('Error: ' + (data.error || 'delete failed'));
    return;
  }
  await loadDatasets();
}

loadDatasets();
