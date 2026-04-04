const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express = require("express");
const bodyParser = require("body-parser");
const ical = require("node-ical");

const app = express();
app.use(bodyParser.json());

const ICAL_URL = process.env.ICAL_URL;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const PROPERTY = {
  id: "maltese_maisonette",
  name: "Maltese Maisonette",
};

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

// ===== BOOKING EXISTS =====
async function bookingExists(checkin, checkout) {
  const res = await supabaseFetch(
    `bookings?property_id=eq.${PROPERTY.id}&checkin=eq.${checkin}&checkout=eq.${checkout}`
  );
  const data = await res.json();
  return data.length > 0;
}

// ===== CREATE BOOKING =====
async function createBooking(checkin, checkout) {
  const exists = await bookingExists(checkin, checkout);
  if (exists) return;

  const payload = {
    guest_phone: "ical",
    property_id: PROPERTY.id,
    checkin,
    checkout,
  };

  const res = await supabaseFetch("bookings", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("❌ Booking error:", await res.text());
    return;
  }

  const data = await res.json();
  console.log("📅 Booking created:", data);
}

// ===== CLEANING EXISTS =====
async function cleaningExists(booking_id) {
  const res = await supabaseFetch(
    `cleaning_tasks?booking_id=eq.${booking_id}`
  );
  const data = await res.json();
  return data.length > 0;
}

// ===== CREATE CLEANING =====
async function createCleaningTask(booking) {
  const exists = await cleaningExists(booking.id);
  if (exists) return;

  const payload = {
    property_id: booking.property_id,
    booking_id: booking.id,
    cleaning_date: booking.checkout,
    status: "pending",
    cleaner: null,
    hourly_rate: null,
    start_time: null,
    end_time: null,
    total_amount: null,
    notes: null,
  };

  const res = await supabaseFetch("cleaning_tasks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("❌ Cleaning error:", await res.text());
    return;
  }

  const data = await res.json();
  console.log("🧹 Cleaning created:", data);
}

// ===== UPDATE CLEANING =====
async function updateCleaningTask(id, updates) {
  const res = await supabaseFetch(`cleaning_tasks?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    console.error("❌ Update error:", await res.text());
    return;
  }

  console.log("✅ Cleaning updated");
}

// ===== CALCULATE COST =====
function calculateTotal(start_time, end_time, hourly_rate) {
  if (!start_time || !end_time || !hourly_rate) return null;

  const start = new Date(`1970-01-01T${start_time}`);
  const end = new Date(`1970-01-01T${end_time}`);

  const hours = (end - start) / (1000 * 60 * 60);
  return Math.round(hours * hourly_rate * 100) / 100;
}

// ===== ICAL SYNC =====
async function runIcalSync() {
  try {
    if (!ICAL_URL) throw new Error("ICAL_URL missing");

    console.log("🔄 Syncing iCal for:", PROPERTY.name);

    const data = await ical.async.fromURL(ICAL_URL);

    for (const k in data) {
      const event = data[k];

      if (event.type === "VEVENT") {
        const checkin = event.start.toISOString().split("T")[0];
        const checkout = event.end.toISOString().split("T")[0];

        await createBooking(checkin, checkout);
      }
    }
  } catch (err) {
    console.error("❌ iCal error:", err);
  }
}

// ===== CLEANING SYNC =====
async function runCleaningSync() {
  const res = await supabaseFetch(
    `bookings?property_id=eq.${PROPERTY.id}`
  );

  const bookings = await res.json();

  for (const booking of bookings) {
    await createCleaningTask(booking);
  }
}

// ===== FULL SYNC =====
async function runFullSync() {
  await runIcalSync();
  await runCleaningSync();
}

// ===== MANUAL SYNC =====
app.get("/sync", async (req, res) => {
  try {
    await runFullSync();
    res.send("✅ Sync completed");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Sync failed");
  }
});

// ===== UPDATE CLEANING API =====
app.post("/cleaning/update", async (req, res) => {
  try {
    const { id, cleaner, start_time, end_time, hourly_rate, notes, status } =
      req.body;

    const total_amount = calculateTotal(
      start_time,
      end_time,
      hourly_rate
    );

    await updateCleaningTask(id, {
      cleaner,
      start_time,
      end_time,
      hourly_rate,
      total_amount,
      notes,
      status,
    });

    res.send("✅ Cleaning updated");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Update failed");
  }
});

// ===== GET CLEANING =====
app.get("/cleaning", async (req, res) => {
  const response = await supabaseFetch(
    `cleaning_tasks?property_id=eq.${PROPERTY.id}&order=cleaning_date.asc`
  );

  const data = await response.json();
  res.json(data);
});

// ===== SCHEDULER =====
setInterval(runFullSync, 5 * 60 * 1000);

// ===== START =====
app.listen(10000, () => {
  console.log("🚀 CLEANING SYSTEM FINAL READY");
});