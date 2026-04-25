const chatBubble = document.getElementById("chatBubble");

function updateScale() {
  const artboardWidth = 402;
  const artboardHeight = 874;
  const scale = Math.min(window.innerWidth / artboardWidth, window.innerHeight / artboardHeight);
  document.documentElement.style.setProperty("--artboard-scale", String(scale));
}

updateScale();

window.addEventListener("resize", updateScale);

chatBubble.addEventListener("click", () => {
  window.location.href = "./chat.html";
});
