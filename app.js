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

chatBubble.addEventListener("click", () => {
  window.location.href = "./chat.html";
});
