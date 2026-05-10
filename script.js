const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

const radiusAInput = document.getElementById("radius-a");
const radiusBInput = document.getElementById("radius-b");
const speedInput = document.getElementById("speed-input");
const radiusAValue = document.getElementById("radius-a-value");
const radiusBValue = document.getElementById("radius-b-value");
const speedValue = document.getElementById("speed-value");
const ratioInfo = document.getElementById("ratio-info");
const pointInfo = document.getElementById("point-info");
const speedInfo = document.getElementById("speed-info");
const statusInfo = document.getElementById("status-info");
const startButton = document.getElementById("start-button");
const resetButton = document.getElementById("reset-button");

const DPR = window.devicePixelRatio || 1;
const DEFAULT_SPEED = 0.02;
const MAX_TRACE_POINTS = 8000;
const RATIONAL_TOLERANCE = 1e-10;
const MAX_RATIONAL_DENOMINATOR = 2000;

let animationFrame = null;
let running = false;
let theta = 0;
let trace = [];
let loopClosed = false;
let state = {
  a: 4,
  b: 1,
  speed: DEFAULT_SPEED,
  status: "유효한 식입니다."
};

function fitCanvas() {
  const card = canvas.parentElement;
  const rect = card.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width - 36));
  const height = Math.max(420, Math.floor(rect.height - 36));

  canvas.width = width * DPR;
  canvas.height = height * DPR;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  draw();
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
    throw new Error("유한한 수 아님");
  }

  return value;
}

function stopAnimation() {
  running = false;
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  startButton.textContent = "시작";
}

function closeLoopAnimation() {
  stopAnimation();
  loopClosed = true;
  state = {
    ...state,
    status: "점 P가 시작점으로 돌아와 정지했습니다."
  };
  updateLabels();
}

function syncStateFromInputs() {
  let nextA = state.a;
  let nextB = state.b;
  let nextSpeed = state.speed;
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

  if (valid && nextB >= nextA) {
    valid = false;
    radiusBInput.classList.add("invalid");
    status = "항상 b < a 이어야 합니다.";
  }

  if (valid && nextSpeed <= 0) {
    valid = false;
    speedInput.classList.add("invalid");
    status = "속도는 0보다 커야 합니다.";
  }

  if (valid) {
    state = { a: nextA, b: nextB, speed: nextSpeed, status };
    radiusAInput.classList.remove("invalid");
    radiusBInput.classList.remove("invalid");
    speedInput.classList.remove("invalid");
    return true;
  }

  state = { ...state, status };
  return false;
}

function getValues() {
  return { a: state.a, b: state.b, speed: state.speed };
}

function updateLabels() {
  const { a, b, speed } = getValues();
  radiusAValue.textContent = formatNumber(a);
  radiusBValue.textContent = formatNumber(b);
  speedValue.textContent = formatNumber(speed);
  ratioInfo.textContent = `a : b = ${formatNumber(a)} : ${formatNumber(b)}`;
  pointInfo.textContent = `(${formatNumber(a)}, 0)`;
  speedInfo.textContent = `${formatNumber(speed)} rad/frame`;
  statusInfo.textContent = state.status;
}

function resetTrace() {
  theta = 0;
  trace = [];
  loopClosed = false;
}

function getGeometry(a, b, scale, angle) {
  const bigR = a * scale;
  const smallR = b * scale;
  const orbitR = (a - b) * scale;
  const cx = orbitR * Math.cos(angle);
  const cy = -orbitR * Math.sin(angle);
  const rotation = ((a - b) / b) * angle;
  const px = cx + smallR * Math.cos(rotation);
  const py = cy + smallR * Math.sin(rotation);

  return { bigR, smallR, orbitR, cx, cy, px, py };
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
      return { numerator, denominator, error };
    }
  }

  if (bestError <= RATIONAL_TOLERANCE) {
    return { numerator: bestNumerator, denominator: bestDenominator, error: bestError };
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

function drawGrid(width, height, centerX, centerY) {
  ctx.save();
  ctx.strokeStyle = "rgba(92, 72, 50, 0.12)";
  ctx.lineWidth = 1;

  const step = 44;
  for (let x = centerX % step; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = centerY % step; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(47, 36, 27, 0.35)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();
  ctx.restore();
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const { a, b } = getValues();
  const margin = 36;
  const scale = Math.min(
    (width - margin * 2) / (2 * a + 2 * b),
    (height - margin * 2) / (2 * a + 2 * b)
  );

  const centerX = width / 2;
  const centerY = height / 2;

  drawGrid(width, height, centerX, centerY);

  const { bigR, smallR, cx, cy, px, py } = getGeometry(a, b, scale, theta);

  ctx.save();
  ctx.translate(centerX, centerY);

  if (trace.length > 1) {
    ctx.beginPath();
    ctx.moveTo(trace[0].x, trace[0].y);
    for (let i = 1; i < trace.length; i += 1) {
      ctx.lineTo(trace[i].x, trace[i].y);
    }
    ctx.strokeStyle = "#bf5b36";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, bigR, 0, Math.PI * 2);
  ctx.strokeStyle = "#2f241b";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, smallR, 0, Math.PI * 2);
  ctx.strokeStyle = "#0f8c94";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(px, py);
  ctx.strokeStyle = "rgba(15, 140, 148, 0.55)";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px, py, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#bf5b36";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(bigR, 0, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#2f241b";
  ctx.fill();

  ctx.fillStyle = "#2f241b";
  ctx.font = '700 14px "Trebuchet MS", "Avenir Next", sans-serif';
  ctx.fillText("P", px + 10, py - 10);
  ctx.fillText("(a, 0)", bigR + 10, -10);
  ctx.restore();
}

function step() {
  const { a, b, speed } = getValues();
  const cycleAngle = getCycleAngle(a, b);
  const nextTheta = theta + speed;
  theta = cycleAngle ? Math.min(nextTheta, cycleAngle) : nextTheta;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = Math.min(
    (width - 72) / (2 * a + 2 * b),
    (height - 72) / (2 * a + 2 * b)
  );

  const { px, py } = getGeometry(a, b, scale, theta);
  const currentPoint = { x: px, y: py };

  trace.push(currentPoint);
  if (trace.length > MAX_TRACE_POINTS) {
    trace.shift();
  }
  draw();

  if (cycleAngle && theta >= cycleAngle) {
    closeLoopAnimation();
    return;
  }

  animationFrame = window.requestAnimationFrame(step);
}

function startAnimation() {
  if (running) {
    stopAnimation();
    return;
  }

  if (!syncStateFromInputs()) {
    updateLabels();
    return;
  }

  if (loopClosed) {
    resetTrace();
    draw();
  }

  running = true;
  startButton.textContent = "일시정지";
  animationFrame = window.requestAnimationFrame(step);
}

function handleInputChange() {
  const valid = syncStateFromInputs();
  resetTrace();
  stopAnimation();
  updateLabels();

  if (valid) {
    draw();
  }
}

function handleReset() {
  stopAnimation();
  resetTrace();
  syncStateFromInputs();
  updateLabels();
  draw();
}

radiusAInput.addEventListener("input", handleInputChange);
radiusBInput.addEventListener("input", handleInputChange);
speedInput.addEventListener("input", handleInputChange);
startButton.addEventListener("click", startAnimation);
resetButton.addEventListener("click", handleReset);
window.addEventListener("resize", fitCanvas);

syncStateFromInputs();
updateLabels();
fitCanvas();
