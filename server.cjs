const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const ACCESS_TOKEN = process.env.META_TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// 🧠 RULES ENGINE
// =========================
const rules = [
  {
    keywords: ["wifi"],
    response: "📶 Network: ARRIS-6F59\n🔑 Password: Malta2025",
  },
  {
    keywords: ["parking"],
    response: "🚗 Free street parking nearby. No private parking.",
  },
];

function matchRule(text) {
  const lower = text.toLowerCase();
  for (let rule of rules) {
    for (let keyword of rule.keywords) {
      if (lower.includes(keyword)) return rule.response;
    }
  }
  return null;
}

// 🔐 VERIFY
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// 📩 INCOMING
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const messageId = message.id;
    const from = message.from;
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    // 🔒 DUPLICATE CHECK
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle();

    if (existing) return res.sendStatus(200);

    // 💾 salva messaggio
    await supabase.from("messages").insert([
      {
        phone: from,
        role: "user",
        message: text,
        message_id: messageId,
      },
    ]);

    // =========================
    // 🏠 BOOKING CONTEXT (FIXED)
    // =========================
    const { data: booking } = await supabase
      .from("bookings")
      .select("*")
      .eq("guest_phone", from) // 👈 FIX
      .limit(1)
      .maybeSingle();

    let bookingContext = "";

    if (booking) {
      const today = new Date();
      const checkIn = new Date(booking.checkin);
      const checkOut = new Date(booking.checkout);

      let status = "unknown";

      if (today < checkIn) status = "before check-in";
      else if (today >= checkIn && today <= checkOut) status = "during stay";
      else status = "after check-out";

      bookingContext = `
Guest booking:
Property: ${booking.property_id}
Check-in: ${booking.checkin}
Check-out: ${booking.checkout}
Status: ${status}
`;
    }

    // =========================
    // ⚡ RULES
    // =========================
    const ruleResponse = matchRule(text);

    if (ruleResponse) {
      await supabase.from("messages").insert([
        {
          phone: from,
          role: "assistant",
          message: ruleResponse,
        },
      ]);

      await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: ruleResponse },
        }),
      });

      return res.sendStatus(200);
    }

    // =========================
    // 🤖 AI
    // =========================
    const { data: history } = await supabase
      .from("messages")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: false })
      .limit(10);

    const messages = history.reverse().map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.message,
    }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are an Airbnb co-host.

${bookingContext}

Be helpful, friendly and concise.
`,
        },
        ...messages,
      ],
    });

    const reply = completion.choices[0].message.content;

    await supabase.from("messages").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

    await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      }),
    });

  } catch (err) {
    console.error(err);
  }

  res.sendStatus(200);
});

app.listen(10000, () => console.log("🚀 Server running"));