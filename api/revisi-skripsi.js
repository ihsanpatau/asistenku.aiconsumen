// /api/revisi-skripsi.js
// Endpoint khusus revisi skripsi dengan AI
// Menerima: teks dokumen + perintah revisi
// Mengembalikan: JSON dengan teks sebelum & sesudah + penjelasan

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

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
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
      .select("blocked, plan")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.blocked)
      return res.status(403).json({ error: "Akun diblokir." });

    // ── Rate limit ────────────────────────────────────────────────────────
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

    const { docContext, command, revisionHistory, fullDocText } =
      req.body || {};
    if (!command)
      return res.status(400).json({ error: "Perintah revisi wajib diisi." });
    if (!docContext && !fullDocText)
      return res.status(400).json({ error: "Konteks dokumen wajib diisi." });

    // ── Build histori singkat untuk konteks AI ────────────────────────────
    const historyStr = (revisionHistory || [])
      .slice(-5)
      .map((h, i) => `Revisi ${i + 1}: "${h.cmd}" → bagian "${h.bagian}"`)
      .join("\n");

    // ── Prompt ────────────────────────────────────────────────────────────
    const systemPrompt = `Kamu adalah editor skripsi akademik profesional untuk mahasiswa Indonesia. Bertugas merevisi bagian skripsi berdasarkan perintah pengguna.

PENTING: teks_sebelum dan teks_sesudah akan dipakai untuk mengedit LANGSUNG di dalam file .docx asli (bukan membuat dokumen baru). teks_sebelum dicocokkan ke satu paragraf utuh di dokumen, lalu ISI paragraf itu diganti dengan teks_sesudah — format paragraf asli (font, ukuran, perataan, gaya heading) dipertahankan otomatis, kamu HANYA perlu menghasilkan teksnya.

ATURAN WAJIB:
1. Pertahankan GAYA PENULISAN ASLI — formal, akademik, bahasa Indonesia baku sesuai dokumen.
2. Pertahankan STRUKTUR (urutan bab, sub-bab, dan alur argumen).
3. teks_sebelum HARUS berupa kutipan PERSIS (verbatim, tanpa diubah satu karakter pun) dari SATU paragraf utuh yang ada di dokumen — bukan potongan dari tengah kalimat, dan bukan gabungan dari beberapa paragraf berbeda. Salin apa adanya dari "KONTEKS DOKUMEN".
4. Jika hasil revisi (teks_sesudah) sebaiknya terdiri dari beberapa paragraf terpisah (misalnya diminta "ubah jadi 3 paragraf"), pisahkan tiap paragraf dengan baris kosong (dua kali enter / "\\n\\n") di dalam teks_sesudah. Setiap paragraf akan otomatis menjadi paragraf Word tersendiri dengan format yang sama seperti paragraf aslinya.
5. Jika diminta menambah/mengubah TABEL: gunakan format markdown tabel (| Kolom | Kolom |\\n|---|---|\\n| data | data |) pada teks_sesudah, dan set jenis_perubahan="tabel". Tabel akan disisipkan sebagai tabel Word asli setelah paragraf/bagian yang disebut di teks_sebelum (atau bagian_direvisi jika teks_sebelum kosong).
6. GRAFIK/CHART belum didukung untuk diedit langsung ke file Word — jika diminta grafik, kembalikan field "error" yang menjelaskan keterbatasan ini dan sarankan alternatif (misalnya tabel data).
7. Jika bagian yang dimaksud user tidak dapat ditemukan sama sekali di KONTEKS DOKUMEN, kembalikan field "error" saja — jangan mengarang teks_sebelum.
8. Balas HANYA JSON valid (tanpa backtick di luar), format:
{
  "bagian_direvisi": "nama section/bagian yang direvisi (misal: Latar Belakang, Rumusan Masalah, Kata Pengantar, Kesimpulan) — dipakai juga sebagai penanda lokasi jika teks_sebelum tidak ketemu persis",
  "teks_sebelum": "kutipan PERSIS satu paragraf utuh dari dokumen asli yang akan diganti",
  "teks_sesudah": "teks hasil revisi (pisahkan dengan \\n\\n jika perlu jadi beberapa paragraf)",
  "jenis_perubahan": "edit|tambah|tabel",
  "penjelasan": "penjelasan singkat (1-2 kalimat) apa yang diubah dan mengapa"
}

Jika perintah tidak spesifik atau bagian tidak ditemukan:
{"error": "Sebutkan lebih spesifik bagian yang ingin direvisi, contoh: 'Perbaiki paragraf pertama latar belakang' atau 'Ubah rumusan masalah nomor 2'."}`;

    const userPrompt = [
      docContext
        ? `=== KONTEKS DOKUMEN (bagian relevan) ===\n${truncate(
            docContext,
            8000
          )}`
        : "",
      historyStr ? `=== REVISI SEBELUMNYA ===\n${historyStr}` : "",
      `=== PERINTAH REVISI ===\n"${command}"`,
      `\nLakukan revisi sesuai perintah. Gaya penulisan harus mengikuti gaya dokumen asli.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // ── Panggil AI ────────────────────────────────────────────────────────
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 6000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok)
      throw new Error(
        (aiData.error && aiData.error.message) || "Anthropic API error"
      );

    const rawText = (
      (aiData.content && aiData.content[0] && aiData.content[0].text) ||
      ""
    ).trim();

    // ── Parse JSON dari AI ────────────────────────────────────────────────
    let result;
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      // Coba extract JSON dari dalam teks
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
        } catch (e2) {
          throw new Error(
            "Format respons AI tidak valid. Coba ulangi perintah."
          );
        }
      } else {
        throw new Error("Format respons AI tidak valid. Coba ulangi perintah.");
      }
    }

    // ── Catat usage ───────────────────────────────────────────────────────
    try {
      await sbAdmin.rpc("increment_api_usage", {
        p_user_id: userId,
        p_day: day,
      });
    } catch (e) {
      /* non-fatal */
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("revisi-skripsi error:", err);
    return res.status(500).json({ error: "Kesalahan server: " + err.message });
  }
};
