const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔒 Anti-duplicati
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

    if (!msg || !msg.text) {
      return res.sendStatus(200);
    }

    // 🔒 blocco duplicati
    const messageId = msg.id;
    if (processedMessages.has(messageId)) {
      return res.sendStatus(200);
    }
    processedMessages.add(messageId);

    const from = msg.from;
    const text = msg.text.body;

    console.log("TEXT:", text);

    const info = extractInfo(text);

    // =======================
    // SALVA UTENTE
    // =======================

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

    // =======================
    // MEMORY
    // =======================

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

    console.log("FINAL MEMORY:", {
      finalMonth,
      finalDates,
      finalGuests
    });

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

        // 🔥 prezzo dinamico ospiti
        const multiplier = finalGuests > 2 ? 1.2 : 1;

        const total = Math.round(n * avg * multiplier);

        // 🤖 AI per risposta naturale
        const ai = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "Sei un host Airbnb cordiale, naturale e umano. Risposte brevi, amichevoli."
              },
              {
                role: "user",
                content: `
Cliente:
- mese: ${finalMonth}
- date: dal ${finalDates.from} al ${finalDates.to}
- ospiti: ${finalGuests}
- prezzo: ${total}€

Scrivi risposta naturale.
`
              }
            ]
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            }
          }
        );

        reply = ai.data.choices[0].message.content;
      }
    }

    // =======================
    // SMART FALLBACK
    // =======================

    if (!reply) {
      if (info.month && !info.dates && !info.guests) {
        reply = `A ${info.month} i prezzi variano un po’, ma siamo più o meno su quella fascia 😊 Se vuoi dimmi le date e ti faccio un calcolo preciso!`;
      } 
      else if (!finalMonth) {
        reply = "Per quale mese stai pensando di venire?";
      } 
      else if (!finalGuests) {
        reply = "Quante persone sarete?";
      } 
      else if (!finalDates) {
        reply = "Hai già delle date precise?";
      } 
      else {
        reply = "Controllo meglio i dettagli 😊";
      }
    }

    console.log("REPLY:", reply);

    // =======================
    // SALVA AI
    // =======================

    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply
      }
    ]);

    // =======================
    // INVIO WHATSAPP
    // =======================

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