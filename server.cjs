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
// LANGUAGE DETECTION
// =======================

function detectLanguage(text) {
  if (!text) return "it";
  const t = text.toLowerCase();

  if (t.match(/\b(hello|hi|thanks|price)\b/)) return "en";
  if (t.match(/\b(hola|gracias)\b/)) return "es";

  return "it";
}

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
// AI STYLE (SOLO RISCRITTURA)
// =======================

async function rewrite(text, lang) {
  const prompt = `
Riscrivi questo messaggio in ${lang} in modo:
- naturale
- amichevole
- breve
- umano

Messaggio:
"${text}"
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

    const lang = detectLanguage(text);
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

    let finalMonth = null;
    let finalDates = null;
    let finalGuests = null;

    for (const h of history) {
      if (!finalMonth && h.guest_month) finalMonth = h.guest_month;
      if (!finalDates && h.guest_dates) {
        try { finalDates = JSON.parse(h.guest_dates); } catch {}
      }
      if (!finalGuests && h.guest_count) finalGuests = h.guest_count;
    }

    // FLOW
    let baseReply;

    if (!finalMonth) {
      baseReply = "Per quale mese stai pensando?";
    } else if (!finalGuests) {
      baseReply = "Quante persone sarete?";
    } else if (!finalDates) {
      baseReply = "Hai già delle date precise?";
    } else {
      const { data: price } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      if (price) {
        const avg = (price.price_min + price.price_max) / 2;
        const total = Math.round(nights(finalDates) * avg);

        baseReply = `Dal ${finalDates.from} al ${finalDates.to} ${finalMonth} per ${finalGuests} persone siamo intorno ai ${total}€.

Vuoi che controllo la disponibilità?`;
      }
    }

    // LEAD TRIGGER
    if (
      finalMonth &&
      finalDates &&
      finalGuests &&
      text.toLowerCase().includes("va bene")
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

      baseReply = "Perfetto 🙌 Ti blocco la disponibilità. Come ti chiami?";
    }

    // AI rewrite
    const reply = await rewrite(baseReply, lang);

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