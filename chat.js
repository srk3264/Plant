const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const locationStatus = document.getElementById("locationStatus");

const APP_CONTEXT = {
  location: null,
  conversation: []
};

function appendMessage(kind, text) {
  const message = document.createElement("article");
  message.className = `chat-message ${kind}`;
  message.textContent = text;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
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
      setLocationStatus("Location ready for local weather/news context.");
    },
    () => {
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

appendMessage("assistant", "Hi, I can answer with local context once weather/news wiring is done. Ask me anything to test chat flow.");
detectLocation();
chatInput.focus();
