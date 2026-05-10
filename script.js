const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const canvasSurface = document.getElementById("canvas-surface");

const radiusAInput = document.getElementById("radius-a");
const radiusBInput = document.getElementById("radius-b");
const speedInput = document.getElementById("speed-input");
const modeHypoInput = document.getElementById("mode-hypo");
const modeEpiInput = document.getElementById("mode-epi");
const traceOnlyToggle = document.getElementById("trace-only-toggle");

const radiusAValue = document.getElementById("radius-a-value");
const radiusBValue = document.getElementById("radius-b-value");
const speedValue = document.getElementById("speed-value");
const ratioInfo = document.getElementById("ratio-info");
const pointInfo = document.getElementById("point-info");
const modeInfo = document.getElementById("mode-info");
const speedInfo = document.getElementById("speed-info");
const viewInfo = document.getElementById("view-info");
const statusInfo = document.getElementById("status-info");

const startButton = document.getElementById("start-button");
const resetButton = document.getElementById("reset-button");
const saveControls = document.getElementById("save-controls");
const saveButton = document.getElementById("save-button");
const saveMenu = document.getElementById("save-menu");
const saveWithGridButton = document.getElementById("save-with-grid");
const saveWithoutGridButton = document.getElementById("save-without-grid");

const DEFAULT_SPEED = 0.02;
const MAX_TRACE_POINTS = 8000;
const RATIONAL_TOLERANCE = 1e-10;
const MAX_RATIONAL_DENOMINATOR = 2000;
const EXPORT_SCALE = 2;
const CANVAS_BG = "#fffdf8";

const CURVE_CONFIGS = {
  hypo: {
    label: "하이포사이클로이드",
    shortLabel: "H",
    traceColor: "#bf5b36",
    guideColor: "#0f8c94",
    pointColor: "#bf5b36",
    spokeColor: "rgba(15, 140, 148, 0.55)"
  },
  epi: {
    label: "에피사이클로이드",
    shortLabel: "E",
    traceColor: "#2456a5",
    guideColor: "#2b9a72",
    pointColor: "#2456a5",
    spokeColor: "rgba(43, 154, 114, 0.55)"
  }
};

let animationFrame = null;
let running = false;
let theta = 0;
let loopClosed = false;
let traces = createEmptyTraces();
let resizeObserver = null;
let state = {
  a: 4,
  b: 1,
  speed: DEFAULT_SPEED,
  showHypo: true,
  showEpi: false,
  traceOnly: false,
  status: "유효한 식입니다."
};

function createEmptyTraces() {
  return {
    hypo: [],
    epi: []
  };
}

function fitCanvas() {
  const rect = canvasSurface.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(320, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  renderToCanvas();
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) {
    return value.toExponential(4);
  }

  return Number(value.toFixed(4)).toString();
}

function evaluateExpression(input) {
  const normalized = input.trim().toLowerCase().replaceAll("π", "pi");
  if (!normalized) {
    throw new Error("빈 입력");
  }

  const tokenPattern = /(sqrt|pi|e|\d*\.\d+|\d+|[()+\-*/])/g;
  const tokens = normalized.match(tokenPattern);

  if (!tokens || tokens.join("") !== normalized.replace(/\s+/g, "")) {
    throw new Error("허용되지 않는 문자");
  }

  const expression = tokens
    .map((token) => {
      if (token === "pi") {
        return "Math.PI";
      }
      if (token === "e") {
        return "Math.E";
      }
      if (token === "sqrt") {
        return "Math.sqrt";
      }
      return token;
    })
    .join("");

  const value = Function(`"use strict"; return (${expression});`)();

  if (!Number.isFinite(value)) {
    throw new Error("유한한 수가 아닙니다.");
  }

  return value;
}

function getActiveModes() {
  const modes = [];
  if (state.showHypo) {
    modes.push("hypo");
  }
  if (state.showEpi) {
    modes.push("epi");
  }
  return modes;
}

function getValues() {
  return {
    a: state.a,
    b: state.b,
    speed: state.speed
  };
}

function getModeLabel(modes = getActiveModes()) {
  if (modes.length === 2) {
    return "하이포사이클로이드 + 에피사이클로이드";
  }

  if (modes.length === 1) {
    return CURVE_CONFIGS[modes[0]].label;
  }

  return "선택된 모드 없음";
}

function getTraceOnlyView() {
  return state.traceOnly && !running;
}

function getViewLabel() {
  if (running) {
    return "실행 중: 원과 자취 함께 보기";
  }

  if (state.traceOnly) {
    return "정지 중: 자취만 보기";
  }

  return "정지 중: 원과 자취 함께 보기";
}

function updateControlAvailability() {
  traceOnlyToggle.disabled = running;
}

function updateLabels() {
  const { a, b, speed } = getValues();
  radiusAValue.textContent = formatNumber(a);
  radiusBValue.textContent = formatNumber(b);
  speedValue.textContent = formatNumber(speed);
  ratioInfo.textContent = `a : b = ${formatNumber(a)} : ${formatNumber(b)}`;
  pointInfo.textContent = `(${formatNumber(a)}, 0)`;
  modeInfo.textContent = getModeLabel();
  speedInfo.textContent = `${formatNumber(speed)} rad/frame`;
  viewInfo.textContent = getViewLabel();
  statusInfo.textContent = state.status;
}

function setSaveMenu(open) {
  saveMenu.hidden = !open;
  saveButton.setAttribute("aria-expanded", String(open));
}

function stopAnimation() {
  running = false;
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  startButton.textContent = "시작";
  updateControlAvailability();
}

function closeLoopAnimation() {
  stopAnimation();
  loopClosed = true;
  state = {
    ...state,
    status: "선택한 곡선이 한 주기를 마쳐 정지했습니다."
  };
  updateLabels();
  renderToCanvas();
}

function syncStateFromInputs() {
  let nextA = state.a;
  let nextB = state.b;
  let nextSpeed = state.speed;
  const nextShowHypo = modeHypoInput.checked;
  const nextShowEpi = modeEpiInput.checked;
  const nextTraceOnly = traceOnlyToggle.checked;
  let status = "유효한 식입니다.";
  let valid = true;

  try {
    nextA = evaluateExpression(radiusAInput.value);
    radiusAInput.classList.remove("invalid");
  } catch (error) {
    valid = false;
    radiusAInput.classList.add("invalid");
    status = "a 식을 해석할 수 없습니다.";
  }

  try {
    nextB = evaluateExpression(radiusBInput.value);
    radiusBInput.classList.remove("invalid");
  } catch (error) {
    valid = false;
    radiusBInput.classList.add("invalid");
    if (status === "유효한 식입니다.") {
      status = "b 식을 해석할 수 없습니다.";
    }
  }

  try {
    nextSpeed = evaluateExpression(speedInput.value);
    speedInput.classList.remove("invalid");
  } catch (error) {
    valid = false;
    speedInput.classList.add("invalid");
    if (status === "유효한 식입니다.") {
      status = "속도 식을 해석할 수 없습니다.";
    }
  }

  if (valid && nextA <= 0) {
    valid = false;
    radiusAInput.classList.add("invalid");
    status = "a는 0보다 커야 합니다.";
  }

  if (valid && nextB <= 0) {
    valid = false;
    radiusBInput.classList.add("invalid");
    status = "b는 0보다 커야 합니다.";
  }

  if (valid && nextSpeed <= 0) {
    valid = false;
    speedInput.classList.add("invalid");
    status = "속도는 0보다 커야 합니다.";
  }

  if (valid && !nextShowHypo && !nextShowEpi) {
    valid = false;
    status = "적어도 한 모드는 선택해야 합니다.";
  }

  if (valid && nextShowHypo && nextB >= nextA) {
    valid = false;
    radiusBInput.classList.add("invalid");
    status = "하이포사이클로이드에서는 항상 b < a 이어야 합니다.";
  }

  if (valid) {
    state = {
      ...state,
      a: nextA,
      b: nextB,
      speed: nextSpeed,
      showHypo: nextShowHypo,
      showEpi: nextShowEpi,
      traceOnly: nextTraceOnly,
      status
    };
    radiusAInput.classList.remove("invalid");
    radiusBInput.classList.remove("invalid");
    speedInput.classList.remove("invalid");
    return true;
  }

  state = {
    ...state,
    showHypo: nextShowHypo,
    showEpi: nextShowEpi,
    traceOnly: nextTraceOnly,
    status
  };
  return false;
}

function resetTrace() {
  theta = 0;
  traces = createEmptyTraces();
  loopClosed = false;
}

function approximateRational(value, maxDenominator = MAX_RATIONAL_DENOMINATOR) {
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Infinity;

  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(value * denominator);
    const error = Math.abs(value - numerator / denominator);

    if (error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }

    if (error <= RATIONAL_TOLERANCE) {
      return { numerator, denominator };
    }
  }

  if (bestError <= RATIONAL_TOLERANCE) {
    return { numerator: bestNumerator, denominator: bestDenominator };
  }

  return null;
}

function getCycleAngle(a, b) {
  const ratio = a / b;
  const approximation = approximateRational(ratio);

  if (!approximation) {
    return null;
  }

  return Math.PI * 2 * approximation.denominator;
}

function getSceneRadius(a, b, activeModes) {
  let sceneRadius = a;

  if (activeModes.includes("epi")) {
    sceneRadius = Math.max(sceneRadius, a + 2 * b);
  }

  return sceneRadius;
}

function getSceneScale(width, height, a, b, activeModes) {
  const margin = 36;
  const sceneRadius = getSceneRadius(a, b, activeModes);

  return Math.min(
    (width - margin * 2) / (sceneRadius * 2),
    (height - margin * 2) / (sceneRadius * 2)
  );
}

function getCurveGeometry(mode, a, b, scale, angle) {
  const bigR = a * scale;
  const smallR = b * scale;

  if (mode === "hypo") {
    const orbitR = (a - b) * scale;
    const cx = orbitR * Math.cos(angle);
    const cy = -orbitR * Math.sin(angle);
    const rotation = ((a - b) / b) * angle;
    const px = cx + smallR * Math.cos(rotation);
    const py = cy + smallR * Math.sin(rotation);

    return { bigR, smallR, orbitR, cx, cy, px, py };
  }

  const orbitR = (a + b) * scale;
  const cx = orbitR * Math.cos(angle);
  const cy = -orbitR * Math.sin(angle);
  const rotation = ((a + b) / b) * angle;
  const px = cx - smallR * Math.cos(rotation);
  const py = cy + smallR * Math.sin(rotation);

  return { bigR, smallR, orbitR, cx, cy, px, py };
}

function drawGrid(targetCtx, width, height, centerX, centerY) {
  targetCtx.save();
  targetCtx.strokeStyle = "rgba(92, 72, 50, 0.12)";
  targetCtx.lineWidth = 1;

  const step = 44;
  for (let x = centerX % step; x <= width; x += step) {
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x, height);
    targetCtx.stroke();
  }

  for (let y = centerY % step; y <= height; y += step) {
    targetCtx.beginPath();
    targetCtx.moveTo(0, y);
    targetCtx.lineTo(width, y);
    targetCtx.stroke();
  }

  targetCtx.strokeStyle = "rgba(47, 36, 27, 0.35)";
  targetCtx.lineWidth = 1.4;
  targetCtx.beginPath();
  targetCtx.moveTo(0, centerY);
  targetCtx.lineTo(width, centerY);
  targetCtx.moveTo(centerX, 0);
  targetCtx.lineTo(centerX, height);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawTrace(targetCtx, points, color) {
  if (points.length < 2) {
    return;
  }

  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    targetCtx.lineTo(points[i].x, points[i].y);
  }
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = 3;
  targetCtx.stroke();
}

function renderScene(targetCtx, width, height, options = {}) {
  const { showGrid = true, showGuides = true } = options;
  const activeModes = getActiveModes();

  targetCtx.clearRect(0, 0, width, height);
  targetCtx.fillStyle = CANVAS_BG;
  targetCtx.fillRect(0, 0, width, height);

  if (activeModes.length === 0) {
    return;
  }

  const { a, b } = getValues();
  const scale = getSceneScale(width, height, a, b, activeModes);
  const centerX = width / 2;
  const centerY = height / 2;

  if (showGrid) {
    drawGrid(targetCtx, width, height, centerX, centerY);
  }

  const geometries = {};
  for (const mode of activeModes) {
    geometries[mode] = getCurveGeometry(mode, a, b, scale, theta);
  }

  targetCtx.save();
  targetCtx.translate(centerX, centerY);

  for (const mode of activeModes) {
    drawTrace(targetCtx, traces[mode], CURVE_CONFIGS[mode].traceColor);
  }

  if (showGuides) {
    const bigR = geometries[activeModes[0]].bigR;

    targetCtx.beginPath();
    targetCtx.arc(0, 0, bigR, 0, Math.PI * 2);
    targetCtx.strokeStyle = "#2f241b";
    targetCtx.lineWidth = 2.4;
    targetCtx.stroke();

    for (const mode of activeModes) {
      const config = CURVE_CONFIGS[mode];
      const geometry = geometries[mode];

      targetCtx.beginPath();
      targetCtx.arc(geometry.cx, geometry.cy, geometry.smallR, 0, Math.PI * 2);
      targetCtx.strokeStyle = config.guideColor;
      targetCtx.lineWidth = 2.4;
      targetCtx.stroke();

      targetCtx.beginPath();
      targetCtx.moveTo(geometry.cx, geometry.cy);
      targetCtx.lineTo(geometry.px, geometry.py);
      targetCtx.strokeStyle = config.spokeColor;
      targetCtx.lineWidth = 1.8;
      targetCtx.stroke();

      targetCtx.beginPath();
      targetCtx.arc(geometry.px, geometry.py, 6, 0, Math.PI * 2);
      targetCtx.fillStyle = config.pointColor;
      targetCtx.fill();

      const label = activeModes.length === 1 ? "P" : config.shortLabel;
      const labelOffsetY = activeModes.length === 1 ? -10 : mode === "hypo" ? -12 : 18;
      targetCtx.fillStyle = "#2f241b";
      targetCtx.font = '700 14px "Trebuchet MS", "Avenir Next", sans-serif';
      targetCtx.fillText(label, geometry.px + 10, geometry.py + labelOffsetY);
    }

    targetCtx.beginPath();
    targetCtx.arc(bigR, 0, 4.5, 0, Math.PI * 2);
    targetCtx.fillStyle = "#2f241b";
    targetCtx.fill();
    targetCtx.fillStyle = "#2f241b";
    targetCtx.font = '700 14px "Trebuchet MS", "Avenir Next", sans-serif';
    targetCtx.fillText("(a, 0)", bigR + 10, -10);
  }

  targetCtx.restore();
}

function renderToCanvas(showGrid = true) {
  renderScene(ctx, canvas.clientWidth, canvas.clientHeight, {
    showGrid,
    showGuides: !getTraceOnlyView()
  });
}

function step() {
  const { a, b, speed } = getValues();
  const activeModes = getActiveModes();
  const cycleAngle = getCycleAngle(a, b);
  const nextTheta = theta + speed;
  theta = cycleAngle ? Math.min(nextTheta, cycleAngle) : nextTheta;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = getSceneScale(width, height, a, b, activeModes);

  for (const mode of activeModes) {
    const geometry = getCurveGeometry(mode, a, b, scale, theta);
    traces[mode].push({ x: geometry.px, y: geometry.py });
    if (traces[mode].length > MAX_TRACE_POINTS) {
      traces[mode].shift();
    }
  }

  renderToCanvas();

  if (cycleAngle && theta >= cycleAngle) {
    closeLoopAnimation();
    return;
  }

  animationFrame = window.requestAnimationFrame(step);
}

function handleSceneChange() {
  stopAnimation();
  resetTrace();
  syncStateFromInputs();
  updateLabels();
  setSaveMenu(false);
  renderToCanvas();
}

function startAnimation() {
  if (running) {
    stopAnimation();
    updateLabels();
    renderToCanvas();
    return;
  }

  if (!syncStateFromInputs()) {
    updateLabels();
    renderToCanvas();
    return;
  }

  if (loopClosed) {
    resetTrace();
  }

  running = true;
  startButton.textContent = "일시정지";
  updateControlAvailability();
  updateLabels();
  renderToCanvas();
  animationFrame = window.requestAnimationFrame(step);
}

function handleModeChange(event) {
  if (!modeHypoInput.checked && !modeEpiInput.checked) {
    event.target.checked = true;
    state = {
      ...state,
      status: "적어도 한 모드는 선택해야 합니다."
    };
    updateLabels();
    renderToCanvas();
    return;
  }

  handleSceneChange();
}

function handleTraceOnlyChange() {
  state = {
    ...state,
    traceOnly: traceOnlyToggle.checked
  };
  updateLabels();
  renderToCanvas();
}

function handleReset() {
  stopAnimation();
  resetTrace();
  syncStateFromInputs();
  updateLabels();
  setSaveMenu(false);
  renderToCanvas();
}

function downloadImage(includeGrid) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const exportCanvas = document.createElement("canvas");
  const exportCtx = exportCanvas.getContext("2d");

  exportCanvas.width = width * EXPORT_SCALE;
  exportCanvas.height = height * EXPORT_SCALE;
  exportCtx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, 0, 0);

  renderScene(exportCtx, width, height, {
    showGrid: includeGrid,
    showGuides: !getTraceOnlyView()
  });

  const link = document.createElement("a");
  const modeSlug = getActiveModes().join("-") || "none";
  const gridSlug = includeGrid ? "grid" : "plain";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  link.download = `cycloid-${modeSlug}-${gridSlug}-${timestamp}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  document.body.append(link);
  link.click();
  link.remove();
  setSaveMenu(false);
}

radiusAInput.addEventListener("input", handleSceneChange);
radiusBInput.addEventListener("input", handleSceneChange);
speedInput.addEventListener("input", handleSceneChange);
modeHypoInput.addEventListener("change", handleModeChange);
modeEpiInput.addEventListener("change", handleModeChange);
traceOnlyToggle.addEventListener("change", handleTraceOnlyChange);
startButton.addEventListener("click", startAnimation);
resetButton.addEventListener("click", handleReset);
saveButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setSaveMenu(saveMenu.hidden);
});
saveWithGridButton.addEventListener("click", () => downloadImage(true));
saveWithoutGridButton.addEventListener("click", () => downloadImage(false));
document.addEventListener("click", (event) => {
  if (!saveControls.contains(event.target)) {
    setSaveMenu(false);
  }
});
window.addEventListener("resize", fitCanvas);

if ("ResizeObserver" in window) {
  resizeObserver = new ResizeObserver(() => {
    fitCanvas();
  });
  resizeObserver.observe(canvasSurface);
}

syncStateFromInputs();
updateControlAvailability();
updateLabels();
fitCanvas();
