const { createClient } = require("@supabase/supabase-js");
 
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
 
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
 
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "No message" });
 
    const { data: bookings, error: fetchErr } = await supabase
      .from("bookings").select("*").order("check_in", { ascending: true });
    if (fetchErr) throw new Error("DB fetch failed: " + fetchErr.message);
 
    const prompt = `You are BookingBot, a smart room booking assistant.
CURRENT BOOKINGS: ${JSON.stringify(bookings)}
Parse the user message and return ONLY raw JSON (no markdown, no backticks):
{
  "intent": "ADD"|"UPDATE"|"CANCEL"|"QUERY"|"LIST",
  "data": {
    "rooms": ["1"],
    "guest_name": "Name",
    "check_in": "2026-05-10",
    "check_out": "2026-05-28",
    "notes": "",
    "match_id": null,
    "updates": {},
    "query_type": "by_room",
    "target": ""
  },
  "reply": "Friendly reply with emojis under 5 lines"
}
Use year 2026 if missing. ISO dates only.
User message: ${message}`;
 
    const aiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.2 }
      })
    });
 
    const aiJson = await aiRes.json();
    const raw = (aiJson.candidates?.[0]?.content?.parts?.[0]?.text || "{}").replace(/```json|```/g, "").trim();
 
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return res.json({ reply: "Sorry, try rephrasing! 😅", booking: null }); }
 
    const { intent, data, reply } = parsed;
    let booking = null;
 
    if (intent === "ADD" && data?.guest_name) {
      const { data: inserted, error } = await supabase.from("bookings")
        .insert([{ rooms: data.rooms, guest_name: data.guest_name, check_in: data.check_in, check_out: data.check_out, notes: data.notes || "" }])
        .select().single();
      if (error) throw new Error("Insert failed: " + error.message);
      booking = inserted;
    }
    if (intent === "UPDATE" && data?.match_id) {
      const { data: updated, error } = await supabase.from("bookings")
        .update(data.updates).eq("id", data.match_id).select().single();
      if (error) throw new Error("Update failed: " + error.message);
      booking = updated;
    }
    if (intent === "CANCEL" && data?.match_id) {
      await supabase.from("bookings").delete().eq("id", data.match_id);
    }
    if (intent === "LIST") booking = { list: bookings };
    if (intent === "QUERY") {
      let filtered = bookings;
      if (data?.query_type === "by_room")
        filtered = bookings.filter(b => b.rooms?.some(r => r.toString() === data.target?.replace(/room\s*/i,"").trim()));
      else if (data?.query_type === "by_guest")
        filtered = bookings.filter(b => b.guest_name?.toLowerCase().includes(data.target?.toLowerCase()));
      booking = { list: filtered };
    }
 
    return res.json({ reply, booking, intent });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ reply: "⚠️ Server error: " + err.message, booking: null });
  }
};
