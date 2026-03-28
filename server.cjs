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
  apiKey: process.env.OPENAI_API_KEY,
});

// =======================
// DEDUPLICAZIONE
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

  const months = [
    "gennaio","febbraio","marzo","aprile","maggio","giugno",
    "luglio","agosto","settembre","ottobre","novembre","dicembre"
  ];

  let month = null;
  for (const m of months) {
    if (lower.includes(m)) {
      month = m;
      break;
    }
  }

  // numeri (ospiti)
  let guests = null;
  const guestsMatch = lower.match(/\b(\d+)\b/);
  if (guestsMatch) {
    guests = parseInt(guestsMatch[1]);
  }

  // date (semplice versione)
  let dates = null;
  const dateMatch = lower.match(/(\d{1,2}).*(\d{1,2})/);
  if (dateMatch) {
    dates = {
      from: parseInt(dateMatch[1]),
      to: parseInt(dateMatch[2])
    };
  }

  return { month, dates, guests };
}

function calculateNights(dates) {
  if (!dates) return null;
  return dates.to - dates.from;
}

// =======================
// WEBHOOK
// =======================

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) {
      console.log("⚠️ Evento non messaggio ignorato");
      return res.sendStatus(200);
    }

    const msg = value.messages[0];
    const messageId = msg.id;
    const from = msg.from;
    const text = msg.text?.body;

    if (processedMessageIds.has(messageId)) {
      console.log("🚫 DUPLICATO BLOCCATO");
      return res.sendStatus(200);
    }

    processedMessageIds.add(messageId);
    if (processedMessageIds.size > 1000) {
      processedMessageIds.clear();
    }

    if (!text) {
      console.log("⚠️ No text");
      return res.sendStatus(200);
    }

    console.log("📩 TEXT:", text);

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

    // =======================
    // RECUPERA MEMORIA COMPLETA
    // =======================

    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: false })
      .limit(20);

    let finalMonth = null;
    let finalDates = null;
    let finalGuests = null;

    for (const h of history) {
      if (!finalMonth && h.guest_mon) finalMonth = h.guest_mon;
      if (!finalDates && h.guest_date) finalDates = h.guest_date;
      if (!finalGuests && h.guest_count) finalGuests = h.guest_count;
    }

    console.log("📦 MEMORY:", { finalMonth, finalDates, finalGuests });

    // =======================
    // PRICING
    // =======================

    let finalReply = null;

    if (finalMonth && finalDates && finalGuests) {

      const { data: pricing } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      if (pricing) {
        const nights = calculateNights(finalDates);
        const avgPrice = Math.round((pricing.price_min + pricing.price_max) / 2);
        const total = nights * avgPrice;

        finalReply = `Perfetto! Dal ${finalDates.from} al ${finalDates.to} ${finalMonth} per ${finalGuests} persone il totale è circa ${total}€. Il prezzo può variare leggermente in base alla disponibilità.`;
      }
    }

    // =======================
    // SE NON COMPLETO → AI
    // =======================

    if (!finalReply) {

      const messages = [
        {
          role: "system",
          content:
            "Sei un assistente Airbnb. Risposte brevi. Se mancano date o ospiti, chiedile."
        },
      ];

      if (history) {
        for (const h of history.reverse()) {
          messages.push({
            role: mapRole(h.role),
            content: h.message,
          });
        }
      }

      const ai = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });

      finalReply = ai.choices[0].message.content;
    }

    console.log("🤖 FINAL:", finalReply);

    // =======================
    // SALVA AI
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: finalReply,
      },
    ]);

    // =======================
    // INVIO
    // =======================

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: finalReply },
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

app.get("/", (req, res) => {
  res.send("OK");
});

app.listen(process.env.PORT || 3001, () => {
  console.log("🚀 Server running");
});