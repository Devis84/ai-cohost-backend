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

// ⚠️ METTI ID REALE
const PROPERTY_ID = "80ffd815-7985-47a1-84d6-c9463bf13590";

// =======================
// FORMAT PROPERTY DATA
// =======================

function formatProperty(p) {
  return {
    name: p.property_name,
    wifi: p.wifi_name && p.wifi_password
      ? `Rete: ${p.wifi_name}, Password: ${p.wifi_password}`
      : null,
    checkin: p.checkin_time,
    checkout: p.checkout_time,
    rules: p.house_rules,
    instructions: p.checkin_instructions
  };
}

// =======================
// AI RESPONSE
// =======================

async function generateReply(message, property) {
  const prompt = `
Sei un assistente per una casa vacanze.

CONTESTO CASA:
${JSON.stringify(property)}

L’utente è già ospite della casa.

REGOLE IMPORTANTI:
- NON parlare di prezzi
- NON parlare di prenotazioni
- NON fare domande inutili
- NON inventare informazioni
- Rispondi SOLO usando i dati sopra
- Se l'informazione non esiste, dì che non è disponibile
- Tono naturale, umano
- Risposta breve (max 2 frasi)

Domanda:
${message}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });

  return res.choices[0].message.content;
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
    // GET PROPERTY
    // =======================

    const { data: propertyRaw, error } = await supabase
      .from("properties")
      .select("*")
      .eq("id", PROPERTY_ID)
      .single();

    if (error || !propertyRaw) {
      console.log("❌ PROPERTY ERROR:", error);
      return res.sendStatus(200);
    }

    const property = formatProperty(propertyRaw);

    // =======================
    // SAVE USER MESSAGE
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text
      }
    ]);

    // =======================
    // AI RESPONSE
    // =======================

    const reply = await generateReply(text, property);

    // =======================
    // SAVE AI MESSAGE
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply
      }
    ]);

    // =======================
    // SEND WHATSAPP
    // =======================

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.sendStatus(200);

  } catch (err) {
    console.log("🔥 ERROR:", err.message);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log("✅ Server running");
});