const cameraFeed = document.getElementById("camera");
const cameraFallback = document.getElementById("cameraFallback");
const chatBubble = document.getElementById("chatBubble");

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
  if (!cameraFeed || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (cameraFallback) {
      cameraFallback.hidden = false;
    }
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
  } catch (error) {
    console.error("Camera access failed:", error);
    if (cameraFallback) {
      cameraFallback.hidden = false;
    }
  }
}

startCamera();

chatBubble.addEventListener("click", () => {
  window.location.href = "./chat.html";
});
