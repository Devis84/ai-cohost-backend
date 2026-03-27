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

// MAPPATURA RUOLI (DB → OPENAI)
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

    // ===== SALVA MESSAGGIO UTENTE =====
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
      },
    ]);

    console.log("✅ Salvato messaggio utente");

    // ===== PRENDI STORICO =====
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true })
      .limit(10);

    // ===== COSTRUZIONE MESSAGGI =====
    const messages = [
      {
        role: "system",
        content: `
Sei un assistente per un host Airbnb.

Usa SEMPRE lo storico della conversazione per rispondere.

Regole:
- Non ripetere sempre "come posso aiutarti"
- Continua il discorso
- Se parlano di prezzi → dai range realistici
- Se danno info (mese, date) → usale
- Risposte brevi e naturali (stile WhatsApp)
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

    console.log("🧠 Messaggi inviati a OpenAI:", messages.length);

    // ===== CHIAMATA OPENAI =====
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
    });

    const reply = ai.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // ===== SALVA RISPOSTA AI =====
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

    console.log("✅ Salvato messaggio AI");

    // ===== INVIO WHATSAPP =====
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