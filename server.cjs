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

const processed = new Set();

// =======================
// FIX PARSER SERIO
// =======================

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

  // ✅ DATE (priorità alta)
  let dates = null;
  const dateMatch = lower.match(/dal\s*(\d{1,2})\D+(\d{1,2})/);
  if (dateMatch) {
    const from = parseInt(dateMatch[1]);
    const to = parseInt(dateMatch[2]);
    if (to > from) {
      dates = { from, to };
    }
  }

  // ✅ GUESTS SOLO SE TESTO HA "SIAMO"
  let guests = null;
  const guestMatch = lower.match(/(siamo|per)\s*(\d+)/);
  if (guestMatch) {
    guests = parseInt(guestMatch[2]);
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

    if (!msg) return res.sendStatus(200);

    if (processed.has(msg.id)) return res.sendStatus(200);
    processed.add(msg.id);

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) return res.sendStatus(200);

    console.log("TEXT:", text);

    const info = extractInfo(text);
    console.log("INFO:", info);

    // SALVA SOLO SE C'È QUALCOSA
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
        guest_mon: info.month || null,
        guest_date: info.dates || null,
        guest_count: info.guests || null
      },
    ]);

    // =======================
    // MEMORY
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

    console.log("MEMORY:", { finalMonth, finalDates, finalGuests });

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

        reply = `Perfetto! Dal ${finalDates.from} al ${finalDates.to} ${finalMonth} per ${finalGuests} persone il totale è circa ${total}€.`;
      }
    }

    // =======================
    // FALLBACK AI
    // =======================

    if (!reply) {
      const ai = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Sei un assistente Airbnb. Se mancano date o ospiti chiedile."
          },
          {
            role: "user",
            content: text,
          },
        ],
      });

      reply = ai.choices[0].message.content;
    }

    console.log("REPLY:", reply);

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

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

    res.sendStatus(200);

  } catch (err) {
    console.log("ERROR:", err.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => res.send("OK"));

app.listen(process.env.PORT || 3001, () => {
  console.log("Server running");
});