// /api/generate.js
// Satu endpoint backend yang dipakai semua fitur (parafrase, PPT, jurnal, DoktrAI, skripsi, dll)
// API key disimpan aman di Environment Variables Vercel, TIDAK pernah terlihat di browser.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, task, messages, system } = req.body;

    if (!prompt && !messages) {
      return res.status(400).json({ error: 'Prompt atau messages wajib diisi' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key belum dikonfigurasi di server' });
    }

    const body = {
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: messages && messages.length ? messages : [{ role: 'user', content: prompt }],
    };
    if (system) body.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Terjadi kesalahan dari Anthropic API' });
    }

    const resultText = data.content?.[0]?.text || '';
    return res.status(200).json({ text: resultText, task, raw: data });

  } catch (err) {
    console.error('Generate API error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
}
