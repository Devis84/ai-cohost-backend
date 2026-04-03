const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const ACCESS_TOKEN = process.env.META_TOKEN;

const CLEANER_PHONE = process.env.CLEANER_PHONE;

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
        to,
        text: { body: text },
      }),
    }
  );
}

// ===== NOTIFY CLEANER =====
async function notifyCleaner(task) {
  if (!CLEANER_PHONE) return;

  const msg = `🧼 New cleaning task

Property: ${task.property_id}
Date: ${task.cleaning_date}

Please confirm.`;

  await sendMessage(CLEANER_PHONE, msg);
}

// ===== BOOKING =====
async function getBooking(phone) {
  const res = await supabaseFetch(
    `bookings?guest_phone=eq.${normalizePhone(phone)}`
  );
  const data = await res.json();
  return data[0];
}

// ===== CLEANING =====
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

  if (data[0]) {
    await notifyCleaner(data[0]);
  }
}

// ===== DASHBOARD API =====
app.get("/cleaning", async (req, res) => {
  const result = await supabaseFetch(
    "cleaning_tasks?order=cleaning_date.asc"
  );
  const data = await result.json();
  res.json(data);
});

app.get("/cleaning/calendar", async (req, res) => {
  const { start, end } = req.query;

  const result = await supabaseFetch(
    `cleaning_tasks?cleaning_date=gte.${start}&cleaning_date=lte.${end}&order=cleaning_date.asc`
  );

  const data = await result.json();
  res.json(data);
});

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

    res.json({ success: true, total_amount });
  } catch (err) {
    res.status(500).json({ error: "update failed" });
  }
});

// ===== SIMPLE DASHBOARD UI =====
app.get("/", (req, res) => {
  res.send(`
  <html>
  <body>
    <h2>🧼 Cleaning Dashboard</h2>
    <button onclick="load()">Load Tasks</button>
    <pre id="out"></pre>

    <script>
      async function load() {
        const res = await fetch('/cleaning');
        const data = await res.json();
        document.getElementById('out').innerText = JSON.stringify(data, null, 2);
      }
    </script>
  </body>
  </html>
  `);
});

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    const booking = await getBooking(from);
    if (booking) await createCleaningTask(booking);

    await sendMessage(from, "Message received");

    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(500);
  }
});

// ===== SCHEDULER =====
async function runCleaningScheduler() {
  const res = await supabaseFetch("bookings");
  const bookings = await res.json();

  for (const booking of bookings) {
    const exists = await cleaningExists(booking.id);
    if (!exists) {
      await createCleaningTask(booking);
    }
  }
}

setInterval(runCleaningScheduler, 5 * 60 * 1000);

// ===== START =====
app.listen(10000, () => {
  console.log("🚀 PRO MAX system running");
});