require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// 🔐 ENV
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const VERIFY_TOKEN = "my_verify_token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// =========================
// ✅ ROOT TEST
// =========================
app.get("/", (req, res) => {
  res.send("OK");
});

// =========================
// ✅ META VERIFICATION
// =========================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFICATO");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// =========================
// 📩 WEBHOOK POST
// =========================
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK POST RICEVUTO");

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];

    if (!message) {
      console.log("⚠️ Nessun messaggio");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("👤 Da:", from);
    console.log("💬 Testo:", text);

    if (!text) return res.sendStatus(200);

    // =========================
    // 💾 SALVA MESSAGGIO UTENTE
    // =========================
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
      },
    ]);

    // =========================
    // 📚 PRENDI STORICO
    // =========================
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true })
      .limit(10);

    const messages = [
      {
        role: "system",
        content:
          "Sei un assistente per un host Airbnb. Rispondi come se stessi aiutando un ospite reale. Dai risposte concrete, brevi e utili. Se ti chiedono prezzi o disponibilità, invita a fornire le date.",
      },
      ...history.map((msg) => ({
        role: msg.role,
        content: msg.message,
      })),
    ];

    console.log("🚀 CHIAMO OPENAI...");

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
    });

    const reply = aiResponse.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // =========================
    // 💾 SALVA RISPOSTA AI
    // =========================
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

    // =========================
    // 📤 INVIA WHATSAPP
    // =========================
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📤 RISPOSTA INVIATA");

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ ERRORE:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// =========================
// 🚀 START SERVER
// =========================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});