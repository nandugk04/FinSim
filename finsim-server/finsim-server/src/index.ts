import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GROQ_API_KEY;
const MODEL = "openai/gpt-oss-20b";

if (!API_KEY) {
  console.warn(
    "\n⚠️  GROQ_API_KEY is not set. Create a .env file (see .env.example) before calling /api/claude.\n"
  );
}

interface GroqChoice {
  message?: { content?: string };
}

interface GroqResponse {
  choices?: GroqChoice[];
}

app.post("/api/claude", async (req, res) => {
  const { prompt } = req.body as { prompt?: string };

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Request body must include a 'prompt' string." });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: "Server is missing GROQ_API_KEY." });
  }

  try {
    const apiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Groq API error:", apiRes.status, errText);
      return res.status(apiRes.status).json({ error: "Groq API request failed." });
    }

    const data = (await apiRes.json()) as GroqResponse;
    const text = data.choices?.[0]?.message?.content || "";

    res.json({ text });
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Unexpected server error." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`FinSim backend running at http://localhost:${PORT}`);
});

