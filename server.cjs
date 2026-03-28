const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body;
    if (!text) return res.sendStatus(200);

    console.log("TEXT:", text);

    const info = extractInfo(text);

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
        guest_month: info.month || null,
        guest_dates: info.dates ? JSON.stringify(info.dates) : null,
        guest_count: info.guests || null
      },
    ]);

    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true });

    let finalMonth = null;
    let finalDates = null;
    let finalGuests = null;

    for (const h of history) {
      if (h.guest_month) finalMonth = h.guest_month;

      if (h.guest_dates) {
        try {
          finalDates = JSON.parse(h.guest_dates);
        } catch {}
      }

      if (h.guest_count) finalGuests = h.guest_count;
    }

    console.log("FINAL MEMORY:", { finalMonth, finalDates, finalGuests });

    let reply = null;

    // =======================
    // PRICING
    // =======================

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

        reply = `Perfetto! Dal ${finalDates.from} al ${finalDates.to} ${finalMonth} per ${finalGuests} persone il totale è circa ${total}€ 😊\n\nSe vuoi, posso aiutarti anche con la disponibilità o altre info sull’alloggio!`;
      }
    }

    // =======================
    // SMART FALLBACK (NO LOOP)
    // =======================

    if (!reply) {

      if (!finalMonth) {
        reply = "Per quale mese stai pensando di soggiornare? 😊";
      }

      else if (!finalGuests) {
        reply = "Perfetto! Quante persone sarete?";
      }

      else if (!finalDates) {
        reply = "Hai già delle date precise per il soggiorno?";
      }

      else {
        reply = "Dammi un secondo che controllo meglio i dettagli 😊";
      }
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

app.listen(process.env.PORT || 3001, () => {
  console.log("Server running");
});