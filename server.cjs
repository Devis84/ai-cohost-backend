function generateReply(msg, p) {
  if (!p) return "⚠️ Problema nel recupero dati.";

  const t = msg.toLowerCase().trim();

  const match = (...words) => words.some(w => t.includes(w));

  // WIFI
  if (match("wifi", "wi-fi", "internet")) {
    return p.wifi || "⚠️ WiFi non disponibile.";
  }

  // CHECK-IN / OUT
  if (match("check in", "checkin")) {
    return p.checkin || "⚠️ Check-in non disponibile.";
  }

  if (match("check out", "checkout")) {
    return p.checkout || "⚠️ Check-out non disponibile.";
  }

  // PARKING
  if (match("parcheggio", "parking", "car")) {
    return p.parking || "⚠️ Info parcheggio non disponibile.";
  }

  // RULES (🔥 FIX QUI)
  if (match(
    "regole",
    "rules",
    "party",
    "smoking",
    "rumore",
    "noise",
    "ospiti",
    "guests"
  )) {
    return p.house_rules || "⚠️ Regole non disponibili.";
  }

  // RESTAURANTS
  if (match("ristoranti", "food", "eat", "restaurant")) {
    return p.restaurants || "⚠️ Info ristoranti non disponibile.";
  }

  // TRANSPORT
  if (match("trasporti", "bus", "taxi", "uber")) {
    return p.transport || "⚠️ Info trasporti non disponibile.";
  }

  // LOCATION
  if (match("zona", "dove", "location", "area")) {
    return p.location_info || "⚠️ Info zona non disponibile.";
  }

  // EMERGENCY
  if (match("emergenza", "help", "numero", "emergency")) {
    return p.emergency_contact || "⚠️ Contatti non disponibili.";
  }

  // DEFAULT
  return "🙂 Posso aiutarti con WiFi, check-in, parcheggio, regole o info sulla zona.";
}