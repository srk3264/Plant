const chatBubble = document.getElementById("chatBubble");

function updateScale() {
  const artboardWidth = 402;
  const artboardHeight = 874;
  const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const scale = Math.min(viewportWidth / artboardWidth, viewportHeight / artboardHeight);
  document.documentElement.style.setProperty("--artboard-scale", String(scale));
}

updateScale();

window.addEventListener("resize", updateScale);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateScale);
}

chatBubble.addEventListener("click", () => {
  window.location.href = "./chat.html";
});
