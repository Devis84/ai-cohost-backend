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
  const match = lower.match(/(\d{1,2})\D+(\d{1,2})/);
  if (match) {
    const from = parseInt(match[1]);
    const to = parseInt(match[2]);
    if (to > from) dates = { from, to };
  }

  let guests = null;

  if (lower.includes("solo")) guests = 1;

  const numbers = lower.match(/\d+/g);
  if (numbers) {
    for (const n of numbers) {
      const num = parseInt(n);
      if (dates && (num === dates.from || num === dates.to)) continue;
      if (num > 0 && num <= 10) guests = num;
    }
  }

  return { month, dates, guests };
}

function nights(d) {
  return d ? d.to - d.from : null;
}

// =======================
// INTENT
// =======================

function detectIntent(text) {
  const t = text.toLowerCase();

  if (t.includes("meno") && t.includes("costa")) return "PRICE_HINT";
  if (t.includes("ciao") || t.includes("salve")) return "GREETING";
  if (t === "si" || t === "sì" || t.includes("ok") || t.includes("grazie")) return "YES";

  return "NORMAL";
}

// =======================
// AI RESPONSE
// =======================

async function generateReply(context) {
  const prompt = `
Sei un host Airbnb molto bravo a comunicare.

Tono:
- naturale
- amichevole
- commerciale (ma non aggressivo)
- breve (max 3-4 righe)

Dati cliente:
- mese: ${context.month || "non specificato"}
- date: ${context.dates ? `${context.dates.from}-${context.dates.to}` : "non specificate"}
- ospiti: ${context.guests || "non specificato"}
- prezzo: ${context.price || "non disponibile"}

Regole IMPORTANTI:
- NON inventare prezzi
- se manca qualcosa, chiedilo in modo naturale
- se hai prezzo, comunicalo bene e invita all'azione
- NON ripetere frasi uguali
- NON sembrare robot

Rispondi al messaggio: "${context.userText}"
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });

  return res.choices[0].message.content;
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

    console.log("TEXT:", text);

    const intent = detectIntent(text);
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

    let priceData = null;

    if (finalMonth) {
      const { data } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      priceData = data;
    }

    let totalPrice = null;

    if (priceData && finalDates && finalGuests) {
      const n = nights(finalDates);
      const avg = (priceData.price_min + priceData.price_max) / 2;
      totalPrice = Math.round(n * avg);
    }

    // =======================
    // INTENT OVERRIDE
    // =======================

    let reply = null;

    if (intent === "PRICE_HINT") {
      reply = `Di solito giugno e settembre sono più economici 😊

Luglio e agosto sono più richiesti, quindi un po' più cari.

Se vuoi, dimmi delle date e ti faccio un calcolo preciso 👍`;
    }

    // =======================
    // AI RESPONSE (CORE)
    // =======================

    if (!reply) {
      reply = await generateReply({
        month: finalMonth,
        dates: finalDates,
        guests: finalGuests,
        price: totalPrice,
        userText: text
      });
    }

    // =======================
    // LEAD
    // =======================

    if (finalMonth && finalDates && finalGuests && text.toLowerCase().includes("va bene")) {
      await supabase.from("leads").insert([
        {
          phone: from,
          month: finalMonth,
          dates: JSON.stringify(finalDates),
          guests: finalGuests
        }
      ]);

      reply += `

Perfetto 🙌 Ti blocco la disponibilità.

Posso chiederti il nome?`;
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