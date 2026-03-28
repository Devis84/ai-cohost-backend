const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// =======================
// CONFIG
// =======================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =======================
// 🔒 DEDUPLICAZIONE SERIA
// =======================

const processedMessageIds = new Set();

// =======================
// HELPERS
// =======================

function mapRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

function extractInfo(text) {
  const lower = text.toLowerCase();

  let month = null;

  const months = [
    "gennaio","febbraio","marzo","aprile","maggio","giugno",
    "luglio","agosto","settembre","ottobre","novembre","dicembre"
  ];

  for (const m of months) {
    if (lower.includes(m)) {
      month = m;
      break;
    }
  }

  return {
    month,
    dates: null,
    guests: null
  };
}

// =======================
// WEBHOOK
// =======================

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // ❗ ignora eventi non messaggi
    if (!value?.messages) {
      console.log("⚠️ Evento non messaggio ignorato");
      return res.sendStatus(200);
    }

    const msg = value.messages[0];

    const messageId = msg.id;
    const from = msg.from;
    const text = msg.text?.body;

    // ❗ deduplicazione su ID (fix vero)
    if (processedMessageIds.has(messageId)) {
      console.log("🚫 DUPLICATO BLOCCATO:", messageId);
      return res.sendStatus(200);
    }

    processedMessageIds.add(messageId);

    // pulizia memoria
    if (processedMessageIds.size > 1000) {
      processedMessageIds.clear();
    }

    // ❗ ignora messaggi senza testo
    if (!text) {
      console.log("⚠️ Messaggio senza testo ignorato");
      return res.sendStatus(200);
    }

    console.log("📩 TEXT:", text);

    // =======================
    // ESTRAZIONE INFO
    // =======================

    const info = extractInfo(text);
    console.log("🧠 INFO:", info);

    // =======================
    // SALVA UTENTE
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
        guest_mon: info.month,
        guest_date: info.dates,
        guest_count: info.guests
      },
    ]);

    console.log("✅ Salvato utente");

    // =======================
    // STORICO
    // =======================

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
          "Sei un assistente per host Airbnb. Risposte brevi, naturali e utili. Se mancano date o numero ospiti, chiedile."
      },
    ];

    if (history) {
      for (const h of history) {
        messages.push({
          role: mapRole(h.role),
          content: h.message,
        });
      }
    }

    console.log("🧠 Messaggi:", messages.length);

    // =======================
    // OPENAI
    // =======================

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply = ai.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // =======================
    // SALVA AI
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

    console.log("✅ Salvato AI");

    // =======================
    // INVIO WHATSAPP
    // =======================

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

// =======================
// HEALTH CHECK
// =======================

app.get("/", (req, res) => {
  res.send("OK");
});

// =======================
// START SERVER
// =======================

app.listen(process.env.PORT || 3001, () => {
  console.log("🚀 Server running");
});