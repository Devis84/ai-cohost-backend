const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const processedMessages = new Set();

// =======================
// PARSER
// =======================

function extractInfo(text) {
  const lower = text.toLowerCase();

  const months = [
    "gennaio","febbraio","marzo","aprile","maggio","giugno",
    "luglio","agosto","settembre","ottobre","novembre","dicembre"
  ];

  let month = null;
  for (const m of months) {
    if (lower.includes(m)) month = m;
  }

  let dates = null;
  const dateMatch = lower.match(/(\d{1,2})\D+(\d{1,2})/);
  if (dateMatch) {
    const from = parseInt(dateMatch[1]);
    const to = parseInt(dateMatch[2]);
    if (to > from) dates = { from, to };
  }

  let guests = null;

  if (lower.includes("solo") || lower.includes("da solo")) {
    guests = 1;
  }

  const numbers = lower.match(/\d+/g);
  if (numbers) {
    for (const n of numbers) {
      const num = parseInt(n);

      if (dates && (num === dates.from || num === dates.to)) continue;

      if (num > 0 && num <= 10) {
        guests = num;
      }
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
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg || !msg.text) return res.sendStatus(200);

    if (processedMessages.has(msg.id)) return res.sendStatus(200);
    processedMessages.add(msg.id);

    const from = msg.from;
    const text = msg.text.body;

    const info = extractInfo(text);

    // salva
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

    // PRENDI SOLO ULTIMI 10
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: false })
      .limit(10);

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

    if (finalMonth && finalDates && finalGuests) {
      const { data: price } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      if (price) {
        const n = nights(finalDates);
        const avg = (price.price_min + price.price_max) / 2;
        const total = Math.round(n * avg);

        reply = `Perfetto 😊 Dal ${finalDates.from} al ${finalDates.to} ${finalMonth} per ${finalGuests} persona${finalGuests > 1 ? "e" : ""} il totale è circa ${total}€.`;
      }
    }

    if (!reply) {
      if (!finalMonth) reply = "Per quale mese?";
      else if (!finalGuests) reply = "Quante persone?";
      else if (!finalDates) reply = "Che date?";
      else reply = "Controllo meglio 😊";
    }

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply
      }
    ]);

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

app.listen(process.env.PORT || 3001);