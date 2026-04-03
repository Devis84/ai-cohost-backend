import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ==============================
// ENV
// ==============================

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  HOST_PHONE
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==============================
// HELPERS
// ==============================

async function getProperty(propertyId) {
  const { data } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .single();

  return data;
}

function hasFeature(property, feature) {
  return property?.features?.[feature] === true;
}

async function saveMessage(phone, role, message, propertyId) {
  await supabase.from("messages").insert({
    phone,
    role,
    message,
    property_id: propertyId
  });
}

async function getHistory(phone) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: true })
    .limit(20);

  return data || [];
}

async function send(to, text) {
  await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });
}

// ==============================
// TAKEOVER
// ==============================

const takeover = new Map();

// ==============================
// AI
// ==============================

async function askAI(text, property, history) {
  try {
    const context = history.map(h => `${h.role}: ${h.message}`).join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `You are an Airbnb assistant. Answer clearly and politely using property data.`
          },
          {
            role: "user",
            content: `${context}\nUser: ${text}`
          }
        ]
      })
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content;
  } catch (e) {
    return null;
  }
}

// ==============================
// FALLBACK
// ==============================

function fallback(text, property) {
  text = text.toLowerCase();

  if (text.includes("wifi")) {
    return `📶 Network: ARRIS-6F59 | Password: Malta2025`;
  }

  if (text.includes("parking")) {
    return `🚗 Free street parking nearby. No private parking.`;
  }

  if (text.includes("party")) {
    return `❌ Parties are not allowed. Quiet hours from 23:00 to 07:00.`;
  }

  return `🙂 I can help with WiFi, check-in, parking and local info.`;
}

// ==============================
// WEBHOOK
// ==============================

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    const propertyId = "default-property"; // TEMP
    const property = await getProperty(propertyId);

    // SAVE USER MESSAGE
    await saveMessage(from, "guest", text, propertyId);

    // HOST NOTIFY
    if (HOST_PHONE) {
      await send(HOST_PHONE, `👤 Guest ${from}: ${text}`);
    }

    // TAKEOVER
    if (takeover.has(from)) {
      await send(from, "👤 Host will reply shortly.");
      return res.sendStatus(200);
    }

    // FEATURE CHECK
    if (!hasFeature(property, "ai_assistant")) {
      return res.sendStatus(200);
    }

    const history = await getHistory(from);

    let reply = await askAI(text, property, history);

    if (!reply) {
      reply = fallback(text, property);
    }

    await saveMessage(from, "assistant", reply, propertyId);
    await send(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ==============================
// DASHBOARD API
// ==============================

app.get("/conversations", async (req, res) => {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  res.json(data || []);
});

// ==============================
// HOST CONTROL
// ==============================

app.post("/host-send", async (req, res) => {
  const { phone, message } = req.body;

  await send(phone, message);
  await saveMessage(phone, "host", message, "default-property");

  res.sendStatus(200);
});

app.post("/takeover", (req, res) => {
  const { phone, active } = req.body;

  if (active) takeover.set(phone, true);
  else takeover.delete(phone);

  res.sendStatus(200);
});

// ==============================
// START
// ==============================

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});