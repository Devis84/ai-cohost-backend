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

function calculateTotal(start, end, rate) {
  if (!start || !end || !rate) return null;

  const startDate = new Date(`1970-01-01T${start}`);
  const endDate = new Date(`1970-01-01T${end}`);

  const hours = (endDate - startDate) / (1000 * 60 * 60);
  return Number((hours * rate).toFixed(2));
}

// ===== SUPABASE =====
async function supabaseFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

// =========================
// 🔐 WEBHOOK VERIFY
// =========================
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// =========================
// 📤 SEND MESSAGE
// =========================
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
        to,
        text: { body: text },
      }),
    }
  );
}

// =========================
// 📩 SAVE MESSAGE
// =========================
async function saveMessage(phone, message, role) {
  await supabaseFetch("messages", {
    method: "POST",
    body: JSON.stringify({
      phone: normalizePhone(phone),
      message,
      role,
    }),
  });
}

// =========================
// 🏠 BOOKING
// =========================
async function getBooking(phone) {
  const cleanPhone = normalizePhone(phone);

  const res = await supabaseFetch(
    `bookings?guest_phone=eq.${cleanPhone}`
  );

  const data = await res.json();
  return data[0];
}

// =========================
// 🧼 CLEANING CORE
// =========================
async function cleaningExists(booking_id) {
  const res = await supabaseFetch(
    `cleaning_tasks?booking_id=eq.${booking_id}`
  );

  const data = await res.json();
  return data.length > 0;
}

async function createCleaningTask(booking) {
  const exists = await cleaningExists(booking.id);
  if (exists) return;

  const payload = {
    property_id: booking.property_id,
    booking_id: booking.id,
    cleaning_date: booking.checkout,
    status: "pending",
  };

  const res = await supabaseFetch("cleaning_tasks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  console.log("🧹 Created cleaning:", data);
}

// =========================
// 📊 DASHBOARD API
// =========================

// 👉 GET ALL TASKS
app.get("/cleaning", async (req, res) => {
  const result = await supabaseFetch(
    "cleaning_tasks?order=cleaning_date.asc"
  );
  const data = await result.json();
  res.json(data);
});

// 👉 GET BY DATE RANGE (CALENDAR)
app.get("/cleaning/calendar", async (req, res) => {
  const { start, end } = req.query;

  const result = await supabaseFetch(
    `cleaning_tasks?cleaning_date=gte.${start}&cleaning_date=lte.${end}&order=cleaning_date.asc`
  );

  const data = await result.json();
  res.json(data);
});

// 👉 UPDATE TASK (CLEANER SYSTEM)
app.post("/cleaning/update", async (req, res) => {
  try {
    const {
      id,
      cleaner,
      start_time,
      end_time,
      hourly_rate,
      notes,
      status,
    } = req.body;

    const total_amount = calculateTotal(
      start_time,
      end_time,
      hourly_rate
    );

    const updates = {
      cleaner,
      start_time,
      end_time,
      hourly_rate,
      total_amount,
      notes,
      status,
    };

    await supabaseFetch(`cleaning_tasks?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });

    res.json({
      success: true,
      total_amount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "update failed" });
  }
});

// =========================
// 🤖 AI
// =========================
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

// =========================
// 📩 WEBHOOK
// =========================
app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    await saveMessage(from, text, "guest");

    const booking = await getBooking(from);
    if (booking) await createCleaningTask(booking);

    const reply = getReply(text);

    await sendMessage(from, reply);
    await saveMessage(from, reply, "assistant");

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// =========================
// ⏱ SCHEDULER
// =========================
async function runCleaningScheduler() {
  console.log("⏱ Sync cleaning...");

  const res = await supabaseFetch("bookings");
  const bookings = await res.json();

  for (const booking of bookings) {
    const exists = await cleaningExists(booking.id);
    if (!exists) {
      await createCleaningTask(booking);
    }
  }
}

// ogni 5 minuti
setInterval(runCleaningScheduler, 5 * 60 * 1000);

// =========================
// 🚀 START
// =========================
app.listen(10000, () => {
  console.log("🚀 Server running (PRO version)");
});