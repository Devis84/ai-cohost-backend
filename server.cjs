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

// 🔥 FIX DUPLICATI
const processed = new Set();

// =======================
// PARSER
// =======================

function extractInfo(text) {
  const t = text.toLowerCase();

  let month = null;
  if (t.includes("giugno")) month = "giugno";
  if (t.includes("luglio")) month = "luglio";

  let dates = null;
  const m = t.match(/(\d{1,2})\D+(\d{1,2})/);
  if (m) {
    const from = parseInt(m[1]);
    const to = parseInt(m[2]);
    if (to > from) dates = { from, to };
  }

  let guests = null;
  if (t.includes("solo")) guests = 1;

  const nums = t.match(/\d+/g);
  if (nums) {
    for (const n of nums) {
      const num = parseInt(n);
      if (dates && (num === dates.from || num === dates.to)) continue;
      if (num <= 10) guests = num;
    }
  }

  return { month, dates, guests };
}

function nights(d) {
  return d ? d.to - d.from : null;
}

// =======================
// WEBHOOK
// =======================

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // 🔥 IGNORA EVENTI NON MESSAGGI
    if (!value?.messages) {
      return res.sendStatus(200);
    }

    const msg = value.messages[0];

    // 🔥 IGNORA DUPLICATI
    if (processed.has(msg.id)) {
      return res.sendStatus(200);
    }
    processed.add(msg.id);

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) return res.sendStatus(200);

    console.log("TEXT:", text);

    const info = extractInfo(text);

    // SAVE USER
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
        guest_month: info.month,
        guest_dates: info.dates ? JSON.stringify(info.dates) : null,
        guest_count: info.guests
      }
    ]);

    // MEMORY
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: false })
      .limit(20);

    let finalMonth = info.month || null;
    let finalDates = info.dates || null;
    let finalGuests = info.guests || null;

    for (const h of history) {
      if (!finalMonth && h.guest_month) finalMonth = h.guest_month;

      if (!finalDates && h.guest_dates) {
        try {
          finalDates = JSON.parse(h.guest_dates);
        } catch {}
      }

      if (!finalGuests && h.guest_count) finalGuests = h.guest_count;
    }

    console.log("FINAL:", { finalMonth, finalDates, finalGuests });

    let reply;

    // FLOW
    if (!finalMonth) {
      reply = "Per quale mese stai pensando?";
    } else if (!finalGuests) {
      reply = "Quante persone sarete?";
    } else if (!finalDates) {
      reply = "Hai già delle date precise?";
    } else {
      const { data: price } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      if (price) {
        const avg = (price.price_min + price.price_max) / 2;
        const total = Math.round(nights(finalDates) * avg);

        reply = `Per le date dal ${finalDates.from} al ${finalDates.to} ${finalMonth}, per ${finalGuests} persone, il totale è circa ${total}€.

Se vuoi posso controllare la disponibilità 👍`;
      }
    }

    console.log("REPLY:", reply);

    // SAVE AI
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply
      }
    ]);

    // SEND
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
    console.log("ERROR:", err.message);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log("Server running");
});