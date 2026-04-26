const cameraFeed = document.getElementById("camera");
const cameraFallback = document.getElementById("cameraFallback");
const chatBubble = document.getElementById("chatBubble");
const detectStatus = document.getElementById("detectStatus");

const DETECTION_INTERVAL_MS = 600;
const COCO_MIN_CONFIDENCE = 0.25;
const TREE_KEYWORDS = /(tree|trunk|bark|forest|woodland|palm tree|birch|oak|maple|conifer|pine)/i;
const MOBILE_NET_MIN_CONFIDENCE = 0.35;
const MOBILE_CONFIRM_WINDOW = 3;
const MOBILE_CONFIRM_MIN_HITS = 2;

let cocoModel = null;
let mobileNetModel = null;
let detectorReady = false;
let detectInFlight = false;
let lastDetectionLogKey = "";
const mobileRecentHits = [];

function setDetectStatus(message) {
  if (detectStatus) {
    detectStatus.textContent = message;
  }
}

function setBubbleReady(isReady) {
  chatBubble.classList.toggle("ready", isReady);
}

function updateScale() {
  const artboardWidth = 402;
  const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const scale = Math.min(1, viewportWidth / artboardWidth);
  document.documentElement.style.setProperty("--artboard-scale", String(scale));
}

updateScale();

window.addEventListener("resize", updateScale);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateScale);
}

async function startCamera() {
  if (!cameraFeed) {
    setDetectStatus("");
    setBubbleReady(true);
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (cameraFallback) {
      cameraFallback.hidden = false;
    }
    setDetectStatus("Camera unsupported");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    cameraFeed.srcObject = stream;
    await cameraFeed.play();
    if (cameraFallback) {
      cameraFallback.hidden = true;
    }
    setDetectStatus("Loading AI models...");
    await loadModels();
    setDetectStatus("Scanning for tree trunk...");
    window.setInterval(runDetection, DETECTION_INTERVAL_MS);
  } catch (error) {
    console.error("Camera access failed:", error);
    if (cameraFallback) {
      cameraFallback.hidden = false;
    }
    setDetectStatus("Camera permission denied");
  }
}

async function loadModels() {
  if (detectorReady) {
    return;
  }

  cocoModel = await cocoSsd.load();
  mobileNetModel = await mobilenet.load();
  detectorReady = true;
}

function hasTreeKeywords(results) {
  const matched = results.some((entry) => {
    const labels = entry.className.split(",").map((label) => label.trim().toLowerCase());
    const isTreeLike = labels.some((label) => TREE_KEYWORDS.test(label));
    return isTreeLike && entry.probability >= MOBILE_NET_MIN_CONFIDENCE;
  });

  mobileRecentHits.push(matched ? 1 : 0);
  if (mobileRecentHits.length > MOBILE_CONFIRM_WINDOW) {
    mobileRecentHits.shift();
  }

  const hitCount = mobileRecentHits.reduce((sum, hit) => sum + hit, 0);
  return hitCount >= MOBILE_CONFIRM_MIN_HITS;
}

function hasPlantLikeObject(predictions) {
  return predictions.some((entry) => {
    const className = entry.class.toLowerCase();
    const score = entry.score || 0;
    return (className.includes("plant") || className.includes("potted") || className.includes("leaf")) && score >= COCO_MIN_CONFIDENCE;
  });
}

async function runDetection() {
  if (!detectorReady || detectInFlight || !cameraFeed || cameraFeed.readyState < 2) {
    return;
  }

  detectInFlight = true;

  try {
    const [objectPredictions, imagePredictions] = await Promise.all([
      cocoModel.detect(cameraFeed, 100),
      mobileNetModel.classify(cameraFeed, 5)
    ]);

    const objectNames = objectPredictions.map((entry) => entry.class);
    const sceneNames = imagePredictions.map((entry) => entry.className);
    const logKey = `${objectNames.join("|")}__${sceneNames.join("|")}`;

    if (logKey !== lastDetectionLogKey) {
      console.log("COCO-SSD objects:", objectNames.length ? objectNames : ["none"]);
      console.log("MobileNet scene labels:", sceneNames.length ? sceneNames : ["none"]);
      lastDetectionLogKey = logKey;
    }

    const cocoDetected = hasPlantLikeObject(objectPredictions);
    const mobileDetected = hasTreeKeywords(imagePredictions);
    const detected = cocoDetected || mobileDetected;

    setBubbleReady(detected);
    if (detected) {
      setDetectStatus(cocoDetected ? "Tree trunk detected (COCO)" : "Tree trunk likely (MobileNet)");
    } else {
      setDetectStatus("Scanning for tree trunk...");
    }
  } catch (error) {
    console.error("Detection failed:", error);
    setDetectStatus("Detection temporarily unavailable");
  } finally {
    detectInFlight = false;
  }
}

setBubbleReady(false);
startCamera();

chatBubble.addEventListener("click", () => {
  if (!chatBubble.classList.contains("ready")) {
    return;
  }
  window.location.href = "./chat.html";
});
