// api/chat.js  –  Vercel Serverless Function (uses Google Gemini – FREE tier)
import { createClient } from "@supabase/supabase-js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS headers so any browser can call this
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "No message provided" });

    // 1. Fetch ALL current bookings from Supabase
    const { data: bookings, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .order("check_in", { ascending: true });

    if (fetchErr) throw new Error("DB fetch failed: " + fetchErr.message);

    // 2. Ask Claude what to do
    const systemPrompt = `You are BookingBot, a smart room booking assistant.

CURRENT BOOKINGS IN DATABASE:
${JSON.stringify(bookings, null, 2)}

Your job: parse the user's natural language message and return ONLY a raw JSON object (no markdown, no backticks).

Schema:
{
  "intent": "ADD" | "UPDATE" | "CANCEL" | "QUERY" | "LIST",
  "data": {
    // For ADD:
    "rooms": ["1","2"],          // array of room numbers/names as strings
    "guest_name": "Pranav",
    "check_in": "2025-05-10",    // ISO date YYYY-MM-DD
    "check_out": "2025-05-28",
    "notes": ""

    // For UPDATE:
    "match_id": 5,               // booking id from database
    "updates": { ...fields... }

    // For CANCEL:
    "match_id": 5

    // For QUERY:
    "query_type": "by_room" | "by_guest" | "availability",
    "target": "Room 1"  // or guest name

    // For LIST: empty {}
  },
  "reply": "Friendly WhatsApp-style reply with emojis. Confirm the action taken or answer the query. For new bookings, include a short summary. Keep it under 5 lines."
}

Date rules: if year is missing, use 2025 or 2026 whichever is future. Always output ISO dates.
Be helpful, warm, and concise.`;

    const aiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + "

User message: " + message }] }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.2 }
      })
    });
    const aiJson = await aiRes.json();
    const raw = aiJson.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      return res.json({ reply: "Sorry, I had trouble understanding that. Try rephrasing! 😅", booking: null });
    }

    const { intent, data, reply } = parsed;
    let booking = null;

    // 3. Execute DB operation
    if (intent === "ADD" && data?.guest_name) {
      const { data: inserted, error } = await supabase
        .from("bookings")
        .insert([{
          rooms: data.rooms,
          guest_name: data.guest_name,
          check_in: data.check_in,
          check_out: data.check_out,
          notes: data.notes || "",
        }])
        .select()
        .single();
      if (error) throw new Error("Insert failed: " + error.message);
      booking = inserted;
    }

    if (intent === "UPDATE" && data?.match_id) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update(data.updates)
        .eq("id", data.match_id)
        .select()
        .single();
      if (error) throw new Error("Update failed: " + error.message);
      booking = updated;
    }

    if (intent === "CANCEL" && data?.match_id) {
      await supabase.from("bookings").delete().eq("id", data.match_id);
    }

    if (intent === "LIST") {
      booking = { list: bookings };
    }

    if (intent === "QUERY") {
      // Find matching bookings for the reply context
      let filtered = bookings;
      if (data?.query_type === "by_room") {
        filtered = bookings.filter(b =>
          b.rooms?.some(r => r.toString() === data.target?.replace(/room\s*/i, "").trim())
        );
      } else if (data?.query_type === "by_guest") {
        filtered = bookings.filter(b =>
          b.guest_name?.toLowerCase().includes(data.target?.toLowerCase())
        );
      }
      booking = { list: filtered };
    }

    return res.json({ reply, booking, intent });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ reply: "⚠️ Server error: " + err.message, booking: null });
  }
}
