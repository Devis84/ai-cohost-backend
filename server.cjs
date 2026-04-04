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

// ===== UPDATE CLEANING (FIX SERIO) =====
async function updateCleaningTask(id, updates) {
  const cleanPayload = {};

  // 👇 invia SOLO campi validi
  for (const key in updates) {
    if (updates[key] !== undefined && updates[key] !== null) {
      cleanPayload[key] = updates[key];
    }
  }

  const res = await supabaseFetch(`cleaning_tasks?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(cleanPayload),
  });

  if (!res.ok) {
    console.error("❌ Update error:", await res.text());
    return false;
  }

  const result = await res.text();
  console.log("✅ Updated:", result);

  return true;
}

// ===== CALCOLO COSTO =====
function calculateTotal(start_time, end_time, hourly_rate) {
  if (!start_time || !end_time || !hourly_rate) return null;

  const [sh, sm] = start_time.split(":").map(Number);
  const [eh, em] = end_time.split(":").map(Number);

  const start = sh + sm / 60;
  const end = eh + em / 60;

  const hours = end - start;
  return Math.round(hours * hourly_rate * 100) / 100;
}

// ===== UPDATE API =====
app.post("/cleaning/update", async (req, res) => {
  try {
    const { id, cleaner, start_time, end_time, hourly_rate, notes, status } =
      req.body;

    if (!id) {
      return res.status(400).send("❌ Missing ID");
    }

    const total_amount = calculateTotal(
      start_time,
      end_time,
      hourly_rate
    );

    const success = await updateCleaningTask(id, {
      cleaner,
      start_time,
      end_time,
      hourly_rate,
      total_amount,
      notes,
      status,
    });

    if (!success) {
      return res.status(500).send("❌ Update failed");
    }

    res.send("✅ Cleaning updated");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Error");
  }
});

// ===== START =====
app.listen(10000, () => {
  console.log("🚀 CLEANING FIX READY");
});