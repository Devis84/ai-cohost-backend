require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// SUPABASE
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// MAPPATURA RUOLI
function mapRole(role) {
  if (role === "guest") return "user";
  if (role === "assistant") return "assistant";
  return "user";
}

// WEBHOOK
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 WEBHOOK");

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      console.log("⚠️ Nessun messaggio");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("👤 FROM:", from);
    console.log("💬 TEXT:", text);

    if (!text) return res.sendStatus(200);

    // ===== SALVA UTENTE =====
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
      },
    ]);

    console.log("✅ Salvato messaggio utente");

    // ===== STORICO =====
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true })
      .limit(10);

    // ===== PROMPT =====
    const messages = [
      {
        role: "system",
        content: `
Sei un host Airbnb reale.

Informazioni struttura:
- Appartamento in città
- Prezzo medio: 100–120€ a notte
- Giugno/Luglio: 110–130€ a notte

Regole:
- Risposte brevi (stile WhatsApp)
- NON essere generico
- NON dire "dipende da molti fattori"
- Dai numeri concreti
- Usa lo storico della conversazione

Comportamento:
- Se chiedono prezzo → dai range realistico
- Se dicono mese → usa i prezzi corretti
- Se manca info → chiedi solo quello che serve

Parla come un host umano, non come un assistente AI.
`,
      },
    ];

    if (history && history.length > 0) {
      for (const h of history) {
        messages.push({
          role: mapRole(h.role),
          content: h.message,
        });
      }
    }

    console.log("🧠 Messaggi:", messages.length);

    // ===== OPENAI =====
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
    });

    const reply = ai.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // ===== SALVA AI =====
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

    console.log("✅ Salvato messaggio AI");

    // ===== INVIO =====
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📤 SENT");

    res.sendStatus(200);
  } catch (err) {
    console.log("❌ ERRORE:", err.message);
    res.sendStatus(500);
  }
});

// ROOT
app.get("/", (req, res) => {
  res.send("OK");
});

// SERVER
app.listen(process.env.PORT || 3001, () => {
  console.log("🚀 Server running");
});