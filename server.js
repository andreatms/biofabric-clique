const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const AdmZip = require('adm-zip');

let utils = null;
try {
    utils = require('./utils');
} catch (e) {
    console.warn('utils module not found; endpoints depending on utils will return 500 until utils is provided');
}

const app = express();
app.use(express.static('public'));

const DATA_DIR = path.join(__dirname, 'data');
const JSON_DIR = path.join(DATA_DIR, 'jsonFiles');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const SETS_DIR = path.join(DATA_DIR, 'sets');
const SETS_GRAPH_DIR = path.join(SETS_DIR, 'graphs');
const SETS_IMPORTED_RESULTS_DIR = path.join(SETS_DIR, 'imported-results');
const LOGS_DIR = path.join(__dirname, 'logs');
const WORKFLOW_DIR = path.join(LOGS_DIR, 'workflow');
const WORKFLOW_PIPELINES_FILE = path.join(WORKFLOW_DIR, 'pipelines.json');
const WORKFLOW_QUEUES_FILE = path.join(WORKFLOW_DIR, 'queues.json');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const SAVES_PIPELINES_DIR = path.join(SAVES_DIR, 'pipelines');
const SAVES_QUEUES_DIR = path.join(SAVES_DIR, 'queues');
const ANALYSIS_SNAPSHOTS_DIR = path.join(DATA_DIR, 'analysis');

// ensure uploads directory exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// ensure logs directory exists
fs.mkdirSync(LOGS_DIR, { recursive: true });
// ensure workflow directory exists
fs.mkdirSync(WORKFLOW_DIR, { recursive: true });
// ensure results directory exists
fs.mkdirSync(RESULTS_DIR, { recursive: true });
// ensure sets directories exist
fs.mkdirSync(SETS_GRAPH_DIR, { recursive: true });
fs.mkdirSync(SETS_IMPORTED_RESULTS_DIR, { recursive: true });
// ensure saves directories exist
fs.mkdirSync(SAVES_PIPELINES_DIR, { recursive: true });
fs.mkdirSync(SAVES_QUEUES_DIR, { recursive: true });
fs.mkdirSync(ANALYSIS_SNAPSHOTS_DIR, { recursive: true });

// ── Startup log cleanup ─────────────────────────────────────────────────────
// For each log in logs/:
//   - UUID-named logs: parse first line to extract solution name, rename if
//     the .sol exists in data/results/, delete if it doesn't.
//   - Named logs: delete if no matching .sol file exists in data/results/.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.log$/i;
fs.readdir(LOGS_DIR, (err, logFiles) => {
    if (err) return;
    logFiles.forEach(logFile => {
        const logPath = path.join(LOGS_DIR, logFile);
        if (UUID_RE.test(logFile)) {
            // read only the first line to extract solution name
            fs.readFile(logPath, 'utf8', (e, content) => {
                if (e) return;
                const firstLine = content.split('\n')[0] || '';
                const arrowIdx = firstLine.indexOf('\u2192 ');
                if (arrowIdx === -1) {
                    // no solution info — delete orphaned log
                    fs.rm(logPath, () => {});
                    return;
                }
                const solFileName = firstLine.slice(arrowIdx + 2).trim();
                const solBase = path.basename(solFileName, '.sol');
                const solFilePath = path.join(RESULTS_DIR, solFileName);
                const newLogPath = path.join(LOGS_DIR, `${solBase}.log`);
                if (fs.existsSync(solFilePath)) {
                    fs.rename(logPath, newLogPath, () => {});
                    console.log(`[log-cleanup] renamed ${logFile} → ${solBase}.log`);
                } else {
                    fs.rm(logPath, () => {});
                    console.log(`[log-cleanup] deleted orphaned log ${logFile}`);
                }
            });
        } else {
            // named log — delete if no matching .sol
            const solFileName = logFile.replace(/\.log$/i, '.sol');
            const solFilePath = path.join(RESULTS_DIR, solFileName);
            if (!fs.existsSync(solFilePath)) {
                fs.rm(logPath, () => {});
                console.log(`[log-cleanup] deleted orphaned named log ${logFile}`);
            }
        }
    });
});
// ────────────────────────────────────────────────────────────────────────────

const uploadedFiles = {};





// ensure jsonFiles directory exists
fs.mkdirSync(JSON_DIR, { recursive: true });

const uploadJson = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, JSON_DIR),
        filename: (req, file, cb) => {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            const formatted = `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
            const safeName = file.originalname.replace(/\s+/g, "_");
            cb(null, `${formatted}_${safeName}`);
        }
    })
});

const uploadLst = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
});

const uploadSetResultsZip = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 80 * 1024 * 1024 },
});

const uploadAnalysisSnapshot = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadedJsonFiles = {};

// Load existing JSON files on server start
fs.readdir(JSON_DIR, (err, files) => {
    if (!err) {
        files.forEach(fname => {
            uploadedJsonFiles[fname] = { 
                path: path.join(JSON_DIR, fname), 
                originalname: fname 
            };
        });
        console.log(`Loaded ${files.length} existing JSON files`);
    }
});

// POST /generate-graph — generates a server-side graph and saves it to data/jsonFiles/
app.post('/generate-graph', express.json(), (req, res) => {
    if (!utils) {
        return res.status(500).json({ error: 'utils module not available' });
    }
    const { name, params, strategy = 'default' } = req.body;
    if (!name || !params) {
        return res.status(400).json({ error: 'Missing required parameters: name, params' });
    }

    let graphJson;
    try {
        if (strategy === 'dataset-sperimentazione') {
            if (typeof utils.generateGraphJsonDatasetSperimentazione !== 'function') {
                return res.status(500).json({ error: 'generateGraphJsonDatasetSperimentazione is not available in utils.js' });
            }
            graphJson = utils.generateGraphJsonDatasetSperimentazione(name, params);
        } else if (strategy === 'dataset-sperimentazione-2' || strategy === 'dataset-sperimentazione-3') {
            return res.status(400).json({ error: `Strategia non supportata: ${strategy}` });
        } else {
            graphJson = utils.generateGraphJson(name, params);
        }
    } catch (e) {
        return res.status(400).json({ error: e.message || 'Errore durante la generazione del grafo' });
    }

    const isSetMetadata = strategy === 'dataset-sperimentazione'
        && graphJson
        && Array.isArray(graphJson.graphs)
        && !Array.isArray(graphJson.nodes);

    if (isSetMetadata) {
        return res.status(200).json({
            message: 'Set di grafi generato con successo.',
            strategy,
            mode: 'set',
            setName: graphJson.setName,
            graphSet: graphJson,
        });
    }

    const jsonString = JSON.stringify(graphJson, null, 2);

    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const formatted = `${d.getFullYear()}_${pad(d.getMonth()+1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
    const safeName = `${name.replace(/\s+/g, '_')}.json`;
    const filename = `${formatted}_${safeName}`;
    const filePath = path.join(JSON_DIR, filename);

    fs.writeFile(filePath, jsonString, 'utf8', (err) => {
        if (err) {
            return res.status(500).json({ error: 'Errore durante il salvataggio del grafo' });
        }
        uploadedJsonFiles[filename] = { path: filePath, originalname: safeName };
        console.log('Graph generated and saved:', filePath);
        res.status(200).json({ message: 'Grafo generato con successo.', id: filename, graph: graphJson });
    });
});

app.post('/upload-json', uploadJson.single('jsonfile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No JSON file uploaded.' });  
    } else {
        console.log('JSON File uploaded:', req.file.path);
        uploadedJsonFiles[req.file.filename] = { path: req.file.path, originalname: req.file.originalname };
        return res.status(200).json({ message: 'JSON file uploaded successfully.', id: req.file.filename });
    }
});

app.get('/uploaded-json-files', (req, res) => {
    fs.readdir(JSON_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Error reading JSON directory' });
        }
        const filesResp = files.map(fname => ({
            id: fname,
            name: uploadedJsonFiles[fname] ? uploadedJsonFiles[fname].originalname : fname
        }));
        res.status(200).json({ files: filesResp });
    });
});

function parseLstGraphToJson(lstContent) {
    const lines = String(lstContent || '').split(/\r?\n/);
    const nodesSet = new Set();
    const edgeSet = new Set();

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^(\d+)\s*:\s*(.*)$/);
        if (!m) continue;

        const source = parseInt(m[1], 10);
        if (!Number.isInteger(source)) continue;
        nodesSet.add(source);

        const rhs = (m[2] || '').trim();
        if (!rhs) continue;

        const neighbors = rhs.split(/\s+/).map(x => parseInt(x, 10)).filter(Number.isInteger);
        for (const target of neighbors) {
            if (source === target) continue;
            nodesSet.add(target);
            const a = Math.min(source, target);
            const b = Math.max(source, target);
            edgeSet.add(`${a}-${b}`);
        }
    }

    const nodeIds = [...nodesSet].sort((a, b) => a - b);
    const nodes = nodeIds.map(id => ({ id }));
    const links = [...edgeSet]
        .map(key => {
            const [source, target] = key.split('-').map(Number);
            return { source, target };
        })
        .sort((e1, e2) => (e1.source - e2.source) || (e1.target - e2.target))
        .map((e, i) => ({ id: i + 1, source: e.source, target: e.target }));

    if (nodes.length === 0) {
        throw new Error('Il file .lst non contiene nodi validi.');
    }

    const graph = { nodes, links };
    const rawCliques = (utils && typeof utils.findMaximalCliquesBronKerbosch === 'function')
        ? utils.findMaximalCliquesBronKerbosch(graph, 3)
        : [];
    const cliques = rawCliques.map((c, idx) => ({ id: idx + 1, nodes: c }));

    return { nodes, links, cliques };
}

app.post('/upload-lst', uploadLst.single('lstfile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No LST file uploaded.' });
    }

    let graphJson;
    try {
        graphJson = parseLstGraphToJson(req.file.buffer.toString('utf8'));
    } catch (e) {
        return res.status(400).json({ error: `Formato .lst non valido: ${e.message}` });
    }

    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const formatted = `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
    const originalBase = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const safeName = `${originalBase.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
    const filename = `${formatted}_${safeName}`;
    const filePath = path.join(JSON_DIR, filename);

    fs.writeFile(filePath, JSON.stringify(graphJson, null, 2), 'utf8', (err) => {
        if (err) {
            return res.status(500).json({ error: 'Errore durante il salvataggio del JSON convertito.' });
        }
        uploadedJsonFiles[filename] = { path: filePath, originalname: safeName };
        return res.status(200).json({
            message: 'File .lst convertito in JSON con successo.',
            id: filename,
            stats: { nodes: graphJson.nodes.length, edges: graphJson.links.length },
        });
    });
});

app.delete('/delete-json-file/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const fileEntry = uploadedJsonFiles[fileId];
    if (!fileEntry) {
        return res.status(400).json({ error: 'Invalid JSON file ID.' });
    }
    console.log('Deleting JSON file:', fileEntry.path);
    fs.rm(fileEntry.path, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Error deleting JSON file.' });
        }
        delete uploadedJsonFiles[fileId];
        res.status(200).json({ message: 'JSON file deleted successfully.' });
    });
});

app.get('/loaded-solutions', (req, res) => {
    fs.readdir(RESULTS_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Error reading results directory' });
        }
        const filesResp = files.map(fname => ({
            id: fname,
            name: fname
        }));
        res.status(200).json({ files: filesResp });
    });
});

app.delete('/delete-solution/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    // Prevent path traversal
    const safeName = path.basename(fileId);
    const filePath = path.join(RESULTS_DIR, safeName);

    if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Solution file not found.' });
    }

    console.log('Deleting solution:', filePath);

    fs.rm(filePath, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Error deleting solution file.' });
        }
        // also delete the associated log file
        const solBase = path.basename(safeName, '.sol');
        const logPath = path.join(LOGS_DIR, `${solBase}.log`);
        fs.rm(logPath, () => {}); // ignore errors (log may not exist)
        res.status(200).json({ message: 'Solution deleted successfully.' });
    });
});

app.delete('/delete-all-solutions', (req, res) => {
    fs.readdir(RESULTS_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Error reading results directory.' });
        let pending = files.length;
        if (pending === 0) return res.status(200).json({ message: 'No solutions to delete.' });
        let hasError = false;
        files.forEach(fname => {
            fs.rm(path.join(RESULTS_DIR, fname), (e) => {
                if (e) hasError = true;
                // also delete the matching log
                const solBase = path.basename(fname, '.sol');
                fs.rm(path.join(LOGS_DIR, `${solBase}.log`), () => {});
                pending--;
                if (pending === 0) {
                    if (hasError) return res.status(500).json({ error: 'Some files could not be deleted.' });
                    res.status(200).json({ message: 'All solutions deleted.' });
                }
            });
        });
    });
});

const jobs = {};

app.get('/jobs', (req, res) => {
    const jobList = Object.entries(jobs).map(([id, job]) => ({
        jobId: id,
        fileId: job.fileId,
        fileName: job.fileName,
        solFileName: job.solFileName,
        status: job.status,
        gap: job.gap !== undefined ? job.gap : null,
        startTime: job.startTime
    }));
    res.status(200).json({ jobs: jobList });
});

app.get('/jsonFiles/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const fileEntry = uploadedJsonFiles[fileId];
    
    if (!fileEntry) {
        return res.status(404).json({ error: 'JSON file not found.' });
    }
    
    fs.readFile(fileEntry.path, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Error reading JSON file.' });
        }
        
        try {
            const jsonData = JSON.parse(data);
            res.status(200).json(jsonData);
        } catch (parseErr) {
            return res.status(400).json({ error: 'Invalid JSON file.' });
        }
    });
});

app.get('/results/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const safeName = path.basename(fileId);
    const filePath = path.join(RESULTS_DIR, safeName);
    
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(404).send('Solution file not found.');
        }
        
        res.status(200).type('text/plain').send(data);
    });
});

// ── Pipeline management ────────────────────────────────────────────────────

const pipelines = {};
const pipelineQueues = {};

function sanitizeSetName(setName) {
    return String(setName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sanitizeZipRelativePath(relPath) {
    return String(relPath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\.\./g, '');
}

function getSetMetadataPath(setName) {
    const safe = sanitizeSetName(setName);
    return safe ? path.join(SETS_DIR, `${safe}.json`) : null;
}

function getImportedSetExecutionPath(setName) {
    const safe = sanitizeSetName(setName);
    return safe ? path.join(SETS_IMPORTED_RESULTS_DIR, `${safe}.json`) : null;
}

function readImportedSetExecution(setName) {
    const fp = getImportedSetExecutionPath(setName);
    if (!fp || !fs.existsSync(fp)) return null;
    const parsed = readJsonSafe(fp);
    if (!parsed || !Array.isArray(parsed.graphs)) return null;
    return parsed;
}

function writeImportedSetExecution(setName, payload) {
    const fp = getImportedSetExecutionPath(setName);
    if (!fp) return;
    writeJsonSafe(fp, payload);
}

function readGraphSetMetadata(setName) {
    const fp = getSetMetadataPath(setName);
    if (!fp || !fs.existsSync(fp)) return null;
    return readJsonSafe(fp);
}

function listGraphSets() {
    if (!fs.existsSync(SETS_DIR)) return [];
    const files = fs.readdirSync(SETS_DIR)
        .filter((f) => f.endsWith('.json'));

    const out = [];
    for (const fileName of files) {
        const abs = path.join(SETS_DIR, fileName);
        const meta = readJsonSafe(abs);
        if (!meta || !meta.setName || !Array.isArray(meta.graphs)) continue;

        const nodeCounts = meta.graphs
            .filter((g) => g && Number.isInteger(g.nodes))
            .map((g) => g.nodes);
        const cliqueCounts = meta.graphs
            .filter((g) => g && Array.isArray(g.cliques))
            .map((g) => g.cliques.length);

        out.push({
            setName: meta.setName,
            createdAt: meta.createdAt || null,
            totalGraphs: meta.graphs.length,
            minNodes: nodeCounts.length ? Math.min(...nodeCounts) : null,
            maxNodes: nodeCounts.length ? Math.max(...nodeCounts) : null,
            minCliques: cliqueCounts.length ? Math.min(...cliqueCounts) : null,
            maxCliques: cliqueCounts.length ? Math.max(...cliqueCounts) : null,
            parameters: meta.parameters || {},
        });
    }

    return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function normalizeRestoredStatus(status) {
    const active = ['generating-graph', 'generating-lp', 'running'];
    return active.includes(status) ? 'stopped' : status;
}

function serializePipelineForWorkflow(p) {
    return {
        id: p.id,
        name: p.name,
        optType: p.optType,
        mode: p.mode,
        ownsGraph: p.ownsGraph,
        status: p.status,
        gap: p.gap,
        graphInfo: p.graphInfo,
        graphId: p.graphId,
        lpFileId: p.lpFileId,
        jobId: p.jobId,
        solFileName: p.solFileName,
        startTime: p.startTime,
        endTime: p.endTime,
        error: p.error,
        queueId: p.queueId || null,
        graphSetRef: p.graphSetRef || null,
        saveFileName: p.saveFileName || null,
        saveFilePath: p.saveFilePath || null,
        logFileName: p.logFileName || null,
    };
}

function serializeQueueForWorkflow(q) {
    return {
        id: q.id,
        name: q.name,
        status: q.status,
        currentIndex: q.currentIndex,
        currentItemId: q.currentItemId,
        items: q.items || [],
        startTime: q.startTime,
        endTime: q.endTime,
        saveFileName: q.saveFileName || null,
        saveFilePath: q.saveFilePath || null,
    };
}

function persistWorkflowState() {
    const pipelinesSnapshot = Object.values(pipelines).map(serializePipelineForWorkflow);
    const queuesSnapshot = Object.values(pipelineQueues).map(serializeQueueForWorkflow);
    writeJsonSafe(WORKFLOW_PIPELINES_FILE, { pipelines: pipelinesSnapshot, updatedAt: new Date().toISOString() });
    writeJsonSafe(WORKFLOW_QUEUES_FILE, { queues: queuesSnapshot, updatedAt: new Date().toISOString() });
}

function restoreWorkflowState() {
    const pipelineState = readJsonSafe(WORKFLOW_PIPELINES_FILE) || {};
    const queueState = readJsonSafe(WORKFLOW_QUEUES_FILE) || {};

    const restoredPipelines = Array.isArray(pipelineState.pipelines) ? pipelineState.pipelines : [];
    for (const p of restoredPipelines) {
        const restoredStatus = normalizeRestoredStatus(p.status || 'failed');
        pipelines[p.id] = {
            ...p,
            status: restoredStatus,
            jobId: null,
            endTime: p.endTime || (restoredStatus === 'stopped' ? new Date() : null),
            error: restoredStatus === 'stopped' && !p.error
                ? 'Esecuzione interrotta: riavvio applicazione'
                : (p.error || null),
            log: p.log || `[${new Date().toISOString()}] Pipeline ripristinata da workflow (${restoredStatus})\n`,
        };
    }

    const restoredQueues = Array.isArray(queueState.queues) ? queueState.queues : [];
    for (const q of restoredQueues) {
        const queueStatus = normalizeRestoredStatus(q.status || 'stopped');
        const items = Array.isArray(q.items) ? q.items.map((it) => {
            if (queueStatus === 'stopped' && ['running', 'pending'].includes(it.status)) {
                return {
                    ...it,
                    status: 'stopped',
                    endTime: it.endTime || new Date(),
                    error: it.error || 'Interrotta: riavvio applicazione',
                };
            }
            return it;
        }) : [];

        pipelineQueues[q.id] = {
            ...q,
            status: queueStatus,
            items,
            currentItemId: null,
            endTime: q.endTime || (queueStatus === 'stopped' ? new Date() : null),
        };
    }
}

restoreWorkflowState();

function getWorkflowRegistrySummary() {
    const pState = readJsonSafe(WORKFLOW_PIPELINES_FILE) || {};
    const qState = readJsonSafe(WORKFLOW_QUEUES_FILE) || {};
    const pipelinesList = Array.isArray(pState.pipelines) ? pState.pipelines : [];
    const queuesList = Array.isArray(qState.queues) ? qState.queues : [];
    return {
        pipelines: {
            file: toRelFromRepo(WORKFLOW_PIPELINES_FILE),
            count: pipelinesList.length,
            updatedAt: pState.updatedAt || null,
        },
        queues: {
            file: toRelFromRepo(WORKFLOW_QUEUES_FILE),
            count: queuesList.length,
            updatedAt: qState.updatedAt || null,
        },
    };
}

function makeSaveTimestamp(date = new Date()) {
    const pad = (v) => String(v).padStart(2, '0');
    return `${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}_${pad(date.getHours())}_${pad(date.getMinutes())}_${pad(date.getSeconds())}`;
}

function makeSaveFileName(prefix, name, id, date = new Date()) {
    const safeName = String(name || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${prefix}${makeSaveTimestamp(date)}_${safeName}_${id}.json`;
}

function toRelFromRepo(absPath) {
    if (!absPath) return null;
    return path.relative(__dirname, absPath).replace(/\\/g, '/');
}

function writeJsonSafe(filePath, payload) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
        console.error('[save-json] write failed:', filePath, e.message);
    }
}

function ensurePipelineSaveFile(pipeline) {
    if (!pipeline) return;
    if (pipeline.saveFilePath && pipeline.saveFileName) return;
    const saveFileName = makeSaveFileName('pipeline_', pipeline.name, pipeline.id, pipeline.startTime || new Date());
    pipeline.saveFileName = saveFileName;
    pipeline.saveFilePath = path.join(SAVES_PIPELINES_DIR, saveFileName);
}

function persistPipelineSave(pipeline) {
    if (!pipeline) return;
    ensurePipelineSaveFile(pipeline);

    const job = pipeline.jobId ? jobs[pipeline.jobId] : null;
    const graphJsonRef = pipeline.mode === 'dataset-set' && pipeline.graphSetRef
        ? `data/sets/graphs/${pipeline.graphSetRef.setName}/${pipeline.graphSetRef.filePath}`
        : (pipeline.graphId ? `data/jsonFiles/${pipeline.graphId}` : null);

    const payload = {
        id: pipeline.id,
        name: pipeline.name,
        mode: pipeline.mode,
        optType: pipeline.optType,
        status: pipeline.status,
        queueId: pipeline.queueId || null,
        startTime: pipeline.startTime,
        endTime: pipeline.endTime,
        gap: pipeline.gap,
        error: pipeline.error,
        saveFileName: pipeline.saveFileName,
        files: {
            graphJson: graphJsonRef,
            lp: pipeline.lpFileId ? `data/uploads/${pipeline.lpFileId}` : null,
            sol: pipeline.solFileName ? `data/results/${pipeline.solFileName}` : null,
            log: pipeline.logFileName ? `logs/${pipeline.logFileName}` : (job && job.logFilePath ? toRelFromRepo(job.logFilePath) : null),
        },
    };
    writeJsonSafe(pipeline.saveFilePath, payload);
    persistWorkflowState();
}

function ensureQueueSaveFile(queue) {
    if (!queue) return;
    if (queue.saveFilePath && queue.saveFileName) return;
    const saveFileName = makeSaveFileName('queue_', queue.name, queue.id, queue.startTime || new Date());
    queue.saveFileName = saveFileName;
    queue.saveFilePath = path.join(SAVES_QUEUES_DIR, saveFileName);
}

function persistQueueSave(queue) {
    if (!queue) return;
    ensureQueueSaveFile(queue);

    const payload = {
        id: queue.id,
        name: queue.name,
        status: queue.status,
        startTime: queue.startTime,
        endTime: queue.endTime,
        currentIndex: queue.currentIndex,
        currentItemId: queue.currentItemId,
        saveFileName: queue.saveFileName,
        sourceType: queue.sourceType || 'manual',
        setName: queue.setName || null,
        pipelineSaveFiles: queue.items
            .map((it) => it.pipelineSaveFileName)
            .filter(Boolean)
            .map((f) => `data/saves/pipelines/${f}`),
        items: queue.items.map((it) => ({
            id: it.id,
            name: it.name,
            mode: it.mode,
            jsonFileId: it.jsonFileId || null,
            graphPath: it.graphPath || null,
            setName: it.setName || null,
            status: it.status,
            pipelineId: it.pipelineId,
            pipelineSaveFileName: it.pipelineSaveFileName || null,
            error: it.error,
            startTime: it.startTime,
            endTime: it.endTime,
        })),
    };
    writeJsonSafe(queue.saveFilePath, payload);
    persistWorkflowState();
}

function persistPipelineAndQueue(pipeline) {
    persistPipelineSave(pipeline);
    if (pipeline && pipeline.queueId && pipelineQueues[pipeline.queueId]) {
        persistQueueSave(pipelineQueues[pipeline.queueId]);
    }
}

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function resolveRepoRelPath(relPath) {
    if (!relPath) return null;
    return path.join(__dirname, relPath.replace(/\//g, path.sep));
}

function fileExists(absPath) {
    return !!absPath && fs.existsSync(absPath);
}

function getPipelineSaveList() {
    if (!fs.existsSync(SAVES_PIPELINES_DIR)) return [];
    const files = fs.readdirSync(SAVES_PIPELINES_DIR)
        .filter(f => f.startsWith('pipeline_') && f.endsWith('.json'));

    const list = files.map((fileName) => {
        const absPath = path.join(SAVES_PIPELINES_DIR, fileName);
        const saved = readJsonSafe(absPath) || {};
        return {
            fileName,
            id: saved.id || null,
            name: saved.name || fileName,
            status: saved.status || 'unknown',
            mode: saved.mode || null,
            startTime: saved.startTime || null,
            endTime: saved.endTime || null,
        };
    });

    return list.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
}

function getQueueSaveList() {
    if (!fs.existsSync(SAVES_QUEUES_DIR)) return [];
    const files = fs.readdirSync(SAVES_QUEUES_DIR)
        .filter(f => f.startsWith('queue_') && f.endsWith('.json'));

    const list = files.map((fileName) => {
        const absPath = path.join(SAVES_QUEUES_DIR, fileName);
        const saved = readJsonSafe(absPath) || {};
        return {
            fileName,
            id: saved.id || null,
            name: saved.name || fileName,
            status: saved.status || 'unknown',
            startTime: saved.startTime || null,
            endTime: saved.endTime || null,
            pipelineCount: Array.isArray(saved.pipelineSaveFiles) ? saved.pipelineSaveFiles.length : 0,
        };
    });

    return list.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
}

function getImportedSetExecutionList() {
    if (!fs.existsSync(SETS_IMPORTED_RESULTS_DIR)) return [];
    const files = fs.readdirSync(SETS_IMPORTED_RESULTS_DIR)
        .filter((f) => f.toLowerCase().endsWith('.json'));

    const list = files.map((fileName) => {
        const absPath = path.join(SETS_IMPORTED_RESULTS_DIR, fileName);
        const saved = readJsonSafe(absPath) || {};
        const setName = sanitizeSetName(saved.setName || path.basename(fileName, '.json'));
        const importedAt = saved.importedAt || null;
        const summary = saved.summary || summarizeExecutionGraphs(saved.graphs || []);
        return {
            fileName,
            setName,
            importedAt,
            total: Number(summary.total || 0),
            succeeded: Number(summary.succeeded || 0),
            failed: Number(summary.failed || 0),
            running: Number(summary.running || 0),
            pending: Number(summary.pending || 0),
            stopped: Number(summary.stopped || 0),
        };
    });

    return list.sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
}

function getAnalysisSnapshotList() {
    if (!fs.existsSync(ANALYSIS_SNAPSHOTS_DIR)) return [];
    const files = fs.readdirSync(ANALYSIS_SNAPSHOTS_DIR)
        .filter(f => f.startsWith('analysis_') && f.endsWith('.json'));

    const list = files.map((fileName) => {
        const absPath = path.join(ANALYSIS_SNAPSHOTS_DIR, fileName);
        const saved = readJsonSafe(absPath) || {};
        return {
            fileName,
            name: saved.name || fileName,
            createdAt: saved.createdAt || null,
            resultCount: Array.isArray(saved.results) ? saved.results.length : 0,
            source: saved.source || null,
        };
    });

    return list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function runExtractMetrics(jsonAbs, solAbs, logAbs) {
    return new Promise((resolve, reject) => {
        const tmpDir = fs.mkdtempSync(path.join(DATA_DIR, 'tmp_metrics_'));
        const args = [path.join(__dirname, 'extract_metrics.js'), jsonAbs, solAbs];
        if (logAbs) args.push(logAbs);

        const child = spawn('node', args, { cwd: tmpDir });
        let stderr = '';
        child.stderr.on('data', d => { stderr += d.toString(); });
        child.on('error', (err) => {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
            reject(err);
        });

        child.on('close', (code) => {
            const outFile = path.join(tmpDir, 'metrics_output.json');
            if (code !== 0) {
                try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
                reject(new Error(stderr || `extract_metrics.js exited with code ${code}`));
                return;
            }
            try {
                const metrics = JSON.parse(fs.readFileSync(outFile, 'utf8'));
                fs.rmSync(tmpDir, { recursive: true, force: true });
                resolve(metrics);
            } catch (e) {
                try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
                reject(new Error(`Impossibile leggere metrics_output.json: ${e.message}`));
            }
        });
    });
}

async function analyzePipelineSaveFile(pipelineSaveFileName) {
    const savePath = path.join(SAVES_PIPELINES_DIR, pipelineSaveFileName);
    const saved = readJsonSafe(savePath);
    if (!saved) throw new Error(`File pipeline non valido: ${pipelineSaveFileName}`);

    const jsonAbs = resolveRepoRelPath(saved.files && saved.files.graphJson);
    const solAbs = resolveRepoRelPath(saved.files && saved.files.sol);
    const logAbs = resolveRepoRelPath(saved.files && saved.files.log);

    if (!fileExists(jsonAbs)) throw new Error(`JSON grafo mancante per ${pipelineSaveFileName}`);
    if (!fileExists(solAbs)) throw new Error(`SOL mancante per ${pipelineSaveFileName}`);

    const metrics = await runExtractMetrics(jsonAbs, solAbs, fileExists(logAbs) ? logAbs : null);
    const graphJsonRel = saved.files && saved.files.graphJson ? saved.files.graphJson : null;
    let graphJsonId = graphJsonRel ? path.basename(graphJsonRel) : null;
    let graphSetName = null;
    let graphSetGraphId = null;

    // For graph-set pipelines the source JSON is under data/sets/graphs/<setName>/<file>.json.
    // Expose set-aware fields so frontend can open graph/result views correctly.
    if (graphJsonRel) {
        const m = String(graphJsonRel).match(/^data\/sets\/graphs\/([^/]+)\/(.+\.json)$/i);
        if (m) {
            graphSetName = sanitizeSetName(m[1]);
            graphSetGraphId = path.basename(m[2], '.json');
            graphJsonId = null;
        }
    }

    const solRel = saved.files && saved.files.sol ? saved.files.sol : null;
    const solFileName = solRel ? path.basename(solRel) : null;
    return {
        pipelineSaveFile: pipelineSaveFileName,
        pipelineName: saved.name || null,
        pipelineStatus: saved.status || null,
        graphJsonId,
        graphSetName,
        graphSetGraphId,
        solFileName,
        metrics,
    };
}

async function analyzeImportedSetExecutionFile(importedFileName) {
    const fileName = path.basename(String(importedFileName || ''));
    if (!fileName.toLowerCase().endsWith('.json')) {
        throw new Error(`File import set non valido: ${importedFileName}`);
    }

    const absPath = path.join(SETS_IMPORTED_RESULTS_DIR, fileName);
    const imported = readJsonSafe(absPath);
    if (!imported || !Array.isArray(imported.graphs)) {
        throw new Error(`File import set non valido o corrotto: ${fileName}`);
    }

    const setName = sanitizeSetName(imported.setName || path.basename(fileName, '.json'));
    const results = [];
    const errors = [];

    for (const g of imported.graphs) {
        const status = String((g && g.status) || 'pending').toLowerCase();
        const isCompletedLike = ['completed', 'ok', 'success'].includes(status);
        if (!isCompletedLike) {
            continue;
        }

        const graphPathRel = g && g.filePath ? String(g.filePath) : null;
        const graphId = g && g.id ? String(g.id) : (graphPathRel ? path.basename(graphPathRel, '.json') : null);
        const graphAbs = graphPathRel ? path.join(SETS_GRAPH_DIR, setName, graphPathRel) : null;
        const solFileName = g && g.solFileName ? String(g.solFileName) : null;
        const solAbs = solFileName ? path.join(RESULTS_DIR, path.basename(solFileName)) : null;
        const logFileName = g && g.logFileName ? String(g.logFileName) : null;
        const logAbs = logFileName ? path.join(LOGS_DIR, path.basename(logFileName)) : null;

        const syntheticSaveName = `imported_set_${setName}_${graphId || 'unknown'}`;

        if (!graphAbs || !fileExists(graphAbs)) {
            errors.push({
                pipelineSaveFile: syntheticSaveName,
                error: `JSON grafo set mancante: ${graphPathRel || '-'}`,
            });
            continue;
        }
        if (!solAbs || !fileExists(solAbs)) {
            errors.push({
                pipelineSaveFile: syntheticSaveName,
                error: `SOL mancante per set ${setName}, grafo ${graphId || '-'}: ${solFileName || '-'}`,
            });
            continue;
        }

        try {
            const metrics = await runExtractMetrics(graphAbs, solAbs, fileExists(logAbs) ? logAbs : null);
            results.push({
                pipelineSaveFile: syntheticSaveName,
                pipelineName: `imported_set_${setName}`,
                pipelineStatus: status,
                graphJsonId: null,
                graphSetName: setName,
                graphSetGraphId: graphId,
                solFileName: path.basename(solFileName),
                metrics,
            });
        } catch (e) {
            errors.push({
                pipelineSaveFile: syntheticSaveName,
                error: e.message || 'Errore analisi risultato importato',
            });
        }
    }

    return { setName, importedFile: fileName, results, errors };
}

function computeBasicMetricsFromGraphJson(graphJson) {
    if (!graphJson || typeof graphJson !== 'object') {
        throw new Error('JSON grafo non valido.');
    }

    const nodesArr = Array.isArray(graphJson.nodes) ? graphJson.nodes : [];
    const edgesArr = Array.isArray(graphJson.edges)
        ? graphJson.edges
        : (Array.isArray(graphJson.links) ? graphJson.links : []);
    const cliquesArr = Array.isArray(graphJson.cliques) ? graphJson.cliques : [];

    const totalNodesRaw = Number(graphJson.totalNodes);
    const totalEdgesRaw = Number(graphJson.totalEdges);
    const totalCliquesRaw = Number(graphJson.totalCliques);

    const totalNodes = Number.isFinite(totalNodesRaw) ? totalNodesRaw : nodesArr.length;
    const totalEdges = Number.isFinite(totalEdgesRaw) ? totalEdgesRaw : edgesArr.length;
    let totalCliques = Number.isFinite(totalCliquesRaw) ? totalCliquesRaw : cliquesArr.length;
    const graphDensity = totalNodes > 1 && Number.isFinite(totalEdges)
        ? (2 * totalEdges) / (totalNodes * (totalNodes - 1))
        : 0;

    const cliqueSizes = cliquesArr
        .map((c) => {
            if (Array.isArray(c)) return c.length;
            if (c && Array.isArray(c.nodes)) return c.nodes.length;
            return NaN;
        })
        .filter((v) => Number.isFinite(v));

    let avgCliqueSize = cliqueSizes.length
        ? cliqueSizes.reduce((sum, v) => sum + v, 0) / cliqueSizes.length
        : NaN;
    let maxCliqueSize = cliqueSizes.length ? Math.max(...cliqueSizes) : NaN;

    const avgNodeDegree = totalNodes > 0 && Number.isFinite(totalEdges)
        ? (2 * totalEdges) / totalNodes
        : NaN;
    let maxNodeDegree = NaN;

    try {
        const degreeByNode = new Map();
        const normalizedNodeIds = nodesArr
            .map((n) => {
                if (n === null || n === undefined) return null;
                if (typeof n === 'object') return n.id ?? n.name ?? n.key ?? n.label ?? null;
                return n;
            })
            .filter((v) => v !== null && v !== undefined)
            .map((v) => String(v));

        normalizedNodeIds.forEach((id) => degreeByNode.set(id, 0));

        for (const e of edgesArr) {
            let a = null;
            let b = null;
            if (Array.isArray(e) && e.length >= 2) {
                a = e[0];
                b = e[1];
            } else if (e && typeof e === 'object') {
                a = e.source ?? e.u ?? e.from ?? e[0] ?? null;
                b = e.target ?? e.v ?? e.to ?? e[1] ?? null;
            }
            if (a === null || a === undefined || b === null || b === undefined) continue;
            const sa = String(a);
            const sb = String(b);
            degreeByNode.set(sa, (degreeByNode.get(sa) || 0) + 1);
            degreeByNode.set(sb, (degreeByNode.get(sb) || 0) + 1);
        }

        if (degreeByNode.size > 0) {
            maxNodeDegree = Math.max(...Array.from(degreeByNode.values()));
        }
    } catch (e) {
        maxNodeDegree = NaN;
    }

    let cliqueDetails = null;
    const MAX_NODES_FOR_CLIQUE_DETECTION = 250;
    const MAX_CLIQUES_LIMIT = 5000;

    try {
        if (Array.isArray(cliquesArr) && cliquesArr.length) {
            cliqueDetails = cliquesArr.map((c) => {
                if (Array.isArray(c)) return { nodes: c };
                if (c && Array.isArray(c.nodes)) return { nodes: c.nodes };
                return null;
            }).filter(Boolean);
        } else {
            const nodeIdFromEntry = (n) => {
                if (n === null || n === undefined) return null;
                if (typeof n === 'object') return (n.id ?? n.name ?? n.key ?? n.label ?? null);
                return String(n);
            };

            let nodeIds = [];
            if (nodesArr && nodesArr.length) {
                nodeIds = Array.from(new Set(nodesArr.map(nodeIdFromEntry).filter(Boolean)));
            }
            if (!nodeIds.length && Array.isArray(edgesArr) && edgesArr.length) {
                const inferFromEdge = (e) => {
                    if (Array.isArray(e) && e.length >= 2) return [String(e[0]), String(e[1])];
                    if (e && typeof e === 'object') {
                        const a = e.source ?? e.u ?? e.from ?? e.v ?? e[0] ?? null;
                        const b = e.target ?? e.v ?? e.to ?? e[1] ?? null;
                        return [a !== null && a !== undefined ? String(a) : null, b !== null && b !== undefined ? String(b) : null];
                    }
                    return [null, null];
                };
                const setIds = new Set();
                for (const e of edgesArr) {
                    const [a, b] = inferFromEdge(e);
                    if (a) setIds.add(a);
                    if (b) setIds.add(b);
                }
                nodeIds = Array.from(setIds);
            }

            if (nodeIds.length && nodeIds.length <= MAX_NODES_FOR_CLIQUE_DETECTION) {

                const neighbors = new Map();
                nodeIds.forEach(id => neighbors.set(id, new Set()));

                const normalizeEdge = (e) => {
                    if (Array.isArray(e) && e.length >= 2) return [String(e[0]), String(e[1])];
                    if (e && typeof e === 'object') {
                        const a = e.source ?? e.u ?? e.from ?? e[0] ?? null;
                        const b = e.target ?? e.v ?? e.to ?? e[1] ?? null;
                        return [a !== null && a !== undefined ? String(a) : null, b !== null && b !== undefined ? String(b) : null];
                    }
                    return [null, null];
                };

                for (const e of edgesArr) {
                    const [a, b] = normalizeEdge(e);
                    if (!a || !b) continue;
                    if (!neighbors.has(a) || !neighbors.has(b)) continue;
                    neighbors.get(a).add(b);
                    neighbors.get(b).add(a);
                }

                // Bron–Kerbosch with pivoting
                const cliques = [];
                const P0 = new Set(nodeIds);
                const R0 = new Set();
                const X0 = new Set();

                const intersection = (setA, setB) => {
                    const r = new Set();
                    for (const v of setA) if (setB.has(v)) r.add(v);
                    return r;
                };

                const union = (a, b) => new Set([...a, ...b]);

                const choosePivot = (P, X) => {
                    let best = null;
                    let bestCount = -1;
                    for (const u of union(P, X)) {
                        const neigh = neighbors.get(u) || new Set();
                        let count = 0;
                        for (const v of P) if (neigh.has(v)) count++;
                        if (count > bestCount) { bestCount = count; best = u; }
                    }
                    return best;
                };

                let abort = false;

                const bronk = (R, P, X) => {
                    if (abort) return;
                    if (P.size === 0 && X.size === 0) {
                        cliques.push(Array.from(R));
                        if (cliques.length >= MAX_CLIQUES_LIMIT) { abort = true; }
                        return;
                    }
                    const u = choosePivot(P, X);
                    const pivotNeigh = u ? (neighbors.get(u) || new Set()) : new Set();
                    const candidates = Array.from(P).filter(v => !pivotNeigh.has(v));
                    for (const v of candidates) {
                        if (abort) break;
                        const Nv = neighbors.get(v) || new Set();
                        bronk(new Set([...R, v]), intersection(P, Nv), intersection(X, Nv));
                        P.delete(v);
                        X.add(v);
                        if (cliques.length >= MAX_CLIQUES_LIMIT) { abort = true; break; }
                    }
                };

                try {
                    bronk(R0, P0, X0);
                } catch (e) {
                }

                if (cliques.length) {
                    cliqueDetails = cliques.map(c => ({ nodes: c }));
                    totalCliques = cliques.length;
                    const sizes = cliques.map(c => c.length);
                    avgCliqueSize = sizes.reduce((s, v) => s + v, 0) / sizes.length;
                    maxCliqueSize = Math.max(...sizes);
                } else {
                    cliqueDetails = [];
                }
            } else {
                cliqueDetails = [];
            }
        }
    } catch (e) {
        cliqueDetails = cliqueDetails || [];
    }

    let avgCliqueDegree = NaN;
    let pctNodesInClique = NaN;
    if (Array.isArray(cliqueDetails) && cliqueDetails.length && totalNodes > 0) {
        const membership = new Map();
        let totalMemberships = 0;
        for (const c of cliqueDetails) {
            const nodesList = Array.isArray(c.nodes) ? c.nodes : (Array.isArray(c) ? c : []);
            for (const nid of nodesList) {
                const sid = String(nid);
                membership.set(sid, (membership.get(sid) || 0) + 1);
                totalMemberships++;
            }
        }
        avgCliqueDegree = Number.isFinite(totalMemberships) && totalNodes > 0 ? (totalMemberships / totalNodes) : NaN;
        const nodesInCliqueCount = Array.from(membership.keys()).length;
        pctNodesInClique = (nodesInCliqueCount / totalNodes) * 100;
    }

    return {
        instance: graphJson.instance || graphJson.name || null,
        totalNodes,
        totalEdges,
        totalCliques,
        graphDensity,
        avgNodeDegree,
        maxNodeDegree: Number.isFinite(maxNodeDegree) ? maxNodeDegree : NaN,
        avgCliqueSize,
        maxCliqueSize,
        avgCliqueDegree: Number.isFinite(avgCliqueDegree) ? avgCliqueDegree : NaN,
        pctNodesInClique: Number.isFinite(pctNodesInClique) ? pctNodesInClique : NaN,
        cliqueDetails,
    };
}

function getPipelineBasicGraphMetrics(pipelineSaveFileName) {
    const savePath = path.join(SAVES_PIPELINES_DIR, pipelineSaveFileName);
    const saved = readJsonSafe(savePath);
    if (!saved) throw new Error(`File pipeline non valido: ${pipelineSaveFileName}`);

    const graphJsonRel = saved.files && saved.files.graphJson ? saved.files.graphJson : null;
    const graphAbs = resolveRepoRelPath(graphJsonRel);
    if (!fileExists(graphAbs)) throw new Error(`JSON grafo mancante per ${pipelineSaveFileName}`);

    const graphRaw = fs.readFileSync(graphAbs, 'utf8');
    const graphJson = JSON.parse(graphRaw);
    const metrics = computeBasicMetricsFromGraphJson(graphJson);

    let graphJsonId = graphJsonRel ? path.basename(graphJsonRel) : null;
    let graphSetName = null;
    let graphSetGraphId = null;

    if (graphJsonRel) {
        const m = String(graphJsonRel).match(/^data\/sets\/graphs\/([^/]+)\/(.+\.json)$/i);
        if (m) {
            graphSetName = sanitizeSetName(m[1]);
            graphSetGraphId = path.basename(m[2], '.json');
            graphJsonId = null;
        }
    }

    return {
        pipelineSaveFile: pipelineSaveFileName,
        pipelineName: saved.name || null,
        graphJsonId,
        graphSetName,
        graphSetGraphId,
        metrics,
    };
}

function extractGapFromLog(output) {
    const lines = output.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/\b([\d.]+)%\s*$/);
        if (m) return parseFloat(m[1]);
    }
    return null;
}

function runPipeline(pipeline, { customParams, seed, optType, solverParams }, onFinish) {
    const notifyFinish = (() => {
        let called = false;
        return () => {
            if (called) return;
            called = true;
            if (typeof onFinish === 'function') onFinish(pipeline);
        };
    })();

    const name = pipeline.name;

    // ── Generate graph ────────────────────────────────────────
    let graphJson;
    try {
        graphJson = utils.generateGraphJson(name, { customParams, seed });
    } catch (e) {
        pipeline.status = 'failed';
        pipeline.error  = e.message;
        pipeline.log   += `[ERROR] ${e.message}\n`;
        pipeline.endTime = new Date();
        persistPipelineAndQueue(pipeline);
        notifyFinish();
        return;
    }

    runPipelineFromExistingGraph(pipeline, graphJson, { optType, solverParams, persistGraph: true }, notifyFinish);
}

function runPipelineFromExistingGraph(pipeline, graphJson, { optType, solverParams = {}, persistGraph = false }, onFinish) {
    const notifyFinish = (() => {
        let called = false;
        return () => {
            if (called) return;
            called = true;
            if (typeof onFinish === 'function') onFinish(pipeline);
        };
    })();

    const name = pipeline.name;

    const edgeList = graphJson.links || graphJson.edges || [];
    pipeline.graphInfo = { nodes: graphJson.nodes.length, edges: edgeList.length };
    pipeline.log += `[Graph] ${graphJson.nodes.length} nodi, ${edgeList.length} archi, ${(graphJson.cliques || []).length} clique\n`;
    persistPipelineAndQueue(pipeline);

    const startRef = pipeline.startTime || new Date();
    const pad = v => String(v).padStart(2, '0');
    const ts = `${startRef.getFullYear()}_${pad(startRef.getMonth()+1)}_${pad(startRef.getDate())}_${pad(startRef.getHours())}_${pad(startRef.getMinutes())}_${pad(startRef.getSeconds())}`;
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');

    const continueWithLp = () => {
        pipeline.status = 'generating-lp';
        pipeline.log += `[LP] Generazione modello (${optType})...\n`;
        persistPipelineAndQueue(pipeline);

        // ── Generate LP ───────────────────────────────────────
        let lpModel;
        try {
            lpModel = utils.createCliqueModelFromGraph(graphJson, optType);
        } catch (e) {
            pipeline.status  = 'failed';
            pipeline.error   = e.message;
            pipeline.log    += `[ERROR] LP: ${e.message}\n`;
            pipeline.endTime = new Date();
            persistPipelineAndQueue(pipeline);
            notifyFinish();
            return;
        }
        if (!lpModel) {
            pipeline.status  = 'failed';
            pipeline.error   = `LP model è null per optType="${optType}"`;
            pipeline.log    += `[ERROR] LP model null\n`;
            pipeline.endTime = new Date();
            persistPipelineAndQueue(pipeline);
            notifyFinish();
            return;
        }

        const lpFilename = `${ts}_${safeName}_${optType}.lp`;
        const lpFilePath = path.join(UPLOADS_DIR, lpFilename);
        pipeline.log += `[LP] File: ${lpFilename}\n`;

        fs.writeFile(lpFilePath, lpModel, 'utf8', (err) => {
            if (err) {
                pipeline.status  = 'failed';
                pipeline.error   = err.message;
                pipeline.log    += `[ERROR] salvataggio LP: ${err.message}\n`;
                pipeline.endTime = new Date();
                persistPipelineAndQueue(pipeline);
                notifyFinish();
                return;
            }
            uploadedFiles[lpFilename] = { path: lpFilePath, originalname: `${safeName}_${optType}.lp` };
            pipeline.lpFileId = lpFilename;
            pipeline.status   = 'running';
            persistPipelineAndQueue(pipeline);

            // ── Gurobi ─────────────────────────────────────────
            const solBase = `${ts}_${safeName}_${optType}`;
            let solFileName = `${solBase}.sol`;
            let solFP = path.join(RESULTS_DIR, solFileName);
            let dc = 2;
            while (fs.existsSync(solFP)) {
                solFileName = `${solBase}_${dc++}.sol`;
                solFP = path.join(RESULTS_DIR, solFileName);
            }

            const args = [`ResultFile=${solFP}`];
            for (const [k, gName, parse] of [
                ['timeLimit',      'TimeLimit',      parseInt  ],
                ['iterationLimit', 'IterationLimit', parseInt  ],
                ['nodeLimit',      'NodeLimit',      parseInt  ],
                ['mipGap',         'MIPGap',         parseFloat],
            ]) {
                if (solverParams[k] !== undefined && solverParams[k] !== '') {
                    const v = parse(solverParams[k]);
                    if (!isNaN(v)) args.push(`${gName}=${v}`);
                }
            }
            args.push(lpFilePath);

            const jobId = uuidv4();
            pipeline.jobId      = jobId;
            pipeline.solFileName = solFileName;
            pipeline.log += `[Solver] Avvio: ${solFileName}\n`;

            const logFP     = path.join(LOGS_DIR, `${jobId}.log`);
            const logStream = fs.createWriteStream(logFP, { flags: 'a' });
            logStream.write(`[${new Date().toISOString()}] Pipeline "${pipeline.name}" → ${solFileName}\n`);
            pipeline.logFileName = path.basename(logFP);
            persistPipelineAndQueue(pipeline);

            const solverProcess = spawn('gurobi_cl', args);
            jobs[jobId] = {
                process: solverProcess, status: 'running', output: '',
                fileId: lpFilename, fileName: `${safeName}_${optType}.lp`,
                solFileName, startTime: new Date(), logFilePath: logFP,
            };

            solverProcess.stdout.on('data', data => {
                const text = data.toString();
                jobs[jobId].output += text;
                pipeline.log       += text;
                logStream.write(text);
                pipeline.gap = extractGapFromLog(jobs[jobId].output);
            });
            solverProcess.stderr.on('data', data => {
                const text = data.toString();
                jobs[jobId].output += text;
                pipeline.log       += text;
                logStream.write(text);
            });
            solverProcess.on('error', err => {
                jobs[jobId].status   = 'error';
                if (pipeline.status !== 'stopped') {
                    pipeline.status      = 'failed';
                    pipeline.error       = err.message;
                    pipeline.log        += `[ERROR] Solver: ${err.message}\n`;
                }
                pipeline.endTime     = new Date();
                persistPipelineAndQueue(pipeline);
                logStream.end();
                notifyFinish();
            });
            solverProcess.on('close', code => {
                if (pipeline.status === 'stopped') {
                    jobs[jobId].status = 'stopped';
                } else {
                    jobs[jobId].status = code === 0 ? 'done' : 'error';
                    pipeline.status    = code === 0 ? 'completed' : 'failed';
                    if (code !== 0) pipeline.error = `Solver exited with code ${code}`;
                }
                pipeline.endTime   = new Date();
                pipeline.gap       = extractGapFromLog(pipeline.log);
                const newLogP = path.join(LOGS_DIR, `${solBase}.log`);
                logStream.end(() => fs.rename(logFP, newLogP, () => {
                    jobs[jobId].logFilePath = newLogP;
                    pipeline.logFileName = path.basename(newLogP);
                    persistPipelineAndQueue(pipeline);
                    notifyFinish();
                }));
            });
        });
    };

    if (!persistGraph) {
        continueWithLp();
        return;
    }

    const graphFilename = `${ts}_${safeName}.json`;
    const graphFilePath = path.join(JSON_DIR, graphFilename);
    fs.writeFile(graphFilePath, JSON.stringify(graphJson, null, 2), 'utf8', (err) => {
        if (err) {
            pipeline.status  = 'failed';
            pipeline.error   = err.message;
            pipeline.log    += `[ERROR] salvataggio grafo: ${err.message}\n`;
            pipeline.endTime = new Date();
            persistPipelineAndQueue(pipeline);
            notifyFinish();
            return;
        }
        uploadedJsonFiles[graphFilename] = { path: graphFilePath, originalname: `${safeName}.json` };
        pipeline.graphId  = graphFilename;
        pipeline.ownsGraph = true;
        persistPipelineAndQueue(pipeline);
        continueWithLp();
    });
}

app.post('/pipelines/run', express.json(), (req, res) => {
    if (!utils) return res.status(500).json({ error: 'utils module not available' });
    const { name, customParams, seed, optType = 'max', solverParams = {} } = req.body;
    if (!name || !Array.isArray(customParams) || customParams.length === 0) {
        return res.status(400).json({ error: 'name e customParams (array non vuoto) sono obbligatori' });
    }
    if (!['max', 'min'].includes(String(optType).toLowerCase())) {
        return res.status(400).json({ error: 'optType non valido. Valori supportati: max, min.' });
    }
    const pipelineId = uuidv4();
    pipelines[pipelineId] = {
        id: pipelineId, name, optType,
        mode: 'generated',
        ownsGraph: true,
        status: 'generating-graph',
        gap: null, graphInfo: null, graphId: null, lpFileId: null, jobId: null, solFileName: null,
        log: `[${new Date().toISOString()}] Pipeline avviata: "${name}" (${optType})\n`,
        startTime: new Date(), endTime: null, error: null,
    };
    ensurePipelineSaveFile(pipelines[pipelineId]);
    persistPipelineSave(pipelines[pipelineId]);
    res.status(200).json({ pipelineId });
    setImmediate(() => runPipeline(pipelines[pipelineId], { customParams, seed, optType, solverParams }));
});

app.post('/pipelines/run-from-json', express.json(), (req, res) => {
    if (!utils) return res.status(500).json({ error: 'utils module not available' });

    const { name, jsonFileId, optType = 'max', solverParams = {} } = req.body || {};
    if (!name || !jsonFileId) {
        return res.status(400).json({ error: 'name e jsonFileId sono obbligatori' });
    }
    if (!['max', 'min'].includes(String(optType).toLowerCase())) {
        return res.status(400).json({ error: 'optType non valido. Valori supportati: max, min.' });
    }

    const jsonEntry = uploadedJsonFiles[jsonFileId];
    if (!jsonEntry) {
        return res.status(400).json({ error: 'jsonFileId non valido' });
    }

    const pipelineId = uuidv4();
    pipelines[pipelineId] = {
        id: pipelineId,
        name,
        optType,
        mode: 'dataset',
        ownsGraph: false,
        status: 'generating-lp',
        gap: null,
        graphInfo: null,
        graphId: jsonFileId,
        lpFileId: null,
        jobId: null,
        solFileName: null,
        log: `[${new Date().toISOString()}] Dataset pipeline avviata: "${name}" (${optType}) su ${jsonFileId}\n`,
        startTime: new Date(),
        endTime: null,
        error: null,
    };
    ensurePipelineSaveFile(pipelines[pipelineId]);
    persistPipelineSave(pipelines[pipelineId]);

    res.status(200).json({ pipelineId });

    fs.readFile(jsonEntry.path, 'utf8', (err, raw) => {
        if (err) {
            pipelines[pipelineId].status = 'failed';
            pipelines[pipelineId].error = err.message;
            pipelines[pipelineId].log += `[ERROR] lettura JSON: ${err.message}\n`;
            pipelines[pipelineId].endTime = new Date();
            persistPipelineSave(pipelines[pipelineId]);
            return;
        }

        let graphJson;
        try {
            graphJson = JSON.parse(raw);
        } catch (e) {
            pipelines[pipelineId].status = 'failed';
            pipelines[pipelineId].error = e.message;
            pipelines[pipelineId].log += `[ERROR] parsing JSON: ${e.message}\n`;
            pipelines[pipelineId].endTime = new Date();
            persistPipelineSave(pipelines[pipelineId]);
            return;
        }

        setImmediate(() => runPipelineFromExistingGraph(pipelines[pipelineId], graphJson, { optType, solverParams, persistGraph: false }));
    });
});

function startNextQueueItem(queueId) {
    const queue = pipelineQueues[queueId];
    if (!queue || queue.status !== 'running') return;

    const nextIndex = queue.items.findIndex(it => it.status === 'pending');
    if (nextIndex === -1) {
        queue.status = 'completed';
        queue.endTime = new Date();
        queue.currentItemId = null;
        persistQueueSave(queue);
        return;
    }

    const item = queue.items[nextIndex];
    queue.currentIndex = nextIndex;
    queue.currentItemId = item.id;
    item.status = 'running';
    item.startTime = new Date();
    persistQueueSave(queue);

    const runDone = (pipeline) => {
        item.pipelineId = pipeline.id;
        item.pipelineSaveFileName = pipeline.saveFileName || null;
        item.status = pipeline.status;
        item.endTime = new Date();
        item.error = pipeline.error || null;
        queue.currentItemId = null;
        persistPipelineAndQueue(pipeline);
        persistQueueSave(queue);
        setImmediate(() => startNextQueueItem(queueId));
    };

    if (item.mode === 'dataset' || item.mode === 'dataset-set') {
        const isSetGraph = item.mode === 'dataset-set';
        const jsonEntry = uploadedJsonFiles[item.jsonFileId];
        const setGraphPath = isSetGraph && item.graphPath
            ? path.join(SETS_GRAPH_DIR, item.setName || queue.setName || '', item.graphPath)
            : null;

        if (!isSetGraph && !jsonEntry) {
            item.status = 'failed';
            item.error = `jsonFileId non valido: ${item.jsonFileId}`;
            item.endTime = new Date();
            persistQueueSave(queue);
            setImmediate(() => startNextQueueItem(queueId));
            return;
        }

        if (isSetGraph && (!setGraphPath || !fs.existsSync(setGraphPath))) {
            item.status = 'failed';
            item.error = `Grafo set non trovato: ${item.graphPath || '-'}`;
            item.endTime = new Date();
            persistQueueSave(queue);
            setImmediate(() => startNextQueueItem(queueId));
            return;
        }

        const pipelineId = uuidv4();
        const pipeline = {
            id: pipelineId,
            name: item.name,
            optType: item.optType,
            mode: isSetGraph ? 'dataset-set' : 'dataset',
            ownsGraph: false,
            status: 'generating-lp',
            gap: null,
            graphInfo: null,
            graphId: isSetGraph ? null : item.jsonFileId,
            graphSetRef: isSetGraph ? { setName: item.setName || queue.setName || '', filePath: item.graphPath } : null,
            lpFileId: null,
            jobId: null,
            solFileName: null,
            log: isSetGraph
                ? `[${new Date().toISOString()}] Queue "${queue.name}" item set avviato: "${item.name}" (${item.optType}) su ${item.graphPath}\n`
                : `[${new Date().toISOString()}] Queue "${queue.name}" item avviato: "${item.name}" (${item.optType}) su ${item.jsonFileId}\n`,
            startTime: new Date(),
            endTime: null,
            error: null,
            queueId,
        };
        pipelines[pipelineId] = pipeline;
        ensurePipelineSaveFile(pipeline);
        persistPipelineSave(pipeline);
        item.pipelineId = pipelineId;
        item.pipelineSaveFileName = pipeline.saveFileName;
        persistQueueSave(queue);

        const inputGraphPath = isSetGraph ? setGraphPath : jsonEntry.path;
        fs.readFile(inputGraphPath, 'utf8', (err, raw) => {
            if (err) {
                pipeline.status = 'failed';
                pipeline.error = err.message;
                pipeline.log += `[ERROR] lettura JSON: ${err.message}\n`;
                pipeline.endTime = new Date();
                runDone(pipeline);
                return;
            }

            let graphJson;
            try {
                graphJson = JSON.parse(raw);
            } catch (e) {
                pipeline.status = 'failed';
                pipeline.error = e.message;
                pipeline.log += `[ERROR] parsing JSON: ${e.message}\n`;
                pipeline.endTime = new Date();
                runDone(pipeline);
                return;
            }

            setImmediate(() => runPipelineFromExistingGraph(
                pipeline,
                graphJson,
                { optType: item.optType, solverParams: item.solverParams || {}, persistGraph: false },
                runDone,
            ));
        });
        return;
    }

    const pipelineId = uuidv4();
    const pipeline = {
        id: pipelineId,
        name: item.name,
        optType: item.optType,
        mode: 'generated',
        ownsGraph: true,
        status: 'generating-graph',
        gap: null,
        graphInfo: null,
        graphId: null,
        lpFileId: null,
        jobId: null,
        solFileName: null,
        log: `[${new Date().toISOString()}] Queue "${queue.name}" item avviato: "${item.name}" (${item.optType})\n`,
        startTime: new Date(),
        endTime: null,
        error: null,
        queueId,
    };
    pipelines[pipelineId] = pipeline;
    ensurePipelineSaveFile(pipeline);
    persistPipelineSave(pipeline);
    item.pipelineId = pipelineId;
    item.pipelineSaveFileName = pipeline.saveFileName;
    persistQueueSave(queue);
    setImmediate(() => runPipeline(
        pipeline,
        {
            customParams: item.customParams || [],
            seed: item.seed,
            optType: item.optType,
            solverParams: item.solverParams || {},
        },
        runDone,
    ));
}

function summarizeSetQueueItems(items) {
    const acc = { succeeded: 0, failed: 0, stopped: 0, pending: 0, running: 0, total: items.length };
    for (const it of items) {
        if (it.status === 'completed') acc.succeeded += 1;
        else if (it.status === 'failed') acc.failed += 1;
        else if (it.status === 'stopped') acc.stopped += 1;
        else if (it.status === 'running') acc.running += 1;
        else acc.pending += 1;
    }
    return acc;
}

function summarizeExecutionGraphs(graphs) {
    const acc = { succeeded: 0, failed: 0, stopped: 0, pending: 0, running: 0, total: graphs.length };
    for (const g of graphs) {
        const status = String((g && g.status) || 'pending').toLowerCase();
        if (status === 'completed' || status === 'ok' || status === 'success') acc.succeeded += 1;
        else if (status === 'failed' || status === 'error') acc.failed += 1;
        else if (status === 'stopped' || status === 'cancelled') acc.stopped += 1;
        else if (status === 'running') acc.running += 1;
        else acc.pending += 1;
    }
    return acc;
}

function queueContainsGraphSet(queue, setName) {
    if (!queue || !Array.isArray(queue.items) || !setName) return false;
    if (queue.setName === setName) return true;
    return queue.items.some((it) => it && it.mode === 'dataset-set' && (it.setName === setName));
}

function findLatestGraphSetQueue(setName) {
    const candidates = Object.values(pipelineQueues)
        .filter((q) => q && queueContainsGraphSet(q, setName));
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))[0];
}

function buildGraphSetExecutionPayloadFromQueue(setName, meta, queue) {
    const setItems = (queue && Array.isArray(queue.items))
        ? queue.items.filter((it) => it && it.mode === 'dataset-set' && it.setName === setName)
        : [];
    const byId = new Map(setItems.map((it) => [String(it.id), it]));
    const byPath = new Map(setItems.map((it) => [String(it.graphPath || ''), it]));

    const graphs = (meta.graphs || []).map((g) => {
        const item = byId.get(String(g.id)) || byPath.get(String(g.filePath || '')) || null;
        const p = item && item.pipelineId && pipelines[item.pipelineId] ? pipelines[item.pipelineId] : null;
        return {
            id: g.id,
            filePath: g.filePath,
            nodes: g.nodes,
            edges: g.edges,
            cliques: g.cliques,
            status: item ? (item.status || 'idle') : 'idle',
            error: item ? (item.error || null) : null,
            startTime: item ? (item.startTime || null) : null,
            endTime: item ? (item.endTime || null) : null,
            pipelineId: item ? (item.pipelineId || null) : null,
            optType: item ? (item.optType || null) : null,
            gap: p ? (p.gap ?? null) : null,
            solFileName: p ? (p.solFileName || null) : null,
            logFileName: p ? (p.logFileName || null) : null,
        };
    });

    return {
        formatVersion: 1,
        setName,
        exportedAt: new Date().toISOString(),
        source: {
            type: 'local-queue',
            queueId: queue ? queue.id : null,
            queueName: queue ? queue.name : null,
        },
        queue: queue ? {
            id: queue.id,
            name: queue.name,
            status: queue.status,
            startTime: queue.startTime,
            endTime: queue.endTime,
        } : {
            status: 'idle',
            startTime: null,
            endTime: null,
        },
        summary: summarizeExecutionGraphs(graphs),
        graphs,
    };
}

function normalizeImportedExecutionPayload(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Payload import non valido.');
    }

    const setName = sanitizeSetName(raw.setName);
    if (!setName) {
        throw new Error('setName mancante nel payload importato.');
    }
    if (!Array.isArray(raw.graphs)) {
        throw new Error('graphs deve essere un array nel payload importato.');
    }

    const graphs = raw.graphs.map((g) => ({
        id: g && g.id ? String(g.id) : null,
        filePath: g && g.filePath ? String(g.filePath) : null,
        status: g && g.status ? String(g.status) : 'idle',
        error: g && g.error ? String(g.error) : null,
        startTime: g && g.startTime ? g.startTime : null,
        endTime: g && g.endTime ? g.endTime : null,
        pipelineId: g && g.pipelineId ? String(g.pipelineId) : null,
        optType: g && g.optType ? String(g.optType) : null,
        gap: g && g.gap !== undefined ? g.gap : null,
        solFileName: g && g.solFileName ? String(g.solFileName) : null,
        logFileName: g && g.logFileName ? String(g.logFileName) : null,
    }));

    return {
        formatVersion: Number(raw.formatVersion) || 1,
        setName,
        exportedAt: raw.exportedAt || null,
        importedAt: new Date().toISOString(),
        source: raw.source && typeof raw.source === 'object'
            ? { ...raw.source, type: raw.source.type || 'external-import' }
            : { type: 'external-import' },
        queue: raw.queue && typeof raw.queue === 'object'
            ? {
                id: raw.queue.id || null,
                name: raw.queue.name || null,
                status: raw.queue.status || 'completed',
                startTime: raw.queue.startTime || null,
                endTime: raw.queue.endTime || null,
            }
            : { status: 'completed', startTime: null, endTime: null },
        summary: summarizeExecutionGraphs(graphs),
        graphs,
    };
}

app.post('/pipeline-queues/start', express.json(), (req, res) => {
    const { name, jobs: queueJobs } = req.body || {};
    if (!Array.isArray(queueJobs) || queueJobs.length === 0) {
        return res.status(400).json({ error: 'jobs deve essere un array non vuoto' });
    }

    const normalizedJobs = [];
    for (const j of queueJobs) {
        const mode = String(j.mode || 'dataset').toLowerCase();
        const optType = String(j.optType || 'max').toLowerCase();
        if (!['max', 'min'].includes(optType)) {
            return res.status(400).json({ error: `optType non valido per job "${j.name || ''}"` });
        }
        if (mode === 'dataset-set') {
            const setName = String(j.setName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
            const graphPath = String(j.graphPath || '').replace(/\\/g, '/');
            if (!j.name || !setName || !graphPath) {
                return res.status(400).json({ error: 'Ogni job dataset-set richiede name, setName e graphPath' });
            }

            normalizedJobs.push({
                id: uuidv4(),
                mode: 'dataset-set',
                name: j.name,
                setName,
                graphPath,
                jsonFileId: j.jsonFileId || `${setName}/${graphPath}`,
                optType,
                solverParams: j.solverParams || {},
                status: 'pending',
                pipelineId: null,
                startTime: null,
                endTime: null,
                error: null,
            });
            continue;
        }

        if (mode === 'dataset') {
            if (!j.name || !j.jsonFileId) {
                return res.status(400).json({ error: 'Ogni job dataset richiede name e jsonFileId' });
            }
            normalizedJobs.push({
                id: uuidv4(),
                mode: 'dataset',
                name: j.name,
                jsonFileId: j.jsonFileId,
                optType,
                solverParams: j.solverParams || {},
                status: 'pending',
                pipelineId: null,
                startTime: null,
                endTime: null,
                error: null,
            });
            continue;
        }

        if (mode === 'generated') {
            if (!j.name || !Array.isArray(j.customParams) || j.customParams.length === 0) {
                return res.status(400).json({ error: 'Ogni job generated richiede name e customParams (array non vuoto)' });
            }
            normalizedJobs.push({
                id: uuidv4(),
                mode: 'generated',
                name: j.name,
                customParams: j.customParams,
                seed: j.seed,
                optType,
                solverParams: j.solverParams || {},
                status: 'pending',
                pipelineId: null,
                startTime: null,
                endTime: null,
                error: null,
            });
            continue;
        }

        return res.status(400).json({ error: `mode non valido: ${mode}` });
    }

    const queueId = uuidv4();
    pipelineQueues[queueId] = {
        id: queueId,
        name: name || `queue_${new Date().toISOString()}`,
        status: 'running',
        currentIndex: -1,
        currentItemId: null,
        items: normalizedJobs,
        startTime: new Date(),
        endTime: null,
    };
    ensureQueueSaveFile(pipelineQueues[queueId]);
    persistQueueSave(pipelineQueues[queueId]);

    res.status(200).json({ queueId });
    setImmediate(() => startNextQueueItem(queueId));
});

app.get('/pipeline-queues', (req, res) => {
    const queues = Object.values(pipelineQueues).map(q => ({
        id: q.id,
        name: q.name,
        sourceType: q.sourceType || 'manual',
        setName: q.setName || null,
        status: q.status,
        currentIndex: q.currentIndex,
        currentItemId: q.currentItemId,
        totalItems: q.items.length,
        items: q.items,
        startTime: q.startTime,
        endTime: q.endTime,
    }));
    res.json({ queues });
});

app.get('/graph-sets', (req, res) => {
    const sets = listGraphSets().map((setInfo) => {
        const q = findLatestGraphSetQueue(setInfo.setName);
        const imported = readImportedSetExecution(setInfo.setName);

        const qItemsForSet = q
            ? (q.items || []).filter((it) => it && it.mode === 'dataset-set' && it.setName === setInfo.setName)
            : [];
        const processedLocal = qItemsForSet.filter((it) => ['completed', 'failed', 'stopped'].includes(it.status)).length;
        const processedImported = imported && imported.summary
            ? (Number(imported.summary.succeeded || 0) + Number(imported.summary.failed || 0) + Number(imported.summary.stopped || 0))
            : 0;

        const useLocal = !!q;
        return {
            ...setInfo,
            queueStatus: useLocal
                ? q.status
                : (imported && imported.queue && imported.queue.status ? imported.queue.status : 'idle'),
            progress: {
                processed: useLocal ? processedLocal : processedImported,
                total: useLocal
                    ? qItemsForSet.length
                    : (imported && imported.summary && Number.isFinite(imported.summary.total)
                        ? imported.summary.total
                        : setInfo.totalGraphs),
            },
            summary: useLocal
                ? summarizeSetQueueItems(qItemsForSet)
                : (imported ? imported.summary : null),
            running: useLocal ? !!(q && q.status === 'running') : false,
            queueId: q ? q.id : null,
            queueStartTime: useLocal
                ? (q ? q.startTime : null)
                : (imported && imported.queue ? imported.queue.startTime : null),
            queueEndTime: useLocal
                ? (q ? q.endTime : null)
                : (imported && imported.queue ? imported.queue.endTime : null),
            executionSource: useLocal ? 'local' : (imported ? 'imported' : 'none'),
        };
    });
    res.json({ sets });
});

app.get('/graph-sets/:setName', (req, res) => {
    const setName = sanitizeSetName(req.params.setName);
    const meta = readGraphSetMetadata(setName);
    if (!meta) {
        return res.status(404).json({ error: `Set non trovato: ${setName}` });
    }

    const queue = findLatestGraphSetQueue(setName);
    const imported = readImportedSetExecution(setName);
    const queueItems = (queue && Array.isArray(queue.items))
        ? queue.items.filter((it) => it && it.mode === 'dataset-set' && it.setName === setName)
        : [];
    const localById = new Map(queueItems.map((it) => [String(it.id), it]));
    const localByPath = new Map(queueItems.map((it) => [String(it.graphPath || ''), it]));
    const importedById = new Map(((imported && imported.graphs) || []).map((g) => [String(g.id || ''), g]));
    const importedByPath = new Map(((imported && imported.graphs) || []).map((g) => [String(g.filePath || ''), g]));

    const details = (meta.graphs || []).map((g) => {
        const local = localById.get(String(g.id)) || localByPath.get(String(g.filePath || '')) || null;
        const imp = importedById.get(String(g.id || '')) || importedByPath.get(String(g.filePath || '')) || null;
        const st = local || imp;
        return {
            id: g.id,
            filePath: g.filePath,
            nodes: g.nodes,
            edges: g.edges,
            cliques: g.cliques,
            step: g.step,
            status: st ? st.status : 'idle',
            error: st ? (st.error || null) : (g.error || null),
            pipelineId: st ? (st.pipelineId || null) : null,
            startTime: st ? (st.startTime || null) : null,
            endTime: st ? (st.endTime || null) : null,
        };
    });

    return res.json({
        setName: meta.setName,
        createdAt: meta.createdAt,
        parameters: meta.parameters || {},
        queue: queue ? {
            id: queue.id,
            status: queue.status,
            currentIndex: queue.currentIndex,
            currentItemId: queue.currentItemId,
            startTime: queue.startTime,
            endTime: queue.endTime,
            summary: summarizeSetQueueItems(queueItems),
            source: 'local',
        } : (imported ? {
            id: null,
            status: (imported.queue && imported.queue.status) || 'completed',
            currentIndex: -1,
            currentItemId: null,
            startTime: imported.queue ? imported.queue.startTime : null,
            endTime: imported.queue ? imported.queue.endTime : null,
            summary: imported.summary || summarizeExecutionGraphs(imported.graphs || []),
            source: 'imported',
        } : { status: 'idle', source: 'none' }),
        graphs: details,
    });
});

app.get('/graph-sets/:setName/execution-results/export', (req, res) => {
    const setName = sanitizeSetName(req.params.setName);
    const meta = readGraphSetMetadata(setName);
    if (!meta) {
        return res.status(404).json({ error: `Set non trovato: ${setName}` });
    }

    const queue = findLatestGraphSetQueue(setName);
    const imported = readImportedSetExecution(setName);
    const payload = queue
        ? buildGraphSetExecutionPayloadFromQueue(setName, meta, queue)
        : (imported || null);

    if (!payload) {
        return res.status(404).json({ error: `Nessun risultato di esecuzione disponibile per set ${setName}` });
    }

    const zip = new AdmZip();
    zip.addFile('execution_results.json', Buffer.from(JSON.stringify(payload, null, 2), 'utf8'));
    zip.addFile('set_metadata.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));

    const setGraphRoot = path.join(SETS_GRAPH_DIR, setName);
    for (const g of (meta.graphs || [])) {
        const rel = sanitizeZipRelativePath(g && g.filePath ? g.filePath : `${g.id}.json`);
        if (!rel) continue;
        const abs = path.join(setGraphRoot, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        const bytes = fs.readFileSync(abs);
        zip.addFile(`graphs/${rel}`, bytes);
    }

    const logNames = new Set();
    for (const g of (payload.graphs || [])) {
        if (!g || !g.logFileName) continue;
        const safeLog = path.basename(String(g.logFileName));
        if (!safeLog.toLowerCase().endsWith('.log')) continue;
        logNames.add(safeLog);
    }
    for (const logName of logNames) {
        const logPath = path.join(LOGS_DIR, logName);
        if (!fs.existsSync(logPath) || !fs.statSync(logPath).isFile()) continue;
        zip.addFile(`logs/${logName}`, fs.readFileSync(logPath));
    }

    const solutionNames = new Set();
    for (const g of (payload.graphs || [])) {
        if (!g || !g.solFileName) continue;
        const safeSol = path.basename(String(g.solFileName));
        if (!safeSol.toLowerCase().endsWith('.sol')) continue;
        solutionNames.add(safeSol);
    }
    for (const solName of solutionNames) {
        const solPath = path.join(RESULTS_DIR, solName);
        if (!fs.existsSync(solPath) || !fs.statSync(solPath).isFile()) continue;
        zip.addFile(`solutions/${solName}`, fs.readFileSync(solPath));
    }

    const fileName = `${setName}_execution_results.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/zip');
    return res.status(200).send(zip.toBuffer());
});

app.post('/graph-sets/execution-results/import', express.json({ limit: '20mb' }), (req, res) => {
    try {
        const normalized = normalizeImportedExecutionPayload(req.body);
        const meta = readGraphSetMetadata(normalized.setName);
        if (!meta) {
            return res.status(404).json({ error: `Set non trovato localmente: ${normalized.setName}` });
        }

        writeImportedSetExecution(normalized.setName, normalized);
        return res.json({
            message: 'Risultati importati con successo',
            setName: normalized.setName,
            summary: normalized.summary,
        });
    } catch (e) {
        return res.status(400).json({ error: e.message || 'Errore import risultati set' });
    }
});

app.post('/graph-sets/execution-results/import-zip', uploadSetResultsZip.single('file'), (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'File ZIP obbligatorio (campo: file).' });
        }

        const zip = new AdmZip(req.file.buffer);
        const entries = zip.getEntries();
        const execEntry = entries.find((e) => !e.isDirectory && /(^|\/)execution_results\.json$/i.test(e.entryName));
        if (!execEntry) {
            return res.status(400).json({ error: 'ZIP non valido: execution_results.json mancante.' });
        }

        let importedRaw;
        try {
            importedRaw = JSON.parse(execEntry.getData().toString('utf8'));
        } catch (e) {
            return res.status(400).json({ error: `execution_results.json non valido: ${e.message}` });
        }

        const normalized = normalizeImportedExecutionPayload(importedRaw);

        const metadataEntry = entries.find((e) => !e.isDirectory && /(^|\/)set_metadata\.json$/i.test(e.entryName));
        if (metadataEntry && !readGraphSetMetadata(normalized.setName)) {
            try {
                const importedMeta = JSON.parse(metadataEntry.getData().toString('utf8'));
                if (!importedMeta || sanitizeSetName(importedMeta.setName) !== normalized.setName) {
                    return res.status(400).json({ error: 'set_metadata.json non coerente con execution_results.json.' });
                }
                const setMetaPath = getSetMetadataPath(normalized.setName);
                if (setMetaPath) writeJsonSafe(setMetaPath, importedMeta);
            } catch (e) {
                return res.status(400).json({ error: `set_metadata.json non valido: ${e.message}` });
            }
        }

        const meta = readGraphSetMetadata(normalized.setName);
        if (!meta) {
            return res.status(404).json({ error: `Set non trovato localmente: ${normalized.setName}. Importa anche set_metadata.json nel pacchetto ZIP.` });
        }

        const graphDir = path.join(SETS_GRAPH_DIR, normalized.setName);
        fs.mkdirSync(graphDir, { recursive: true });
        for (const e of entries) {
            if (e.isDirectory) continue;
            const rel = sanitizeZipRelativePath(e.entryName);
            if (!rel.toLowerCase().startsWith('graphs/')) continue;
            const graphRel = rel.slice('graphs/'.length);
            if (!graphRel || !graphRel.toLowerCase().endsWith('.json')) continue;
            const target = path.join(graphDir, graphRel);
            const targetDir = path.dirname(target);
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(target, e.getData());
        }

        for (const e of entries) {
            if (e.isDirectory) continue;
            const rel = sanitizeZipRelativePath(e.entryName);
            const relLower = rel.toLowerCase();
            if (!(relLower.startsWith('solutions/') || relLower.startsWith('results/'))) continue;
            const solName = path.basename(rel);
            if (!solName || !solName.toLowerCase().endsWith('.sol')) continue;
            const target = path.join(RESULTS_DIR, solName);
            fs.writeFileSync(target, e.getData());
        }

        for (const e of entries) {
            if (e.isDirectory) continue;
            const rel = sanitizeZipRelativePath(e.entryName);
            const relLower = rel.toLowerCase();
            if (!relLower.startsWith('logs/')) continue;
            const logName = path.basename(rel);
            if (!logName || !logName.toLowerCase().endsWith('.log')) continue;
            const target = path.join(LOGS_DIR, logName);
            fs.writeFileSync(target, e.getData());
        }

        writeImportedSetExecution(normalized.setName, normalized);
        return res.json({
            message: 'ZIP risultati importato con successo',
            setName: normalized.setName,
            summary: normalized.summary,
        });
    } catch (e) {
        return res.status(400).json({ error: e.message || 'Errore import ZIP risultati set' });
    }
});

app.get('/graph-sets/:setName/graphs/:graphId', (req, res) => {
    const setName = String(req.params.setName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const graphId = String(req.params.graphId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const meta = readGraphSetMetadata(setName);
    if (!meta) return res.status(404).json({ error: `Set non trovato: ${setName}` });

    const entry = (meta.graphs || []).find((g) => `${g.id}` === graphId);
    if (!entry) return res.status(404).json({ error: `Grafo set non trovato: ${graphId}` });

    const graphPath = path.join(SETS_GRAPH_DIR, setName, entry.filePath || `${graphId}.json`);
    fs.readFile(graphPath, 'utf8', (err, raw) => {
        if (err) return res.status(404).json({ error: `File grafo non trovato: ${entry.filePath}` });
        try {
            const parsed = JSON.parse(raw);
            res.json(parsed);
        } catch (e) {
            res.status(400).json({ error: `JSON non valido: ${e.message}` });
        }
    });
});

app.post('/graph-sets/:setName/run-queue', express.json(), (req, res) => {
    const setName = String(req.params.setName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const meta = readGraphSetMetadata(setName);
    if (!meta) {
        return res.status(404).json({ error: `Set non trovato: ${setName}` });
    }

    const existing = findLatestGraphSetQueue(setName);
    if (existing && existing.status === 'running') {
        return res.status(409).json({ error: `Queue gia in esecuzione per set ${setName}` });
    }

    const optType = String((req.body && req.body.optType) || 'max').toLowerCase();
    if (!['max', 'min'].includes(optType)) {
        return res.status(400).json({ error: 'optType non valido. Valori supportati: max, min.' });
    }

    const solverParams = (req.body && req.body.solverParams) || {};
    const items = (meta.graphs || []).map((g) => ({
        id: g.id,
        graphPath: g.filePath,
        jsonFileId: `${setName}/${g.filePath}`,
        setName,
        nodes: g.nodes,
        edges: g.edges,
        cliques: g.cliques,
        step: g.step,
        mode: 'dataset-set',
        name: `set_${setName}_${g.id}`,
        optType,
        solverParams,
        status: 'pending',
        pipelineId: null,
        pipelineSaveFileName: null,
        startTime: null,
        endTime: null,
        error: null,
    }));

    const queueId = uuidv4();
    pipelineQueues[queueId] = {
        id: queueId,
        name: `set_queue_${setName}`,
        sourceType: 'graph-set',
        setName,
        status: 'running',
        currentIndex: -1,
        currentItemId: null,
        items,
        optType,
        solverParams,
        startTime: new Date(),
        endTime: null,
        summary: summarizeSetQueueItems(items),
    };

    ensureQueueSaveFile(pipelineQueues[queueId]);
    persistQueueSave(pipelineQueues[queueId]);

    setImmediate(() => startNextQueueItem(queueId));
    return res.json({ message: 'Queue set avviata', setName, queueId, total: items.length });
});

app.get('/graph-sets/:setName/delete-preview', (req, res) => {
    const setName = sanitizeSetName(req.params.setName);
    const meta = readGraphSetMetadata(setName);
    if (!meta) {
        return res.status(404).json({ error: `Set non trovato: ${setName}` });
    }

    const graphDir = path.join(SETS_GRAPH_DIR, setName);
    let graphFiles = 0;
    if (fs.existsSync(graphDir)) {
        graphFiles = fs.readdirSync(graphDir)
            .filter((f) => f.toLowerCase().endsWith('.json'))
            .length;
    }

    const importedResultPath = getImportedSetExecutionPath(setName);
    const hasImportedExecution = !!(importedResultPath && fs.existsSync(importedResultPath));
    const queueRefs = Object.values(pipelineQueues).filter((queue) => queueContainsGraphSet(queue, setName));
    const hasRunningQueue = queueRefs.some((q) => q && q.status === 'running');

    const relatedPipelines = Object.values(pipelines).filter((p) => p && p.graphSetRef && p.graphSetRef.setName === setName);
    const computedResults = relatedPipelines.filter((p) => p.solFileName).length;
    const computedLogs = relatedPipelines.filter((p) => p.logFileName).length;

    return res.json({
        setName,
        metadataFile: `${setName}.json`,
        graphFiles,
        hasImportedExecution,
        queueRefs: queueRefs.length,
        hasRunningQueue,
        computedResults,
        computedLogs,
    });
});

app.delete('/graph-sets/:setName', (req, res) => {
    const setName = sanitizeSetName(req.params.setName);
    const setMetaPath = getSetMetadataPath(setName);
    if (!setMetaPath || !fs.existsSync(setMetaPath)) {
        return res.status(404).json({ error: `Set non trovato: ${setName}` });
    }

    const q = findLatestGraphSetQueue(setName);
    if (q && q.status === 'running') {
        return res.status(409).json({ error: `Set ${setName} in esecuzione. Ferma prima la queue.` });
    }

    try {
        fs.rmSync(setMetaPath, { force: true });
        fs.rmSync(path.join(SETS_GRAPH_DIR, setName), { recursive: true, force: true });
        fs.rmSync(getImportedSetExecutionPath(setName), { force: true });

        Object.values(pipelineQueues)
            .filter((queue) => queueContainsGraphSet(queue, setName))
            .forEach((queue) => {
                if (queue && queue.id) delete pipelineQueues[queue.id];
            });
        persistWorkflowState();

        return res.json({ message: 'Graph set eliminato con successo', setName });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Errore eliminazione graph set' });
    }
});

app.delete('/graph-sets/:setName/queue', (req, res) => {
    const setName = String(req.params.setName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const queue = findLatestGraphSetQueue(setName);
    if (!queue) {
        return res.status(404).json({ error: `Queue set non trovata: ${setName}` });
    }

    const action = String(req.query.action || 'stop').toLowerCase();
    if (!['stop', 'delete'].includes(action)) {
        return res.status(400).json({ error: 'Azione non valida. Valori supportati: stop, delete.' });
    }

    if (queue.status === 'running') {
        queue.status = 'stopped';
        queue.endTime = new Date();
        queue.items
            .filter((it) => it.status === 'pending')
            .forEach((it) => {
                it.status = 'stopped';
                it.endTime = new Date();
                it.error = 'Non eseguito: queue interrotta';
            });

        const running = queue.items.find((it) => it.id === queue.currentItemId);
        if (running && running.pipelineId && pipelines[running.pipelineId]) {
            const p = pipelines[running.pipelineId];
            p.status = 'stopped';
            p.endTime = new Date();
            p.error = 'Interrotto manualmente (set queue)';
            p.log += `[INFO] Pipeline interrotta manualmente dalla set queue ${setName}\n`;
            if (p.jobId && jobs[p.jobId]) {
                try { jobs[p.jobId].process.kill('SIGTERM'); } catch (_) {}
                jobs[p.jobId].status = 'stopped';
            }
            persistPipelineSave(p);
            running.status = 'stopped';
            running.endTime = new Date();
            running.error = 'Interrotto manualmente';
        }

        queue.currentItemId = null;
        queue.summary = summarizeSetQueueItems(queue.items);
    }

    if (action === 'delete') {
        delete pipelineQueues[queue.id];
        persistWorkflowState();
        return res.json({
            message: 'Queue set eliminata dallo storico (risultati calcolati preservati)',
            setName,
            status: 'deleted',
        });
    }

    return res.json({ message: 'Queue set fermata', setName, status: queue.status, summary: queue.summary });
});

app.get('/analysis/saved-items', (req, res) => {
    res.json({
        pipelines: getPipelineSaveList(),
        queues: getQueueSaveList(),
        importedSets: getImportedSetExecutionList(),
    });
});

app.delete('/analysis/saved-items/pipeline/:fileName', (req, res) => {
    const fileName = path.basename(String(req.params.fileName || ''));
    if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Nome file pipeline non valido.' });
    }

    const absPath = path.join(SAVES_PIPELINES_DIR, fileName);
    if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: `Pipeline save non trovato: ${fileName}` });
    }

    try {
        fs.rmSync(absPath, { force: true });
        return res.json({ message: 'Pipeline save eliminato', fileName });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Errore eliminazione pipeline save' });
    }
});

app.delete('/analysis/saved-items/queue/:fileName', (req, res) => {
    const fileName = path.basename(String(req.params.fileName || ''));
    if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Nome file queue non valido.' });
    }

    const absPath = path.join(SAVES_QUEUES_DIR, fileName);
    if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: `Queue save non trovato: ${fileName}` });
    }

    try {
        fs.rmSync(absPath, { force: true });
        return res.json({ message: 'Queue save eliminato', fileName });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Errore eliminazione queue save' });
    }
});

app.get('/analysis/snapshots', (req, res) => {
    res.json({ snapshots: getAnalysisSnapshotList() });
});

app.get('/analysis/snapshots/:fileName', (req, res) => {
    const fileName = path.basename(String(req.params.fileName || ''));
    if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Nome snapshot non valido.' });
    }

    const absPath = path.join(ANALYSIS_SNAPSHOTS_DIR, fileName);
    const saved = readJsonSafe(absPath);
    if (!saved) {
        return res.status(404).json({ error: `Snapshot non trovato: ${fileName}` });
    }

    return res.json(saved);
});

app.get('/analysis/snapshots/:fileName/export', (req, res) => {
    const fileName = path.basename(String(req.params.fileName || ''));
    if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Nome snapshot non valido.' });
    }

    const absPath = path.join(ANALYSIS_SNAPSHOTS_DIR, fileName);
    if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: `Snapshot non trovato: ${fileName}` });
    }

    const payload = fs.readFileSync(absPath, 'utf8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(payload);
});

app.post('/analysis/snapshots/save', express.json({ limit: '30mb' }), (req, res) => {
    const { name, source = {}, results, failedEntries } = req.body || {};
    if (!Array.isArray(results) || results.length === 0) {
        return res.status(400).json({ error: 'results deve essere un array non vuoto.' });
    }
    const failedArray = Array.isArray(failedEntries) ? failedEntries : [];

    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const stamp = `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
    const safeLabel = String(name || 'analysis')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'analysis';
    const fileName = `analysis_${stamp}_${safeLabel}.json`;
    const absPath = path.join(ANALYSIS_SNAPSHOTS_DIR, fileName);

    const payload = {
        name: safeLabel,
        createdAt: now.toISOString(),
        source,
        resultCount: results.length + failedArray.length,
        results,
    };
    if (failedArray.length) payload.failedEntries = failedArray;

    try {
        writeJsonSafe(absPath, payload);
        return res.json({ message: 'Analisi salvata con successo', fileName });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Errore salvataggio analisi' });
    }
});

app.post('/analysis/snapshots/import', uploadAnalysisSnapshot.single('file'), (req, res) => {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'File snapshot obbligatorio (campo: file).' });
    }

    let parsed;
    try {
        parsed = JSON.parse(req.file.buffer.toString('utf8'));
    } catch (e) {
        return res.status(400).json({ error: `Snapshot JSON non valido: ${e.message}` });
    }

    if (!parsed || !Array.isArray(parsed.results) || parsed.results.length === 0) {
        return res.status(400).json({ error: 'Snapshot non valido: campo results mancante o vuoto.' });
    }

    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const stamp = `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`;

    const fileBase = path.basename(String(req.file.originalname || ''), '.json') || 'analysis_import';
    const safeLabel = String(parsed.name || fileBase)
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'analysis_import';

    const fileName = `analysis_${stamp}_${safeLabel}.json`;
    const absPath = path.join(ANALYSIS_SNAPSHOTS_DIR, fileName);

    const parsedFailed = Array.isArray(parsed.failedEntries) ? parsed.failedEntries : [];
    const payload = {
        name: safeLabel,
        createdAt: parsed.createdAt || now.toISOString(),
        importedAt: now.toISOString(),
        source: parsed.source || { type: 'import' },
        resultCount: parsed.results.length + parsedFailed.length,
        results: parsed.results,
    };
    if (parsedFailed.length) payload.failedEntries = parsedFailed;

    try {
        writeJsonSafe(absPath, payload);
        return res.json({ message: 'Snapshot importato con successo', fileName });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Errore import snapshot' });
    }
});

app.delete('/analysis/snapshots/:fileName', (req, res) => {
    const fileName = path.basename(String(req.params.fileName || ''));
    if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Nome snapshot non valido.' });
    }

    const absPath = path.join(ANALYSIS_SNAPSHOTS_DIR, fileName);
    if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: `Snapshot non trovato: ${fileName}` });
    }

    try {
        fs.rmSync(absPath, { force: true });
        return res.json({ message: 'Snapshot analisi eliminato', fileName });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Errore eliminazione snapshot' });
    }
});

app.get('/workflow/registry', (req, res) => {
    res.json(getWorkflowRegistrySummary());
});

app.delete('/workflow/registry', (req, res) => {
    const scope = String(req.query.scope || 'all').toLowerCase();
    if (!['all', 'pipelines', 'queues'].includes(scope)) {
        return res.status(400).json({ error: 'scope non valido. Valori supportati: all, pipelines, queues' });
    }

    const nowIso = new Date().toISOString();
    if (scope === 'all' || scope === 'pipelines') {
        writeJsonSafe(WORKFLOW_PIPELINES_FILE, { pipelines: [], updatedAt: nowIso });
    }
    if (scope === 'all' || scope === 'queues') {
        writeJsonSafe(WORKFLOW_QUEUES_FILE, { queues: [], updatedAt: nowIso });
    }

    return res.json({
        message: `Workflow ${scope} pulito con successo`,
        scope,
        registry: getWorkflowRegistrySummary(),
    });
});

app.post('/analysis/run', express.json(), async (req, res) => {
    const { targetType, saveFileName } = req.body || {};
    if (!targetType || !saveFileName) {
        return res.status(400).json({ error: 'targetType e saveFileName sono obbligatori' });
    }

    try {
        if (targetType === 'pipeline') {
            const analyzed = await analyzePipelineSaveFile(saveFileName);
            return res.json({
                targetType,
                saveFileName,
                results: [analyzed],
                errors: [],
            });
        }

        if (targetType === 'queue') {
            const queuePath = path.join(SAVES_QUEUES_DIR, saveFileName);
            const queueSaved = readJsonSafe(queuePath);
            if (!queueSaved) {
                return res.status(404).json({ error: `Queue save non trovato: ${saveFileName}` });
            }

            const pipelineRefs = Array.isArray(queueSaved.pipelineSaveFiles)
                ? queueSaved.pipelineSaveFiles
                : [];
            const pipelineFiles = pipelineRefs
                .map((rel) => path.basename(rel))
                .filter((f) => f && f.endsWith('.json'));

            const results = [];
            const errors = [];

            for (const pFile of pipelineFiles) {
                try {
                    const analyzed = await analyzePipelineSaveFile(pFile);
                    results.push(analyzed);
                } catch (e) {
                    errors.push({ pipelineSaveFile: pFile, error: e.message });
                }
            }

            return res.json({
                targetType,
                saveFileName,
                queueName: queueSaved.name || null,
                results,
                errors,
            });
        }

        if (targetType === 'imported-set') {
            const analyzed = await analyzeImportedSetExecutionFile(saveFileName);
            if ((!analyzed.results || analyzed.results.length === 0) && analyzed.errors && analyzed.errors.length > 0) {
                return res.status(400).json({
                    error: `Nessun risultato analizzabile per ${analyzed.setName}: mancano file .sol per gli elementi completati importati. Reimporta un ZIP che includa anche le soluzioni.`,
                    details: analyzed.errors,
                });
            }
            return res.json({
                targetType,
                saveFileName,
                setName: analyzed.setName,
                results: analyzed.results,
                errors: analyzed.errors,
            });
        }

        return res.status(400).json({ error: 'targetType non valido. Valori supportati: pipeline, queue, imported-set' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Errore analisi risultati' });
    }
});

app.delete('/pipeline-queues/:id', (req, res) => {
    const queue = pipelineQueues[req.params.id];
    if (!queue) return res.status(404).json({ error: 'Queue not found' });

    const action = req.query.action || 'stop';
    if (!['stop', 'delete'].includes(action)) {
        return res.status(400).json({ error: 'Azione non valida. Valori supportati: stop, delete.' });
    }

    if (queue.status === 'running') {
        queue.status = 'stopped';
        queue.endTime = new Date();

        const runningItem = queue.items.find(it => it.id === queue.currentItemId);
        if (runningItem) {
            runningItem.status = 'stopped';
            runningItem.endTime = new Date();
            runningItem.error = 'Interrotto manualmente';

            const p = runningItem.pipelineId ? pipelines[runningItem.pipelineId] : null;
            if (p) {
                p.status = 'stopped';
                p.endTime = new Date();
                p.error = 'Interrotto manualmente';
                p.log += `[INFO] Pipeline interrotta manualmente dalla queue ${queue.id}\n`;
                if (p.jobId && jobs[p.jobId]) {
                    try { jobs[p.jobId].process.kill('SIGTERM'); } catch (_) {}
                    jobs[p.jobId].status = 'stopped';
                }
                persistPipelineAndQueue(p);
            }
        }

        queue.items
            .filter(it => it.status === 'pending')
            .forEach(it => {
                it.status = 'stopped';
                it.endTime = new Date();
                it.error = 'Non eseguito: queue interrotta';
            });
        queue.currentItemId = null;
        persistQueueSave(queue);
    }

    if (action === 'delete') {
        persistQueueSave(queue);
        delete pipelineQueues[queue.id];
        persistWorkflowState();
        return res.json({ message: 'Queue eliminata' });
    }

    return res.json({ message: 'Queue fermata', status: queue.status });
});

app.get('/pipelines', (req, res) => {
    res.json({
        pipelines: Object.values(pipelines).map(({ log: _omit, ...p }) => p),
    });
});

app.get('/pipelines/:id/log', (req, res) => {
    const p = pipelines[req.params.id];
    if (!p) return res.status(404).json({ error: 'Pipeline not found' });
    res.type('text/plain').send(p.log);
});

app.get('/pipelines/:id', (req, res) => {
    const p = pipelines[req.params.id];
    if (!p) return res.status(404).json({ error: 'Pipeline not found' });
    res.json(p);
});

app.delete('/pipelines/:id', (req, res) => {
    const p = pipelines[req.params.id];
    if (!p) return res.status(404).json({ error: 'Pipeline not found' });

    const active = ['generating-graph', 'generating-lp', 'running'];
    if (active.includes(p.status) && p.jobId && jobs[p.jobId]) {
        try { jobs[p.jobId].process.kill('SIGTERM'); } catch (_) {}
        jobs[p.jobId].status = 'stopped';
    }

    const action = req.query.action || 'stop';
    if (action === 'stop') {
        if (active.includes(p.status)) { p.status = 'stopped'; p.endTime = new Date(); }
        persistPipelineAndQueue(p);
        return res.json({ message: 'Pipeline fermata', status: p.status });
    }

    if (p.graphId && p.ownsGraph) {
        fs.rm(path.join(JSON_DIR, p.graphId), () => {});
        delete uploadedJsonFiles[p.graphId];
    }
    if (p.lpFileId)    { fs.rm(path.join(UPLOADS_DIR, p.lpFileId),  () => {}); delete uploadedFiles[p.lpFileId]; }
    if (p.solFileName) { fs.rm(path.join(RESULTS_DIR, p.solFileName), () => {}); }
    if (p.jobId)       { delete jobs[p.jobId]; }
    delete pipelines[p.id];
    persistWorkflowState();
    res.json({ message: 'Pipeline eliminata' });
});

// ────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.get('/analysis/pipelines/:fileName/basic-metrics', (req, res) => {
    const fileName = path.basename(String(req.params.fileName || ''));
    if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Nome file pipeline non valido.' });
    }

    try {
        const data = getPipelineBasicGraphMetrics(fileName);
        return res.json(data);
    } catch (e) {
        return res.status(400).json({ error: e.message || 'Errore lettura metriche base pipeline' });
    }
});