const { createClient } = require("@supabase/supabase-js");
 
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
 
const AVAILABLE_ROOMS = ["1", "2", "3"];
 
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
 
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ reply: "No message provided", booking: null });
 
    const { data: bookings, error: fetchErr } = await supabase
      .from("bookings").select("*").order("check_in", { ascending: true });
    if (fetchErr) throw new Error("DB fetch failed: " + fetchErr.message);
 
    const prompt = `You are BookingBot, a friendly room booking assistant for a property with exactly 3 rooms: Room 1, Room 2, and Room 3.
 
AVAILABLE ROOMS: Room 1, Room 2, Room 3 (these are the only rooms that exist)
CURRENT BOOKINGS IN DATABASE: ${JSON.stringify(bookings)}
 
The user says: "${message}"
 
Respond with ONLY a valid JSON object. No markdown. No backticks. Just raw JSON:
{
  "intent": "ADD or UPDATE or CANCEL or QUERY or LIST",
  "data": {
    "rooms": ["1", "2"],
    "guest_name": "Name Here",
    "check_in": "2026-05-10",
    "check_out": "2026-05-28",
    "amount": 23000,
    "notes": "",
    "match_id": null,
    "updates": {},
    "query_type": "by_room",
    "target": ""
  },
  "reply": "Your friendly reply with emojis. Always mention room numbers, guest name, dates, and amount (in ₹ rupees) when relevant."
}
 
Rules:
- Only Room 1, Room 2, Room 3 exist. If asked about other rooms say they don't exist.
- amount is in Indian Rupees (₹). Extract it from messages like "23000 rupees" or "Rs 5000" or "₹10000". Default 0 if not mentioned.
- Always show amount as ₹XX,XXX format in reply
- Use year 2026 if year not mentioned
- Dates must be YYYY-MM-DD
- For QUERY by availability: check if any booking exists for that room in the requested period. If no bookings for that room, it is available.
- reply must always be helpful and friendly`;
 
    const aiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.1 }
      })
    });
 
    if (!aiRes.ok) throw new Error("Gemini API error: " + await aiRes.text());
 
    const aiJson = await aiRes.json();
    const rawText = aiJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
 
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return res.json({ reply: rawText || "I understood but couldn't process. Try again!", booking: null, intent: "UNKNOWN" }); }
 
    const { intent, data, reply } = parsed;
    let booking = null;
 
    if (intent === "ADD" && data && data.guest_name) {
      const { data: inserted, error } = await supabase.from("bookings")
        .insert([{
          rooms: data.rooms || [],
          guest_name: data.guest_name,
          check_in: data.check_in,
          check_out: data.check_out,
          amount: data.amount || 0,
          notes: data.notes || ""
        }])
        .select().single();
      if (error) throw new Error("Insert failed: " + error.message);
      booking = inserted;
    }
 
    if (intent === "UPDATE" && data && data.match_id) {
      const { data: updated, error } = await supabase.from("bookings")
        .update(data.updates).eq("id", data.match_id).select().single();
      if (error) throw new Error("Update failed: " + error.message);
      booking = updated;
    }
 
    if (intent === "CANCEL" && data && data.match_id) {
      await supabase.from("bookings").delete().eq("id", data.match_id);
    }
 
    if (intent === "LIST") booking = { list: bookings };
 
    if (intent === "QUERY") {
      let filtered = bookings;
      if (data && data.query_type === "by_room" && data.target) {
        const roomNum = data.target.replace(/room\s*/i, "").trim();
        filtered = bookings.filter(b => b.rooms && b.rooms.some(r => r.toString() === roomNum));
      } else if (data && data.query_type === "by_guest" && data.target) {
        filtered = bookings.filter(b => b.guest_name && b.guest_name.toLowerCase().includes(data.target.toLowerCase()));
      }
      booking = { list: filtered };
    }
 
    return res.json({ reply: reply || "Done! ✅", booking, intent });
 
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ reply: "⚠️ Error: " + err.message, booking: null });
  }
};
