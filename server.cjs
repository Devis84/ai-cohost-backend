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
// AI TEXT GENERATOR (SOLO STILE)
// =======================

async function generateText(message) {
  const prompt = `
Riscrivi questo messaggio in modo:
- naturale
- amichevole
- commerciale leggero
- breve

Messaggio:
"${message}"
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
      .limit(15);

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

    let baseReply = null;

    // =======================
    // FLOW CONTROLLATO
    // =======================

    if (!finalMonth) {
      baseReply = "Per quale mese stai pensando?";
    }

    else if (!finalGuests) {
      baseReply = "Quante persone sarete?";
    }

    else if (!finalDates) {
      baseReply = "Hai già delle date precise?";
    }

    else {
      // PRICING
      const { data: price } = await supabase
        .from("pricing")
        .select("*")
        .eq("month", finalMonth)
        .single();

      if (price) {
        const avg = (price.price_min + price.price_max) / 2;
        const total = Math.round(nights(finalDates) * avg);

        baseReply = `Per le date dal ${finalDates.from} al ${finalDates.to} ${finalMonth}, per ${finalGuests} persone, il totale è circa ${total}€.

Se vuoi posso controllare subito la disponibilità 👍`;
      }
    }

    // =======================
    // LEAD
    // =======================

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

      baseReply = `Perfetto 🙌 Ti blocco la disponibilità.

Posso chiederti il nome?`;
    }

    // =======================
    // AI REWRITE
    // =======================

    const reply = await generateText(baseReply);

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