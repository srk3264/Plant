const video = document.getElementById("camera");
const overlay = document.getElementById("overlay");
const statusText = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const demoBtn = document.getElementById("demoBtn");
const chatBubble = document.getElementById("chatBubble");

const ctx = overlay.getContext("2d");
const TREE_CONFIDENCE = 0.55;
const DETECTION_INTERVAL_MS = 450;
const CHAT_HIDE_AFTER_MS = 4000;

let model = null;
let stream = null;
let running = false;
let lastDetectTick = 0;
let bubbleTimer = null;

function setStatus(message) {
  statusText.textContent = message;
}

function showBubble() {
  chatBubble.classList.remove("hidden");

  if (bubbleTimer) {
    window.clearTimeout(bubbleTimer);
  }

  bubbleTimer = window.setTimeout(() => {
    chatBubble.classList.add("hidden");
  }, CHAT_HIDE_AFTER_MS);
}

function drawPredictions(predictions) {
  const width = overlay.width;
  const height = overlay.height;

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 3;
  ctx.font = "14px Space Grotesk";

  predictions.forEach((prediction) => {
    const [x, y, w, h] = prediction.bbox;

    ctx.strokeStyle = "#d9ff8a";
    ctx.fillStyle = "rgba(14, 20, 16, 0.75)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.stroke();

    const label = `${prediction.class} ${Math.round(prediction.score * 100)}%`;
    const labelPadding = 8;
    const labelWidth = ctx.measureText(label).width + labelPadding * 2;
    const labelY = y > 34 ? y - 30 : y + h + 6;

    ctx.fillRect(x, labelY, labelWidth, 24);
    ctx.fillStyle = "#f5f3eb";
    ctx.fillText(label, x + labelPadding, labelY + 16);
  });
}

function evaluateTreeDetection(predictions) {
  return predictions.some((prediction) => {
    const isPlant = prediction.class === "potted plant" || prediction.class.includes("plant");
    return isPlant && prediction.score >= TREE_CONFIDENCE;
  });
}

function resizeCanvas() {
  overlay.width = video.videoWidth || window.innerWidth;
  overlay.height = video.videoHeight || window.innerHeight;
}

async function detectFrame(timestamp) {
  if (!running) {
    return;
  }

  if (!model || video.readyState < 2) {
    window.requestAnimationFrame(detectFrame);
    return;
  }

  const elapsed = timestamp - lastDetectTick;

  if (elapsed >= DETECTION_INTERVAL_MS) {
    lastDetectTick = timestamp;
    const predictions = await model.detect(video);

    drawPredictions(predictions);

    if (evaluateTreeDetection(predictions)) {
      setStatus("Tree-like object detected");
      showBubble();
    } else {
      setStatus("Scanning for trees...");
    }
  }

  window.requestAnimationFrame(detectFrame);
}

async function startCamera() {
  if (running) {
    return;
  }

  try {
    setStatus("Requesting camera permission...");

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = stream;
    await video.play();

    resizeCanvas();

    setStatus("Loading detection model...");
    model = await cocoSsd.load();

    running = true;
    setStatus("Scanning for trees...");
    window.requestAnimationFrame(detectFrame);
  } catch (error) {
    console.error(error);
    setStatus("Camera start failed. Check browser permissions.");
  }
}

startBtn.addEventListener("click", startCamera);
demoBtn.addEventListener("click", () => {
  setStatus("Demo mode: bubble shown");
  showBubble();
});

chatBubble.addEventListener("click", () => {
  window.location.href = "./chat.html";
});

window.addEventListener("resize", resizeCanvas);
video.addEventListener("loadedmetadata", resizeCanvas);
