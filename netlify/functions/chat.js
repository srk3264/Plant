const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPEN_METEO_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_REVERSE_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/reverse";
const BDC_REVERSE_GEOCODE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(payload)
  };
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function pickTopNewsTitlesFromRss(xmlText, maxItems = 3) {
  if (!xmlText) {
    return [];
  }

  const items = [...xmlText.matchAll(/<item>[\s\S]*?<\/item>/gi)]
    .map((match) => match[0])
    .slice(0, 12);

  const titles = [];
  for (const item of items) {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
    if (!titleMatch) {
      continue;
    }

    const title = sanitizeText(titleMatch[1]).replace(/\s-\s[^-]+$/, "");
    if (title && !titles.includes(title)) {
      titles.push(title);
    }
    if (titles.length >= maxItems) {
      break;
    }
  }

  return titles;
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL(OPEN_METEO_REVERSE_GEOCODE_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  console.log("Reverse geocode request:", {
    latitude,
    longitude,
    url: url.toString()
  });

  const response = await fetch(url);
  if (!response.ok) {
    console.warn("Reverse geocode failed:", {
      status: response.status,
      statusText: response.statusText
    });
    return null;
  }

  const payload = await response.json();
  const firstResult = payload?.results?.[0];
  if (!firstResult) {
    console.warn("Reverse geocode returned no results", {
      resultCount: Array.isArray(payload?.results) ? payload.results.length : 0,
      latitude,
      longitude
    });
    return null;
  }

  console.log("Reverse geocode result:", {
    name: firstResult.name,
    admin1: firstResult.admin1,
    country: firstResult.country,
    countryCode: firstResult.country_code,
    latitude: firstResult.latitude,
    longitude: firstResult.longitude
  });

  return {
    city: firstResult.name || null,
    admin1: firstResult.admin1 || null,
    country: firstResult.country || null,
    countryCode: firstResult.country_code || null
  };
}

async function reverseGeocodeFallback(latitude, longitude) {
  const url = new URL(BDC_REVERSE_GEOCODE_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("localityLanguage", "en");

  console.log("Reverse geocode fallback request:", {
    latitude,
    longitude,
    url: url.toString()
  });

  const response = await fetch(url);
  if (!response.ok) {
    console.warn("Reverse geocode fallback failed:", {
      status: response.status,
      statusText: response.statusText
    });
    return null;
  }

  const payload = await response.json();
  const city = payload?.city || payload?.locality || payload?.principalSubdivision || null;
  const admin1 = payload?.principalSubdivision || null;
  const country = payload?.countryName || null;
  const countryCode = payload?.countryCode || null;

  if (!city && !admin1 && !country) {
    console.warn("Reverse geocode fallback returned no usable locality", {
      latitude,
      longitude
    });
    return null;
  }

  console.log("Reverse geocode fallback result:", {
    city,
    admin1,
    country,
    countryCode
  });

  return {
    city,
    admin1,
    country,
    countryCode
  };
}

async function getWeather(latitude, longitude) {
  const url = new URL(OPEN_METEO_WEATHER_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const current = payload?.current;
  if (!current) {
    return null;
  }

  return {
    temperatureC: current.temperature_2m,
    windKmh: current.wind_speed_10m,
    weatherCode: current.weather_code,
    observedAt: current.time
  };
}

async function getLocalNews(locationMeta) {
  const locationTerm = locationMeta?.city || locationMeta?.admin1 || locationMeta?.country || "local area";
  const query = encodeURIComponent(`${locationTerm}`);
  const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  const response = await fetch(rssUrl, {
    headers: {
      "User-Agent": "Project-O-Chat/1.0"
    }
  });

  if (!response.ok) {
    return [];
  }

  const xmlText = await response.text();
  return pickTopNewsTitlesFromRss(xmlText, 3);
}

function toOpenRouterHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "")
    }))
    .filter((item) => item.content.trim().length > 0);
}

function formatCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "unavailable";
  }
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function buildSystemPrompt(context) {
  const coordinates = formatCoordinates(context.latitude, context.longitude);
  const locationLine = context.locationMeta
    ? `${context.locationMeta.city || context.locationMeta.admin1 || "Unknown place"}, ${context.locationMeta.country || "Unknown country"}`
    : `Coordinates available (${coordinates})`;

  const weatherLine = context.weather
    ? `${context.weather.temperatureC} C, wind ${context.weather.windKmh} km/h, code ${context.weather.weatherCode}`
    : "Weather unavailable";

  const newsLine = Array.isArray(context.news) && context.news.length
    ? context.news.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
    : "No local headlines available";

  return [
    "You are Project O's local context assistant.",
    "Answer in 2-4 short sentences, practical and friendly.",
    "Use location, weather, and local headlines when relevant.",
    "If context is missing, state that briefly and still help.",
    "If coordinates are present, do not say location is unavailable.",
    "If place-name reverse geocoding is unavailable, do not claim a specific city/state by guesswork.",
    "Avoid slang or filler phrasing such as 'tho'.",
    "Never invent exact numbers if unavailable.",
    "",
    `Location: ${locationLine}`,
    `Coordinates: ${coordinates}`,
    `Weather: ${weatherLine}`,
    "Local headlines:",
    newsLine
  ].join("\n");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json(500, { error: "Missing OPENROUTER_API_KEY in Netlify environment variables." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const message = String(payload.message || "").trim();
  if (!message) {
    return json(400, { error: "Message is required." });
  }

  const latitude = Number(payload?.location?.latitude);
  const longitude = Number(payload?.location?.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

  let locationMeta = null;
  let weather = null;
  let news = [];

  if (hasCoordinates) {
    try {
      [locationMeta, weather] = await Promise.all([
        reverseGeocode(latitude, longitude),
        getWeather(latitude, longitude)
      ]);

      if (!locationMeta) {
        locationMeta = await reverseGeocodeFallback(latitude, longitude);
      }
    } catch {
      // Keep chat functional even when context providers fail.
    }

    try {
      news = await getLocalNews(locationMeta);
    } catch {
      // Keep chat functional even when news provider fails.
    }
  }

  const systemPrompt = buildSystemPrompt({
    latitude,
    longitude,
    locationMeta,
    weather,
    news
  });
  const history = toOpenRouterHistory(payload.history);

  console.log("Context before OpenRouter:", {
    latitude,
    longitude,
    locationMeta,
    weather,
    newsCount: news.length,
    hasCoordinates
  });

  const openRouterBody = {
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    temperature: 0.5,
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message }
    ]
  };

  const openRouterResponse = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://plantecology.netlify.app",
      "X-Title": "Project O"
    },
    body: JSON.stringify(openRouterBody)
  });

  if (!openRouterResponse.ok) {
    const details = await openRouterResponse.text();
    return json(502, {
      error: "OpenRouter request failed.",
      details: details.slice(0, 600)
    });
  }

  const completion = await openRouterResponse.json();
  const reply = completion?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    return json(502, { error: "OpenRouter returned an empty reply." });
  }

  return json(200, {
    reply,
    context: {
      locationMeta,
      weather,
      news
    }
  });
};
