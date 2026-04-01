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

const processed = new Set();

// =======================
// PARSER
// =======================

function extractInfo(text) {
  const t = text.toLowerCase();

  let month = null;
  if (t.includes("giugno")) month = "giugno";
  if (t.includes("luglio")) month = "luglio";
  if (t.includes("maggio")) month = "maggio";

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
// AI CORE
// =======================

async function generateReply(context) {
  const prompt = `
Sei un assistente per affitti brevi.

DATI:
${JSON.stringify(context)}

OBIETTIVO:
- capire cosa manca
- fare UNA domanda alla volta
- oppure rispondere

REGOLE:
- NON ripetere domande
- NON usare frasi tipo "mi sembra"
- breve e naturale
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
    const value = req.body.entry?.[0]?.changes?.[0]?.value;

    if (!value?.messages) return res.sendStatus(200);

    const msg = value.messages[0];

    if (processed.has(msg.id)) return res.sendStatus(200);
    processed.add(msg.id);

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) return res.sendStatus(200);

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

    // =======================
    // MEMORY FIX (IMPORTANTISSIMO)
    // =======================

    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true }); // 👈 ordine corretto

    let finalMonth = null;
    let finalDates = null;
    let finalGuests = null;

    for (const h of history) {
      // 👉 SOVRASCRIVE SEMPRE (ultimo vince)
      if (h.guest_month) finalMonth = h.guest_month;

      if (h.guest_dates) {
        try {
          finalDates = JSON.parse(h.guest_dates);
        } catch {}
      }

      if (h.guest_count) finalGuests = h.guest_count;
    }

    // =======================
    // PRICING
    // =======================

    let priceInfo = null;

    if (finalMonth && finalDates && finalGuests) {
      const { data: price } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      if (price) {
        const avg = (price.price_min + price.price_max) / 2;
        const total = Math.round(nights(finalDates) * avg);

        priceInfo = {
          total,
          from: finalDates.from,
          to: finalDates.to,
          month: finalMonth,
          guests: finalGuests
        };
      }
    }

    // =======================
    // FLOW
    // =======================

    let reply;

    if (priceInfo) {
      reply = `Dal ${priceInfo.from} al ${priceInfo.to} ${priceInfo.month} per ${priceInfo.guests} persone il totale è circa ${priceInfo.total}€. Vuoi che controlli la disponibilità?`;
    } else {
      const context = {
        message: text,
        month: finalMonth,
        dates: finalDates,
        guests: finalGuests
      };

      reply = await generateReply(context);
    }

    // =======================
    // LEAD
    // =======================

    if (
      finalMonth &&
      finalDates &&
      finalGuests &&
      text.toLowerCase().includes("ok")
    ) {
      await supabase.from("leads").insert([
        {
          phone: from,
          month: finalMonth,
          dates: JSON.stringify(finalDates),
          guests: finalGuests,
          status: "new",
          created_at: new Date().toISOString()
        }
      ]);

      reply = "Perfetto 🙌 Ti blocco la disponibilità. Come ti chiami?";
    }

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