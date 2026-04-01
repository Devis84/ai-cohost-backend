const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const processed = new Set();

// ✅ PROPERTY REALE
const PROPERTY_ID = "80ffd815-7985-47a1-84d6-c9463bf13590";

// =======================
// FORMAT PROPERTY
// =======================

function formatProperty(p) {
  return {
    name: p.property_name,
    wifi: p.wifi_name && p.wifi_password
      ? `WiFi: ${p.wifi_name} / ${p.wifi_password}`
      : null,
    checkin: p.checkin_time,
    checkout: p.checkout_time,
    rules: p.house_rules,
    instructions: p.checkin_instructions,
    parking: p.parking || null
  };
}

// =======================
// INTENT DETECTION (MULTI)
// =======================

function detectIntents(text) {
  const t = text.toLowerCase();

  return {
    wifi: t.includes("wifi"),
    checkin: t.includes("check-in") || t.includes("checkin"),
    checkout: t.includes("checkout") || t.includes("check-out"),
    rules: t.includes("regole"),
    parking: t.includes("parcheggio")
  };
}

// =======================
// QUICK REPLY MULTI
// =======================

function quickReply(message, property) {
  const intents = detectIntents(message);

  let responses = [];

  if (intents.wifi && property.wifi)
    responses.push(property.wifi);

  if (intents.checkin && property.instructions)
    responses.push(property.instructions);

  if (intents.checkout && property.checkout)
    responses.push(`Check-out: ${property.checkout}`);

  if (intents.rules && property.rules)
    responses.push(property.rules);

  if (intents.parking && property.parking)
    responses.push(property.parking);

  return responses.length > 0 ? responses.join("\n") : null;
}

// =======================
// MEMORY (ULTIMI MESSAGGI)
// =======================

async function getRecentContext(phone) {
  const { data } = await supabase
    .from("conversations")
    .select("role, message")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(5);

  return data ? data.reverse() : [];
}

// =======================
// AI FALLBACK
// =======================

async function generateReply(message, property, history) {
  const prompt = `
Sei un assistente per una casa vacanze.

DATI CASA:
${JSON.stringify(property)}

CONVERSAZIONE RECENTE:
${JSON.stringify(history)}

REGOLE:
- NON parlare di prezzi
- NON parlare di prenotazioni
- NON inventare
- Se non sai → "Non ho questa informazione"
- NON ripetere cose già dette
- Risposta breve e naturale

Messaggio:
${message}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });

  return res.choices[0].message.content;
}

// =======================
// SEND
// =======================

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// =======================
// WEBHOOK
// =======================

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;

    if (!value?.messages) return res.sendStatus(200);

    const msg = value.messages[0];

    if (processed.has(msg.id)) return res.sendStatus(200);
    processed.add(msg.id);

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) return res.sendStatus(200);

    // =======================
    // PROPERTY
    // =======================

    const { data: propertyRaw, error } = await supabase
      .from("properties")
      .select("*")
      .eq("id", PROPERTY_ID)
      .single();

    if (error || !propertyRaw) {
      console.log("❌ PROPERTY ERROR:", error);
      await sendMessage(from, "Errore interno. Contatta l'host.");
      return res.sendStatus(200);
    }

    const property = formatProperty(propertyRaw);

    // =======================
    // SAVE USER
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text
      }
    ]);

    // =======================
    // QUICK RESPONSE
    // =======================

    let reply = quickReply(text, property);

    // =======================
    // AI FALLBACK (CON MEMORY)
    // =======================

    if (!reply) {
      const history = await getRecentContext(from);
      reply = await generateReply(text, property, history);
    }

    // sicurezza
    if (!reply) {
      reply = "Non ho questa informazione, contatta l'host.";
    }

    // =======================
    // SAVE AI
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply
      }
    ]);

    // =======================
    // SEND
    // =======================

    await sendMessage(from, reply);

    res.sendStatus(200);

  } catch (err) {
    console.log("🔥 ERROR:", err.message);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log("✅ COHOST PRO V2 RUNNING");
});