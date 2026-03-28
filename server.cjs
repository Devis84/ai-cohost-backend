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
// DEDUP
// =======================

const processed = new Set();

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

  // 👇 FIX DATE (10 al 15)
  let dates = null;
  const dateMatch = lower.match(/(\d{1,2})\D+(\d{1,2})/);
  if (dateMatch) {
    const from = parseInt(dateMatch[1]);
    const to = parseInt(dateMatch[2]);

    if (to > from) {
      dates = { from, to };
    }
  }

  // ospiti
  let guests = null;
  const guestsMatch = lower.match(/\b(\d+)\b/);
  if (guestsMatch) {
    guests = parseInt(guestsMatch[1]);
  }

  return { month, dates, guests };
}

function nights(d) {
  if (!d) return null;
  return d.to - d.from;
}

// =======================
// WEBHOOK
// =======================

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) {
      console.log("⚠️ Ignorato evento");
      return res.sendStatus(200);
    }

    if (processed.has(msg.id)) {
      console.log("🚫 DUPLICATO");
      return res.sendStatus(200);
    }

    processed.add(msg.id);

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) return res.sendStatus(200);

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
    // MEMORIA (FIX SERIO)
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

    let reply = null;

    if (finalMonth && finalDates && finalGuests) {

      const { data: price } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      if (price) {
        const n = nights(finalDates);
        const avg = Math.round((price.price_min + price.price_max) / 2);
        const total = n * avg;

        reply = `Perfetto! Dal ${finalDates.from} al ${finalDates.to} ${finalMonth} per ${finalGuests} persone il totale è circa ${total}€. Il prezzo può variare leggermente.`;
      }
    }

    // =======================
    // FALLBACK AI
    // =======================

    if (!reply) {
      const messages = [
        {
          role: "system",
          content:
            "Sei un assistente Airbnb. Se mancano date o ospiti chiedile."
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

      reply = ai.choices[0].message.content;
    }

    console.log("🤖 REPLY:", reply);

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

    // =======================
    // SEND
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
    console.log("❌ ERROR:", err.message);
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