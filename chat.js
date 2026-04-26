const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const locationStatus = document.getElementById("locationStatus");

const APP_CONTEXT = {
  location: null,
  conversation: []
};

const LEFT_TAIL_ASSET = "https://www.figma.com/api/mcp/asset/ed36b1a3-dcb5-4f63-91a1-60ca9b4e7bd4";
const RIGHT_TAIL_ASSET = "https://www.figma.com/api/mcp/asset/15dec776-6b91-4e12-9037-33857dcbb96a";

function appendMessage(kind, text) {
  if (kind === "status") {
    const status = document.createElement("article");
    status.className = "chat-status";
    status.textContent = text;
    chatMessages.appendChild(status);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return status;
  }

  const row = document.createElement("article");
  row.className = `message-row ${kind}`;

  const bubble = document.createElement("div");
  bubble.className = `chat-chip ${kind}`;
  bubble.textContent = text;

  const tail = document.createElement("div");
  tail.className = "chat-tail";
  const tailImage = document.createElement("img");
  tailImage.alt = "";
  tailImage.src = kind === "assistant" ? LEFT_TAIL_ASSET : RIGHT_TAIL_ASSET;
  tail.appendChild(tailImage);

  row.appendChild(bubble);
  row.appendChild(tail);

  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return row;
}

function setLocationStatus(text) {
  if (locationStatus) {
    locationStatus.textContent = text;
  }
}

function addConversation(role, content) {
  APP_CONTEXT.conversation.push({ role, content });
  if (APP_CONTEXT.conversation.length > 12) {
    APP_CONTEXT.conversation.shift();
  }
}

function withSendingState(isSending) {
  chatSend.disabled = isSending;
  chatInput.disabled = isSending;
}

function detectLocation() {
  if (!navigator.geolocation) {
    setLocationStatus("Location unavailable in this browser.");
    appendMessage("status", "Location access is unavailable. Chat will run without local context.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      APP_CONTEXT.location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      };
      console.log("Geolocation:", APP_CONTEXT.location);
      setLocationStatus("Location ready for local weather/news context.");
    },
    (error) => {
      console.warn("Geolocation unavailable:", error);
      setLocationStatus("Location denied. Using no-location mode.");
      appendMessage("status", "Location permission was denied. You can still chat without local context.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 120000
    }
  );
}

async function sendToBackend(userMessage) {
  console.log("Sending location to backend:", APP_CONTEXT.location || "unavailable");

  const response = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: userMessage,
      location: APP_CONTEXT.location,
      history: APP_CONTEXT.conversation
    })
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const message = errorPayload.error || "Unable to reach the chat service.";
    throw new Error(message);
  }

  const payload = await response.json();
  if (payload?.context?.locationMeta) {
    console.log("Reverse geocode locationMeta:", payload.context.locationMeta);
  } else {
    console.log("Reverse geocode locationMeta:", "unavailable");
  }
  if (payload?.context?.weather) {
    console.log("Weather:", payload.context.weather);
  } else {
    console.log("Weather:", "unavailable");
  }
  return payload.reply || "No response returned.";
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = chatInput.value.trim();
  if (!text) {
    return;
  }

  appendMessage("user", text);
  addConversation("user", text);
  chatInput.value = "";

  withSendingState(true);
  const typingMessage = appendMessage("status", "Thinking...");

  try {
    const assistantReply = await sendToBackend(text);
    typingMessage.remove();
    appendMessage("assistant", assistantReply);
    addConversation("assistant", assistantReply);
  } catch (error) {
    typingMessage.remove();
    appendMessage("assistant", `Chat service error: ${error.message}`);
  } finally {
    withSendingState(false);
    chatInput.focus();
  }
});

appendMessage("assistant", "Ask me anything. I will use your location, weather, and local headlines when available.");
appendMessage("user", "That's true tho");
detectLocation();
chatInput.focus();
