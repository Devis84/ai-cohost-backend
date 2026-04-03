const express = require("express");
const bodyParser = require("body-parser");
const ical = require("node-ical");

const app = express();
app.use(bodyParser.json());

const ICAL_URL = process.env.ICAL_URL;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// 👇 PROPERTY CONFIG (SCALABILE)
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

  const data = await res.json();
  console.log("📅 Booking created:", data);
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
  console.log("🧹 Cleaning created:", data);
}

// ===== ICAL SYNC =====
async function runIcalSync() {
  try {
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

// ===== MANUAL TEST =====
app.get("/sync", async (req, res) => {
  await runFullSync();
  res.send("✅ Sync completed");
});

// ===== SCHEDULER =====
setInterval(runFullSync, 5 * 60 * 1000);

// ===== START =====
app.listen(10000, () => {
  console.log("🚀 ICAL SYSTEM READY (Maltese Maisonette)");
});