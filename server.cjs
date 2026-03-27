require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

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

// ROOT
app.get("/", (req, res) => res.send("OK"));

// VERIFY
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// WEBHOOK
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK POST RICEVUTO");

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      console.log("⚠️ Nessun messaggio");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("👤 Da:", from);
    console.log("💬 Testo:", text);

    if (!text) return res.sendStatus(200);

    // =====================
    // 💾 SALVATAGGIO DEBUG
    // =====================
    const { data: insertUser, error: insertUserError } =
      await supabase.from("conversations").insert([
        {
          phone: from,
          role: "guest",
          message: text,
        },
      ]);

    if (insertUserError) {
      console.error("❌ SUPABASE INSERT USER ERROR:", insertUserError);
    } else {
      console.log("✅ Salvato messaggio utente");
    }

    // =====================
    // 📚 STORICO
    // =====================
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) {
      console.error("❌ SUPABASE FETCH ERROR:", error);
    }

    const history = data || [];

    const messages = [
      {
        role: "system",
        content:
          "Sei un assistente per un host Airbnb. Dai risposte concrete e realistiche.",
      },
      ...history.map((msg) => ({
        role: msg.role,
        content: msg.message,
      })),
    ];

    console.log("🚀 CHIAMO OPENAI...");

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply = aiResponse.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // =====================
    // 💾 SALVA RISPOSTA
    // =====================
    const { error: insertAIError } =
      await supabase.from("conversations").insert([
        {
          phone: from,
          role: "assistant",
          message: reply,
        },
      ]);

    if (insertAIError) {
      console.error("❌ SUPABASE INSERT AI ERROR:", insertAIError);
    } else {
      console.log("✅ Salvata risposta AI");
    }

    // =====================
    // 📤 WHATSAPP
    // =====================
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
  } catch (err) {
    console.error("❌ ERRORE GENERALE:", err.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);