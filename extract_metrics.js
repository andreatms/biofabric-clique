/**
 * extract_metrics.js
 *
 * Estrae metriche da:
 *  - <nome>.json  → struttura del grafo (nodi, archi, clique)
 *  - <nome>.sol   → soluzione ILP (valori variabili c_...)
 *  - <nome>.log   → log Gurobi (opzionale, per tempo di esecuzione e statistiche)
 *
 * Utilizzo (Node.js ≥ 14):
 *   node extract_metrics.js <file.json> <file.sol> [file.log]
 *
 * Esempio:
 *   node extract_metrics.js prova_applicativo.json applicativo_1_max.sol applicativo_1_max.log
 */

const fs = require("fs");
const path = require("path");

// ─── 1. Argomenti da riga di comando ──────────────────────────────────────────
const [,, jsonPath, solPath, logPath] = process.argv;

if (!jsonPath || !solPath) {
  console.error("Uso: node extract_metrics.js <file.json> <file.sol> [file.log]");
  process.exit(1);
}

// ─── 2. Lettura file ──────────────────────────────────────────────────────────
const graphData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const solText   = fs.readFileSync(solPath, "utf8");
const logText   = logPath ? fs.readFileSync(logPath, "utf8") : null;

// ─── 3a. Parsing log Gurobi ───────────────────────────────────────────────────
/**
 * Estrae dal log Gurobi:
 * - tempo di esecuzione totale
 * - nodi B&B esplorati
 * - iterazioni simplex
 * - numero soluzioni trovate
 * - gap finale
 * - stato soluzione (Optimal / Suboptimal / …)
 * - statistiche modello (righe, colonne, nonzero)
 */
function parseGurobiLog(text) {
  if (!text) return null;
  const info = {};

  // Tempo totale: "Explored N nodes ... in X.XX seconds"
  const timeMatch = text.match(/in\s+([\d.]+)\s+seconds/i);
  info.solveTime_s = timeMatch ? parseFloat(timeMatch[1]) : null;

  // Nodi esplorati e iterazioni simplex
  const nodesMatch = text.match(/Explored\s+([\d,]+)\s+nodes\s+\(([\d,]+)\s+simplex iterations\)/i);
  info.nodesExplored     = nodesMatch ? parseInt(nodesMatch[1].replace(/,/g, "")) : null;
  info.simplexIterations = nodesMatch ? parseInt(nodesMatch[2].replace(/,/g, "")) : null;

  // Numero soluzioni trovate: "Solution count N: ..."
  const solCountMatch = text.match(/Solution count\s+(\d+)/i);
  info.solutionCount = solCountMatch ? parseInt(solCountMatch[1]) : null;

  // Gap finale e stato: "Optimal solution found (tolerance X)"
  const optMatch = text.match(/Optimal solution found/i);
  const gapMatch = text.match(/gap\s+([\d.]+)%/i);          // ultima riga della tabella
  const finalGapMatch = text.match(/gap\s+0\.0+%/i);
  info.status   = optMatch ? "Optimal" : "Non-ottimale";
  info.finalGap_pct = finalGapMatch ? 0 : (gapMatch ? parseFloat(gapMatch[1]) : null);

  // Statistiche modello: "N rows, M columns, K nonzeros"
  const modelMatch = text.match(/([\d,]+)\s+rows,\s+([\d,]+)\s+columns,\s+([\d,]+)\s+nonzeros/i);
  if (modelMatch) {
    info.modelRows    = parseInt(modelMatch[1].replace(/,/g, ""));
    info.modelCols    = parseInt(modelMatch[2].replace(/,/g, ""));
    info.modelNonzeros= parseInt(modelMatch[3].replace(/,/g, ""));
  }

  // Tempo di presolve: "Presolve time: X.XXs"
  const presolveMatch = text.match(/Presolve time:\s+([\d.]+)s/i);
  info.presolveTime_s = presolveMatch ? parseFloat(presolveMatch[1]) : null;

  // Best bound e best objective dalla riga finale
  const bestMatch = text.match(/Best objective\s+([\d.e+]+),\s+best bound\s+([\d.e+]+)/i);
  if (bestMatch) {
    info.bestObjective = parseFloat(bestMatch[1]);
    info.bestBound     = parseFloat(bestMatch[2]);
  }

  // Versione Gurobi
  const verMatch = text.match(/Gurobi Optimizer version ([\d.]+)/i);
  info.gurobiVersion = verMatch ? verMatch[1] : null;

  return info;
}

const gurobiInfo = parseGurobiLog(logText);

// ─── 3b. Parsing .sol ─────────────────────────────────────────────────────────
/**
 * Legge tutte le righe del .sol nella forma "nome valore"
 * e restituisce una Map<string, number>.
 */
function parseSol(text) {
  const vars = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length === 2) {
      vars.set(parts[0], parseFloat(parts[1]));
    }
  }
  return vars;
}

const solVars = parseSol(solText);

// Obiettivo (prima riga commentata del .sol)
const objMatch = solText.match(/#\s*Objective value\s*=\s*([\d.]+)/i);
const objectiveValue = objMatch ? parseFloat(objMatch[1]) : null;

// ─── 4. Dati base dal JSON ────────────────────────────────────────────────────
const nodes  = graphData.nodes;   // array di { id }
const links  = graphData.links;   // array di { id, source, target }
const cliques = graphData.cliques; // array di { id, nodes: [...] }

const totalNodes  = nodes.length;
const totalEdges  = links.length;
const totalCliques = cliques.length;
const avgNodeDegree = totalNodes > 0 ? (2 * totalEdges) / totalNodes : 0;
const graphDensity = totalNodes > 1 ? (2 * totalEdges) / (totalNodes * (totalNodes - 1)) : 0;

// Grado massimo nodi
const degreeByNode = new Map();
for (const node of nodes) {
  const nodeId = node && node.id !== undefined && node.id !== null ? node.id : null;
  if (nodeId !== null) degreeByNode.set(String(nodeId), 0);
}
for (const link of links) {
  if (!link) continue;
  const aRaw = link.source;
  const bRaw = link.target;
  if (aRaw === undefined || aRaw === null || bRaw === undefined || bRaw === null) continue;
  const a = String(aRaw);
  const b = String(bRaw);
  degreeByNode.set(a, (degreeByNode.get(a) || 0) + 1);
  degreeByNode.set(b, (degreeByNode.get(b) || 0) + 1);
}
const maxNodeDegree = degreeByNode.size > 0 ? Math.max(...Array.from(degreeByNode.values())) : 0;

// ─── 5. Dimensione clique ─────────────────────────────────────────────────────
const cliqueSizes = cliques.map(c => c.nodes.length);
const maxCliqueSize  = Math.max(...cliqueSizes);
const avgCliqueSize  = cliqueSizes.reduce((a, b) => a + b, 0) / cliqueSizes.length;

// ─── 6. Clique visualizzate correttamente ────────────────────────────────────
/**
 * Per ogni clique del JSON costruisce la chiave del .sol corrispondente.
 * La variabile c_{nodi ordinati per id} è correttamente visualizzata
 * se il suo valore nella soluzione è uguale alla dimensione della clique
 * (ovvero tutti i nodi sono consecutivi nel layout).
 */
function buildCliqueVarName(nodeIds) {
  // Ordine: come appaiono nell'array (lo stesso usato dal generatore .lp)
  return "c_" + nodeIds.map(id => "n" + id).join("n");
}

/**
 * Cerca la variabile c corrispondente alla clique in solVars.
 * Prova tutte le permutazioni rilevanti oppure cerca per sottostringa di nodi.
 * In realtà il generatore usa l'ordine originale del JSON, quindi
 * usiamo direttamente quello.
 */
function findCliqueValue(clique) {
  const key = buildCliqueVarName(clique.nodes);
  if (solVars.has(key)) return solVars.get(key);

  // Fallback: cerca una chiave che contenga esattamente gli stessi nodi
  // (in qualsiasi ordine) — utile se il generatore li ha ordinati diversamente
  const nodeSet = new Set(clique.nodes.map(id => "n" + id));
  for (const [k, v] of solVars) {
    if (!k.startsWith("c_")) continue;
    const kNodes = k.slice(2).split("n").filter(Boolean).map(s => "n" + s);
    if (
      kNodes.length === clique.nodes.length &&
      kNodes.every(n => nodeSet.has(n))
    ) {
      return v;
    }
  }
  return null; // non trovata
}

let correctlyVisualized = 0;
const cliqueDetails = cliques.map(clique => {
  const size  = clique.nodes.length;
  const cVal  = findCliqueValue(clique);
  const correct = cVal !== null && cVal === size;
  if (correct) correctlyVisualized++;
  return { id: clique.id, nodes: clique.nodes, size, cValue: cVal, correct };
});

const pctCorrect = (correctlyVisualized / totalCliques) * 100;

// ─── 7. Nodi che appartengono ad almeno una clique ────────────────────────────
const nodesInClique = new Set();
for (const clique of cliques) {
  for (const nid of clique.nodes) nodesInClique.add(nid);
}
const pctNodesInClique = (nodesInClique.size / totalNodes) * 100;

// ─── 8. Archi che appartengono ad almeno una clique ──────────────────────────
/**
 * Un arco (u, v) appartiene a una clique se esistono due nodi u e v
 * che compaiono insieme nello stesso array nodes di una clique.
 */
const cliquePairs = new Set();
for (const clique of cliques) {
  const ns = clique.nodes;
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = Math.min(ns[i], ns[j]);
      const b = Math.max(ns[i], ns[j]);
      cliquePairs.add(`${a}-${b}`);
    }
  }
}

let edgesInClique = 0;
for (const link of links) {
  const a = Math.min(link.source, link.target);
  const b = Math.max(link.source, link.target);
  if (cliquePairs.has(`${a}-${b}`)) edgesInClique++;
}
const pctEdgesInClique = (edgesInClique / totalEdges) * 100;

// ─── 9. Tempo di esecuzione ───────────────────────────────────────────────────
/**
 * Il tempo viene estratto dal log Gurobi se disponibile,
 * altrimenti si cerca nel .sol (es. riga "# Elapsed time = X s").
 */
let execTime, execTime_s;
if (gurobiInfo && gurobiInfo.solveTime_s !== null) {
  execTime_s = gurobiInfo.solveTime_s;
  execTime   = `${execTime_s.toFixed(2)} s`;
} else {
  const timeMatch = solText.match(/#\s*(?:Elapsed|Solve|Execution|CPU)\s*time[^=]*=\s*([\d.]+)/i);
  execTime_s = timeMatch ? parseFloat(timeMatch[1]) : null;
  execTime   = execTime_s !== null ? `${execTime_s} s` : "N/D (fornire il file .log)";
}

// ─── 10. Stampa risultati ─────────────────────────────────────────────────────
const fmt1 = (n) => n.toFixed(1);
const fmt2 = (n) => n.toFixed(2);

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║            METRICHE DEL GRAFO / ILP                 ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

console.log(`  Istanza                          : ${graphData.name}`);
console.log(`  File JSON                        : ${path.basename(jsonPath)}`);
console.log(`  File SOL                         : ${path.basename(solPath)}`);
if (logPath) console.log(`  File LOG                         : ${path.basename(logPath)}`);
console.log(`  Valore obiettivo (sol)            : ${objectiveValue ?? "N/D"}`);
console.log(`  Tempo di esecuzione               : ${execTime}`);
console.log("");

if (gurobiInfo) {
  console.log("  ── Gurobi ────────────────────────────────────────────");
  if (gurobiInfo.gurobiVersion)   console.log(`  Versione Gurobi                   : ${gurobiInfo.gurobiVersion}`);
  console.log(`  Stato soluzione                   : ${gurobiInfo.status}`);
  if (gurobiInfo.bestObjective != null) console.log(`  Best objective                    : ${gurobiInfo.bestObjective}`);
  if (gurobiInfo.bestBound != null)     console.log(`  Best bound                        : ${gurobiInfo.bestBound}`);
  console.log(`  Gap finale                        : ${gurobiInfo.finalGap_pct !== null ? gurobiInfo.finalGap_pct + " %" : "N/D"}`);
  if (gurobiInfo.solutionCount != null) console.log(`  Soluzioni trovate (B&B)           : ${gurobiInfo.solutionCount}`);
  if (gurobiInfo.nodesExplored != null) console.log(`  Nodi B&B esplorati                : ${gurobiInfo.nodesExplored.toLocaleString("it-IT")}`);
  if (gurobiInfo.simplexIterations != null) console.log(`  Iterazioni simplex                : ${gurobiInfo.simplexIterations.toLocaleString("it-IT")}`);
  if (gurobiInfo.presolveTime_s != null) console.log(`  Tempo presolve                    : ${gurobiInfo.presolveTime_s} s`);
  if (gurobiInfo.modelRows != null) {
    console.log(`  Modello (righe / colonne / nz)    : ${gurobiInfo.modelRows} / ${gurobiInfo.modelCols} / ${gurobiInfo.modelNonzeros}`);
  }
  console.log("");
}

console.log("  ── Nodi e Archi ──────────────────────────────────────");
console.log(`  Numero totale di nodi             : ${totalNodes}`);
console.log(`  Numero totale di archi            : ${totalEdges}`);
console.log(`  Densita del grafo                 : ${fmt2(graphDensity)}`);
console.log(`  Grado medio nodi                  : ${fmt2(avgNodeDegree)}`);
console.log(`  Grado massimo nodi                : ${maxNodeDegree}`);
console.log(`  Nodi in almeno una clique         : ${nodesInClique.size} / ${totalNodes}  (${fmt1(pctNodesInClique)} %)`);
console.log(`  Archi in almeno una clique        : ${edgesInClique} / ${totalEdges}  (${fmt1(pctEdgesInClique)} %)`);
console.log("");
console.log("  ── Clique ────────────────────────────────────────────");
console.log(`  Clique totali                     : ${totalCliques}`);
console.log(`  Dimensione clique massima         : ${maxCliqueSize}`);
console.log(`  Numero medio di nodi per clique   : ${fmt2(avgCliqueSize)}`);
console.log(`  Clique visualizzate correttamente : ${correctlyVisualized} / ${totalCliques}  (${fmt1(pctCorrect)} %)`);
console.log("");
console.log("  ── Dettaglio clique ──────────────────────────────────");
for (const c of cliqueDetails) {
  const stato = c.correct
    ? "✔  corretta"
    : c.cValue === null
      ? "?  var. non trovata"
      : `✘  parziale (c=${c.cValue}, atteso=${c.size})`;
  console.log(`  Clique ${String(c.id).padStart(2)} [${c.nodes.join(",")}]  dim=${c.size}  ${stato}`);
}
console.log("");

// ─── 11. Export JSON opzionale ────────────────────────────────────────────────
const result = {
  instance:                  graphData.name,
  objectiveValue,
  executionTime_s:           execTime_s,
  executionTime:             execTime,
  gurobi:                    gurobiInfo ?? undefined,
  totalNodes,
  totalEdges,
  graphDensity:             +fmt2(graphDensity),
  avgNodeDegree:            +fmt2(avgNodeDegree),
  maxNodeDegree,
  pctNodesInClique:          +fmt2(pctNodesInClique),
  pctEdgesInClique:          +fmt2(pctEdgesInClique),
  totalCliques,
  maxCliqueSize,
  avgCliqueSize:             +fmt2(avgCliqueSize),
  correctlyVisualized,
  compactCliques:            correctlyVisualized,
  pctCompactCliques:         +fmt2(pctCorrect),
  pctCorrectlyVisualized:    +fmt2(pctCorrect),
  cliqueDetails,
};

const outFile = "metrics_output.json";
fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");
console.log(`  → Risultati salvati anche in: ${outFile}\n`);
