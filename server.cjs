const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const ACCESS_TOKEN = process.env.META_TOKEN;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ===== UTILS =====
function normalizePhone(phone) {
  return phone.replace("+", "").trim();
}

// ===== WEBHOOK VERIFY =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ===== SEND MESSAGE =====
async function sendMessage(to, text) {
  await fetch(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        text: { body: text },
      }),
    }
  );
}

// ===== GET BOOKING =====
async function getBookingByPhone(phone) {
  const cleanPhone = normalizePhone(phone);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?guest_phone=eq.${cleanPhone}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  const data = await res.json();
  return data[0];
}

// ===== CREATE CLEANING TASK =====
async function createCleaningTask(booking) {
  if (!booking) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/cleaning_tasks`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      property_id: booking.property_id,
      booking_id: booking.id,
      cleaning_date: booking.checkout,
      status: "pending",
    }),
  });

  const data = await res.text();
  console.log("Cleaning created:", data);
}

// ===== SAVE MESSAGE =====
async function saveMessage(phone, message, role) {
  await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone: normalizePhone(phone),
      message,
      role,
    }),
  });
}

// ===== AI =====
function getReply(text) {
  const msg = text.toLowerCase();

  if (msg.includes("wifi")) {
    return "📶 Network: ARRIS-6F59\n🔑 Password: Malta2025";
  }

  if (msg.includes("parking")) {
    return "🚗 Free street parking nearby. No private parking.";
  }

  if (msg.includes("check-in")) {
    return "Check-in is from 15:00 (3 PM).";
  }

  if (msg.includes("early")) {
    return "Early check-in may be possible depending on availability.";
  }

  return "Sorry, I didn't understand.";
}

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    console.log("Incoming:", from, text);

    await saveMessage(from, text, "guest");

    const booking = await getBookingByPhone(from);

    if (booking) {
      await createCleaningTask(booking);
    } else {
      console.log("Booking NOT found");
    }

    const reply = getReply(text);

    await sendMessage(from, reply);
    await saveMessage(from, reply, "assistant");

    res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err);
    res.sendStatus(500);
  }
});

// ===== START =====
app.listen(10000, () => {
  console.log("Server running on port 10000");
});