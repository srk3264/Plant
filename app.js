const cameraFeed = document.getElementById("camera");
const cameraFallback = document.getElementById("cameraFallback");
const chatBubble = document.getElementById("chatBubble");
const detectStatus = document.getElementById("detectStatus");

const DETECTION_INTERVAL_MS = 700;
const POSITIVE_REFERENCE_IMAGE_URLS = [
  "./assets/reference/tree-ref-1.jpg",
  "./assets/reference/tree-ref-2.jpg",
  "./assets/reference/tree-ref-3.jpg",
  "./assets/reference/tree-ref-4.jpg",
  "./assets/reference/tree-ref-5.jpg",
  "./assets/reference/tree-ref-6.jpg",
  "./assets/reference/tree-ref-7.jpg",
  "./assets/reference/tree-ref-8.jpg"
];
const NEGATIVE_REFERENCE_IMAGE_URLS = [];
const SIMILARITY_THRESHOLD = 0.72;
const SIMILARITY_MARGIN_THRESHOLD = 0.03;
const SIMILARITY_CONFIRM_WINDOW = 4;
const SIMILARITY_CONFIRM_MIN_HITS = 3;
const FORCE_ENABLE_AFTER_MS = 9000;

let mobileNetModel = null;
let detectorReady = false;
let detectInFlight = false;
let lastSimilarityLogKey = "";
const similarityRecentHits = [];
let detectionStartedAt = 0;
const positiveReferenceEmbeddings = [];
const negativeReferenceEmbeddings = [];

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
  const artboardHeight = 874;
  const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const scale = Math.min(1, viewportWidth / artboardWidth, viewportHeight / artboardHeight);
  document.documentElement.style.setProperty("--artboard-scale", String(scale));
}

updateScale();

window.addEventListener("resize", updateScale);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateScale);
}

async function startCamera() {
  if (!cameraFeed || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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
    detectionStartedAt = Date.now();
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

  await tf.ready();
  mobileNetModel = await mobilenet.load();
  await loadReferenceEmbeddings();
  detectorReady = true;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

async function getNormalizedEmbedding(input) {
  const embeddingTensor = tf.tidy(() => {
    const embedding = mobileNetModel.infer(input, true);
    const flattened = embedding.flatten();
    const normalized = flattened.div(flattened.norm());
    return normalized;
  });
  const values = await embeddingTensor.data();
  embeddingTensor.dispose();
  return Float32Array.from(values);
}

async function loadReferenceEmbeddings() {
  positiveReferenceEmbeddings.length = 0;
  negativeReferenceEmbeddings.length = 0;

  for (const imageUrl of POSITIVE_REFERENCE_IMAGE_URLS) {
    try {
      const image = await loadImage(imageUrl);
      const embedding = await getNormalizedEmbedding(image);
      positiveReferenceEmbeddings.push({ imageUrl, embedding });
    } catch (error) {
      console.warn("Positive reference embedding load failed:", imageUrl, error);
    }
  }

  for (const imageUrl of NEGATIVE_REFERENCE_IMAGE_URLS) {
    try {
      const image = await loadImage(imageUrl);
      const embedding = await getNormalizedEmbedding(image);
      negativeReferenceEmbeddings.push({ imageUrl, embedding });
    } catch (error) {
      console.warn("Negative reference embedding load failed:", imageUrl, error);
    }
  }

  console.log("Reference embeddings loaded:", {
    positive: positiveReferenceEmbeddings.length,
    negative: negativeReferenceEmbeddings.length
  });
}

function cosineSimilarity(embeddingA, embeddingB) {
  if (!embeddingA || !embeddingB || embeddingA.length !== embeddingB.length) {
    return 0;
  }

  let dot = 0;
  for (let index = 0; index < embeddingA.length; index += 1) {
    dot += embeddingA[index] * embeddingB[index];
  }
  return dot;
}

function evaluateSimilarity(frameEmbedding) {
  let bestPositiveSimilarity = 0;
  for (const reference of positiveReferenceEmbeddings) {
    const similarity = cosineSimilarity(frameEmbedding, reference.embedding);
    if (similarity > bestPositiveSimilarity) {
      bestPositiveSimilarity = similarity;
    }
  }

  let bestNegativeSimilarity = 0;
  for (const reference of negativeReferenceEmbeddings) {
    const similarity = cosineSimilarity(frameEmbedding, reference.embedding);
    if (similarity > bestNegativeSimilarity) {
      bestNegativeSimilarity = similarity;
    }
  }

  const similarityMargin = bestPositiveSimilarity - bestNegativeSimilarity;
  const positivePass = bestPositiveSimilarity >= SIMILARITY_THRESHOLD;
  const marginPass = !negativeReferenceEmbeddings.length || similarityMargin >= SIMILARITY_MARGIN_THRESHOLD;
  const instantMatch = positivePass && marginPass;

  similarityRecentHits.push(instantMatch ? 1 : 0);
  if (similarityRecentHits.length > SIMILARITY_CONFIRM_WINDOW) {
    similarityRecentHits.shift();
  }

  const hitCount = similarityRecentHits.reduce((sum, hit) => sum + hit, 0);
  return {
    bestPositiveSimilarity,
    bestNegativeSimilarity,
    similarityMargin,
    instantMatch,
    confirmed: hitCount >= SIMILARITY_CONFIRM_MIN_HITS,
    hitCount
  };
}

async function runDetection() {
  if (!detectorReady || detectInFlight || !cameraFeed || cameraFeed.readyState < 2) {
    return;
  }

  detectInFlight = true;

  try {
    if (!positiveReferenceEmbeddings.length) {
      const elapsedMs = detectionStartedAt ? Date.now() - detectionStartedAt : 0;
      if (elapsedMs >= FORCE_ENABLE_AFTER_MS) {
        setBubbleReady(true);
        setDetectStatus("Tree references unavailable. Continue to chat.");
      } else {
        setBubbleReady(false);
        setDetectStatus("Loading tree references...");
      }
      return;
    }

    const frameEmbedding = await getNormalizedEmbedding(cameraFeed);
    const similarity = evaluateSimilarity(frameEmbedding);
    const similarityLogKey = `${similarity.bestPositiveSimilarity.toFixed(3)}__${similarity.bestNegativeSimilarity.toFixed(3)}__${similarity.instantMatch}__${similarity.hitCount}`;

    if (similarityLogKey !== lastSimilarityLogKey) {
      console.log("Similarity detection:", {
        bestPositiveSimilarity: Number(similarity.bestPositiveSimilarity.toFixed(3)),
        bestNegativeSimilarity: Number(similarity.bestNegativeSimilarity.toFixed(3)),
        threshold: SIMILARITY_THRESHOLD,
        margin: Number(similarity.similarityMargin.toFixed(3)),
        marginThreshold: SIMILARITY_MARGIN_THRESHOLD,
        instantMatch: similarity.instantMatch,
        hitCount: similarity.hitCount
      });
      lastSimilarityLogKey = similarityLogKey;
    }

    setBubbleReady(similarity.confirmed);
    if (similarity.confirmed) {
      setDetectStatus(`Tree trunk detected (${Math.round(similarity.bestPositiveSimilarity * 100)}% match)`);
    } else {
      const elapsedMs = detectionStartedAt ? Date.now() - detectionStartedAt : 0;
      if (elapsedMs >= FORCE_ENABLE_AFTER_MS) {
        setBubbleReady(true);
        setDetectStatus("Tree not confirmed. Continue to chat.");
      } else {
        setDetectStatus(`Scanning for tree trunk... (${Math.round(similarity.bestPositiveSimilarity * 100)}% match)`);
      }
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
