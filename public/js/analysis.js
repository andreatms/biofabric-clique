let savedItems = { pipelines: [], queues: [], importedSets: [] };
let lastAnalysisResults = [];
let lastAnalysisFailedEntries = [];
let chartTooltip = null;
let workflowRegistry = null;
let analysisSnapshots = [];
let analysisSnapshotFilter = '';
const SINGLE_CHART_CONFIG_STORAGE_KEY = 'bgw.analysis.singleChartConfig.v1';
let singleChartDefaultConfigSnapshot = null;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  return Number(v).toFixed(digits);
}

function isLogMetricKey(key) {
  return String(key || '').trim() === 'execTimeLog';
}

function isPercentageMetricKey(key) {
  const normalized = String(key || '').trim();
  return normalized === 'pctCompactCliques' || normalized === 'pctNodesInClique';
}

function toSuperscript(value) {
  const map = {
    '-': '⁻',
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '.': '.',
  };
  return String(value).split('').map((ch) => map[ch] || ch).join('');
}

function formatLogExponentLabel(v) {
  if (!Number.isFinite(v)) return '-';
  const rounded = Math.round(v);
  if (Math.abs(v - rounded) < 1e-6) return `10${toSuperscript(rounded)}`;
  return `10${toSuperscript(fmtNum(v, 2))}`;
}

function formatMetricValueForDisplay(key, value, digits = 2) {
  if (isLogMetricKey(key)) return formatLogExponentLabel(value);
  if (isPercentageMetricKey(key)) return `${fmtNum(value, digits)}%`;
  return fmtNum(value, digits);
}

function getPreferredLogMetricDomain() {
  return { min: -2, max: 4 };
}

function getMetricAxisGenerator(scale, key, orientation = 'bottom', tickPadding = 10, tickInterval = null, tickStart = null, tickMax = null) {
  const axis = orientation === 'left' ? d3.axisLeft(scale) : d3.axisBottom(scale);
  axis.tickPadding(tickPadding);
  const interval = Number(tickInterval);
  const hasInterval = Number.isFinite(interval) && interval > 0;
  const maxTickValue = Number(tickMax);
  const hasMaxTickValue = Number.isFinite(maxTickValue);
  const formatStandardTick = (d) => {
    if (isLogMetricKey(key)) return formatLogExponentLabel(Number(d));
    if (isPercentageMetricKey(key)) return `${fmtNum(Number(d), 0)}%`;
    return d;
  };
  if (hasInterval) {
    const domain = scale.domain();
    const minV = Number(domain[0]);
    const maxV = Number(domain[1]);
    if (Number.isFinite(minV) && Number.isFinite(maxV)) {
      let start = Number.isFinite(Number(tickStart)) ? Number(tickStart) : Math.ceil(minV / interval) * interval;
      if (!Number.isFinite(start)) start = Math.ceil(minV / interval) * interval;
      while (start < minV - interval * 0.5) start += interval;
      const tickValues = [];
      for (let v = start; v <= maxV + interval * 0.5; v += interval) {
        if (hasMaxTickValue && v > maxTickValue + interval * 0.5) break;
        tickValues.push(v);
      }
      if (tickValues.length) axis.tickValues(tickValues);
    }
    if (isLogMetricKey(key) || isPercentageMetricKey(key)) axis.tickFormat((d) => formatStandardTick(d));
    return axis;
  }
  if (hasMaxTickValue) {
    axis.tickFormat((d) => (Number(d) <= maxTickValue ? formatStandardTick(d) : ''));
    return axis;
  }
  if (isPercentageMetricKey(key)) {
    axis.tickFormat((d) => formatStandardTick(d));
    return axis;
  }
  if (!isLogMetricKey(key)) return axis;

  const domain = scale.domain();
  const minV = Number(domain[0]);
  const maxV = Number(domain[1]);
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
    axis.tickFormat((d) => formatLogExponentLabel(Number(d)));
    return axis;
  }

  const preferred = getPreferredLogMetricDomain();
  const start = Math.max(preferred.min, Math.floor(minV));
  const end = Math.min(preferred.max, Math.ceil(maxV));
  const tickValues = [];
  for (let exp = start; exp <= end; exp += 1) tickValues.push(exp);

  axis.tickValues(Array.from(new Set(tickValues)).sort((a, b) => a - b));
  axis.tickFormat((d) => formatLogExponentLabel(Number(d)));
  return axis;
}

function getLinearDomainWithPixelPadding(extent, rangePx, padPx = 0, padFactor = 0.08) {
  const minV = Number(extent && extent[0]);
  const maxV = Number(extent && extent[1]);
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return [0, 1];
  const span = (maxV - minV) || Math.max(1, Math.abs(maxV) || 1);
  const factorPad = span * padFactor;
  const pixelPad = rangePx > 0 && padPx > 0 ? (span * padPx) / rangePx : 0;
  const totalPad = Math.max(factorPad, pixelPad);
  return [minV - totalPad, maxV + totalPad];
}

function getMetricDomainWithPadding(key, extent, rangePx, padPx = 0, padFactor = 0.08) {
  const padded = getLinearDomainWithPixelPadding(extent, rangePx, padPx, padFactor);
  if (isPercentageMetricKey(key)) {
    const minV = Number(padded[0]);
    const maxV = Number(padded[1]);
    const safeMin = Number.isFinite(minV) ? Math.max(0, minV) : 0;
    const safeMax = Number.isFinite(maxV) ? Math.min(100, maxV) : 100;
    return [Math.min(0, safeMin), Math.max(100, safeMax)];
  }
  if (!isLogMetricKey(key)) return padded;

  const preferred = getPreferredLogMetricDomain();
  const minV = Number(padded[0]);
  const maxV = Number(padded[1]);
  const safeMin = Number.isFinite(minV) ? Math.min(minV, preferred.min) : preferred.min;
  const safeMax = Number.isFinite(maxV) ? Math.max(maxV, preferred.max + 0.12) : preferred.max + 0.12;
  return [safeMin, safeMax];
}

function parseExecutionTimeSeconds(metrics) {
  if (!metrics || typeof metrics !== 'object') return NaN;

  const direct = Number(metrics.executionTime_s);
  if (Number.isFinite(direct)) return direct;

  const raw = String(metrics.executionTime || '').trim();
  if (!raw) return NaN;

  const m = raw.match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return NaN;
  const normalized = m[1].replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function enrichFailedEntriesBasicMetrics(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const tasks = entries.map(async (entry) => {
    if (!entry || !entry.pipelineSaveFile) return;
    const existing = entry.metrics || {};
    const hasInfo = (Array.isArray(existing.cliqueDetails) && existing.cliqueDetails.length)
      || Number.isFinite(Number(existing.avgCliqueDegree))
      || (Number.isFinite(Number(existing.avgCliqueSize)) && Number.isFinite(Number(existing.totalCliques)));
    if (hasInfo) return;
    const fileName = String(entry.pipelineSaveFile || '');
    if (!fileName) return;
    try {
      const r = await fetch(`/analysis/pipelines/${encodeURIComponent(fileName)}/basic-metrics`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data || !data.metrics) return;
      entry.metrics = Object.assign({}, entry.metrics || {}, data.metrics);
    } catch (e) {
      // ignore fetch errors silently
    }
  });
  await Promise.all(tasks);
}

function getExecScaleMode(selectId = 'exec-scale-mode') {
  const sel = document.getElementById(selectId);
  const mode = sel ? String(sel.value || 'linear').toLowerCase() : 'linear';
  return mode === 'log' ? 'log' : 'linear';
}

function getExecTimeCap(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return null;
  const raw = String(input.value || '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getAnalysisPointMode() {
  const sel = document.getElementById('analysis-point-mode');
  const mode = sel ? String(sel.value || 'average').toLowerCase() : 'average';
  if (mode === 'all') return 'all';
  if (mode === 'boxplot') return 'boxplot';
  return 'average';
}

function shouldShowFailedPoints() {
  const chk = document.getElementById('analysis-show-failed');
  return !chk || !!chk.checked;
}

function shouldShowCompletedPoints() {
  const chk = document.getElementById('analysis-show-completed');
  return !chk || !!chk.checked;
}

function shouldShowLegend() {
  const single = document.getElementById('single-show-legend');
  if (single) return !!single.checked;
  const chk = document.getElementById('analysis-show-legend');
  return !chk || !!chk.checked;
}

function shouldShowSingleColorLegend() {
  const chk = document.getElementById('single-show-color-legend');
  return !chk || !!chk.checked;
}

function getMainForegroundLayer() {
  const sel = document.getElementById('analysis-foreground-layer');
  return String(sel && sel.value ? sel.value : 'failed').toLowerCase() === 'completed' ? 'completed' : 'failed';
}

function getFailedPointsColor() {
  const input = document.getElementById('analysis-failed-color');
  const raw = String(input && input.value ? input.value : '').trim();
  return /^#([0-9a-fA-F]{6})$/.test(raw) ? raw : '#ff8c00';
}

function getSymbolTypeByName(name) {
  const key = String(name || 'triangle').toLowerCase();
  if (key === 'diamond') return d3.symbolDiamond;
  if (key === 'square') return d3.symbolSquare;
  if (key === 'circle') return d3.symbolCircle;
  if (key === 'cross') return d3.symbolCross;
  return d3.symbolTriangle;
}

function getFailedPointsShape() {
  const sel = document.getElementById('analysis-failed-shape');
  return String(sel && sel.value ? sel.value : 'triangle').toLowerCase();
}

function shouldShowSingleFailedPoints() {
  const chk = document.getElementById('single-show-failed');
  return !chk || !!chk.checked;
}

function shouldShowSingleCompletedPoints() {
  const chk = document.getElementById('single-show-completed');
  return !chk || !!chk.checked;
}

function shouldSingleCiOutliersExtremesOnly() {
  const chk = document.getElementById('single-ci-outlier-extremes-only');
  return !!(chk && chk.checked);
}

function getSingleFailedPointsColor() {
  const input = document.getElementById('single-failed-color');
  const raw = String(input && input.value ? input.value : '').trim();
  return /^#([0-9a-fA-F]{6})$/.test(raw) ? raw : getFailedPointsColor();
}

function getSingleFailedPointsShape() {
  const sel = document.getElementById('single-failed-shape');
  return String(sel && sel.value ? sel.value : 'triangle').toLowerCase();
}

function getHexColorInputValue(inputId, fallback) {
  const input = document.getElementById(inputId);
  const raw = String(input && input.value ? input.value : '').trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return raw;
  return fallback;
}

function getClampedNumberInputValue(inputId, fallback, min, max) {
  const raw = Number(document.getElementById(inputId)?.value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function getSingleConfidenceIntervalStyle() {
  const basePointSize = getSinglePointBaseSize();
  const outlierSizeMultiplier = getClampedNumberInputValue('single-ci-outlier-size-multiplier', 1, 0.5, 6);
  const outlierSymbolArea = Math.max(18, Math.min(260, basePointSize * basePointSize * 0.9 * outlierSizeMultiplier));
  return {
    areaFillColor: getHexColorInputValue('single-ci-area-fill-color', '#9fb8ff'),
    areaStrokeColor: getHexColorInputValue('single-ci-area-stroke-color', '#4f77c6'),
    medianColor: getHexColorInputValue('single-ci-median-color', '#1f3f88'),
    p25Color: getHexColorInputValue('single-ci-p25-color', '#2958b8'),
    p75Color: getHexColorInputValue('single-ci-p75-color', '#2958b8'),
    outlierFillColor: getHexColorInputValue('single-ci-outlier-fill-color', '#ffffff'),
    outlierStrokeColor: getHexColorInputValue('single-ci-outlier-stroke-color', '#cf1b1b'),
    areaStrokeWidth: getClampedNumberInputValue('single-ci-area-stroke-width', 0.8, 0, 8),
    medianWidth: getClampedNumberInputValue('single-ci-median-width', 2.3, 0.2, 10),
    p25Width: getClampedNumberInputValue('single-ci-p25-width', 1.2, 0.2, 10),
    p75Width: getClampedNumberInputValue('single-ci-p75-width', 1.2, 0.2, 10),
    outlierStrokeWidth: getClampedNumberInputValue('single-ci-outlier-stroke-width', 1.3, 0.2, 10),
    outlierOpacity: getClampedNumberInputValue('single-ci-outlier-opacity', 0.85, 0.05, 1),
    outlierShape: String(document.getElementById('single-ci-outlier-shape')?.value || 'circle').toLowerCase(),
    outlierSymbolArea,
  };
}

function shouldHideSingleAxisNames() {
  const chk = document.getElementById('single-hide-axis-names');
  return !!(chk && chk.checked);
}

function shouldHideSingleXAxis() {
  const chk = document.getElementById('single-hide-axis-x');
  return !!(chk && chk.checked);
}

function shouldHideSingleYAxis() {
  const chk = document.getElementById('single-hide-axis-y');
  return !!(chk && chk.checked);
}

function getSingleForegroundLayer() {
  const sel = document.getElementById('single-foreground-layer');
  return String(sel && sel.value ? sel.value : 'failed').toLowerCase() === 'completed' ? 'completed' : 'failed';
}

function getSinglePointMode() {
  const sel = document.getElementById('single-point-mode');
  const mode = String(sel && sel.value ? sel.value : 'scatter').toLowerCase();
  if (mode === 'boxplot') return 'boxplot';
  if (mode === 'confidence-interval') return 'confidence-interval';
  return 'scatter';
}

function getSingleBucketingConfig() {
  const enabledInput = document.getElementById('single-enable-bucketing');
  const sizeInput = document.getElementById('single-bucket-size');
  const startInput = document.getElementById('single-bucket-start');
  const rawSize = Number(sizeInput?.value);
  const rawStart = Number(startInput?.value);
  const bucketSize = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 1;
  const bucketStart = Number.isFinite(rawStart) ? rawStart : 0;
  const pointMode = getSinglePointMode();
  const enabled = !!(enabledInput && enabledInput.checked) && pointMode !== 'boxplot';
  return {
    enabled,
    bucketSize: enabled ? bucketSize : null,
    bucketStart: enabled ? bucketStart : null,
  };
}

function updateSingleBucketingControls() {
  const enabledInput = document.getElementById('single-enable-bucketing');
  const sizeInput = document.getElementById('single-bucket-size');
  const startInput = document.getElementById('single-bucket-start');
  if (!enabledInput || !sizeInput || !startInput) return;
  const pointMode = getSinglePointMode();
  const supported = pointMode === 'scatter' || pointMode === 'confidence-interval';
  enabledInput.disabled = !supported;
  sizeInput.disabled = !supported || !enabledInput.checked;
  startInput.disabled = !supported || !enabledInput.checked;
}

function getSinglePointOpacity() {
  const raw = Number(document.getElementById('single-point-opacity')?.value);
  return Number.isFinite(raw) ? Math.max(0.05, Math.min(1, raw)) : 0.95;
}

function getSinglePointFillMode() {
  const sel = document.getElementById('single-point-fill-mode');
  return String(sel && sel.value ? sel.value : 'filled').toLowerCase() === 'stroke-only' ? 'stroke-only' : 'filled';
}

function getSingleCompletedPointStrokeColor() {
  const input = document.getElementById('single-point-stroke-color-completed');
  const raw = String(input && input.value ? input.value : '').trim();
  if (/^#([0-9a-fA-F]{6})$/.test(raw)) return raw;
  return '#222222';
}

function getSingleFailedPointStrokeColor() {
  const input = document.getElementById('single-point-stroke-color-failed');
  const raw = String(input && input.value ? input.value : '').trim();
  if (/^#([0-9a-fA-F]{6})$/.test(raw)) return raw;
  return '#3b2a00';
}

function shouldSingleCompletedStrokeFollowFill() {
  const input = document.getElementById('single-point-stroke-color-completed');
  return !input || input.dataset.userSet !== '1';
}

function shouldSingleFailedStrokeFollowFill() {
  const input = document.getElementById('single-point-stroke-color-failed');
  return !input || input.dataset.userSet !== '1';
}

function initSingleStrokeColorSync() {
  const completedFillInput = document.getElementById('single-hex-color');
  const failedFillInput = document.getElementById('single-failed-color');
  const completedStrokeInput = document.getElementById('single-point-stroke-color-completed');
  const failedStrokeInput = document.getElementById('single-point-stroke-color-failed');

  if (completedStrokeInput && completedFillInput) {
    if (completedStrokeInput.dataset.userSet !== '1') {
      completedStrokeInput.value = completedFillInput.value || completedStrokeInput.value;
    }
    completedFillInput.addEventListener('input', () => {
      if (completedStrokeInput.dataset.userSet === '1') return;
      completedStrokeInput.value = completedFillInput.value || completedStrokeInput.value;
    });
    completedStrokeInput.addEventListener('input', () => {
      completedStrokeInput.dataset.userSet = '1';
    });
  }

  if (failedStrokeInput && failedFillInput) {
    if (failedStrokeInput.dataset.userSet !== '1') {
      failedStrokeInput.value = failedFillInput.value || failedStrokeInput.value;
    }
    failedFillInput.addEventListener('input', () => {
      if (failedStrokeInput.dataset.userSet === '1') return;
      failedStrokeInput.value = failedFillInput.value || failedStrokeInput.value;
    });
    failedStrokeInput.addEventListener('input', () => {
      failedStrokeInput.dataset.userSet = '1';
    });
  }
}

function getSingleCustomLabelValue(inputId) {
  const input = document.getElementById(inputId);
  const raw = String(input && input.value ? input.value : '').trim();
  return raw;
}

function applyForegroundInGroup(g, foregroundLayer, completedSelector, failedSelector) {
  if (!g) return;
  if (foregroundLayer === 'completed') {
    g.selectAll(completedSelector).raise();
    return;
  }
  g.selectAll(failedSelector).raise();
}

function renderSingleScatterLegend({
  g,
  pointsCount,
  failedCount,
  failedColor,
  failedShape,
  failedUsesColorScale = false,
  failedUsesSizeScale = false,
  completedDisplayMode = 'points',
  completedLegendLabel = 'Completed graphs',
  failedLegendLabel = 'Incomplete graphs',
  legendFontSize = 11,
  bucketLabel = '',
}) {
  const completedModeSuffixMap = {
    boxplot: ' (boxplot)',
    'confidence-interval': ' (intervallo di confidenza)',
    points: '',
  };
  const completedModeLabelMap = {
    boxplot: `${completedLegendLabel} (boxplot)`,
    'confidence-interval': `${completedLegendLabel} (confidence interval)`,
    points: completedLegendLabel,
  };
  const completedModeSuffix = completedModeSuffixMap[completedDisplayMode] || '';
  const completedLegendText = completedModeLabelMap[completedDisplayMode] || completedLegendLabel;

  const legendEl = document.getElementById('analysis-single-scatter-legend');
  if (legendEl) {
    legendEl.style.fontSize = `${legendFontSize}px`;
    const shapeLabelMap = {
      triangle: 'triangle',
      diamond: 'diamond',
      square: 'square',
      circle: 'circle',
      cross: 'cross',
    };
    const shapeLabel = shapeLabelMap[String(failedShape || 'triangle').toLowerCase()] || 'triangle';
    const failedColorLabel = failedUsesColorScale ? 'color from metric' : failedColor;
    const failedSizeLabel = failedUsesSizeScale ? ', size from metric' : '';
    const bucketSuffix = bucketLabel ? ` | ${bucketLabel}` : '';
    legendEl.textContent = `Legend: ${completedLegendLabel}${completedModeSuffix}=${pointsCount} | ${failedLegendLabel}=${failedCount} (${shapeLabel}, ${failedColorLabel}${failedSizeLabel})${bucketSuffix}`;
  }
  if (!shouldShowLegend()) {
    if (legendEl) legendEl.textContent = '';
    return;
  }

  if (!g) return;
  const legend = g.append('g').attr('transform', 'translate(8,8)');
  const legendTextY = Math.max(12, legendFontSize + 1);
  const legendRowH = Math.max(18, legendFontSize + 7);
  let yOffset = 0;

  if (pointsCount > 0) {
    if (completedDisplayMode === 'boxplot') {
      legend.append('rect')
        .attr('x', 2)
        .attr('y', yOffset + 3)
        .attr('width', 12)
        .attr('height', 10)
        .attr('fill', '#9fb8ff')
        .attr('stroke', '#223a75')
        .attr('stroke-width', 1);
      legend.append('line')
        .attr('x1', 2)
        .attr('x2', 14)
        .attr('y1', yOffset + 8)
        .attr('y2', yOffset + 8)
        .attr('stroke', '#223a75')
        .attr('stroke-width', 1.1);
    } else if (completedDisplayMode === 'confidence-interval') {
      legend.append('rect')
        .attr('x', 2)
        .attr('y', yOffset + 2)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', '#9fb8ff')
        .attr('fill-opacity', 0.35)
        .attr('stroke', 'none');
      legend.append('line')
        .attr('x1', 2)
        .attr('x2', 14)
        .attr('y1', yOffset + 8)
        .attr('y2', yOffset + 8)
        .attr('stroke', '#223a75')
        .attr('stroke-width', 1.6);
      legend.append('line')
        .attr('x1', 2)
        .attr('x2', 14)
        .attr('y1', yOffset + 5)
        .attr('y2', yOffset + 5)
        .attr('stroke', '#223a75')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,2');
      legend.append('line')
        .attr('x1', 2)
        .attr('x2', 14)
        .attr('y1', yOffset + 11)
        .attr('y2', yOffset + 11)
        .attr('stroke', '#223a75')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,2');
    } else {
      legend.append('circle')
        .attr('cx', 8)
        .attr('cy', yOffset + 8)
        .attr('r', 5)
        .attr('fill', '#9fb8ff')
        .attr('stroke', '#223a75')
        .attr('stroke-width', 1);
    }
    legend.append('text')
      .attr('x', 20)
      .attr('y', yOffset + legendTextY)
      .attr('font-size', legendFontSize)
      .attr('fill', '#2f3e63')
      .text(completedLegendText);
    yOffset += legendRowH;
  }

  if (failedCount > 0) {
    legend.append('path')
      .attr('d', d3.symbol().type(getSymbolTypeByName(failedShape)).size(90))
      .attr('transform', `translate(8,${yOffset + 8}) rotate(180)`)
      .attr('fill', failedColor)
      .attr('stroke', '#3b2a00')
      .attr('stroke-width', 1);
    legend.append('text')
      .attr('x', 20)
      .attr('y', yOffset + legendTextY)
      .attr('font-size', legendFontSize)
      .attr('fill', '#5b3d00')
      .text(failedLegendLabel);
  }
}

function renderSingleColorLegend({
  g,
  innerW,
  tickFontSize,
  colorValueFontSize,
  cKey,
  colorScaleLabel = '',
  completedColorExtent,
  completedColorScale,
  completedColor,
  failedColorExtent,
  failedColorScale,
  failedColor,
  completedCount = 0,
  failedCount = 0,
}) {
  if (!cKey || cKey === 'none') return;
  if (!shouldShowSingleColorLegend()) return;
  if (!g) return;

  // ensure svg defs
  const svgEl = g.node() && g.node().ownerSVGElement ? g.node().ownerSVGElement : null;
  if (!svgEl) return;

  let defs = d3.select(svgEl).select('defs');
  if (defs.empty()) defs = d3.select(svgEl).append('defs');

  const items = [];
  if (completedCount > 0) {
    items.push({
      id: 'completed',
      label: colorScaleLabel || `${getMetricLabelByKey(cKey)}`,
      extent: completedColorExtent,
      colorScale: completedColorScale,
      endColorFallback: completedColor,
      textColor: '#2f3e63',
    });
  }
  if (failedCount > 0) {
    items.push({
      id: 'failed',
      label: colorScaleLabel || `${getMetricLabelByKey(cKey)}`,
      extent: failedColorExtent,
      colorScale: failedColorScale,
      endColorFallback: failedColor,
      textColor: '#5b3d00',
    });
  }
  if (!items.length) return;

  const boxW = 150;
  const boxH = 12;
  const rowH = 34;
  const x = Math.max(0, innerW - boxW - 8);
  const legend = g.append('g').attr('transform', `translate(${x},8)`);

  const getExtentValues = (extent) => {
    const minV = Array.isArray(extent) ? Number(extent[0]) : NaN;
    const maxV = Array.isArray(extent) ? Number(extent[1]) : NaN;
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return null;
    return { minV, maxV };
  };

  const safeScaleColor = (scaleFn, value, fallback) => {
    try {
      const c = typeof scaleFn === 'function' ? scaleFn(value) : fallback;
      return c || fallback;
    } catch (e) {
      return fallback;
    }
  };

  items.forEach((item, idx) => {
    const y = idx * rowH;
    const extentValues = getExtentValues(item.extent);
    const minV = extentValues ? extentValues.minV : null;
    const maxV = extentValues ? extentValues.maxV : null;

    const startColor = extentValues
      ? safeScaleColor(item.colorScale, minV, '#f7fbff')
      : '#f7fbff';
    const endColor = extentValues
      ? safeScaleColor(item.colorScale, maxV, item.endColorFallback)
      : item.endColorFallback;

    const gid = `singleColorGrad_${item.id}_${Math.random().toString(36).slice(2, 9)}`;
    const grad = defs.append('linearGradient').attr('id', gid).attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '0%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', startColor);
    grad.append('stop').attr('offset', '100%').attr('stop-color', endColor);

    legend.append('text')
      .attr('x', 0)
      .attr('y', y)
      .attr('font-size', tickFontSize)
      .attr('fill', item.textColor)
      .text(item.label);

    legend.append('rect')
      .attr('x', 0)
      .attr('y', y + 6)
      .attr('width', boxW)
      .attr('height', boxH)
      .attr('rx', 2)
      .attr('ry', 2)
      .attr('fill', `url(#${gid})`)
      .attr('stroke', '#ccc')
      .attr('stroke-width', 0.6);

    legend.append('text')
      .attr('x', 0)
      .attr('y', y + 6 + boxH + 12)
      .attr('font-size', colorValueFontSize)
      .attr('fill', item.textColor)
      .text(extentValues ? formatMetricValueForDisplay(cKey, minV, 2) : 'n.d.');

    legend.append('text')
      .attr('x', boxW)
      .attr('y', y + 6 + boxH + 12)
      .attr('text-anchor', 'end')
      .attr('font-size', colorValueFontSize)
      .attr('fill', item.textColor)
      .text(extentValues ? formatMetricValueForDisplay(cKey, maxV, 2) : 'n.d.');
  });
}

function getPointOverlapFactor() {
  const slider = document.getElementById('analysis-overlap-slider');
  const value = slider ? Number(slider.value) : 0.7;
  return Number.isFinite(value) ? Math.max(0.35, Math.min(1, value)) : 0.7;
}

function getPointAttractStrength() {
  const slider = document.getElementById('analysis-attract-slider');
  const value = slider ? Number(slider.value) : 0.35;
  return Number.isFinite(value) ? Math.max(0.05, Math.min(0.9, value)) : 0.35;
}

function updatePointTuningLabels() {
  const overlap = getPointOverlapFactor();
  const attract = getPointAttractStrength();
  const overlapLabel = document.getElementById('analysis-overlap-value');
  const attractLabel = document.getElementById('analysis-attract-value');
  if (overlapLabel) overlapLabel.textContent = overlap.toFixed(2);
  if (attractLabel) attractLabel.textContent = attract.toFixed(2);
}

function updatePointTuningVisibility() {
  const tuning = document.getElementById('analysis-point-tuning');
  if (!tuning) return;
  const show = getAnalysisPointMode() === 'all';
  tuning.hidden = !show;
  tuning.style.display = show ? 'flex' : 'none';
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

  const err = document.getElementById('analysis-error');
  const msg = document.getElementById('analysis-msg');
  try {
    const r = await fetch(`/workflow/registry?scope=${encodeURIComponent(scope)}`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Workflow cleanup error');

    workflowRegistry = data.registry || null;
    renderWorkflowSummary();
    await loadSavedItems();
    msg.textContent = data.message || 'Workflow cleared successfully.';
    msg.style.display = 'block';
    err.style.display = 'none';
  } catch (e) {
    err.textContent = 'Error: ' + e.message;
    err.style.display = 'block';
  }
}

async function loadSavedItems() {
  const r = await fetch('/analysis/saved-items');
  const data = await r.json();
  savedItems = {
    pipelines: data.pipelines || [],
    queues: data.queues || [],
    importedSets: data.importedSets || [],
  };
  populateSaveSelects();
}

async function deleteSelectedQueueSaves() {
  const selectedQueueSaves = Array.from(document.getElementById('queue-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);
  if (!selectedQueueSaves.length) {
    alert('Select at least one saved queue to delete.');
    return;
  }
  if (!confirm(`Delete ${selectedQueueSaves.length} saved queue(s) from the analysis list?`)) return;

  const failed = [];
  for (const fileName of selectedQueueSaves) {
    try {
      const r = await fetch(`/analysis/saved-items/queue/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || 'Error deleting queue save');
    } catch (e) {
      failed.push({ fileName, error: e.message });
    }
  }

  await loadSavedItems();
  if (failed.length) {
    alert(`Some deletions failed (${failed.length}). See console.`);
    console.warn('Queue save delete errors', failed);
  }
}

async function deleteSelectedPipelineSaves() {
  const selectedPipelineSaves = Array.from(document.getElementById('pipeline-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);
  if (!selectedPipelineSaves.length) {
    alert('Select at least one saved pipeline to delete.');
    return;
  }
  if (!confirm(`Delete ${selectedPipelineSaves.length} saved pipeline(s) from the analysis list?`)) return;

  const failed = [];
  for (const fileName of selectedPipelineSaves) {
    try {
      const r = await fetch(`/analysis/saved-items/pipeline/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || 'Error deleting pipeline save');
    } catch (e) {
      failed.push({ fileName, error: e.message });
    }
  }

  await loadSavedItems();
  if (failed.length) {
    alert(`Alcune eliminazioni non sono riuscite (${failed.length}). Vedi console.`);
    console.warn('Pipeline save delete errors', failed);
  }
}

function populateAnalysisSnapshots() {
  const sel = document.getElementById('analysis-snapshots');
  if (!sel) return;
  sel.innerHTML = '';

  const query = String(analysisSnapshotFilter || '').trim().toLowerCase();
  const visibleSnapshots = !query
    ? analysisSnapshots
    : analysisSnapshots.filter((snap) => String(snap.name || snap.fileName || '').toLowerCase().includes(query));

  if (!visibleSnapshots.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = query ? 'No analyses found with this filter' : 'No saved analyses';
    sel.appendChild(opt);
    return;
  }

  visibleSnapshots.forEach((snap) => {
    const opt = document.createElement('option');
    opt.value = snap.fileName;
    const stamp = snap.createdAt ? new Date(snap.createdAt).toLocaleString('it-IT') : '-';
    opt.textContent = `${snap.name || snap.fileName} | results: ${snap.resultCount || 0} | ${stamp}`;
    sel.appendChild(opt);
  });
}

async function loadAnalysisSnapshots() {
  try {
    const r = await fetch('/analysis/snapshots');
    const data = await r.json();
    analysisSnapshots = data.snapshots || [];
    populateAnalysisSnapshots();
  } catch (e) {
    console.error('Error loading analysis snapshots', e);
  }
}

function onAnalysisSnapshotFilterChange(value) {
  analysisSnapshotFilter = String(value || '');
  populateAnalysisSnapshots();
}

function exportSelectedAnalysisSnapshot() {
  const sel = document.getElementById('analysis-snapshots');
  const fileName = sel && sel.value ? sel.value : '';
  if (!fileName) {
    alert('Select a saved analysis to export.');
    return;
  }
  window.open(`/analysis/snapshots/${encodeURIComponent(fileName)}/export`, '_blank');
}

function triggerImportAnalysisSnapshot() {
  const input = document.getElementById('analysis-snapshot-import-file');
  if (!input) return;
  input.value = '';
  input.click();
}

async function onImportAnalysisSnapshotFile(inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0] ? inputEl.files[0] : null;
  if (!file) return;

  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/analysis/snapshots/import', {
      method: 'POST',
      body: fd,
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error importing saved analysis');
    await loadAnalysisSnapshots();
    alert(`Saved analysis imported: ${data.fileName}`);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (inputEl) inputEl.value = '';
  }
}

async function saveCurrentAnalysis() {
  if (!lastAnalysisResults || !lastAnalysisResults.length) {
    alert('No results to save. Run an analysis first.');
    return;
  }

  const saveName = (document.getElementById('analysis-save-name')?.value || '').trim();
  const selectedPipelineSaves = Array.from(document.getElementById('pipeline-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);
  const selectedQueueSaves = Array.from(document.getElementById('queue-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);
  const selectedImportedSetSaves = Array.from(document.getElementById('imported-set-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);

  try {
    const r = await fetch('/analysis/snapshots/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: saveName,
        source: {
          pipelineSaves: selectedPipelineSaves,
          queueSaves: selectedQueueSaves,
          importedSetSaves: selectedImportedSetSaves,
        },
        results: lastAnalysisResults,
        failedEntries: Array.isArray(lastAnalysisFailedEntries) ? lastAnalysisFailedEntries : [],
      }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error saving analysis');

    await loadAnalysisSnapshots();
    alert(`Analysis saved: ${data.fileName}`);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function openSelectedAnalysisSnapshot() {
  const sel = document.getElementById('analysis-snapshots');
  const fileName = sel && sel.value ? sel.value : '';
  if (!fileName) {
    alert('Select a saved analysis to open.');
    return;
  }

  try {
    const r = await fetch(`/analysis/snapshots/${encodeURIComponent(fileName)}`);
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error opening saved analysis');

    lastAnalysisResults = Array.isArray(data.results) ? data.results : [];
    lastAnalysisFailedEntries = Array.isArray(data.failedEntries) ? data.failedEntries : [];
    // enrich failed entries with basic metrics derived from the graph JSON when possible
    await enrichFailedEntriesBasicMetrics(lastAnalysisFailedEntries);
    renderTable(lastAnalysisResults);
    renderDatasetStats(lastAnalysisResults, lastAnalysisFailedEntries);
    renderAllAnalysisCharts(lastAnalysisResults);

    const msg = document.getElementById('analysis-msg');
    const totalCount = lastAnalysisResults.length + (lastAnalysisFailedEntries ? lastAnalysisFailedEntries.length : 0);
    msg.textContent = `Saved analysis loaded: ${data.name || fileName} (${totalCount} item(s): ${lastAnalysisResults.length} completed, ${lastAnalysisFailedEntries.length} incomplete).`;
    msg.style.display = 'block';
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteSelectedAnalysisSnapshot() {
  const sel = document.getElementById('analysis-snapshots');
  const fileName = sel && sel.value ? sel.value : '';
  if (!fileName) {
    alert('Select a saved analysis to delete.');
    return;
  }
  if (!confirm(`Delete saved analysis ${fileName}?`)) return;

  try {
    const r = await fetch(`/analysis/snapshots/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error deleting saved analysis');
    await loadAnalysisSnapshots();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function populateSaveSelects() {
  const pipelineSel = document.getElementById('pipeline-saves');
  const queueSel = document.getElementById('queue-saves');
  const importedSetSel = document.getElementById('imported-set-saves');
  pipelineSel.innerHTML = '';
  queueSel.innerHTML = '';
  if (importedSetSel) importedSetSel.innerHTML = '';

  if (!savedItems.pipelines.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No saved pipelines';
    pipelineSel.appendChild(opt);
  } else {
    savedItems.pipelines.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.fileName;
      const stamp = item.startTime ? new Date(item.startTime).toLocaleString('it-IT') : '-';
      opt.textContent = `${item.name} (${item.status}) - ${stamp}`;
      pipelineSel.appendChild(opt);
    });
  }

  if (!savedItems.queues.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No saved queues';
    queueSel.appendChild(opt);
  } else {
    savedItems.queues.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.fileName;
      const stamp = item.startTime ? new Date(item.startTime).toLocaleString('it-IT') : '-';
      opt.textContent = `${item.name} (${item.status}) - ${stamp} | pipeline: ${item.pipelineCount}`;
      queueSel.appendChild(opt);
    });
  }

  if (!importedSetSel) return;

  if (!savedItems.importedSets.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No imported results';
    importedSetSel.appendChild(opt);
  } else {
    savedItems.importedSets.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.fileName;
      const stamp = item.importedAt ? new Date(item.importedAt).toLocaleString('it-IT') : '-';
      opt.textContent = `${item.setName} | ok: ${item.succeeded}/${item.total} | ${stamp}`;
      importedSetSel.appendChild(opt);
    });
  }
}

function renderTable(results) {
  const tbody = document.getElementById('analysis-tbody');
  if (!results.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="list-empty">No metrics available.</td></tr>';
    return;
  }

  tbody.innerHTML = results.map(r => {
    const m = r.metrics || {};
    const isSetGraph = !!(r.graphSetName && r.graphSetGraphId);
    const graphLink = isSetGraph
      ? `<a href="/graph.html?set=${encodeURIComponent(r.graphSetName)}&setGraph=${encodeURIComponent(r.graphSetGraphId)}" target="_blank">Apri</a>`
      : (r.graphJsonId
        ? `<a href="/graph.html?graph=${encodeURIComponent(r.graphJsonId)}" target="_blank">Apri</a>`
        : '-');
    const biofabricLink = r.solFileName
      ? (isSetGraph
        ? `<a href="/result.html?set=${encodeURIComponent(r.graphSetName)}&setGraph=${encodeURIComponent(r.graphSetGraphId)}&sol=${encodeURIComponent(r.solFileName)}" target="_blank">Apri</a>`
        : (r.graphJsonId
          ? `<a href="/result.html?graph=${encodeURIComponent(r.graphJsonId)}&sol=${encodeURIComponent(r.solFileName)}" target="_blank">Apri</a>`
          : '-'))
      : '-';
    return `<tr>
      <td>${esc(r.pipelineSaveFile)}</td>
      <td>${esc(m.instance || '-')}</td>
      <td>${esc(m.totalNodes ?? '-')}</td>
      <td>${esc(m.totalCliques ?? '-')}</td>
      <td>${fmtNum(m.pctCorrectlyVisualized, 2)}%</td>
      <td>${fmtNum(getCompactCliquesPct(m), 2)}%</td>
      <td>${fmtNum(getNodesInCliquePct(m), 2)}%</td>
      <td>${fmtNum(m.avgCliqueSize, 2)}</td>
      <td>${esc(m.objectiveValue ?? '-')}</td>
      <td>${esc(m.executionTime || '-')}</td>
      <td>${graphLink}</td>
      <td>${biofabricLink}</td>
    </tr>`;
  }).join('');
}

function getCompactCliquesPct(metrics) {
  const direct = Number(metrics && metrics.pctCompactCliques);
  if (Number.isFinite(direct)) return direct;
  const fallback = Number(metrics && metrics.pctCorrectlyVisualized);
  return Number.isFinite(fallback) ? fallback : NaN;
}

function getNodesInCliquePct(metrics) {
  const direct = Number(metrics && metrics.pctNodesInClique);
  if (Number.isFinite(direct)) return direct;

  const details = metrics && Array.isArray(metrics.cliqueDetails) ? metrics.cliqueDetails : null;
  const totalNodes = Number(metrics && metrics.totalNodes);
  if (!details || !Number.isFinite(totalNodes) || totalNodes <= 0) return NaN;

  const inClique = new Set();
  details.forEach((c) => {
    if (!c || !Array.isArray(c.nodes)) return;
    c.nodes.forEach((nid) => inClique.add(nid));
  });
  return (inClique.size / totalNodes) * 100;
}

const DATASET_STATS_DEFINITIONS = [
  {
    key: 'nodes',
    label: 'Number of nodes',
    decimals: 2,
    extractor: (metrics) => [Number(metrics && metrics.totalNodes)],
  },
  {
    key: 'edges',
    label: 'Number of edges',
    decimals: 2,
    extractor: (metrics) => [Number(metrics && metrics.totalEdges)],
  },
  {
    key: 'cliques',
    label: 'Number of cliques',
    decimals: 2,
    extractor: (metrics) => [Number(metrics && metrics.totalCliques)],
  },
  {
    key: 'cliqueSize',
    label: 'Size of cliques',
    decimals: 2,
    extractor: (metrics) => extractCliqueSizeValues(metrics),
  },
  {
    key: 'pairwiseOverlap',
    label: 'Pairwise overlap between pairs of cliques',
    decimals: 4,
    extractor: (metrics) => computePairwiseCliqueOverlapJaccard(metrics),
  },
];

const DATASET_STATS_ROW_DEFINITIONS = [
  { key: 'min', label: 'Minimum' },
  { key: 'max', label: 'Maximum' },
  { key: 'mean', label: 'Mean' },
  { key: 'std', label: 'Standard deviation' },
];

function buildCombinedAnalysisEntries(results, failedEntries) {
  const completed = Array.isArray(results) ? results : [];
  const failed = Array.isArray(failedEntries) ? failedEntries : [];
  const completedEntries = completed.map((entry) => ({
      metrics: entry && entry.metrics ? entry.metrics : {},
      isComplete: true,
    }));
  const failedEntriesNormalized = failed.map((entry) => ({
    metrics: entry && entry.metrics ? entry.metrics : {},
    isComplete: false,
  }));
  return [...completedEntries, ...failedEntriesNormalized]
    .filter((entry) => entry.metrics && typeof entry.metrics === 'object');
}

function normalizeFiniteValues(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

function extractCliqueNodeArrays(metrics) {
  const details = metrics && Array.isArray(metrics.cliqueDetails) ? metrics.cliqueDetails : [];
  return details
    .map((clique) => {
      if (Array.isArray(clique)) return clique;
      if (clique && Array.isArray(clique.nodes)) return clique.nodes;
      return null;
    })
    .filter((nodes) => Array.isArray(nodes) && nodes.length > 0)
    .map((nodes) => nodes.map((nodeId) => String(nodeId)));
}

function extractCliqueSizeValues(metrics) {
  const cliqueNodes = extractCliqueNodeArrays(metrics);
  return normalizeFiniteValues(cliqueNodes.map((nodes) => nodes.length));
}

function computePairwiseCliqueOverlapJaccard(metrics) {
  const cliqueNodes = extractCliqueNodeArrays(metrics);
  if (cliqueNodes.length < 2) return [];

  const cliqueSets = cliqueNodes.map((nodes) => new Set(nodes));
  const values = [];

  for (let i = 0; i < cliqueSets.length; i++) {
    for (let j = i + 1; j < cliqueSets.length; j++) {
      const setA = cliqueSets[i];
      const setB = cliqueSets[j];
      const small = setA.size <= setB.size ? setA : setB;
      const large = small === setA ? setB : setA;
      let intersectionSize = 0;
      for (const nodeId of small) {
        if (large.has(nodeId)) intersectionSize += 1;
      }
      const unionSize = setA.size + setB.size - intersectionSize;
      if (unionSize > 0) {
        values.push(intersectionSize / unionSize);
      }
    }
  }

  return normalizeFiniteValues(values);
}

function computeDescriptiveStats(values) {
  const finiteValues = normalizeFiniteValues(values);
  if (!finiteValues.length) return null;

  const min = d3.min(finiteValues);
  const max = d3.max(finiteValues);
  const meanAndStd = computeMeanAndStd(finiteValues);

  return {
    min,
    max,
    mean: meanAndStd.mean,
    std: meanAndStd.std,
  };
}

function collectMetricValues(entries, extractor) {
  const values = [];
  entries.forEach((entry) => {
    const extracted = extractor(entry.metrics);
    normalizeFiniteValues(extracted).forEach((v) => values.push(v));
  });
  return values;
}

function formatDatasetStatValue(value, digits) {
  if (!Number.isFinite(value)) return '-';
  return Number(value).toFixed(digits);
}

function renderDatasetStats(results, failedEntries = lastAnalysisFailedEntries) {
  const tbody = document.getElementById('analysis-dataset-stats-tbody');
  const summary = document.getElementById('analysis-dataset-stats-summary');
  if (!tbody || !summary) return;

  const entries = buildCombinedAnalysisEntries(results, failedEntries);
  if (!entries.length) {
    summary.textContent = 'No data available.';
    tbody.innerHTML = '<tr><td colspan="5" class="list-empty">No statistics available.</td></tr>';
    return;
  }

  const completeEntries = entries.filter((entry) => entry.isComplete === true);
  const nonCompleteEntries = entries.filter((entry) => entry.isComplete === false);
  summary.textContent = `Graphs analyzed: ${entries.length} (complete: ${completeEntries.length}, incomplete: ${nonCompleteEntries.length}).`;

  const rowHtml = [];
  DATASET_STATS_DEFINITIONS.forEach((metricDef) => {
    const statsByGroup = {
      complete: computeDescriptiveStats(collectMetricValues(completeEntries, metricDef.extractor)),
      nonComplete: computeDescriptiveStats(collectMetricValues(nonCompleteEntries, metricDef.extractor)),
      total: computeDescriptiveStats(collectMetricValues(entries, metricDef.extractor)),
    };

    DATASET_STATS_ROW_DEFINITIONS.forEach((rowDef, rowIndex) => {
      const metricCell = rowIndex === 0
        ? `<td class="analysis-dataset-metric" rowspan="${DATASET_STATS_ROW_DEFINITIONS.length}">${esc(metricDef.label)}</td>`
        : '';
      rowHtml.push(`<tr>
        ${metricCell}
        <td class="analysis-dataset-stat-label">${esc(rowDef.label)}</td>
        <td class="analysis-dataset-stat-value">${formatDatasetStatValue(statsByGroup.complete ? statsByGroup.complete[rowDef.key] : NaN, metricDef.decimals)}</td>
        <td class="analysis-dataset-stat-value">${formatDatasetStatValue(statsByGroup.nonComplete ? statsByGroup.nonComplete[rowDef.key] : NaN, metricDef.decimals)}</td>
        <td class="analysis-dataset-stat-value">${formatDatasetStatValue(statsByGroup.total ? statsByGroup.total[rowDef.key] : NaN, metricDef.decimals)}</td>
      </tr>`);
    });
  });

  tbody.innerHTML = rowHtml.join('');
}

function buildFailedPointsByX(xAccessor) {
  return (lastAnalysisFailedEntries || [])
    .map((entry) => {
      const m = entry.metrics || {};
      return {
        name: m.instance || entry.pipelineSaveFile || 'unsolved graph',
        pipelineSaveFile: entry.pipelineSaveFile || '-',
        error: entry.error || 'Solution unavailable',
        x: Number(xAccessor(m)),
        y: Number(m.totalCliques),
      };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function renderFailedOverlayPoints(g, points, xScale, yScale, radius = 7, options = {}) {
  if (!shouldShowFailedPoints() || !Array.isArray(points) || !points.length) return;
  const failedColor = options.color || getFailedPointsColor();
  const shapeType = getSymbolTypeByName(options.shape || getFailedPointsShape());

  if (!chartTooltip) {
    chartTooltip = d3.select('body').append('div').attr('class', 'chart-tooltip');
  }

  g.selectAll('path.failed-point')
    .data(points)
    .enter()
    .append('path')
    .attr('class', 'failed-point')
    .attr('d', d3.symbol().type(shapeType).size(Math.max(40, radius * radius * 4)))
    .attr('transform', (d) => `translate(${xScale(d.x)},${yScale(d.y)}) rotate(180)`)
    .attr('fill', failedColor)
    .attr('stroke', '#3b2a00')
    .attr('stroke-width', 1.1)
    .attr('opacity', 0.95)
    .on('mousemove', (event, d) => {
      chartTooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 16}px`)
        .style('top', `${event.clientY + 12}px`)
        .html(
          `<strong>${esc(d.name)}</strong><br>` +
          `Pipeline save: ${esc(d.pipelineSaveFile)}<br>` +
          `X: ${fmtNum(d.x, 2)}<br>` +
          `Clique: ${fmtNum(d.y, 0)}<br>` +
          `Status: solution not computed<br>` +
          `Error: ${esc(d.error || '-')}`
        );
    })
    .on('mouseleave', () => chartTooltip.style('opacity', 0));
}

function computeBasicMetricsFromGraphJsonClient(graphJson) {
  if (!graphJson || typeof graphJson !== 'object') {
    return null;
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

  // Attempt to compute clique details client-side if not present (with safety limits)
  let cliqueDetails = null;
  const MAX_NODES_FOR_CLIQUE_DETECTION = 150;
  const MAX_CLIQUES_LIMIT = 2000;

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
      if (nodesArr && nodesArr.length) nodeIds = Array.from(new Set(nodesArr.map(nodeIdFromEntry).filter(Boolean)));
      if (!nodeIds.length && Array.isArray(edgesArr) && edgesArr.length) {
        const setIds = new Set();
        for (const e of edgesArr) {
          if (Array.isArray(e) && e.length >= 2) { setIds.add(String(e[0])); setIds.add(String(e[1])); }
          else if (e && typeof e === 'object') {
            const a = e.source ?? e.u ?? e.from ?? e[0] ?? null;
            const b = e.target ?? e.v ?? e.to ?? e[1] ?? null;
            if (a !== null && a !== undefined) setIds.add(String(a));
            if (b !== null && b !== undefined) setIds.add(String(b));
          }
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

        const cliques = [];
        const P0 = new Set(nodeIds);
        const R0 = new Set();
        const X0 = new Set();

        const intersection = (A, B) => { const r = new Set(); for (const v of A) if (B.has(v)) r.add(v); return r; };
        const union = (A, B) => new Set([...A, ...B]);
        const choosePivot = (P, X) => {
          let best = null, bestCount = -1;
          for (const u of union(P, X)) {
            const neigh = neighbors.get(u) || new Set();
            let count = 0; for (const v of P) if (neigh.has(v)) count++;
            if (count > bestCount) { bestCount = count; best = u; }
          }
          return best;
        };
        let abort = false;
        const bronk = (R, P, X) => {
          if (abort) return;
          if (P.size === 0 && X.size === 0) { cliques.push(Array.from(R)); if (cliques.length >= MAX_CLIQUES_LIMIT) { abort = true; } return; }
          const u = choosePivot(P, X);
          const pivotNeigh = u ? (neighbors.get(u) || new Set()) : new Set();
          const candidates = Array.from(P).filter(v => !pivotNeigh.has(v));
          for (const v of candidates) {
            if (abort) break;
            const Nv = neighbors.get(v) || new Set();
            bronk(new Set([...R, v]), intersection(P, Nv), intersection(X, Nv));
            P.delete(v); X.add(v);
            if (cliques.length >= MAX_CLIQUES_LIMIT) { abort = true; break; }
          }
        };
        try { bronk(R0, P0, X0); } catch (e) { /* ignore */ }
        if (cliques.length) {
          cliqueDetails = cliques.map(c => ({ nodes: c }));
          totalCliques = cliques.length;
          const sizes = cliques.map(c => c.length);
          avgCliqueSize = sizes.reduce((s, v) => s + v, 0) / sizes.length;
          maxCliqueSize = Math.max(...sizes);
        } else cliqueDetails = [];
      } else {
        cliqueDetails = [];
      }
    }
  } catch (e) {
    cliqueDetails = cliqueDetails || [];
  }

  // compute avgCliqueDegree and pctNodesInClique if available
  let avgCliqueDegree = NaN;
  let pctNodesInClique = NaN;
  if (Array.isArray(cliqueDetails) && cliqueDetails.length && totalNodes > 0) {
    const membership = new Map(); let totalMemberships = 0;
    for (const c of cliqueDetails) {
      const nodesList = Array.isArray(c.nodes) ? c.nodes : (Array.isArray(c) ? c : []);
      for (const nid of nodesList) { const sid = String(nid); membership.set(sid, (membership.get(sid) || 0) + 1); totalMemberships++; }
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

function extractImportedSetGraphId(pipelineSaveFile, setName) {
  const raw = String(pipelineSaveFile || '').trim();
  const safeSetName = String(setName || '').trim();
  if (!raw || !safeSetName) return null;
  const prefix = `imported_set_${safeSetName}_`;
  if (!raw.startsWith(prefix)) return null;
  const graphId = raw.slice(prefix.length).trim();
  if (!graphId || graphId === 'unknown') return null;
  return graphId;
}

function buildAccuracyRawPoints(results, xAccessor) {
  return results
    .map(r => {
      const m = r.metrics || {};
      return {
        name: m.instance ? m.instance : r.pipelineSaveFile,
        pipelineSaveFile: r.pipelineSaveFile,
        x: Number(xAccessor(m)),
        y: Number(m.totalCliques),
        pct: Number(m.pctCorrectlyVisualized),
        avg: Number(m.avgCliqueSize),
      };
    })
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.pct) && Number.isFinite(p.avg));
}

function buildTimeRawPoints(results, xAccessor) {
  return results
    .map(r => {
      const m = r.metrics || {};
      return {
        name: m.instance ? m.instance : r.pipelineSaveFile,
        pipelineSaveFile: r.pipelineSaveFile,
        x: Number(xAccessor(m)),
        y: Number(m.totalCliques),
        avg: Number(m.avgCliqueSize),
        execS: parseExecutionTimeSeconds(m),
      };
    })
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.avg) && Number.isFinite(p.execS));
}

function buildAccuracyPoints(results, xAccessor, pointMode = 'average') {
  const rawPoints = buildAccuracyRawPoints(results, xAccessor);

  if (pointMode === 'all') {
    return rawPoints.map((p) => ({
      ...p,
      count: 1,
    }));
  }

  const pointGroups = new Map();
  rawPoints.forEach((p) => {
    const key = `${p.x}|${p.y}`;
    if (!pointGroups.has(key)) {
      pointGroups.set(key, {
        x: p.x,
        y: p.y,
        pctSum: 0,
        avgSum: 0,
        count: 0,
        names: [],
        pipelineSaveFiles: [],
      });
    }
    const g = pointGroups.get(key);
    g.pctSum += p.pct;
    g.avgSum += p.avg;
    g.count += 1;
    g.names.push(p.name);
    g.pipelineSaveFiles.push(p.pipelineSaveFile);
  });

  return Array.from(pointGroups.values()).map((g) => ({
    x: g.x,
    y: g.y,
    pct: g.pctSum / g.count,
    avg: g.avgSum / g.count,
    count: g.count,
    name: g.count === 1 ? g.names[0] : `${g.count} analyses`,
    pipelineSaveFile: g.count === 1 ? g.pipelineSaveFiles[0] : g.pipelineSaveFiles.join(', '),
  }));
}

function buildTimePoints(results, xAccessor, pointMode = 'average') {
  const rawPoints = buildTimeRawPoints(results, xAccessor);

  if (pointMode === 'all') {
    return rawPoints.map((p) => ({
      ...p,
      count: 1,
    }));
  }

  const pointGroups = new Map();
  rawPoints.forEach((p) => {
    const key = `${p.x}|${p.y}`;
    if (!pointGroups.has(key)) {
      pointGroups.set(key, {
        x: p.x,
        y: p.y,
        avgSum: 0,
        execSum: 0,
        count: 0,
        names: [],
        pipelineSaveFiles: [],
      });
    }
    const g = pointGroups.get(key);
    g.avgSum += p.avg;
    g.execSum += p.execS;
    g.count += 1;
    g.names.push(p.name);
    g.pipelineSaveFiles.push(p.pipelineSaveFile);
  });

  return Array.from(pointGroups.values()).map((g) => ({
    x: g.x,
    y: g.y,
    avg: g.avgSum / g.count,
    execS: g.execSum / g.count,
    count: g.count,
    name: g.count === 1 ? g.names[0] : `${g.count} analyses`,
    pipelineSaveFile: g.count === 1 ? g.pipelineSaveFiles[0] : g.pipelineSaveFiles.join(', '),
  }));
}

function applyPointSeparation(points, xScale, yScale, radiusScale, innerW, innerH, overlapFactor, attractStrength) {
  if (!points.length) return [];

  const nodes = points.map((p) => ({
    ...p,
    plotX: xScale(p.x),
    plotY: yScale(p.y),
    targetX: xScale(p.x),
    targetY: yScale(p.y),
    radius: radiusScale(p.avg),
  }));

  const simulation = d3.forceSimulation(nodes)
    .force('x', d3.forceX((d) => d.targetX).strength(attractStrength))
    .force('y', d3.forceY((d) => d.targetY).strength(attractStrength))
    .force('collide', d3.forceCollide((d) => Math.max(2, d.radius * overlapFactor)).iterations(2))
    .stop();

  for (let i = 0; i < 80; i++) {
    simulation.tick();
    nodes.forEach((n) => {
      const minX = n.radius;
      const maxX = Math.max(minX, innerW - n.radius);
      const minY = n.radius;
      const maxY = Math.max(minY, innerH - n.radius);
      n.x = Math.max(minX, Math.min(maxX, n.x));
      n.y = Math.max(minY, Math.min(maxY, n.y));
    });
  }

  nodes.forEach((n) => {
    n.plotX = n.x;
    n.plotY = n.y;
  });

  return nodes;
}

function computeMeanAndStd(values) {
  if (!values.length) return { mean: NaN, std: NaN };
  const mean = d3.mean(values);
  const variance = d3.mean(values.map((v) => (v - mean) ** 2));
  return { mean, std: Math.sqrt(Math.max(0, variance)) };
}

function buildBoxplotSeriesByX(points, metricAccessor) {
  const grouped = d3.group(points, (d) => d.x);
  return Array.from(grouped.entries())
    .map(([x, group]) => {
      const yValues = group.map((d) => d.y).filter(Number.isFinite).sort((a, b) => a - b);
      if (!yValues.length) return null;
      const metricValues = group.map((d) => metricAccessor(d)).filter(Number.isFinite);
      const q1 = d3.quantileSorted(yValues, 0.25);
      const median = d3.quantileSorted(yValues, 0.5);
      const q3 = d3.quantileSorted(yValues, 0.75);
      const whiskerLow = yValues[0];
      const whiskerHigh = yValues[yValues.length - 1];
      const metricMean = metricValues.length ? d3.mean(metricValues) : NaN;
      const uniquePipelines = Array.from(new Set(group.map((d) => d.pipelineSaveFile))).filter(Boolean);
      return {
        x: Number(x),
        count: group.length,
        q1Y: q1,
        medianY: median,
        q3Y: q3,
        lowY: whiskerLow,
        highY: whiskerHigh,
        metricMean,
        pipelineSaveFile: uniquePipelines.join(', '),
      };
    })
    .filter((d) => d && Number.isFinite(d.x) && Number.isFinite(d.q1Y) && Number.isFinite(d.medianY) && Number.isFinite(d.q3Y))
    .sort((a, b) => a.x - b.x);
}

function getBucketBounds(value, bucketSize, bucketStart = 0) {
  if (!Number.isFinite(value) || !Number.isFinite(bucketSize) || bucketSize <= 0) return null;
  const safeStart = Number.isFinite(bucketStart) ? bucketStart : 0;
  const bucketIndex = Math.floor((value - safeStart) / bucketSize);
  const start = safeStart + (bucketIndex * bucketSize);
  const end = start + bucketSize;
  const center = start + (bucketSize / 2);
  return { start, end, center };
}

function bucketSingleScatterPoints(points, bucketSize, bucketStart = 0) {
  if (!Array.isArray(points) || !points.length || !Number.isFinite(bucketSize) || bucketSize <= 0) {
    return Array.isArray(points) ? points : [];
  }

  const grouped = new Map();
  points.forEach((point) => {
    const bounds = getBucketBounds(point.x, bucketSize, bucketStart);
    if (!bounds) return;
    const key = `${bounds.start}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        bucketStart: bounds.start,
        bucketEnd: bounds.end,
        bucketCenter: bounds.center,
        points: [],
      });
    }
    grouped.get(key).points.push(point);
  });

  return Array.from(grouped.values())
    .map((bucket) => {
      const bucketPoints = bucket.points;
      const yValues = bucketPoints.map((d) => d.y).filter(Number.isFinite);
      if (!yValues.length) return null;
      const xValues = bucketPoints.map((d) => d.x).filter(Number.isFinite);
      const colorValues = bucketPoints.map((d) => d.colorV).filter(Number.isFinite);
      const sizeValues = bucketPoints.map((d) => d.sizeV).filter(Number.isFinite);
      const uniquePipelines = Array.from(new Set(bucketPoints.map((d) => d.pipelineSaveFile))).filter(Boolean);
      const uniqueNames = Array.from(new Set(bucketPoints.map((d) => d.name))).filter(Boolean);
      return {
        name: `Bucket X [${fmtNum(bucket.bucketStart, 2)}, ${fmtNum(bucket.bucketEnd, 2)})`,
        pipelineSaveFile: uniquePipelines.join(', '),
        x: bucket.bucketCenter,
        xMean: xValues.length ? d3.mean(xValues) : bucket.bucketCenter,
        y: d3.mean(yValues),
        colorV: colorValues.length ? d3.mean(colorValues) : NaN,
        sizeV: sizeValues.length ? d3.mean(sizeValues) : NaN,
        sampleCount: bucketPoints.length,
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        bucketCenter: bucket.bucketCenter,
        bucketMembers: uniqueNames,
      };
    })
    .filter((d) => d && Number.isFinite(d.x) && Number.isFinite(d.y))
    .sort((a, b) => a.x - b.x);
}

function buildConfidenceIntervalSeriesByX(points, metricAccessor, bucketSize = null, bucketStart = 0, extremesOnly = false) {
  const grouped = d3.group(
    points,
    (d) => {
      if (Number.isFinite(bucketSize) && bucketSize > 0) {
        const bounds = getBucketBounds(d.x, bucketSize, bucketStart);
        return bounds ? `${bounds.start}` : `${d.x}`;
      }
      return d.x;
    }
  );
  return Array.from(grouped.entries())
    .map(([x, group]) => {
      const yValues = group.map((d) => d.y).filter(Number.isFinite).sort((a, b) => a - b);
      if (!yValues.length) return null;
      const metricValues = group.map((d) => metricAccessor(d)).filter(Number.isFinite);
      const p25 = d3.quantileSorted(yValues, 0.25);
      const median = d3.quantileSorted(yValues, 0.5);
      const p75 = d3.quantileSorted(yValues, 0.75);
      if (![p25, median, p75].every(Number.isFinite)) return null;
      const numericX = Number(x);
      const bounds = Number.isFinite(bucketSize) && bucketSize > 0
        ? getBucketBounds(numericX, bucketSize, bucketStart)
        : null;
      const xValues = group.map((d) => d.x).filter(Number.isFinite);

      let outliers = group
        .filter((d) => Number.isFinite(d.y) && (d.y < p25 || d.y > p75))
        .map((d) => ({
          name: d.name,
          y: d.y,
          pipelineSaveFile: d.pipelineSaveFile,
          error: d.error,
        }));

      if (extremesOnly && outliers.length > 1) {
        const minOutlier = outliers.reduce((best, curr) => (curr.y < best.y ? curr : best));
        const maxOutlier = outliers.reduce((best, curr) => (curr.y > best.y ? curr : best));
        outliers = minOutlier === maxOutlier ? [minOutlier] : [minOutlier, maxOutlier];
      }

      const uniquePipelines = Array.from(new Set(group.map((d) => d.pipelineSaveFile))).filter(Boolean);
      return {
        x: bounds ? bounds.center : numericX,
        xMean: xValues.length ? d3.mean(xValues) : (bounds ? bounds.center : numericX),
        count: group.length,
        p25Y: p25,
        medianY: median,
        p75Y: p75,
        outliers,
        metricMean: metricValues.length ? d3.mean(metricValues) : NaN,
        pipelineSaveFile: uniquePipelines.join(', '),
        bucketStart: bounds ? bounds.start : null,
        bucketEnd: bounds ? bounds.end : null,
        bucketCenter: bounds ? bounds.center : null,
      };
    })
    .filter((d) => d && Number.isFinite(d.x) && Number.isFinite(d.p25Y) && Number.isFinite(d.medianY) && Number.isFinite(d.p75Y))
    .sort((a, b) => a.x - b.x);
}

function getBoxHalfWidth(series, xScale) {
  if (series.length <= 1) return 14;
  const sortedX = Array.from(new Set(series.map((d) => d.x))).sort((a, b) => a - b);
  const px = sortedX.map((v) => xScale(v));
  const diffs = [];
  for (let i = 1; i < px.length; i++) {
    const diff = px[i] - px[i - 1];
    if (diff > 0) diffs.push(diff);
  }
  if (!diffs.length) return 14;
  const minDiff = d3.min(diffs);
  return Math.max(7, Math.min(24, minDiff * 0.28));
}

function getExecutionTimeColorDefinition(points, scaleMode = 'linear', maxTimeCapS = null) {
  let execMin;
  let execMax;
  let color;
  let legendMax;

  if (scaleMode === 'log') {
    const positiveTimes = points.map((d) => d.execS).filter((v) => v > 0);
    if (!positiveTimes.length) return null;
    execMin = d3.min(positiveTimes);
    execMax = d3.max(positiveTimes);
    const domainMax = maxTimeCapS !== null ? maxTimeCapS : (execMax > execMin ? execMax : execMin * 10);
    const safeDomainMax = domainMax > 0 ? domainMax : (execMin > 0 ? execMin : 1);
    let domainMin = execMin;
    if (maxTimeCapS !== null) {
      domainMin = Math.min(execMin, safeDomainMax / 10);
    }
    if (!(domainMin > 0) || domainMin >= safeDomainMax) {
      domainMin = safeDomainMax / 10;
    }
    color = d3.scaleLog().domain([domainMin, safeDomainMax]).range(['#f5f9ff', '#0052cc']).clamp(true);
    legendMax = safeDomainMax;
    execMin = domainMin;
  } else {
    const execExtent = d3.extent(points, d => d.execS);
    execMin = execExtent[0];
    execMax = execExtent[1];
    let execDomain;
    if (maxTimeCapS !== null) {
      const domainMax = maxTimeCapS;
      const domainMin = Math.min(execMin, domainMax * 0.5);
      execDomain = domainMin === domainMax ? [Math.max(0, domainMax - 1), domainMax] : [domainMin, domainMax];
      legendMax = domainMax;
      execMin = execDomain[0];
    } else {
      execDomain = execExtent[0] === execExtent[1] ? [execExtent[0], execExtent[0] + 1] : execExtent;
      legendMax = execMax;
    }
    color = d3.scaleLinear().domain(execDomain).range(['#f5f9ff', '#0052cc']).clamp(true);
  }

  return {
    color,
    legendMin: execMin,
    legendMax,
  };
}

function getChartCanvas(containerId, options = {}) {
  const root = d3.select(`#${containerId}`);
  root.selectAll('*').remove();
  const rootNode = document.getElementById(containerId);
  const minWidth = Number(options.minWidth) || 440;
  const forcedWidth = Number(options.width);
  const autoWidth = Math.max(minWidth, (rootNode ? rootNode.clientWidth : 760) - 16);
  const width = Number.isFinite(forcedWidth) && forcedWidth > 0 ? Math.round(forcedWidth) : autoWidth;
  const height = Number(options.height) || 400;
  const marginOptions = options.margin || {};
  const margin = {
    top: Number.isFinite(Number(marginOptions.top)) ? Number(marginOptions.top) : 36,
    right: Number.isFinite(Number(marginOptions.right)) ? Number(marginOptions.right) : 24,
    bottom: Number.isFinite(Number(marginOptions.bottom)) ? Number(marginOptions.bottom) : 60,
    left: Number.isFinite(Number(marginOptions.left)) ? Number(marginOptions.left) : 62,
  };
  const svg = root.append('svg').attr('width', width).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  return { root, svg, g, innerW, innerH };
}

function renderAccuracyScatterByX(results, { containerId, xAccessor, xLabel, pointMode = 'average' }) {
  if (pointMode === 'boxplot') {
    renderAccuracyBoxplotByX(results, { containerId, xAccessor, xLabel });
    return;
  }

  const points = buildAccuracyPoints(results, xAccessor, pointMode);
  const failedPoints = buildFailedPointsByX(xAccessor);
  const visiblePoints = shouldShowCompletedPoints() ? points : [];
  const visibleFailedPoints = shouldShowFailedPoints() ? failedPoints : [];
  const root = d3.select(`#${containerId}`);
  root.selectAll('*').remove();

  if (!visiblePoints.length && !visibleFailedPoints.length) {
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('Insufficient data for the chart.');
    return;
  }

  const domainPoints = [...visiblePoints, ...visibleFailedPoints];

  const { g, innerW, innerH } = getChartCanvas(containerId);
  const x = d3.scaleLinear()
    .domain((() => {
      const [minX, maxX] = d3.extent(domainPoints, d => d.x);
      const span = (maxX - minX) || 1;
      const pad = span * 0.08;
      return [minX - pad, maxX + pad];
    })())
    .nice()
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain((() => {
      const [minY, maxY] = d3.extent(domainPoints, d => d.y);
      const span = (maxY - minY) || 1;
      const pad = span * 0.08;
      return [minY - pad, maxY + pad];
    })())
    .nice()
    .range([innerH, 0]);

  const rScale = d3.scaleSqrt()
    .domain(d3.extent(visiblePoints.length ? visiblePoints : [{ avg: 1 }, { avg: 2 }], d => d.avg))
    .range([5, 22]);

  const positionedPoints = pointMode === 'all'
    ? applyPointSeparation(visiblePoints, x, y, rScale, innerW, innerH, getPointOverlapFactor(), getPointAttractStrength())
    : visiblePoints;

  const color = d3.scaleLinear()
    .domain([0, 100])
    .range(['#ffffff', '#c40000'])
    .clamp(true);

  if (shouldShowLegend()) {
    const legendGradientId = `accuracy-red-gradient-${containerId}`;
    const defs = d3.select(g.node().ownerSVGElement).append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', legendGradientId)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#ffffff');
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#c40000');

    const legendW = 180;
    const legendH = 12;
    const legendX = innerW - legendW;
    const legendY = 4;
    const legend = g.append('g').attr('transform', `translate(${legendX},${legendY})`);
    legend.append('text')
      .attr('x', 0)
      .attr('y', -6)
      .attr('font-size', 11)
      .attr('fill', '#8f1212')
      .text('% clique corrette');

    legend.append('rect')
      .attr('width', legendW)
      .attr('height', legendH)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', `url(#${legendGradientId})`)
      .attr('stroke', '#e7b4b4')
      .attr('stroke-width', 0.8);

    legend.append('text').attr('x', 0).attr('y', legendH + 12).attr('font-size', 10).attr('fill', '#6a1b1b').text('0');
    legend.append('text').attr('x', legendW).attr('y', legendH + 12).attr('text-anchor', 'end').attr('font-size', 10).attr('fill', '#6a1b1b').text('100');
  }

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y));

  g.selectAll('.tick text').attr('font-size', 10);

  g.append('text')
    .attr('x', innerW / 2)
    .attr('y', innerH + 40)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text(xLabel);

  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -44)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text('Numero clique');

  if (!chartTooltip) {
    chartTooltip = d3.select('body').append('div').attr('class', 'chart-tooltip');
  }

  g.selectAll('circle.point')
    .data(positionedPoints)
    .enter()
    .append('circle')
    .attr('class', 'point')
    .attr('cx', d => pointMode === 'all' ? d.plotX : x(d.x))
    .attr('cy', d => pointMode === 'all' ? d.plotY : y(d.y))
    .attr('r', d => rScale(d.avg))
    .attr('fill', d => color(d.pct))
    .attr('stroke', '#8f1212')
    .attr('stroke-width', 1.2)
    .attr('opacity', 0.9)
    .on('mousemove', (event, d) => {
      chartTooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 16}px`)
        .style('top', `${event.clientY + 12}px`)
        .html(
          `<strong>${esc(d.name)}</strong><br>` +
          `Campioni aggregati: ${d.count}<br>` +
          `Pipeline save: ${esc(d.pipelineSaveFile)}<br>` +
          `X: ${fmtNum(d.x, 2)}<br>` +
          `Clique: ${d.y}<br>` +
          `% Corrette: ${fmtNum(d.pct, 2)}%<br>` +
          `Media dim clique: ${fmtNum(d.avg, 2)}`
        );
    })
    .on('mouseleave', () => chartTooltip.style('opacity', 0));

  renderFailedOverlayPoints(g, visibleFailedPoints, x, y, 8);
  applyForegroundInGroup(g, getMainForegroundLayer(), 'circle.point', 'path.failed-point');
}

function renderAccuracyBoxplotByX(results, { containerId, xAccessor, xLabel }) {
  const root = d3.select(`#${containerId}`);
  root.selectAll('*').remove();

  const rawPoints = buildAccuracyRawPoints(results, xAccessor);
  const failedPoints = buildFailedPointsByX(xAccessor);
  const visibleRawPoints = shouldShowCompletedPoints() ? rawPoints : [];
  const visibleFailedPoints = shouldShowFailedPoints() ? failedPoints : [];
  const series = buildBoxplotSeriesByX(visibleRawPoints, (d) => d.pct);
  if (!series.length && !visibleFailedPoints.length) {
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('Insufficient data for the boxplot.');
    return;
  }

  const { g, innerW, innerH } = getChartCanvas(containerId);
  const axisFailedPoints = visibleFailedPoints;
  const xDomainSource = [
    ...series.map((d) => ({ x: d.x })),
    ...axisFailedPoints,
  ];

  const x = d3.scaleLinear()
    .domain((() => {
      const [minX, maxX] = d3.extent(xDomainSource, d => d.x);
      const span = (maxX - minX) || 1;
      const pad = span * 0.08;
      return [minX - pad, maxX + pad];
    })())
    .nice()
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain((() => {
      const minSeriesY = series.length ? d3.min(series, (d) => d.lowY) : Infinity;
      const maxSeriesY = series.length ? d3.max(series, (d) => d.highY) : -Infinity;
      const minFailedY = axisFailedPoints.length ? d3.min(axisFailedPoints, (d) => d.y) : Infinity;
      const maxFailedY = axisFailedPoints.length ? d3.max(axisFailedPoints, (d) => d.y) : -Infinity;
      const minY = Math.min(minSeriesY, minFailedY);
      const maxY = Math.max(maxSeriesY, maxFailedY);
      const span = (maxY - minY) || 1;
      const pad = span * 0.08;
      return [minY - pad, maxY + pad];
    })())
    .nice()
    .range([innerH, 0]);

  const color = d3.scaleLinear()
    .domain([0, 100])
    .range(['#ffffff', '#c40000'])
    .clamp(true);

  if (shouldShowLegend() && series.length) {
    const legendGradientId = `accuracy-red-gradient-${containerId}`;
    const defs = d3.select(g.node().ownerSVGElement).append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', legendGradientId)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#ffffff');
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#c40000');

    const legendW = 180;
    const legendH = 12;
    const legendX = innerW - legendW;
    const legendY = 4;
    const legend = g.append('g').attr('transform', `translate(${legendX},${legendY})`);
    legend.append('text')
      .attr('x', 0)
      .attr('y', -6)
      .attr('font-size', 11)
      .attr('fill', '#8f1212')
      .text('% clique corrette (media ascissa)');

    legend.append('rect')
      .attr('width', legendW)
      .attr('height', legendH)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', `url(#${legendGradientId})`)
      .attr('stroke', '#e7b4b4')
      .attr('stroke-width', 0.8);

    legend.append('text').attr('x', 0).attr('y', legendH + 12).attr('font-size', 10).attr('fill', '#6a1b1b').text('0');
    legend.append('text').attr('x', legendW).attr('y', legendH + 12).attr('text-anchor', 'end').attr('font-size', 10).attr('fill', '#6a1b1b').text('100');
  }

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y));
  g.selectAll('.tick text').attr('font-size', 10);

  g.append('text')
    .attr('x', innerW / 2)
    .attr('y', innerH + 40)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text(xLabel);

  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -44)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text('Numero clique');

  if (!chartTooltip) {
    chartTooltip = d3.select('body').append('div').attr('class', 'chart-tooltip');
  }

  const halfW = getBoxHalfWidth(series.length ? series : [{ x: x.domain()[0] }, { x: x.domain()[1] }], x);
  const boxGroups = g.selectAll('g.box-acc')
    .data(series)
    .enter()
    .append('g')
    .attr('class', 'box-acc');

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x))
    .attr('x2', (d) => x(d.x))
    .attr('y1', (d) => y(d.lowY))
    .attr('y2', (d) => y(d.highY))
    .attr('stroke', '#8f1212')
    .attr('stroke-width', 1.2)
    .attr('opacity', 0.75);

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x) - halfW * 0.6)
    .attr('x2', (d) => x(d.x) + halfW * 0.6)
    .attr('y1', (d) => y(d.lowY))
    .attr('y2', (d) => y(d.lowY))
    .attr('stroke', '#8f1212')
    .attr('stroke-width', 1.1)
    .attr('opacity', 0.9);

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x) - halfW * 0.6)
    .attr('x2', (d) => x(d.x) + halfW * 0.6)
    .attr('y1', (d) => y(d.highY))
    .attr('y2', (d) => y(d.highY))
    .attr('stroke', '#8f1212')
    .attr('stroke-width', 1.1)
    .attr('opacity', 0.9);

  boxGroups.append('rect')
    .attr('x', (d) => x(d.x) - halfW)
    .attr('y', (d) => y(d.q3Y))
    .attr('width', halfW * 2)
    .attr('height', (d) => Math.max(2, y(d.q1Y) - y(d.q3Y)))
    .attr('fill', (d) => color(d.metricMean))
    .attr('stroke', '#8f1212')
    .attr('stroke-width', 1.1)
    .attr('opacity', 0.86);

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x) - halfW)
    .attr('x2', (d) => x(d.x) + halfW)
    .attr('y1', (d) => y(d.medianY))
    .attr('y2', (d) => y(d.medianY))
    .attr('stroke', '#5f0a0a')
    .attr('stroke-width', 1.6);

  boxGroups
    .style('cursor', 'pointer')
    .on('mousemove', (event, d) => {
      chartTooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 16}px`)
        .style('top', `${event.clientY + 12}px`)
        .html(
          `<strong>Ascissa: ${fmtNum(d.x, 2)}</strong><br>` +
          `Campioni: ${d.count}<br>` +
          `Min: ${fmtNum(d.lowY, 2)}<br>` +
          `Q1: ${fmtNum(d.q1Y, 2)}<br>` +
          `Mediana: ${fmtNum(d.medianY, 2)}<br>` +
          `Q3: ${fmtNum(d.q3Y, 2)}<br>` +
          `Max: ${fmtNum(d.highY, 2)}<br>` +
          `% corrette media: ${fmtNum(d.metricMean, 2)}%<br>` +
          `Pipeline save: ${esc(d.pipelineSaveFile)}`
        );
    })
    .on('mouseleave', () => chartTooltip.style('opacity', 0));

  renderFailedOverlayPoints(g, visibleFailedPoints, x, y, 8);
  applyForegroundInGroup(g, getMainForegroundLayer(), 'g.box-acc', 'path.failed-point');
}

function renderExecutionTimeScatterByX(results, { containerId, xAccessor, xLabel, scaleMode = 'linear', maxTimeCapS = null, pointMode = 'average' }) {
  if (pointMode === 'boxplot') {
    renderExecutionTimeBoxplotByX(results, { containerId, xAccessor, xLabel, scaleMode, maxTimeCapS });
    return;
  }

  const root = d3.select(`#${containerId}`);
  root.selectAll('*').remove();

  const points = buildTimePoints(results, xAccessor, pointMode);
  const failedPoints = buildFailedPointsByX(xAccessor);
  const visiblePoints = shouldShowCompletedPoints() ? points : [];
  const visibleFailedPoints = shouldShowFailedPoints() ? failedPoints : [];
  if (!visiblePoints.length && !visibleFailedPoints.length) {
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('Insufficient data for the time chart.');
    return;
  }

  const domainPoints = [...visiblePoints, ...visibleFailedPoints];

  const { svg, g, innerW, innerH } = getChartCanvas(containerId);

  const x = d3.scaleLinear()
    .domain((() => {
      const [minX, maxX] = d3.extent(domainPoints, d => d.x);
      const span = (maxX - minX) || 1;
      const pad = span * 0.08;
      return [minX - pad, maxX + pad];
    })())
    .nice()
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain((() => {
      const [minY, maxY] = d3.extent(domainPoints, d => d.y);
      const span = (maxY - minY) || 1;
      const pad = span * 0.08;
      return [minY - pad, maxY + pad];
    })())
    .nice()
    .range([innerH, 0]);

  const rScale = d3.scaleSqrt().domain(d3.extent(visiblePoints.length ? visiblePoints : [{ avg: 1 }, { avg: 2 }], d => d.avg)).range([5, 22]);
  const positionedPoints = pointMode === 'all'
    ? applyPointSeparation(visiblePoints, x, y, rScale, innerW, innerH, getPointOverlapFactor(), getPointAttractStrength())
    : visiblePoints;

  const colorDef = visiblePoints.length ? getExecutionTimeColorDefinition(visiblePoints, scaleMode, maxTimeCapS) : null;
  if (visiblePoints.length && !colorDef) {
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('Scala logaritmica non disponibile: servono tempi > 0.');
    return;
  }
  const color = colorDef ? colorDef.color : (() => '#d6e2ff');
  const legendMin = colorDef ? colorDef.legendMin : null;
  const legendMax = colorDef ? colorDef.legendMax : null;

  if (colorDef) {
    if (shouldShowLegend()) {
      const legendGradientId = `exec-time-blue-gradient-${containerId}`;
      const defs = svg.append('defs');
      const gradient = defs.append('linearGradient')
        .attr('id', legendGradientId)
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');
      gradient.append('stop').attr('offset', '0%').attr('stop-color', '#f5f9ff');
      gradient.append('stop').attr('offset', '100%').attr('stop-color', '#0052cc');

      const legendW = 180;
      const legendH = 12;
      const legendX = innerW - legendW;
      const legendY = 4;
      const legend = g.append('g').attr('transform', `translate(${legendX},${legendY})`);
      legend.append('text')
        .attr('x', 0)
        .attr('y', -6)
        .attr('font-size', 11)
        .attr('fill', '#375a9e')
        .text(`Average execution time (s) - ${scaleMode === 'log' ? 'log' : 'linear'}${maxTimeCapS !== null ? ` - cap ${fmtNum(maxTimeCapS, 2)} s` : ''}`);

      legend.append('rect')
        .attr('width', legendW)
        .attr('height', legendH)
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', `url(#${legendGradientId})`)
        .attr('stroke', '#c6d5ee')
        .attr('stroke-width', 0.8);

      legend.append('text').attr('x', 0).attr('y', legendH + 12).attr('font-size', 10).attr('fill', '#4b5f87').text(fmtNum(legendMin, 2));
      legend.append('text').attr('x', legendW).attr('y', legendH + 12).attr('text-anchor', 'end').attr('font-size', 10).attr('fill', '#4b5f87').text(fmtNum(legendMax, 2));
    }
  }

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y));

  g.selectAll('.tick text').attr('font-size', 10);

  g.append('text')
    .attr('x', innerW / 2)
    .attr('y', innerH + 40)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text(xLabel);

  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -44)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text('Numero clique');

  if (!chartTooltip) {
    chartTooltip = d3.select('body').append('div').attr('class', 'chart-tooltip');
  }

  g.selectAll('circle.time-point')
    .data(positionedPoints)
    .enter()
    .append('circle')
    .attr('class', 'time-point')
    .attr('cx', d => pointMode === 'all' ? d.plotX : x(d.x))
    .attr('cy', d => pointMode === 'all' ? d.plotY : y(d.y))
    .attr('r', d => rScale(d.avg))
    .attr('fill', d => color(d.execS))
    .attr('stroke', '#13408c')
    .attr('stroke-width', 1.2)
    .attr('opacity', 0.92)
    .on('mousemove', (event, d) => {
      chartTooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 16}px`)
        .style('top', `${event.clientY + 12}px`)
        .html(
          `<strong>${esc(d.name)}</strong><br>` +
          `Campioni aggregati: ${d.count}<br>` +
          `Pipeline save: ${esc(d.pipelineSaveFile)}<br>` +
          `X: ${fmtNum(d.x, 2)}<br>` +
          `Clique: ${d.y}<br>` +
          `Average time: ${fmtNum(d.execS, 2)} s<br>` +
          `Media dim clique: ${fmtNum(d.avg, 2)}`
        );
    })
    .on('mouseleave', () => chartTooltip.style('opacity', 0));

  renderFailedOverlayPoints(g, visibleFailedPoints, x, y, 8);
  applyForegroundInGroup(g, getMainForegroundLayer(), 'circle.time-point', 'path.failed-point');
}

function renderExecutionTimeBoxplotByX(results, { containerId, xAccessor, xLabel, scaleMode = 'linear', maxTimeCapS = null }) {
  const root = d3.select(`#${containerId}`);
  root.selectAll('*').remove();

  const rawPoints = buildTimeRawPoints(results, xAccessor);
  const failedPoints = buildFailedPointsByX(xAccessor);
  const visibleRawPoints = shouldShowCompletedPoints() ? rawPoints : [];
  const visibleFailedPoints = shouldShowFailedPoints() ? failedPoints : [];
  const series = buildBoxplotSeriesByX(visibleRawPoints, (d) => d.execS);
  if (!series.length && !visibleFailedPoints.length) {
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('Insufficient data for the time boxplot.');
    return;
  }

  const { svg, g, innerW, innerH } = getChartCanvas(containerId);
  const axisFailedPoints = visibleFailedPoints;
  const xDomainSource = [
    ...series.map((d) => ({ x: d.x })),
    ...axisFailedPoints,
  ];
  const x = d3.scaleLinear()
    .domain((() => {
      const [minX, maxX] = d3.extent(xDomainSource, d => d.x);
      const span = (maxX - minX) || 1;
      const pad = span * 0.08;
      return [minX - pad, maxX + pad];
    })())
    .nice()
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain((() => {
      const minSeriesY = series.length ? d3.min(series, (d) => d.lowY) : Infinity;
      const maxSeriesY = series.length ? d3.max(series, (d) => d.highY) : -Infinity;
      const minFailedY = axisFailedPoints.length ? d3.min(axisFailedPoints, (d) => d.y) : Infinity;
      const maxFailedY = axisFailedPoints.length ? d3.max(axisFailedPoints, (d) => d.y) : -Infinity;
      const minY = Math.min(minSeriesY, minFailedY);
      const maxY = Math.max(maxSeriesY, maxFailedY);
      const span = (maxY - minY) || 1;
      const pad = span * 0.08;
      return [minY - pad, maxY + pad];
    })())
    .nice()
    .range([innerH, 0]);

  const colorDef = visibleRawPoints.length ? getExecutionTimeColorDefinition(visibleRawPoints, scaleMode, maxTimeCapS) : null;
  if (visibleRawPoints.length && !colorDef) {
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('Scala logaritmica non disponibile: servono tempi > 0.');
    return;
  }
  const color = colorDef ? colorDef.color : (() => '#d6e2ff');
  const legendMin = colorDef ? colorDef.legendMin : null;
  const legendMax = colorDef ? colorDef.legendMax : null;

  if (colorDef) {
    if (shouldShowLegend()) {
      const legendGradientId = `exec-time-blue-gradient-${containerId}`;
      const defs = svg.append('defs');
      const gradient = defs.append('linearGradient')
        .attr('id', legendGradientId)
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');
      gradient.append('stop').attr('offset', '0%').attr('stop-color', '#f5f9ff');
      gradient.append('stop').attr('offset', '100%').attr('stop-color', '#0052cc');

      const legendW = 180;
      const legendH = 12;
      const legendX = innerW - legendW;
      const legendY = 4;
      const legend = g.append('g').attr('transform', `translate(${legendX},${legendY})`);
      legend.append('text')
        .attr('x', 0)
        .attr('y', -6)
        .attr('font-size', 11)
        .attr('fill', '#375a9e')
        .text(`Average execution time (s) - ${scaleMode === 'log' ? 'log' : 'linear'}${maxTimeCapS !== null ? ` - cap ${fmtNum(maxTimeCapS, 2)} s` : ''}`);

      legend.append('rect')
        .attr('width', legendW)
        .attr('height', legendH)
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', `url(#${legendGradientId})`)
        .attr('stroke', '#c6d5ee')
        .attr('stroke-width', 0.8);

      legend.append('text').attr('x', 0).attr('y', legendH + 12).attr('font-size', 10).attr('fill', '#4b5f87').text(fmtNum(legendMin, 2));
      legend.append('text').attr('x', legendW).attr('y', legendH + 12).attr('text-anchor', 'end').attr('font-size', 10).attr('fill', '#4b5f87').text(fmtNum(legendMax, 2));
    }
  }

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y));
  g.selectAll('.tick text').attr('font-size', 10);

  g.append('text')
    .attr('x', innerW / 2)
    .attr('y', innerH + 40)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text(xLabel);

  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -44)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#444')
    .text('Numero clique');

  if (!chartTooltip) {
    chartTooltip = d3.select('body').append('div').attr('class', 'chart-tooltip');
  }

  const halfW = getBoxHalfWidth(series.length ? series : [{ x: x.domain()[0] }, { x: x.domain()[1] }], x);
  const boxGroups = g.selectAll('g.box-time')
    .data(series)
    .enter()
    .append('g')
    .attr('class', 'box-time');

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x))
    .attr('x2', (d) => x(d.x))
    .attr('y1', (d) => y(d.lowY))
    .attr('y2', (d) => y(d.highY))
    .attr('stroke', '#13408c')
    .attr('stroke-width', 1.2)
    .attr('opacity', 0.75);

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x) - halfW * 0.6)
    .attr('x2', (d) => x(d.x) + halfW * 0.6)
    .attr('y1', (d) => y(d.lowY))
    .attr('y2', (d) => y(d.lowY))
    .attr('stroke', '#13408c')
    .attr('stroke-width', 1.1)
    .attr('opacity', 0.9);

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x) - halfW * 0.6)
    .attr('x2', (d) => x(d.x) + halfW * 0.6)
    .attr('y1', (d) => y(d.highY))
    .attr('y2', (d) => y(d.highY))
    .attr('stroke', '#13408c')
    .attr('stroke-width', 1.1)
    .attr('opacity', 0.9);

  boxGroups.append('rect')
    .attr('x', (d) => x(d.x) - halfW)
    .attr('y', (d) => y(d.q3Y))
    .attr('width', halfW * 2)
    .attr('height', (d) => Math.max(2, y(d.q1Y) - y(d.q3Y)))
    .attr('fill', (d) => color(d.metricMean))
    .attr('stroke', '#13408c')
    .attr('stroke-width', 1.1)
    .attr('opacity', 0.86);

  boxGroups.append('line')
    .attr('x1', (d) => x(d.x) - halfW)
    .attr('x2', (d) => x(d.x) + halfW)
    .attr('y1', (d) => y(d.medianY))
    .attr('y2', (d) => y(d.medianY))
    .attr('stroke', '#0f2b5d')
    .attr('stroke-width', 1.6);

  boxGroups
    .style('cursor', 'pointer')
    .on('mousemove', (event, d) => {
      chartTooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 16}px`)
        .style('top', `${event.clientY + 12}px`)
        .html(
          `<strong>Ascissa: ${fmtNum(d.x, 2)}</strong><br>` +
          `Campioni: ${d.count}<br>` +
          `Min: ${fmtNum(d.lowY, 2)}<br>` +
          `Q1: ${fmtNum(d.q1Y, 2)}<br>` +
          `Mediana: ${fmtNum(d.medianY, 2)}<br>` +
          `Q3: ${fmtNum(d.q3Y, 2)}<br>` +
          `Max: ${fmtNum(d.highY, 2)}<br>` +
          `Average time: ${fmtNum(d.metricMean, 2)} s<br>` +
          `Pipeline save: ${esc(d.pipelineSaveFile)}`
        );
    })
    .on('mouseleave', () => chartTooltip.style('opacity', 0));

  renderFailedOverlayPoints(g, visibleFailedPoints, x, y, 8);
  applyForegroundInGroup(g, getMainForegroundLayer(), 'g.box-time', 'path.failed-point');
}

function renderScatter(results) {
  renderAccuracyScatterByX(results, {
    containerId: 'analysis-chart',
    xAccessor: (m) => m.totalNodes,
    xLabel: 'Graph size (number of nodes)',
    pointMode: getAnalysisPointMode(),
  });
}

function renderExecutionTimeScatter(results) {
  renderExecutionTimeScatterByX(results, {
    containerId: 'analysis-time-chart',
    xAccessor: (m) => m.totalNodes,
    xLabel: 'Graph size (number of nodes)',
    scaleMode: getExecScaleMode('exec-scale-mode'),
    maxTimeCapS: getExecTimeCap('exec-cap-time'),
    pointMode: getAnalysisPointMode(),
  });
}

function renderEdgesScatter(results) {
  renderAccuracyScatterByX(results, {
    containerId: 'analysis-edges-chart',
    xAccessor: (m) => m.totalEdges,
    xLabel: 'Graph size (number of edges)',
    pointMode: getAnalysisPointMode(),
  });
}

function renderEdgesExecutionTimeScatter(results) {
  renderExecutionTimeScatterByX(results, {
    containerId: 'analysis-edges-time-chart',
    xAccessor: (m) => m.totalEdges,
    xLabel: 'Graph size (number of edges)',
    scaleMode: getExecScaleMode('exec-scale-mode-edges'),
    maxTimeCapS: getExecTimeCap('exec-cap-time-edges'),
    pointMode: getAnalysisPointMode(),
  });
}

function renderDegreeScatter(results) {
  renderAccuracyScatterByX(results, {
    containerId: 'analysis-degree-chart',
    xAccessor: (m) => m.avgNodeDegree,
    xLabel: 'Average node degree',
    pointMode: getAnalysisPointMode(),
  });
}

function renderDegreeExecutionTimeScatter(results) {
  renderExecutionTimeScatterByX(results, {
    containerId: 'analysis-degree-time-chart',
    xAccessor: (m) => m.avgNodeDegree,
    xLabel: 'Average node degree',
    scaleMode: getExecScaleMode('exec-scale-mode-degree'),
    maxTimeCapS: getExecTimeCap('exec-cap-time-degree'),
    pointMode: getAnalysisPointMode(),
  });
}

function renderAllAnalysisCharts(results) {
  renderScatter(results);
  renderExecutionTimeScatter(results);
  renderEdgesScatter(results);
  renderEdgesExecutionTimeScatter(results);
  renderDegreeScatter(results);
  renderDegreeExecutionTimeScatter(results);
  renderSingleScatter(results);
}

// --- Single custom scatter: options, metric accessors, renderer ---
const SINGLE_SELECT_OPTIONS = [
  { value: 'totalNodes', label: 'number of nodes' },
  { value: 'totalEdges', label: 'number of edges' },
  { value: 'graphDensity', label: 'graph density' },
  { value: 'totalCliques', label: 'number of cliques' },
  { value: 'avgCliqueDegree', label: 'average clique degree' },
  { value: 'pctCompactCliques', label: '% compact cliques' },
  { value: 'pctNodesInClique', label: '% nodes in at least one clique' },
  { value: 'avgNodeDegree', label: 'average node degree' },
  { value: 'maxNodeDegree', label: 'max node degree' },
  { value: 'avgCliqueSize', label: 'average clique size' },
  { value: 'maxCliqueSize', label: 'max clique size' },
  { value: 'execTimeLog', label: 'time (logarithmic)' },
  { value: 'execTimeLinear', label: 'time (linear)' },
];

function computeAvgCliqueDegree(metrics) {
  // average number of cliques a node belongs to
  try {
    const details = metrics && metrics.cliqueDetails ? metrics.cliqueDetails : null;
    const totalNodes = Number(metrics && metrics.totalNodes) || 0;
    if (details && details.length && totalNodes > 0) {
      const counts = new Map();
      for (const c of details) {
        const nodesArr = Array.isArray(c.nodes) ? c.nodes : (Array.isArray(c) ? c : null);
        if (!nodesArr) continue;
        for (const nid of nodesArr) {
          counts.set(nid, (counts.get(nid) || 0) + 1);
        }
      }
      // average over all nodes (including those with zero membership)
      let sum = 0;
      for (const v of counts.values()) sum += v;
      const avg = sum / totalNodes;
      return Number.isFinite(avg) ? avg : NaN;
    }

    // fallback: if server provided avgCliqueDegree use it
    const direct = Number(metrics && metrics.avgCliqueDegree);
    if (Number.isFinite(direct)) return direct;

    // final fallback: approximate from avgCliqueSize * totalCliques / totalNodes
    const avgCliqueSize = Number(metrics && metrics.avgCliqueSize);
    const totalCliques = Number(metrics && metrics.totalCliques);
    if (Number.isFinite(avgCliqueSize) && Number.isFinite(totalCliques) && Number.isFinite(totalNodes) && totalNodes > 0) {
      const avg = (avgCliqueSize * totalCliques) / totalNodes;
      return Number.isFinite(avg) ? avg : NaN;
    }

    return NaN;
  } catch (e) {
    return NaN;
  }
}

function getMetricValueByKey(metrics, key) {
  if (!metrics) return NaN;
  switch (key) {
    case 'totalNodes': return Number(metrics.totalNodes);
    case 'totalEdges': return Number(metrics.totalEdges);
    case 'graphDensity': {
      const direct = Number(metrics.graphDensity);
      if (Number.isFinite(direct)) return direct;
      const n = Number(metrics.totalNodes);
      const m = Number(metrics.totalEdges);
      if (Number.isFinite(n) && Number.isFinite(m) && n > 1) return (2 * m) / (n * (n - 1));
      return NaN;
    }
    case 'totalCliques': return Number(metrics.totalCliques);
    case 'avgCliqueDegree': return computeAvgCliqueDegree(metrics);
    case 'pctCompactCliques': return getCompactCliquesPct(metrics);
    case 'pctNodesInClique': return getNodesInCliquePct(metrics);
    case 'avgNodeDegree': return Number(metrics.avgNodeDegree);
    case 'maxNodeDegree': return Number(metrics.maxNodeDegree);
    case 'avgCliqueSize': return Number(metrics.avgCliqueSize);
    case 'maxCliqueSize': return Number(metrics.maxCliqueSize);
    case 'execTimeLog': {
      const s = parseExecutionTimeSeconds(metrics);
      if (!Number.isFinite(s) || s <= 0) return NaN;
      return Math.log10(s + 1e-6);
    }
    case 'execTimeLinear': return parseExecutionTimeSeconds(metrics);
    default: return NaN;
  }
}

function populateSingleSelects() {
  const ids = ['single-x-select','single-y-select','single-color-select','single-size-select'];
  ids.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    if (id === 'single-color-select' || id === 'single-size-select') {
      const none = document.createElement('option');
      none.value = 'none';
      none.textContent = 'none';
      sel.appendChild(none);
    }
    SINGLE_SELECT_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      sel.appendChild(o);
    });
  });
  // default preset A: X=totalNodes, Y=totalEdges, Color=totalCliques, Size=avgCliqueSize
  const defaults = { 'single-x-select':'totalNodes','single-y-select':'totalEdges','single-color-select':'none','single-size-select':'none' };
  Object.keys(defaults).forEach(id => { const el = document.getElementById(id); if (el) el.value = defaults[id]; });
}

function getSingleChartConfigControlIds() {
  return [
    'single-x-select',
    'single-y-select',
    'single-custom-x-label',
    'single-custom-y-label',
    'single-custom-color-label',
    'single-custom-legend-completed-label',
    'single-custom-legend-failed-label',
    'single-color-select',
    'single-size-select',
    'single-point-mode',
    'single-enable-bucketing',
    'single-bucket-size',
    'single-bucket-start',
    'single-ci-area-fill-color',
    'single-ci-area-stroke-color',
    'single-ci-median-color',
    'single-ci-p25-color',
    'single-ci-p75-color',
    'single-ci-outlier-fill-color',
    'single-ci-outlier-stroke-color',
    'single-ci-area-stroke-width',
    'single-ci-median-width',
    'single-ci-p25-width',
    'single-ci-p75-width',
    'single-ci-outlier-stroke-width',
    'single-ci-outlier-opacity',
    'single-ci-outlier-shape',
    'single-ci-outlier-size-multiplier',
    'single-ci-outlier-extremes-only',
    'single-point-opacity',
    'single-point-fill-mode',
    'single-point-stroke-color-completed',
    'single-point-stroke-color-failed',
    'single-hex-color',
    'single-axis-ratio-x',
    'single-axis-ratio-y',
    'single-point-size-base',
    'single-show-completed',
    'single-show-failed',
    'single-show-legend',
    'single-show-color-legend',
    'single-foreground-layer',
    'single-failed-color',
    'single-failed-shape',
    'single-hide-axis-names',
    'single-hide-axis-x',
    'single-hide-axis-y',
    'single-max-time-cap',
    'single-chart-size-unit',
    'single-chart-width',
    'single-chart-height',
    'single-tick-font-size',
    'single-axis-name-font-size',
    'single-axis-tick-interval-x',
    'single-axis-tick-interval-y',
    'single-axis-tick-start-x',
    'single-axis-tick-start-y',
    'single-axis-tick-max-x',
    'single-axis-tick-max-y',
    'single-legend-font-size',
    'single-color-scale-values-font-size',
  ];
}

function readSingleChartConfigFromControls() {
  const config = {};
  getSingleChartConfigControlIds().forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    config[id] = el.type === 'checkbox' ? !!el.checked : String(el.value ?? '');
  });
  return config;
}

function applySingleChartConfig(config = {}) {
  getSingleChartConfigControlIds().forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(config, id)) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = !!config[id];
    } else {
      el.value = String(config[id] ?? '');
    }
  });
  updateSingleBucketingControls();
}

function loadSavedSingleChartConfig() {
  try {
    const raw = localStorage.getItem(SINGLE_CHART_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveSingleChartConfigAsDefault() {
  try {
    const config = readSingleChartConfigFromControls();
    localStorage.setItem(SINGLE_CHART_CONFIG_STORAGE_KEY, JSON.stringify(config));
    alert('Custom chart configuration saved as default.');
  } catch (e) {
    alert(`Error saving configuration: ${e.message}`);
  }
}

function resetSingleChartConfigToDefault() {
  if (!singleChartDefaultConfigSnapshot) return;
  try {
    localStorage.removeItem(SINGLE_CHART_CONFIG_STORAGE_KEY);
  } catch (_) {
    // ignore storage cleanup errors
  }
  applySingleChartConfig(singleChartDefaultConfigSnapshot);
  if (lastAnalysisResults && lastAnalysisResults.length) renderSingleScatter(lastAnalysisResults);
}

function getMetricLabelByKey(key) {
  if (key === 'none') return 'none';
  const found = SINGLE_SELECT_OPTIONS.find((o) => o.value === key);
  return found ? found.label : key;
}

function getPaddedLinearDomain(extent, padFactor = 0.08) {
  const minV = Number(extent && extent[0]);
  const maxV = Number(extent && extent[1]);
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return [0, 1];
  const span = (maxV - minV) || Math.max(1, Math.abs(maxV) || 1);
  const pad = span * padFactor;
  return [minV - pad, maxV + pad];
}

function getSingleHexColor() {
  const input = document.getElementById('single-hex-color');
  const raw = String(input && input.value ? input.value : '').trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return raw;
  return '#1f77b4';
}

function getSingleMaxTimeCap() {
  const input = document.getElementById('single-max-time-cap');
  if (!input) return null;
  const raw = String(input.value || '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getSingleAxisProportions() {
  const xRaw = Number(document.getElementById('single-axis-ratio-x')?.value);
  const yRaw = Number(document.getElementById('single-axis-ratio-y')?.value);
  const xRatio = Number.isFinite(xRaw) ? Math.max(0.2, Math.min(4, xRaw)) : 1;
  const yRatio = Number.isFinite(yRaw) ? Math.max(0.2, Math.min(4, yRaw)) : 1;
  return { xRatio, yRatio };
}

function getSingleAxisTickInterval(inputId) {
  const raw = Number(document.getElementById(inputId)?.value);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function getSingleAxisTickStart(inputId) {
  const raw = Number(document.getElementById(inputId)?.value);
  return Number.isFinite(raw) ? raw : null;
}

function getSingleAxisTickMax(inputId) {
  const raw = Number(document.getElementById(inputId)?.value);
  return Number.isFinite(raw) ? raw : null;
}

function getSinglePointBaseSize() {
  const raw = Number(document.getElementById('single-point-size-base')?.value);
  return Number.isFinite(raw) ? Math.max(1, Math.min(30, raw)) : 7;
}

function getSingleAxisFontSizes() {
  const tickRaw = Number(document.getElementById('single-tick-font-size')?.value);
  const axisRaw = Number(document.getElementById('single-axis-name-font-size')?.value);
  const tickFontSize = Number.isFinite(tickRaw) ? Math.max(8, Math.min(100, tickRaw)) : 10;
  const axisNameFontSize = Number.isFinite(axisRaw) ? Math.max(8, Math.min(40, axisRaw)) : 11;
  return { tickFontSize, axisNameFontSize };
}

function getSingleLegendFontSizes() {
  const legendRaw = Number(document.getElementById('single-legend-font-size')?.value);
  const colorValuesRaw = Number(document.getElementById('single-color-scale-values-font-size')?.value);
  const legendFontSize = Number.isFinite(legendRaw) ? Math.max(8, Math.min(40, legendRaw)) : 11;
  const colorScaleValuesFontSize = Number.isFinite(colorValuesRaw) ? Math.max(8, Math.min(40, colorValuesRaw)) : 10;
  return { legendFontSize, colorScaleValuesFontSize };
}

function getSingleChartDimensionsPx() {
  const unit = String(document.getElementById('single-chart-size-unit')?.value || 'px').toLowerCase() === 'cm' ? 'cm' : 'px';
  const widthRaw = Number(document.getElementById('single-chart-width')?.value);
  const heightRaw = Number(document.getElementById('single-chart-height')?.value);

  const widthBase = Number.isFinite(widthRaw) && widthRaw > 0 ? widthRaw : 680;
  const heightBase = Number.isFinite(heightRaw) && heightRaw > 0 ? heightRaw : 520;
  const cmToPx = 96 / 2.54;

  const widthPx = unit === 'cm' ? widthBase * cmToPx : widthBase;
  const heightPx = unit === 'cm' ? heightBase * cmToPx : heightBase;

  return {
    widthPx: Math.max(320, Math.min(5000, Math.round(widthPx))),
    heightPx: Math.max(240, Math.min(5000, Math.round(heightPx))),
  };
}

function renderSingleScatter(results) {
  const containerId = 'analysis-single-scatter';
  const root = d3.select(`#${containerId}`);
  root.selectAll('*').remove();
  if (!results || !results.length) {
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('No data available for this chart.');
    return;
  }

  const xKey = document.getElementById('single-x-select')?.value || 'totalNodes';
  const yKey = document.getElementById('single-y-select')?.value || 'totalEdges';
  const cKey = document.getElementById('single-color-select')?.value || 'totalCliques';
  const sKey = document.getElementById('single-size-select')?.value || 'avgCliqueSize';
  const singlePointMode = getSinglePointMode();
  const { enabled: singleBucketingEnabled, bucketSize: singleBucketSize, bucketStart: singleBucketStart } = getSingleBucketingConfig();
  const fixedHexColor = getSingleHexColor();
  const singleMaxTimeCap = getSingleMaxTimeCap();
  const { xRatio, yRatio } = getSingleAxisProportions();
  const xTickInterval = getSingleAxisTickInterval('single-axis-tick-interval-x');
  const yTickInterval = getSingleAxisTickInterval('single-axis-tick-interval-y');
  const xTickStart = getSingleAxisTickStart('single-axis-tick-start-x');
  const yTickStart = getSingleAxisTickStart('single-axis-tick-start-y');
  const xTickMax = getSingleAxisTickMax('single-axis-tick-max-x');
  const yTickMax = getSingleAxisTickMax('single-axis-tick-max-y');
  const basePointSize = getSinglePointBaseSize();
  const { tickFontSize, axisNameFontSize } = getSingleAxisFontSizes();
  const { legendFontSize, colorScaleValuesFontSize } = getSingleLegendFontSizes();
  const { widthPx, heightPx } = getSingleChartDimensionsPx();
  const hideAxisNames = shouldHideSingleAxisNames();
  const hideXAxis = shouldHideSingleXAxis();
  const hideYAxis = shouldHideSingleYAxis();
  const failedColor = getSingleFailedPointsColor();
  const failedShape = getSingleFailedPointsShape();
  const completedLegendLabel = getSingleCustomLabelValue('single-custom-legend-completed-label') || 'Completed graphs';
  const failedLegendLabel = getSingleCustomLabelValue('single-custom-legend-failed-label') || 'Incomplete graphs';
  const pointOpacity = getSinglePointOpacity();
  const pointFillMode = getSinglePointFillMode();
  const completedPointStrokeColor = getSingleCompletedPointStrokeColor();
  const failedPointStrokeColor = getSingleFailedPointStrokeColor();
  const completedStrokeFollowsFill = shouldSingleCompletedStrokeFollowFill();
  const failedStrokeFollowsFill = shouldSingleFailedStrokeFollowFill();
  const ciStyle = getSingleConfidenceIntervalStyle();
  const ciOutliersExtremesOnly = shouldSingleCiOutliersExtremesOnly();

  const getMetricValueForSingleChart = (metrics, key) => {
    if (key === 'execTimeLinear') {
      const raw = parseExecutionTimeSeconds(metrics);
      if (!Number.isFinite(raw)) return NaN;
      if (singleMaxTimeCap !== null) return Math.min(raw, singleMaxTimeCap);
      return raw;
    }
    if (key === 'execTimeLog') {
      const raw = parseExecutionTimeSeconds(metrics);
      if (!Number.isFinite(raw) || raw <= 0) return NaN;
      const capped = singleMaxTimeCap !== null ? Math.min(raw, singleMaxTimeCap) : raw;
      return capped > 0 ? Math.log10(capped + 1e-6) : NaN;
    }
    return getMetricValueByKey(metrics, key);
  };

  const points = results.map(r => {
    const m = r.metrics || {};
    return {
      name: m.instance || r.pipelineSaveFile,
      pipelineSaveFile: r.pipelineSaveFile,
      x: getMetricValueForSingleChart(m, xKey),
      y: getMetricValueForSingleChart(m, yKey),
      colorV: getMetricValueForSingleChart(m, cKey),
      sizeV: getMetricValueForSingleChart(m, sKey),
    };
  }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  const failedPoints = (lastAnalysisFailedEntries || [])
    .map((entry) => {
      const m = entry.metrics || {};
      return {
        name: m.instance || entry.pipelineSaveFile || 'unsolved graph',
        pipelineSaveFile: entry.pipelineSaveFile || '-',
        error: entry.error || 'Solution unavailable',
        x: getMetricValueForSingleChart(m, xKey),
        y: getMetricValueForSingleChart(m, yKey),
        colorV: getMetricValueForSingleChart(m, cKey),
        sizeV: getMetricValueForSingleChart(m, sKey),
      };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const visiblePoints = shouldShowSingleCompletedPoints() ? points : [];
  const plottedCompletedPoints = singlePointMode === 'scatter' && singleBucketingEnabled
    ? bucketSingleScatterPoints(visiblePoints, singleBucketSize, singleBucketStart)
    : visiblePoints;
  const visibleFailedPoints = shouldShowSingleFailedPoints() ? failedPoints : [];

  if (!visiblePoints.length && !visibleFailedPoints.length) {
    const legendEl = document.getElementById('analysis-single-scatter-legend');
    if (legendEl) legendEl.textContent = 'Legend: no points available.';
    root.append('div').attr('class', 'list-empty').style('padding', '14px').text('Insufficient data for the selected chart.');
    return;
  }

  let domainPoints = [...plottedCompletedPoints, ...visibleFailedPoints];
  const baseLeftMargin = hideYAxis ? 30 : 98;
  const leftMargin = hideYAxis
    ? baseLeftMargin
    : Math.min(280, baseLeftMargin + Math.max(0, tickFontSize - 24) * 2.1);
  const baseBottomMargin = hideXAxis ? 50 : 86;
  const bottomMargin = hideXAxis
    ? baseBottomMargin
    : Math.min(260, baseBottomMargin + Math.max(0, tickFontSize - 24) * 1.3);
  const { svg, g, innerW, innerH } = getChartCanvas(containerId, {
    width: Math.round(widthPx * xRatio),
    minWidth: 320,
    height: Math.round(heightPx * yRatio),
    margin: { top: 42, right: 30, bottom: bottomMargin, left: leftMargin },
  });
  svg.style('background', '#ffffff');

  const x = d3.scaleLinear().domain(getPaddedLinearDomain(d3.extent(domainPoints, d => d.x), 0.09)).nice().range([0, innerW]);
  const y = d3.scaleLinear().domain(getPaddedLinearDomain(d3.extent(domainPoints, d => d.y), 0.09)).nice().range([innerH, 0]);

  const sizedPoints = sKey === 'none'
    ? [...plottedCompletedPoints, ...visibleFailedPoints]
    : [...plottedCompletedPoints, ...visibleFailedPoints].filter((p) => Number.isFinite(p.sizeV));
  const sizedDomainPoints = sizedPoints.length ? sizedPoints : [{ sizeV: 1 }, { sizeV: 2 }];
  const sizeExtent = d3.extent(sizedPoints, d => d.sizeV);
  const rScale = sKey === 'none'
    ? (() => basePointSize)
    : d3.scaleSqrt()
      .domain(d3.extent(sizedDomainPoints, d => d.sizeV))
      .range([basePointSize, Math.min(42, basePointSize + 18)]);

  const completedColorPoints = cKey === 'none'
    ? plottedCompletedPoints
    : plottedCompletedPoints.filter((p) => Number.isFinite(p.colorV));
  const failedColorPoints = cKey === 'none'
    ? visibleFailedPoints
    : visibleFailedPoints.filter((p) => Number.isFinite(p.colorV));
  const completedColorExtent = d3.extent(completedColorPoints, d => d.colorV);
  const failedColorExtent = d3.extent(failedColorPoints, d => d.colorV);

  const getSafeColorDomain = (extent) => {
    const minV = Number(Array.isArray(extent) ? extent[0] : NaN);
    const maxV = Number(Array.isArray(extent) ? extent[1] : NaN);
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return [0, 1];
    if (minV === maxV) return [minV, minV + 1];
    return [minV, maxV];
  };

  const completedColorScale = cKey === 'none'
    ? (() => fixedHexColor)
    : d3.scaleLinear().domain(getSafeColorDomain(completedColorExtent)).range(['#f7fbff', fixedHexColor]).clamp(true);
  const failedColorScale = cKey === 'none'
    ? (() => failedColor)
    : d3.scaleLinear().domain(getSafeColorDomain(failedColorExtent)).range(['#f7fbff', failedColor]).clamp(true);
  const usesFillColorMetric = pointFillMode !== 'stroke-only' && cKey !== 'none';
  const colorLegendKey = usesFillColorMetric ? cKey : 'none';
  const xAxisLabel = getSingleCustomLabelValue('single-custom-x-label') || getMetricLabelByKey(xKey);
  const yAxisLabel = getSingleCustomLabelValue('single-custom-y-label') || getMetricLabelByKey(yKey);
  const colorScaleLabel = getSingleCustomLabelValue('single-custom-color-label') || getMetricLabelByKey(cKey);

  const getScaledPointRadius = (sizeValue) => {
    if (sKey === 'none') return rScale();
    return rScale(Number.isFinite(sizeValue) ? sizeValue : (sizeExtent[0] || 0));
  };

  const getCompletedPointFill = (colorValue) => {
    if (pointFillMode === 'stroke-only') return 'none';
    if (cKey === 'none') return completedColorScale();
    return Number.isFinite(colorValue) ? completedColorScale(colorValue) : '#999';
  };

  const getFailedPointFill = (colorValue) => {
    if (pointFillMode === 'stroke-only') return 'none';
    if (cKey === 'none') return failedColor;
    return Number.isFinite(colorValue) ? failedColorScale(colorValue) : failedColor;
  };

  const getCompletedPointStroke = (colorValue) => {
    if (!completedStrokeFollowsFill) return completedPointStrokeColor;
    if (Number.isFinite(colorValue)) return completedColorScale(colorValue);
    return fixedHexColor;
  };

  const getFailedPointStroke = (colorValue) => {
    if (!failedStrokeFollowsFill) return failedPointStrokeColor;
    if (Number.isFinite(colorValue)) return failedColorScale(colorValue);
    return failedColor;
  };

  const getFailedSymbolArea = (sizeValue) => {
    const radius = getScaledPointRadius(sizeValue);
    return Math.max(40, radius * radius * 4);
  };

  const getPointVisualRadius = (point) => {
    const completedOrFailedRadius = getScaledPointRadius(point?.sizeV);
    if (!point || point.error === undefined) return completedOrFailedRadius;
    return Math.max(completedOrFailedRadius, Math.sqrt(getFailedSymbolArea(point.sizeV)) / 2);
  };

  const updateSingleChartDomains = (pointsForDomain) => {
    const safePoints = (Array.isArray(pointsForDomain) ? pointsForDomain : [])
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
    if (!safePoints.length) return;
    const maxRadius = d3.max(safePoints, (d) => getPointVisualRadius(d)) || basePointSize;
    x.domain(getMetricDomainWithPadding(xKey, d3.extent(safePoints, d => d.x), innerW, maxRadius + 4, 0.09)).nice();
    y.domain(getMetricDomainWithPadding(yKey, d3.extent(safePoints, d => d.y), innerH, maxRadius + 4, 0.09)).nice();
  };

  updateSingleChartDomains(domainPoints);

  const xAxisG = g.append('g').attr('transform', `translate(0,${innerH})`).call(getMetricAxisGenerator(x, xKey, 'bottom', 10, xTickInterval, xTickStart, xTickMax));
  const yAxisG = g.append('g').call(getMetricAxisGenerator(y, yKey, 'left', 10, yTickInterval, yTickStart, yTickMax));
  if (hideXAxis) xAxisG.selectAll('*').remove();
  if (hideYAxis) yAxisG.selectAll('*').remove();
  g.selectAll('.tick text').attr('font-size', tickFontSize);

  if (!hideAxisNames && !hideXAxis) {
    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 60)
      .attr('text-anchor', 'middle')
      .attr('font-size', axisNameFontSize)
      .attr('fill', '#444')
      .text(xAxisLabel);
  }

  if (!hideAxisNames && !hideYAxis) {
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerH / 2)
      .attr('y', -54)
      .attr('text-anchor', 'middle')
      .attr('font-size', axisNameFontSize)
      .attr('fill', '#444')
      .text(yAxisLabel);
  }

    /*
  const topLabel = cKey === 'none'
    ? `Colore punti: fisso ${fixedHexColor}`
    : `Colore punti: ${getMetricLabelByKey(cKey)}`;
  const rightLabel = sKey === 'none'
    ? `Dimensione punti: fissa (${fmtNum(basePointSize, 1)})`
    : `Dimensione punti: ${getMetricLabelByKey(sKey)} (min ${fmtNum(basePointSize, 1)})`;

  g.append('text')
    .attr('x', 0)
    .attr('y', -10)
    .attr('font-size', tickFontSize)
    .attr('fill', '#3d4b66')
    .text(topLabel);

  g.append('text')
    .attr('x', innerW)
    .attr('y', -10)
    .attr('text-anchor', 'end')
    .attr('font-size', tickFontSize)
    .attr('fill', '#3d4b66')
    .text(rightLabel);
    */

  if (!chartTooltip) chartTooltip = d3.select('body').append('div').attr('class', 'chart-tooltip');
  const drawSingleFailedPoints = () => {
    if (!visibleFailedPoints.length) return;
    const failedShapeType = getSymbolTypeByName(failedShape);

    g.selectAll('path.single-failed-point')
      .data(visibleFailedPoints)
      .enter()
      .append('path')
      .attr('class', 'single-failed-point')
      .attr('d', (d) => d3.symbol().type(failedShapeType).size(getFailedSymbolArea(d.sizeV))())
      .attr('transform', (d) => `translate(${x(d.x)},${y(d.y)}) rotate(180)`)
      .attr('fill', (d) => getFailedPointFill(d.colorV))
      .attr('stroke', (d) => getFailedPointStroke(d.colorV))
      .attr('stroke-width', pointFillMode === 'stroke-only' ? 1.6 : 1.1)
      .attr('opacity', pointOpacity)
      .on('mousemove', (event, d) => {
        chartTooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 16}px`)
          .style('top', `${event.clientY + 12}px`)
          .html(
            `<strong>${esc(d.name)}</strong><br>` +
            `Pipeline save: ${esc(d.pipelineSaveFile)}<br>` +
            `${getMetricLabelByKey(xKey)}: ${formatMetricValueForDisplay(xKey, d.x, 2)}<br>` +
            `${getMetricLabelByKey(yKey)}: ${formatMetricValueForDisplay(yKey, d.y, 2)}<br>` +
            `${cKey === 'none' ? 'colore fisso' : getMetricLabelByKey(cKey)}: ${cKey === 'none' ? esc(failedColor) : formatMetricValueForDisplay(cKey, d.colorV,2)}<br>` +
            `${sKey === 'none' ? 'dimensione fissa' : getMetricLabelByKey(sKey)}: ${sKey === 'none' ? fmtNum(basePointSize, 1) : formatMetricValueForDisplay(sKey, d.sizeV,2)}<br>` +
            `Status: solution not computed<br>` +
            `Error: ${esc(d.error || '-')}`
          );
      })
      .on('mouseleave', () => chartTooltip.style('opacity', 0));
  };

  if (singlePointMode === 'boxplot') {
    const metricAccessor = (d) => {
      if (usesFillColorMetric && Number.isFinite(d.colorV)) return d.colorV;
      return d.y;
    };
    const series = buildBoxplotSeriesByX(visiblePoints, metricAccessor);
    const halfW = getBoxHalfWidth(series.length ? series : [{ x: x.domain()[0] }, { x: x.domain()[1] }], x);

    const boxGroups = g.selectAll('g.single-box')
      .data(series)
      .enter()
      .append('g')
      .attr('class', 'single-box')
      .style('cursor', 'pointer');

    boxGroups.append('line')
      .attr('x1', (d) => x(d.x))
      .attr('x2', (d) => x(d.x))
      .attr('y1', (d) => y(d.lowY))
      .attr('y2', (d) => y(d.highY))
      .attr('stroke', (d) => {
        if (!completedStrokeFollowsFill) return completedPointStrokeColor;
        if (usesFillColorMetric && Number.isFinite(d.metricMean)) return completedColorScale(d.metricMean);
        return fixedHexColor;
      })
      .attr('stroke-width', 1.2)
      .attr('opacity', pointOpacity);

    boxGroups.append('line')
      .attr('x1', (d) => x(d.x) - halfW * 0.6)
      .attr('x2', (d) => x(d.x) + halfW * 0.6)
      .attr('y1', (d) => y(d.lowY))
      .attr('y2', (d) => y(d.lowY))
      .attr('stroke', (d) => {
        if (!completedStrokeFollowsFill) return completedPointStrokeColor;
        if (usesFillColorMetric && Number.isFinite(d.metricMean)) return completedColorScale(d.metricMean);
        return fixedHexColor;
      })
      .attr('stroke-width', 1.1)
      .attr('opacity', pointOpacity);

    boxGroups.append('line')
      .attr('x1', (d) => x(d.x) - halfW * 0.6)
      .attr('x2', (d) => x(d.x) + halfW * 0.6)
      .attr('y1', (d) => y(d.highY))
      .attr('y2', (d) => y(d.highY))
      .attr('stroke', (d) => {
        if (!completedStrokeFollowsFill) return completedPointStrokeColor;
        if (usesFillColorMetric && Number.isFinite(d.metricMean)) return completedColorScale(d.metricMean);
        return fixedHexColor;
      })
      .attr('stroke-width', 1.1)
      .attr('opacity', pointOpacity);

    boxGroups.append('rect')
      .attr('x', (d) => x(d.x) - halfW)
      .attr('y', (d) => y(d.q3Y))
      .attr('width', halfW * 2)
      .attr('height', (d) => Math.max(2, y(d.q1Y) - y(d.q3Y)))
      .attr('fill', (d) => {
        if (pointFillMode === 'stroke-only') return 'none';
        if (!usesFillColorMetric) return fixedHexColor;
        return Number.isFinite(d.metricMean) ? completedColorScale(d.metricMean) : '#9fb8ff';
      })
      .attr('stroke', (d) => {
        if (!completedStrokeFollowsFill) return completedPointStrokeColor;
        if (usesFillColorMetric && Number.isFinite(d.metricMean)) return completedColorScale(d.metricMean);
        return fixedHexColor;
      })
      .attr('stroke-width', pointFillMode === 'stroke-only' ? 1.5 : 1.1)
      .attr('opacity', pointOpacity);

    boxGroups.append('line')
      .attr('x1', (d) => x(d.x) - halfW)
      .attr('x2', (d) => x(d.x) + halfW)
      .attr('y1', (d) => y(d.medianY))
      .attr('y2', (d) => y(d.medianY))
      .attr('stroke', (d) => {
        if (!completedStrokeFollowsFill) return completedPointStrokeColor;
        if (usesFillColorMetric && Number.isFinite(d.metricMean)) return completedColorScale(d.metricMean);
        return fixedHexColor;
      })
      .attr('stroke-width', 1.8)
      .attr('opacity', pointOpacity);

    boxGroups
      .on('mousemove', (event, d) => {
        const meanLabel = usesFillColorMetric ? `${getMetricLabelByKey(cKey)} media` : 'Ordinata media';
        chartTooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 16}px`)
          .style('top', `${event.clientY + 12}px`)
          .html(
            `<strong>Ascissa: ${formatMetricValueForDisplay(xKey, d.x, 2)}</strong><br>` +
            `Campioni: ${d.count}<br>` +
            `Min: ${formatMetricValueForDisplay(yKey, d.lowY, 2)}<br>` +
            `Q1: ${formatMetricValueForDisplay(yKey, d.q1Y, 2)}<br>` +
            `Mediana: ${formatMetricValueForDisplay(yKey, d.medianY, 2)}<br>` +
            `Q3: ${formatMetricValueForDisplay(yKey, d.q3Y, 2)}<br>` +
            `Max: ${formatMetricValueForDisplay(yKey, d.highY, 2)}<br>` +
            `${meanLabel}: ${usesFillColorMetric ? formatMetricValueForDisplay(cKey, d.metricMean, 2) : formatMetricValueForDisplay(yKey, d.metricMean, 2)}<br>` +
            `Pipeline save: ${esc(d.pipelineSaveFile)}`
          );
      })
      .on('mouseleave', () => chartTooltip.style('opacity', 0));
  } else if (singlePointMode === 'confidence-interval') {
    const metricAccessor = (d) => {
      if (usesFillColorMetric && Number.isFinite(d.colorV)) return d.colorV;
      return d.y;
    };
    const series = buildConfidenceIntervalSeriesByX(
      visiblePoints,
      metricAccessor,
      singleBucketingEnabled ? singleBucketSize : null,
      singleBucketingEnabled ? singleBucketStart : 0,
      ciOutliersExtremesOnly
    );
    domainPoints = [
      ...series.flatMap((d) => [
        { x: d.x, y: d.p25Y },
        { x: d.x, y: d.medianY },
        { x: d.x, y: d.p75Y },
      ]),
      ...visibleFailedPoints,
    ].filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
    updateSingleChartDomains(domainPoints);
    xAxisG.call(getMetricAxisGenerator(x, xKey, 'bottom', 10, xTickInterval, xTickStart, xTickMax));
    yAxisG.call(getMetricAxisGenerator(y, yKey, 'left', 10, yTickInterval, yTickStart, yTickMax));
    if (hideXAxis) xAxisG.selectAll('*').remove();
    if (hideYAxis) yAxisG.selectAll('*').remove();
    g.selectAll('.tick text').attr('font-size', tickFontSize);

    const renderCiTooltip = (event, d) => {
      const meanLabel = usesFillColorMetric ? `${getMetricLabelByKey(cKey)} media` : 'Ordinata media';
      const bucketLabel = Number.isFinite(d.bucketStart) && Number.isFinite(d.bucketEnd)
        ? `Bucket X: [${formatMetricValueForDisplay(xKey, d.bucketStart, 2)}, ${formatMetricValueForDisplay(xKey, d.bucketEnd, 2)})<br>`
        : '';
      chartTooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 16}px`)
        .style('top', `${event.clientY + 12}px`)
        .html(
          `<strong>Ascissa: ${formatMetricValueForDisplay(xKey, d.x, 2)}</strong><br>` +
          bucketLabel +
          `Campioni: ${d.count}<br>` +
          `P25: ${formatMetricValueForDisplay(yKey, d.p25Y, 2)}<br>` +
          `Mediana: ${formatMetricValueForDisplay(yKey, d.medianY, 2)}<br>` +
          `P75: ${formatMetricValueForDisplay(yKey, d.p75Y, 2)}<br>` +
          `Outlier: ${d.outliers.length}<br>` +
          `${meanLabel}: ${usesFillColorMetric ? formatMetricValueForDisplay(cKey, d.metricMean, 2) : formatMetricValueForDisplay(yKey, d.metricMean, 2)}<br>` +
          `Pipeline save: ${esc(d.pipelineSaveFile)}`
        );
    };

    if (series.length) {
      const areaGenerator = d3.area()
        .defined((d) => Number.isFinite(d.x) && Number.isFinite(d.p25Y) && Number.isFinite(d.p75Y))
        .x((d) => x(d.x))
        .y0((d) => y(d.p25Y))
        .y1((d) => y(d.p75Y))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(series)
        .attr('class', 'single-ci-area')
        .attr('d', areaGenerator)
        .attr('fill', pointFillMode === 'stroke-only' ? 'none' : ciStyle.areaFillColor)
        .attr('fill-opacity', pointFillMode === 'stroke-only' ? 0 : Math.min(0.35, pointOpacity * 0.45))
        .attr('stroke', ciStyle.areaStrokeColor)
        .attr('stroke-width', ciStyle.areaStrokeWidth)
        .attr('stroke-opacity', pointOpacity)
        .on('mousemove', (event) => {
          const [mx] = d3.pointer(event, g.node());
          let best = series[0] || null;
          let bestDist = Number.POSITIVE_INFINITY;
          for (const s of series) {
            const dist = Math.abs(x(s.x) - mx);
            if (dist < bestDist) {
              bestDist = dist;
              best = s;
            }
          }
          if (best) renderCiTooltip(event, best);
        })
        .on('mouseleave', () => chartTooltip.style('opacity', 0));

      const medianLine = d3.line()
        .defined((d) => Number.isFinite(d.x) && Number.isFinite(d.medianY))
        .x((d) => x(d.x))
        .y((d) => y(d.medianY))
        .curve(d3.curveMonotoneX);

      const p25Line = d3.line()
        .defined((d) => Number.isFinite(d.x) && Number.isFinite(d.p25Y))
        .x((d) => x(d.x))
        .y((d) => y(d.p25Y))
        .curve(d3.curveMonotoneX);

      const p75Line = d3.line()
        .defined((d) => Number.isFinite(d.x) && Number.isFinite(d.p75Y))
        .x((d) => x(d.x))
        .y((d) => y(d.p75Y))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(series)
        .attr('class', 'single-ci-line single-ci-line-p25')
        .attr('d', p25Line)
        .attr('fill', 'none')
        .attr('stroke', ciStyle.p25Color)
        .attr('stroke-width', ciStyle.p25Width)
        .attr('stroke-dasharray', '5,3')
        .attr('opacity', pointOpacity);

      g.append('path')
        .datum(series)
        .attr('class', 'single-ci-line single-ci-line-p75')
        .attr('d', p75Line)
        .attr('fill', 'none')
        .attr('stroke', ciStyle.p75Color)
        .attr('stroke-width', ciStyle.p75Width)
        .attr('stroke-dasharray', '5,3')
        .attr('opacity', pointOpacity);

      g.append('path')
        .datum(series)
        .attr('class', 'single-ci-line single-ci-line-median')
        .attr('d', medianLine)
        .attr('fill', 'none')
        .attr('stroke', ciStyle.medianColor)
        .attr('stroke-width', ciStyle.medianWidth)
        .attr('opacity', pointOpacity);

      g.selectAll('circle.single-ci-hover')
        .data(series)
        .enter()
        .append('circle')
        .attr('class', 'single-ci-hover')
        .attr('cx', (d) => x(d.x))
        .attr('cy', (d) => y(d.medianY))
        .attr('r', 7)
        .attr('fill', 'transparent')
        .style('cursor', 'pointer')
        .on('mousemove', (event, d) => renderCiTooltip(event, d))
        .on('mouseleave', () => chartTooltip.style('opacity', 0));

      const outlierData = series.flatMap((bucket) => bucket.outliers.map((outlier) => ({
        x: bucket.x,
        count: bucket.count,
        p25Y: bucket.p25Y,
        medianY: bucket.medianY,
        p75Y: bucket.p75Y,
        metricMean: bucket.metricMean,
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        pipelineSaveFile: outlier.pipelineSaveFile || bucket.pipelineSaveFile,
        outlierY: outlier.y,
        outlierName: outlier.name,
      })));

      const outlierSymbolType = getSymbolTypeByName(ciStyle.outlierShape);
      const outlierSymbolPath = d3.symbol().type(outlierSymbolType).size(ciStyle.outlierSymbolArea)();

      g.selectAll('path.single-ci-outlier')
        .data(outlierData)
        .enter()
        .append('path')
        .attr('class', 'single-ci-outlier')
        .attr('d', outlierSymbolPath)
        .attr('transform', (d) => `translate(${x(d.x)},${y(d.outlierY)})`)
        .attr('fill', ciStyle.outlierFillColor)
        .attr('stroke', ciStyle.outlierStrokeColor)
        .attr('stroke-width', ciStyle.outlierStrokeWidth)
        .attr('opacity', ciStyle.outlierOpacity)
        .on('mousemove', (event, d) => {
          chartTooltip
            .style('opacity', 1)
            .style('left', `${event.clientX + 16}px`)
            .style('top', `${event.clientY + 12}px`)
          .html(
              `<strong>Outlier</strong><br>` +
              `${d.outlierName ? `${esc(d.outlierName)}<br>` : ''}` +
              `Ascissa: ${formatMetricValueForDisplay(xKey, d.x, 2)}<br>` +
              `${Number.isFinite(d.bucketStart) && Number.isFinite(d.bucketEnd) ? `Bucket X: [${formatMetricValueForDisplay(xKey, d.bucketStart, 2)}, ${formatMetricValueForDisplay(xKey, d.bucketEnd, 2)})<br>` : ''}` +
              `Valore: ${formatMetricValueForDisplay(yKey, d.outlierY, 2)}<br>` +
              `Intervallo: [${formatMetricValueForDisplay(yKey, d.p25Y, 2)}, ${formatMetricValueForDisplay(yKey, d.p75Y, 2)}]<br>` +
              `Pipeline save: ${esc(d.pipelineSaveFile)}`
            );
        })
        .on('mouseleave', () => chartTooltip.style('opacity', 0));
    }
  } else {
    g.selectAll('circle.single-point')
      .data(plottedCompletedPoints)
      .enter()
      .append('circle')
      .attr('class', 'single-point')
      .attr('cx', d => x(d.x))
      .attr('cy', d => y(d.y))
      .attr('r', d => getScaledPointRadius(d.sizeV))
      .attr('fill', d => getCompletedPointFill(d.colorV))
      .attr('stroke', d => getCompletedPointStroke(d.colorV))
      .attr('stroke-width', pointFillMode === 'stroke-only' ? 1.4 : 0.8)
      .attr('opacity', pointOpacity)
      .on('mousemove', (event, d) => {
        const bucketLabel = Number.isFinite(d.bucketStart) && Number.isFinite(d.bucketEnd)
          ? `Bucket X: [${formatMetricValueForDisplay(xKey, d.bucketStart, 2)}, ${formatMetricValueForDisplay(xKey, d.bucketEnd, 2)})<br>Campioni: ${d.sampleCount || 0}<br>Ascissa media reale: ${formatMetricValueForDisplay(xKey, d.xMean, 2)}<br>`
          : '';
        chartTooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 16}px`)
          .style('top', `${event.clientY + 12}px`)
          .html(
            `<strong>${esc(d.name)}</strong><br>` +
            bucketLabel +
            `${getMetricLabelByKey(xKey)}: ${formatMetricValueForDisplay(xKey, d.x, 2)}<br>` +
            `${getMetricLabelByKey(yKey)}: ${formatMetricValueForDisplay(yKey, d.y, 2)}<br>` +
            `${cKey === 'none' ? 'colore fisso' : getMetricLabelByKey(cKey)}: ${cKey === 'none' ? esc(fixedHexColor) : formatMetricValueForDisplay(cKey, d.colorV,2)}<br>` +
            `${sKey === 'none' ? 'dimensione fissa' : getMetricLabelByKey(sKey)}: ${sKey === 'none' ? fmtNum(basePointSize, 1) : formatMetricValueForDisplay(sKey, d.sizeV,2)}`
          );
      })
      .on('mouseleave', () => chartTooltip.style('opacity', 0));
  }

  drawSingleFailedPoints();
  // render color legend (separata) e legenda principale
  try {
    renderSingleColorLegend({
      g,
      innerW,
      tickFontSize,
      colorValueFontSize: colorScaleValuesFontSize,
      cKey: colorLegendKey,
      colorScaleLabel,
      completedColorExtent,
      completedColorScale,
      completedColor: fixedHexColor,
      failedColorExtent,
      failedColorScale,
      failedColor,
      completedCount: visiblePoints.length,
      failedCount: visibleFailedPoints.length,
    });
  } catch (e) { /* ignore legend errors */ }

  renderSingleScatterLegend({
    g,
    pointsCount: visiblePoints.length,
    failedCount: visibleFailedPoints.length,
    failedColor,
    failedShape,
    failedUsesColorScale: usesFillColorMetric,
    failedUsesSizeScale: sKey !== 'none',
    completedDisplayMode: singlePointMode,
    completedLegendLabel,
    failedLegendLabel,
    legendFontSize,
    bucketLabel: singleBucketingEnabled ? `bucket X=${fmtNum(singleBucketSize, 2)}, start=${fmtNum(singleBucketStart, 2)}` : '',
  });
  applyForegroundInGroup(
    g,
    getSingleForegroundLayer(),
    singlePointMode === 'boxplot'
      ? 'g.single-box'
      : (singlePointMode === 'confidence-interval'
        ? 'path.single-ci-area, path.single-ci-line, path.single-ci-outlier, circle.single-ci-hover'
        : 'circle.single-point'),
    'path.single-failed-point'
  );
}

function redrawSingleScatter() {
  if (lastAnalysisResults && lastAnalysisResults.length) {
    renderSingleScatter(lastAnalysisResults);
  }
}

function getSingleScatterSvgElement() {
  const container = document.getElementById('analysis-single-scatter');
  if (!container) return null;
  const svgEl = container.querySelector('svg');
  if (!svgEl) {
    alert('No chart available to export.');
    return null;
  }
  return svgEl;
}

function serializeSingleScatterSvg(svgEl) {
  const serializer = new XMLSerializer();
  const svgClone = svgEl.cloneNode(true);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svgClone.style.background = '#ffffff';
  return serializer.serializeToString(svgClone);
}

function getSingleScatterBaseName() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `analysis_single_scatter_${ts}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderSvgToCanvas(svgString, svgEl, scale = 2) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      const width = Number(svgEl.getAttribute('width')) || svgEl.clientWidth || 1200;
      const height = Number(svgEl.getAttribute('height')) || svgEl.clientHeight || 800;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({ canvas, width, height });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG rendering error.'));
    };

    image.src = url;
  });
}

async function exportSingleScatter(formatOverride) {
  const svgEl = getSingleScatterSvgElement();
  if (!svgEl) return;

  const selectedFormat = String(
    formatOverride || document.getElementById('single-export-format')?.value || 'png'
  ).toLowerCase();
  const baseName = getSingleScatterBaseName();

  try {
    const svgString = serializeSingleScatterSvg(svgEl);

    if (selectedFormat === 'svg') {
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(svgBlob, `${baseName}.svg`);
      return;
    }

    const { canvas, width, height } = await renderSvgToCanvas(svgString, svgEl, 2);

    if (selectedFormat === 'png') {
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          alert('Error exporting chart PNG.');
          return;
        }
        downloadBlob(pngBlob, `${baseName}.png`);
      }, 'image/png');
      return;
    }

    if (selectedFormat === 'pdf') {
      const jsPdfApi = window.jspdf && window.jspdf.jsPDF;
      if (!jsPdfApi) {
        alert('Libreria PDF non disponibile. Ricarica la pagina e riprova.');
        return;
      }

      const imgData = canvas.toDataURL('image/png');
      const pxToPt = (px) => (px * 72) / 96;
      const pageW = Math.max(1, pxToPt(width));
      const pageH = Math.max(1, pxToPt(height));
      const pdf = new jsPdfApi({
        orientation: pageW >= pageH ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [pageW, pageH],
      });
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH);
      pdf.save(`${baseName}.pdf`);
      return;
    }

    alert('Formato export non supportato.');
  } catch (e) {
    console.error('Error exporting single chart', e);
    alert('Error exporting chart.');
  }
}

function exportSingleScatterJpeg() {
  exportSingleScatter('png');
}

let singleGridModalMode = 'export';

function openSingleGridExportModal(mode = 'export') {
  singleGridModalMode = String(mode || 'export').toLowerCase() === 'web' ? 'web' : 'export';
  const modal = document.getElementById('single-grid-export-modal');
  const listEl = document.getElementById('single-grid-fields-list');
  const titleEl = document.getElementById('single-grid-export-title');
  const exportBtn = document.getElementById('single-grid-modal-export-btn');
  const webBtn = document.getElementById('single-grid-modal-open-page-btn');
  if (!modal || !listEl) return;

  listEl.innerHTML = '';
  SINGLE_SELECT_OPTIONS.forEach((opt) => {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.fontSize = '13px';
    row.style.color = '#223';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.name = 'single-grid-field';
    chk.value = opt.value;
    chk.checked = true;

    const txt = document.createElement('span');
    txt.textContent = opt.label;

    row.appendChild(chk);
    row.appendChild(txt);
    listEl.appendChild(row);
  });

  if (titleEl) {
    titleEl.textContent = singleGridModalMode === 'web'
      ? 'Apri pagina griglia: selezione campi'
      : 'Export grid: select fields';
  }
  if (exportBtn && webBtn) {
    exportBtn.classList.toggle('btn-primary', singleGridModalMode !== 'web');
    exportBtn.classList.toggle('btn-secondary', singleGridModalMode === 'web');
    webBtn.classList.toggle('btn-primary', singleGridModalMode === 'web');
    webBtn.classList.toggle('btn-secondary', singleGridModalMode !== 'web');
  }

  modal.classList.add('open');
}

function closeSingleGridExportModal() {
  const modal = document.getElementById('single-grid-export-modal');
  if (!modal) return;
  modal.classList.remove('open');
}

function selectAllSingleGridFields(checked) {
  const checks = document.querySelectorAll('#single-grid-fields-list input[name="single-grid-field"]');
  checks.forEach((chk) => {
    chk.checked = !!checked;
  });
}

function confirmSingleGridExport() {
  const selected = collectSelectedSingleGridFields();
  if (!selected) return;
  closeSingleGridExportModal();
  exportSingleGrid(undefined, selected);
}

function confirmSingleGridWebPage() {
  const selected = collectSelectedSingleGridFields();
  if (!selected) return;
  closeSingleGridExportModal();
  openTemporarySingleGridPage(selected);
}

function collectSelectedSingleGridFields() {
  const checks = Array.from(document.querySelectorAll('#single-grid-fields-list input[name="single-grid-field"]:checked'));
  const selected = checks.map((c) => String(c.value || '').trim()).filter(Boolean);
  if (!selected.length) {
    alert('Select at least one field to export.');
    return null;
  }
  return selected;
}

async function buildSingleGridMatrixData(selectedMetricKeys) {
  if ((!lastAnalysisResults || !lastAnalysisResults.length) && (!lastAnalysisFailedEntries || !lastAnalysisFailedEntries.length)) {
    alert('No results to export. Run an analysis first.');
    return null;
  }

  const availableOptions = Array.isArray(SINGLE_SELECT_OPTIONS) ? SINGLE_SELECT_OPTIONS : [];
  const availableMetricKeys = availableOptions.map((o) => o.value);
  const selectedSet = new Set(
    Array.isArray(selectedMetricKeys) && selectedMetricKeys.length
      ? selectedMetricKeys.map((v) => String(v || '').trim()).filter(Boolean)
      : availableMetricKeys
  );
  const filteredOptions = availableOptions.filter((o) => selectedSet.has(o.value));
  const metrics = filteredOptions.map((o) => o.value);
  const metricLabels = filteredOptions.map((o) => o.label);

  if (!metrics.length) {
    alert('No metrics available for the grid.');
    return null;
  }

  const cols = metrics.length;
  const rows = metrics.length;
  const pad = 24;
  const labelColWidth = 140;
  const labelRowHeight = 56;

  // Use exactly the custom single-chart dimensions selected by the user.
  const { widthPx, heightPx } = getSingleChartDimensionsPx();
  const { xRatio, yRatio } = getSingleAxisProportions();
  const cellW = Math.max(320, Math.round(widthPx * xRatio));
  const cellH = Math.max(240, Math.round(heightPx * yRatio));
  const gridW = labelColWidth + (cols * cellW) + (cols + 1) * pad;
  const gridH = labelRowHeight + (rows * cellH) + (rows + 1) * pad;

  // Save original single-chart controls to restore later
  const sx = document.getElementById('single-x-select');
  const sy = document.getElementById('single-y-select');
  const sc = document.getElementById('single-color-select');
  const ss = document.getElementById('single-size-select');
  const legendChk = document.getElementById('analysis-show-legend');
  const orig = {
    x: sx?.value,
    y: sy?.value,
    c: sc?.value,
    s: ss?.value,
    legend: legendChk ? !!legendChk.checked : true,
  };

  // Hide legend and force simple styling for small multiples
  if (legendChk) legendChk.checked = false;

  const svgImages = [];
  try {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const metricY = metrics[i];
        const metricX = metrics[j];

        if (sx) sx.value = metricX;
        if (sy) sy.value = metricY;
        if (sc) sc.value = 'none';
        if (ss) ss.value = 'none';

        // redraw into the single-chart container and capture
        redrawSingleScatter();
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 40));

        const container = document.getElementById('analysis-single-scatter');
        const svgEl = container ? container.querySelector('svg') : null;
        const title = `${getMetricLabelByKey(metricX)} vs ${getMetricLabelByKey(metricY)}`;
        if (!svgEl) {
          svgImages.push({ svg: null, w: cellW, h: cellH, title });
          continue;
        }
        const svgString = serializeSingleScatterSvg(svgEl);
        const svgW = Number(svgEl.getAttribute('width')) || cellW;
        const svgH = Number(svgEl.getAttribute('height')) || cellH;
        svgImages.push({ svg: svgString, w: svgW, h: svgH, title });
      }
    }
  } finally {
    // restore originals
    if (sx) sx.value = orig.x;
    if (sy) sy.value = orig.y;
    if (sc) sc.value = orig.c;
    if (ss) ss.value = orig.s;
    if (legendChk) legendChk.checked = orig.legend;
    redrawSingleScatter();
  }

  return {
    metrics,
    metricLabels,
    cols,
    rows,
    pad,
    labelColWidth,
    labelRowHeight,
    cellW,
    cellH,
    gridW,
    gridH,
    svgImages,
  };
}

function buildSingleGridMatrixSvg(matrixData) {
  const {
    metrics,
    metricLabels,
    cols,
    rows,
    pad,
    labelColWidth,
    labelRowHeight,
    cellW,
    cellH,
    gridW,
    gridH,
    svgImages,
  } = matrixData;

  // Build outer SVG that arranges all small scatter svgs
  const outerParts = [];
  outerParts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${gridW}" height="${gridH}">`);
  outerParts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // top headers
  for (let j = 0; j < cols; j++) {
    const label = esc(metricLabels[j] || metrics[j]);
    const x = labelColWidth + pad + j * (cellW + pad) + Math.round(cellW / 2);
    const y = Math.round(pad + 14);
    outerParts.push(`<text x="${x}" y="${y}" font-size="12" text-anchor="middle" fill="#222">${label}</text>`);
  }

  // left headers
  for (let i = 0; i < rows; i++) {
    const label = esc(metricLabels[i] || metrics[i]);
    const x = Math.round(labelColWidth / 2);
    const y = labelRowHeight + pad + i * (cellH + pad) + Math.round(cellH / 2);
    outerParts.push(`<text x="${x}" y="${y}" font-size="12" text-anchor="middle" dominant-baseline="middle" fill="#222">${label}</text>`);
  }

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const idx = i * cols + j;
      const it = svgImages[idx];
      const x0 = labelColWidth + pad + j * (cellW + pad);
      const y0 = labelRowHeight + pad + i * (cellH + pad);
      if (!it || !it.svg) {
        outerParts.push(`<rect x="${x0}" y="${y0}" width="${cellW}" height="${cellH}" fill="#f7f7f7" stroke="#ddd" />`);
        outerParts.push(`<text x="${x0 + Math.round(cellW/2)}" y="${y0 + Math.round(cellH/2)}" font-size="11" text-anchor="middle" dominant-baseline="middle" fill="#666">${esc(it ? it.title : 'n.d.')}</text>`);
        continue;
      }
      const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(it.svg);
      const clipId = `grid-cell-clip-${i}-${j}`;
      outerParts.push(`<clipPath id="${clipId}"><rect x="${x0}" y="${y0}" width="${cellW}" height="${cellH}" /></clipPath>`);
      outerParts.push(`<rect x="${x0}" y="${y0}" width="${cellW}" height="${cellH}" fill="#fff" stroke="#ddd" />`);
      outerParts.push(`<image x="${x0}" y="${y0}" width="${it.w}" height="${it.h}" clip-path="url(#${clipId})" href="${dataUri}" xlink:href="${dataUri}" />`);
    }
  }
  outerParts.push(`</svg>`);
  return outerParts.join('');
}

async function openTemporarySingleGridPage(selectedMetricKeys) {
  const matrixData = await buildSingleGridMatrixData(selectedMetricKeys);
  if (!matrixData) return;

  const {
    metrics,
    metricLabels,
    cols,
    rows,
    cellW,
    cellH,
    svgImages,
  } = matrixData;

  const tableRows = [];
  tableRows.push('<tr><th class="sticky-col sticky-head"></th>');
  for (let j = 0; j < cols; j++) {
    tableRows.push(`<th class="sticky-head">${esc(metricLabels[j] || metrics[j])}</th>`);
  }
  tableRows.push('</tr>');

  for (let i = 0; i < rows; i++) {
    tableRows.push('<tr>');
    tableRows.push(`<th class="sticky-col">${esc(metricLabels[i] || metrics[i])}</th>`);
    for (let j = 0; j < cols; j++) {
      const idx = i * cols + j;
      const it = svgImages[idx];
      if (!it || !it.svg) {
        tableRows.push(`<td><div class="cell-empty" style="width:${cellW}px;height:${cellH}px;">n.d.</div></td>`);
        continue;
      }
      const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(it.svg);
      tableRows.push(
        `<td>` +
        `<div class="cell-wrap" style="width:${cellW}px;height:${cellH}px;">` +
        `<img class="cell-chart" src="${dataUri}" alt="${esc(it.title)}" data-title="${esc(it.title)}" style="width:${it.w}px;height:${it.h}px;">` +
        `</div>` +
        `</td>`
      );
    }
    tableRows.push('</tr>');
  }

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Custom Chart Matrix</title>
  <style>
    body { margin:0; font-family: Segoe UI, Arial, sans-serif; background:#f4f6fb; color:#1f2a44; }
    .topbar { position:sticky; top:0; z-index:20; background:#fff; border-bottom:1px solid #dbe1f1; padding:10px 14px; display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .topbar small { color:#56617d; }
    .matrix-wrap { height: calc(100vh - 58px); overflow:auto; padding:10px; }
    table { border-collapse: separate; border-spacing: 8px; }
    th, td { vertical-align: middle; }
    th { background:#eef2ff; color:#20305a; border:1px solid #d5ddf3; border-radius:8px; padding:8px 10px; font-size:12px; white-space:nowrap; }
    .sticky-head { position: sticky; top: 0; z-index: 12; }
    .sticky-col { position: sticky; left: 0; z-index: 11; }
    .sticky-col.sticky-head { z-index: 14; }
    .cell-wrap { overflow:hidden; border:1px solid #d8deee; border-radius:10px; background:#fff; }
    .cell-chart { display:block; cursor: zoom-in; }
    .cell-empty { display:flex; align-items:center; justify-content:center; border:1px dashed #c5cde2; border-radius:10px; color:#6a7591; background:#fafbff; }
    .lightbox { position: fixed; inset: 0; background: rgba(7,12,24,.78); display:none; align-items:center; justify-content:center; z-index: 50; }
    .lightbox.open { display:flex; }
    .lightbox-inner { max-width: 96vw; max-height: 96vh; background:#fff; border-radius:10px; padding:10px; box-shadow:0 20px 50px rgba(0,0,0,.35); }
    .lightbox-title { margin:0 0 8px; font-size:13px; color:#243457; }
    .lightbox-img { max-width: 92vw; max-height: 86vh; display:block; }
    .close-btn { margin-top:8px; padding:7px 10px; border:1px solid #d0d7ea; border-radius:7px; background:#f7f9ff; cursor:pointer; }
  </style>
</head>
<body>
  <div class="topbar">
    <div><strong>Custom chart matrix</strong></div>
    <small>${rows} x ${cols} charts. Click a chart to enlarge it.</small>
  </div>
  <div class="matrix-wrap">
    <table>
      ${tableRows.join('')}
    </table>
  </div>
  <div id="sg-lightbox" class="lightbox">
    <div class="lightbox-inner">
      <p id="sg-lightbox-title" class="lightbox-title"></p>
      <img id="sg-lightbox-img" class="lightbox-img" alt="Chart detail">
      <button id="sg-lightbox-close" class="close-btn" type="button">Chiudi</button>
    </div>
  </div>
  <script>
    (function () {
      const box = document.getElementById('sg-lightbox');
      const boxImg = document.getElementById('sg-lightbox-img');
      const boxTitle = document.getElementById('sg-lightbox-title');
      const closeBtn = document.getElementById('sg-lightbox-close');

      document.querySelectorAll('.cell-chart').forEach((img) => {
        img.addEventListener('click', () => {
          boxImg.src = img.src;
          boxTitle.textContent = img.dataset.title || '';
          box.classList.add('open');
        });
      });

      function closeLightbox() { box.classList.remove('open'); }
      closeBtn.addEventListener('click', closeLightbox);
      box.addEventListener('click', (e) => { if (e.target === box) closeLightbox(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
    })();
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (!opened) {
    alert('Popup blocked by the browser. Enable popups to open the temporary page.');
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

async function exportSingleGrid(formatOverride, selectedMetricKeys) {
  const matrixData = await buildSingleGridMatrixData(selectedMetricKeys);
  if (!matrixData) return;

  const selectedFormat = String(
    formatOverride || document.getElementById('single-export-format')?.value || 'png'
  ).toLowerCase();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `analysis_single_matrix_${ts}`;
  const outerSvg = buildSingleGridMatrixSvg(matrixData);

  try {
    if (selectedFormat === 'svg') {
      const blob = new Blob([outerSvg], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(blob, `${baseName}.svg`);
      return;
    }

    const temp = document.createElement('div');
    temp.style.position = 'absolute';
    temp.style.left = '-10000px';
    temp.style.top = '0';
    temp.style.visibility = 'hidden';
    temp.innerHTML = outerSvg;
    document.body.appendChild(temp);
    const outerSvgEl = temp.querySelector('svg');
    const { canvas, width, height } = await renderSvgToCanvas(outerSvg, outerSvgEl, 1.2);

    if (selectedFormat === 'png') {
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          alert('Error exporting grid PNG.');
          return;
        }
        downloadBlob(pngBlob, `${baseName}.png`);
      }, 'image/png');
    } else if (selectedFormat === 'pdf') {
      const jsPdfApi = window.jspdf && window.jspdf.jsPDF;
      if (!jsPdfApi) {
        alert('Libreria PDF non disponibile. Ricarica la pagina e riprova.');
        return;
      }
      const imgData = canvas.toDataURL('image/png');
      const pxToPt = (px) => (px * 72) / 96;
      const pageW = Math.max(1, pxToPt(width));
      const pageH = Math.max(1, pxToPt(height));
      const pdf = new jsPdfApi({ orientation: pageW >= pageH ? 'landscape' : 'portrait', unit: 'pt', format: [pageW, pageH] });
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH);
      pdf.save(`${baseName}.pdf`);
    } else {
      alert('Formato export non supportato.');
    }

    document.body.removeChild(temp);
  } catch (e) {
    console.error('Error exporting matrix grid', e);
    alert('Error exporting grid.');
  }
}

async function runAnalysis() {
  const msg = document.getElementById('analysis-msg');
  const err = document.getElementById('analysis-error');
  const btn = document.getElementById('analyze-btn');

  const selectedPipelineSaves = Array.from(document.getElementById('pipeline-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);
  const selectedQueueSaves = Array.from(document.getElementById('queue-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);
  const selectedImportedSetSaves = Array.from(document.getElementById('imported-set-saves').selectedOptions)
    .map(o => o.value)
    .filter(Boolean);

  const requests = [
    ...selectedPipelineSaves.map(saveFileName => ({ targetType: 'pipeline', saveFileName })),
    ...selectedQueueSaves.map(saveFileName => ({ targetType: 'queue', saveFileName })),
    ...selectedImportedSetSaves.map(saveFileName => ({ targetType: 'imported-set', saveFileName })),
  ];

  if (!requests.length) {
    err.textContent = 'Select at least one pipeline, queue, or imported graph-set result.';
    err.style.display = 'block';
    return;
  }

  err.style.display = 'none';
  msg.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Analysis in progress...';

  try {
    const analysisResponses = await Promise.all(requests.map(async (payload) => {
      const r = await fetch('/analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok || data.error) {
        return { results: [], errors: [{ source: payload.saveFileName, error: data.error || 'Analysis error' }] };
      }
      return data;
    }));

    const mergedResults = [];
    const mergedErrors = [];
    analysisResponses.forEach((resp) => {
      (resp.results || []).forEach((r) => mergedResults.push(r));
      (resp.errors || []).forEach((e) => mergedErrors.push(e));
    });

    // Dedupe by pipeline save file to avoid repeated rows when queue includes selected pipeline.
    const dedupMap = new Map();
    mergedResults.forEach((r) => dedupMap.set(r.pipelineSaveFile, r));
    lastAnalysisResults = Array.from(dedupMap.values());

    const failedPipelineFiles = Array.from(new Set(
      mergedErrors
        .map((e) => String(e.pipelineSaveFile || '').trim())
        .filter((f) => f && f.endsWith('.json'))
    ));

    const failedEntries = [];
    await Promise.all(failedPipelineFiles.map(async (fileName) => {
      try {
        const r = await fetch(`/analysis/pipelines/${encodeURIComponent(fileName)}/basic-metrics`);
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || 'Error fetching basic metrics');

        const relatedErrors = mergedErrors
          .filter((e) => String(e.pipelineSaveFile || '').trim() === fileName)
          .map((e) => String(e.error || '').trim())
          .filter(Boolean);

        failedEntries.push({
          pipelineSaveFile: fileName,
          graphJsonId: data.graphJsonId || null,
          graphSetName: data.graphSetName || null,
          graphSetGraphId: data.graphSetGraphId || null,
          metrics: data.metrics || {},
          error: relatedErrors.join(' | ') || 'Solution unavailable',
        });
      } catch (_) {
        // Ignore entries that cannot be resolved to graph metrics.
      }
    }));

    const importedSetNameBySave = new Map(
      (savedItems.importedSets || []).map((item) => [String(item.fileName || ''), String(item.setName || '')])
    );

    const importedEntries = [];
    await Promise.all(analysisResponses.map(async (resp, idx) => {
      const req = requests[idx] || {};
      if (req.targetType !== 'imported-set') return;

      const setName = String(resp.setName || importedSetNameBySave.get(String(req.saveFileName || '')) || '').trim();
      if (!setName) return;

      const errorByGraphId = new Map();
      (resp.errors || []).forEach((e) => {
        const graphId = extractImportedSetGraphId(e && e.pipelineSaveFile, setName);
        if (!graphId) return;
        const prev = errorByGraphId.get(graphId);
        const msg = String((e && e.error) || 'Solution unavailable').trim();
        errorByGraphId.set(graphId, prev ? `${prev} | ${msg}` : msg);
      });

      const failedStatusByGraphId = new Map();
      try {
        const rSet = await fetch(`/graph-sets/${encodeURIComponent(setName)}`);
        const setData = await rSet.json();
        if (rSet.ok && !setData.error && Array.isArray(setData.graphs)) {
          setData.graphs
            .filter((g) => !['completed', 'ok', 'success'].includes(String(g.status || '').toLowerCase()))
            .forEach((g) => {
              const gid = String(g.id || '').trim();
              if (!gid) return;
              failedStatusByGraphId.set(gid, String(g.status || 'not-completed').toLowerCase());
            });
        }
      } catch (_) {
        // If set details cannot be fetched, keep imported-set error derived entries only.
      }

      const graphIds = new Set([
        ...Array.from(errorByGraphId.keys()),
        ...Array.from(failedStatusByGraphId.keys()),
      ]);

      await Promise.all(Array.from(graphIds).map(async (graphId) => {
        try {
          const rGraph = await fetch(`/graph-sets/${encodeURIComponent(setName)}/graphs/${encodeURIComponent(graphId)}`);
          const graphJson = await rGraph.json();
          if (!rGraph.ok || graphJson.error) return;

          const metrics = computeBasicMetricsFromGraphJsonClient(graphJson);
          if (!metrics) return;

          const status = failedStatusByGraphId.get(graphId);
          const fallbackErr = status ? `Execution status: ${status}` : 'Solution unavailable';
          const errMsg = errorByGraphId.get(graphId) || fallbackErr;

          importedEntries.push({
            pipelineSaveFile: `imported_set_${setName}_${graphId}`,
            graphJsonId: null,
            graphSetName: setName,
            graphSetGraphId: graphId,
            metrics,
            error: errMsg,
          });
        } catch (_) {
          // Ignore imported-set graph failures that cannot be resolved.
        }
      }));
    }));

    const dedupFailed = new Map();
    [...failedEntries, ...importedEntries].forEach((entry) => {
      const key = entry.graphSetName && entry.graphSetGraphId
        ? `set:${entry.graphSetName}:${entry.graphSetGraphId}`
        : `pipe:${entry.pipelineSaveFile}`;
      dedupFailed.set(key, entry);
    });
    lastAnalysisFailedEntries = Array.from(dedupFailed.values());

    renderTable(lastAnalysisResults);
    renderDatasetStats(lastAnalysisResults, lastAnalysisFailedEntries);
    renderAllAnalysisCharts(lastAnalysisResults);

    const errCount = mergedErrors.length;
    const baseMsg = `Analysis completed: ${lastAnalysisResults.length} result(s).`;
    msg.textContent = errCount > 0 ? `${baseMsg} Errori: ${errCount}.` : baseMsg;
    msg.style.display = 'block';

    if (errCount > 0) {
      console.warn('Analysis with errors', mergedErrors);
    }
  } catch (e) {
    lastAnalysisFailedEntries = [];
    renderDatasetStats([], []);
    err.textContent = 'Error: ' + e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analizza';
  }
}

async function init() {
  await loadWorkflowRegistry();
  await loadSavedItems();
  await loadAnalysisSnapshots();

  const gridExportModal = document.getElementById('single-grid-export-modal');
  if (gridExportModal) {
    gridExportModal.addEventListener('click', (evt) => {
      if (evt.target === gridExportModal) closeSingleGridExportModal();
    });
  }
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') closeSingleGridExportModal();
  });

  initSingleStrokeColorSync();

  const execControlIds = [
    'analysis-point-mode',
    'analysis-overlap-slider',
    'analysis-attract-slider',
    'analysis-show-completed',
    'analysis-show-failed',
    'analysis-show-legend',
    'analysis-foreground-layer',
    'analysis-failed-color',
    'analysis-failed-shape',
    'exec-scale-mode',
    'exec-scale-mode-edges',
    'exec-scale-mode-degree',
    'exec-cap-time',
    'exec-cap-time-edges',
    'exec-cap-time-degree',
    'single-x-select',
    'single-y-select',
    'single-custom-x-label',
    'single-custom-y-label',
    'single-custom-color-label',
    'single-custom-legend-completed-label',
    'single-custom-legend-failed-label',
    'single-color-select',
    'single-size-select',
    'single-point-mode',
    'single-enable-bucketing',
    'single-bucket-size',
    'single-bucket-start',
    'single-ci-area-fill-color',
    'single-ci-area-stroke-color',
    'single-ci-median-color',
    'single-ci-p25-color',
    'single-ci-p75-color',
    'single-ci-outlier-fill-color',
    'single-ci-outlier-stroke-color',
    'single-ci-area-stroke-width',
    'single-ci-median-width',
    'single-ci-p25-width',
    'single-ci-p75-width',
    'single-ci-outlier-stroke-width',
    'single-ci-outlier-opacity',
    'single-ci-outlier-shape',
    'single-ci-outlier-size-multiplier',
    'single-ci-outlier-extremes-only',
    'single-point-opacity',
    'single-point-fill-mode',
    'single-point-stroke-color-completed',
    'single-point-stroke-color-failed',
    'single-hex-color',
    'single-axis-ratio-x',
    'single-axis-ratio-y',
    'single-point-size-base',
    'single-show-completed',
    'single-show-failed',
    'single-show-legend',
    'single-show-color-legend',
    'single-foreground-layer',
    'single-failed-color',
    'single-failed-shape',
    'single-hide-axis-names',
    'single-hide-axis-x',
    'single-hide-axis-y',
    'single-max-time-cap',
    'single-chart-size-unit',
    'single-chart-width',
    'single-chart-height',
    'single-tick-font-size',
    'single-axis-name-font-size',
    'single-axis-tick-interval-x',
    'single-axis-tick-interval-y',
    'single-axis-tick-start-x',
    'single-axis-tick-start-y',
    'single-axis-tick-max-x',
    'single-axis-tick-max-y',
    'single-legend-font-size',
    'single-color-scale-values-font-size',
  ];
  execControlIds.forEach((controlId) => {
    const control = document.getElementById(controlId);
    if (!control) return;
    const eventName = control.tagName === 'INPUT' ? 'input' : 'change';
    control.addEventListener(eventName, () => {
      updatePointTuningLabels();
      updatePointTuningVisibility();
      updateSingleBucketingControls();
      if (lastAnalysisResults && lastAnalysisResults.length) {
        renderAllAnalysisCharts(lastAnalysisResults);
        renderSingleScatter(lastAnalysisResults);
      }
    });
  });

  // populate and initialize single-selects
  populateSingleSelects();
  singleChartDefaultConfigSnapshot = readSingleChartConfigFromControls();
  const savedSingleChartConfig = loadSavedSingleChartConfig();
  if (savedSingleChartConfig) applySingleChartConfig(savedSingleChartConfig);

  // initial render for single scatter if results exist
  if (lastAnalysisResults && lastAnalysisResults.length) renderSingleScatter(lastAnalysisResults);

  updatePointTuningLabels();
  updatePointTuningVisibility();
  updateSingleBucketingControls();
}

init();
