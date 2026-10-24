// Vercel serverless function: proxies AI requests to Groq so the API key
// never reaches the browser. Set GROQ_API_KEY in Vercel > Project > Settings >
// Environment Variables.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_PROMPT_CHARS = 20000;
const MAX_SYSTEM_CHARS = 4000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ code: "NO_API_KEY", error: "Server is missing GROQ_API_KEY" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const prompt = body && body.prompt;
  const system = (body && body.system) || "";

  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Missing prompt" });
  }
  if (prompt.length > MAX_PROMPT_CHARS || (typeof system === "string" && system.length > MAX_SYSTEM_CHARS)) {
    return res.status(413).json({ error: "Request is too long" });
  }

  const messages = [];
  if (typeof system === "string" && system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  try {
    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 2000,
        temperature: 0.7,
        messages
      })
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      if (upstream.status === 401) {
        return res.status(502).json({ code: "INVALID_KEY", error: "Groq rejected the server API key" });
      }
      if (upstream.status === 429) {
        return res.status(429).json({ error: "The AI is busy right now. Please wait a moment and try again." });
      }
      return res.status(502).json({ error: (data && data.error && data.error.message) || `Groq error ${upstream.status}` });
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      return res.status(502).json({ error: "Empty response from the AI" });
    }
    return res.status(200).json({ content });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the AI service" });
  }
};
