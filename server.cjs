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
// RULES
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

// =========================
// CLEANING TASK
// =========================
async function createCleaningTask(booking) {
  try {
    const cleaningDate = booking.checkout;

    const { data: existing } = await supabase
      .from("cleaning_tasks")
      .select("id")
      .eq("property_id", booking.property_id)
      .eq("cleaning_date", cleaningDate)
      .maybeSingle();

    if (existing) return;

    await supabase.from("cleaning_tasks").insert([
      {
        property_id: booking.property_id,
        booking_id: booking.id,
        cleaning_date: cleaningDate,
        status: "pending",
        hourly_rate: 10,
      },
    ]);

  } catch (err) {
    console.error("Cleaning error:", err);
  }
}

// =========================
// VERIFY
// =========================
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// =========================
// INCOMING
// =========================
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const messageId = message.id;
    const from = message.from;
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle();

    if (existing) return res.sendStatus(200);

    await supabase.from("messages").insert([
      {
        phone: from,
        role: "user",
        message: text,
        message_id: messageId,
      },
    ]);

    // =========================
    // BOOKING + CLEANING
    // =========================
    const { data: booking } = await supabase
      .from("bookings")
      .select("*")
      .eq("guest_phone", from)
      .limit(1)
      .maybeSingle();

    let bookingContext = "";

    if (booking) {
      await createCleaningTask(booking);

      bookingContext = `
Guest booking:
Property: ${booking.property_id}
Check-in: ${booking.checkin}
Check-out: ${booking.checkout}
`;
    }

    // =========================
    // RULES
    // =========================
    const ruleResponse = matchRule(text);

    if (ruleResponse) {
      await sendMessage(from, ruleResponse);
      return res.sendStatus(200);
    }

    // =========================
    // AI
    // =========================
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are an Airbnb co-host.

${bookingContext}

Be helpful and natural.
`,
        },
        {
          role: "user",
          content: text,
        },
      ],
    });

    const reply = completion.choices[0].message.content;

    await sendMessage(from, reply);

  } catch (err) {
    console.error(err);
  }

  res.sendStatus(200);
});

// =========================
// SEND
// =========================
async function sendMessage(to, text) {
  await supabase.from("messages").insert([
    {
      phone: to,
      role: "assistant",
      message: text,
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
      to,
      text: { body: text },
    }),
  });
}

app.listen(10000, () => console.log("🚀 Server running"));