// /api/jurnal-template.js
// Konversi Skripsi → Jurnal dengan Template
// TANPA dependency eksternal (jszip/xmldom dihapus — tidak kompatibel Vercel)
// Output: JSON teks jurnal (download .docx dihandle di browser pakai docx.js)

const { createClient } = require("@supabase/supabase-js");
const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";

function todayJakarta() {
  const now = new Date();
  const jakarta = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
  );
  return `${jakarta.getFullYear()}-${String(jakarta.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(jakarta.getDate()).padStart(2, "0")}`;
}
function truncate(text, max) {
  text = (text || "").trim();
  return text.length > max ? text.slice(0, max) + "\n...[dipotong]" : text;
}
function extractTextFromDocxXml(xmlString) {
  const matches = xmlString.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  return matches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ");
}
function detectPlaceholders(text) {
  const matches = text.match(/\{\{[^}]+\}\}/g) || [];
  return [...new Set(matches)];
}
function detectSections(text) {
  const lines = text
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);
  const sections = [];
  const pat =
    /^(JUDUL|ABSTRAK|ABSTRACT|KATA KUNCI|KEYWORDS|PENDAHULUAN|INTRODUCTION|TINJAUAN|METODE|METHOD|HASIL|RESULT|PEMBAHASAN|DISCUSSION|KESIMPULAN|CONCLUSION|DAFTAR PUSTAKA|REFERENCES|[IVX]+\.|[A-Z][A-Z\s]{3,}:?)$/i;
  lines.forEach((line) => {
    if (pat.test(line) && line.length < 60) sections.push(line);
  });
  return sections;
}

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const token = (req.headers.authorization || "")
      .replace("Bearer ", "")
      .trim();
    if (!token) return res.status(401).json({ error: "Wajib login." });
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey)
      return res
        .status(500)
        .json({ error: "Konfigurasi server belum lengkap." });
    const sbAdmin = createClient(SUPABASE_URL, serviceKey);
    const { data: userData, error: userErr } = await sbAdmin.auth.getUser(
      token
    );
    if (userErr || !userData?.user)
      return res.status(401).json({ error: "Sesi login tidak valid." });
    const userId = userData.user.id;
    const { data: profile } = await sbAdmin
      .from("profiles")
      .select("blocked")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.blocked)
      return res.status(403).json({ error: "Akun diblokir." });
    const day = todayJakarta();
    const { data: usageRow } = await sbAdmin
      .from("usage_tracking")
      .select("request_count")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    if ((usageRow?.request_count || 0) >= 100)
      return res
        .status(429)
        .json({ error: "Batas pemakaian harian tercapai." });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
      return res.status(500).json({ error: "API key belum dikonfigurasi." });

    const {
      skripsiText,
      templateText,
      templateDocxXml,
      prompt,
      judul,
      targetKata,
    } = req.body || {};
    if (!skripsiText)
      return res.status(400).json({ error: "Teks skripsi wajib diisi." });

    const templateContent =
      templateText ||
      (templateDocxXml ? extractTextFromDocxXml(templateDocxXml) : "");
    const placeholders = templateContent
      ? detectPlaceholders(templateContent)
      : [];
    const sections = templateContent ? detectSections(templateContent) : [];
    const hasStructure = placeholders.length > 0 || sections.length > 0;

    let sectionGuide = hasStructure
      ? placeholders.length > 0
        ? `\nTemplate memiliki placeholder berikut yang harus diisi:\n${placeholders.join(
            ", "
          )}\n`
        : `\nIkuti urutan bagian template:\n${sections.join("\n")}\n`
      : `\nGunakan format: Judul, Abstrak (ID & EN), Kata Kunci, Pendahuluan, Metode, Hasil dan Pembahasan, Kesimpulan, Daftar Pustaka.\n`;

    const systemPrompt = `Kamu adalah ahli penulisan jurnal ilmiah Indonesia. Konversi isi skripsi menjadi artikel jurnal akademik. Gunakan Bahasa Indonesia formal. Jangan gunakan simbol markdown heading (#).`;
    const userPrompt = `${
      prompt || "Konversi skripsi ini menjadi artikel jurnal ilmiah:"
    }\n\n=== ISI SKRIPSI ===\n${truncate(skripsiText, 12000)}\n\n${
      templateContent
        ? `=== TEKS TEMPLATE ===\n${truncate(templateContent, 2500)}\n`
        : ""
    }${sectionGuide}\nTarget: ±${
      targetKata || 3000
    } kata. Tulis LENGKAP semua bagian.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: Math.min(
          16000,
          Math.max(4000, parseInt(targetKata || 3000) * 2)
        ),
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok)
      throw new Error(
        (aiData.error && aiData.error.message) || "Anthropic API error"
      );
    const aiText = (
      (aiData.content && aiData.content[0] && aiData.content[0].text) ||
      ""
    ).trim();

    let placeholderData = null;
    if (placeholders.length > 0 && aiText) {
      const phRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 3000,
          system: "Balas HANYA JSON valid tanpa backtick.",
          messages: [
            {
              role: "user",
              content: `Dari konten jurnal:\n\n${truncate(
                aiText,
                5000
              )}\n\nIsi placeholder ini dengan konten sesuai. Balas HANYA JSON:\n{\n${placeholders
                .map((p) => `  "${p}": "isi konten"`)
                .join(",\n")}\n}`,
            },
          ],
        }),
      });
      const phData = await phRes.json();
      const phText = (
        (phData.content && phData.content[0] && phData.content[0].text) ||
        ""
      ).trim();
      try {
        placeholderData = JSON.parse(
          phText
            .replace(/^```json\s*/i, "")
            .replace(/```\s*$/, "")
            .trim()
        );
      } catch (e) {}
    }

    try {
      await sbAdmin.rpc("increment_api_usage", {
        p_user_id: userId,
        p_day: day,
      });
    } catch (e) {}

    return res.status(200).json({
      aiText,
      placeholderData,
      templateSections: sections,
      hasPlaceholders: placeholders.length > 0,
      mode: hasStructure ? "template-guided" : "standard",
      modeLabel:
        placeholders.length > 0
          ? "Inject ke Placeholder"
          : sections.length > 0
          ? "Ikuti Struktur Template"
          : "Format Standar",
    });
  } catch (err) {
    console.error("jurnal-template error:", err);
    return res.status(500).json({ error: "Kesalahan server: " + err.message });
  }
};
