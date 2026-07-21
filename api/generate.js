// /api/generate.js
// Satu endpoint backend yang dipakai semua fitur (parafrase, PPT, jurnal, DoktrAI, skripsi, dll)
// API key disimpan aman di Environment Variables Vercel, TIDAK pernah terlihat di browser.
//
// PENTING (keamanan): endpoint ini WAJIB dipanggil dengan header
// Authorization: Bearer <token_login_supabase>. Tanpa token yang valid,
// permintaan ditolak (401) SEBELUM sampai ke Anthropic API sama sekali —
// supaya endpoint ini tidak bisa dipanggil orang luar/bot tanpa akun,
// yang bisa menghabiskan saldo API tanpa terlacak siapa pelakunya.
// Butuh SUPABASE_SERVICE_ROLE_KEY di Environment Variables Vercel.
//
// TAMBAHAN BARU (proteksi kuota di server):
// Sebelumnya kuota (halaman/pesan per paket) HANYA dicek di browser
// (account.js -> localStorage), yang artinya bisa dilewati kalau endpoint
// ini dipanggil langsung (Postman/curl) dengan token login yang sah.
// Sekarang server ikut membatasi JUMLAH PEMANGGILAN AI PER HARI per akun,
// sesuai paketnya (dibaca dari tabel 'packages' & dicatat di tabel baru
// 'usage_tracking'). Ini jaring pengaman terakhir supaya biaya API tidak
// bisa dihabiskan tanpa batas walau tampilan kuota di frontend di-bypass.
// Wajib jalankan sql/tambahan-usage-tracking.sql di Supabase SQL Editor
// dulu sebelum file ini dipakai (lihat README).

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";

// Batas wajar kalau paket user tidak ketemu di tabel 'packages' (mis. baru
// daftar & profil belum sempat sinkron) — dibuat konservatif setara paket
// Gratis, supaya tetap ada jaring pengaman meski data paket belum lengkap.
const FALLBACK_DAILY_LIMIT = 15;
// Kelipatan dipakai untuk menghitung batas otomatis dari halaman_limit +
// pesan_limit paket, KALAU admin belum mengisi kolom max_api_calls_per_day
// secara manual di tabel packages. Satu "unit" kuota (1 halaman / 1 pesan)
// biasanya butuh lebih dari 1 kali panggilan AI (revisi, per-bagian, dll),
// jadi diberi kelipatan supaya tidak mengganggu pemakaian normal.
const AUTO_LIMIT_MULTIPLIER = 4;
const AUTO_LIMIT_MINIMUM = 20;
// Angka yang dipakai kalau paket punya kuota "unlimited" (>= 99999) —
// tetap dikasih batas atas yang sangat longgar, supaya bukan benar-benar
// tanpa batas (mencegah 1 akun bocor/disalahgunakan menghabiskan saldo).
const UNLIMITED_PLAN_DAILY_CAP = 500;

const GAYA_PENULISAN =
  "Tulis jawabanmu dalam gaya percakapan biasa yang rapi dan enak dibaca, seperti orang menjelaskan langsung. ATURAN PENTING: JANGAN gunakan tanda pagar (#, ##, ###) untuk judul/heading apapun. JANGAN membuat daftar bernomor atau bullet point kecuali benar-benar dibutuhkan (misal langkah-langkah teknis yang wajib berurutan). JANGAN gunakan format markdown yang berlebihan. Tulis dalam bentuk paragraf mengalir dengan bahasa Indonesia yang natural, hangat, dan mudah dipahami, seperti sedang berbicara langsung ke orangnya.";

// Hitung tanggal "hari ini" memakai zona waktu Jakarta, supaya batasnya
// reset di tengah malam WIB (konsisten dengan pesan di account.js yang
// bilang "reset besok jam 00:00").
function todayJakarta() {
  const now = new Date();
  const jakarta = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
  );
  const yyyy = jakarta.getFullYear();
  const mm = String(jakarta.getMonth() + 1).padStart(2, "0");
  const dd = String(jakarta.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getDailyLimitForPlan(sbAdmin, planKey) {
  try {
    const { data: pkg } = await sbAdmin
      .from("packages")
      .select("halaman_limit, pesan_limit, max_api_calls_per_day")
      .eq("key", (planKey || "gratis").toLowerCase())
      .eq("active", true)
      .maybeSingle();

    if (!pkg) return FALLBACK_DAILY_LIMIT;

    if (
      typeof pkg.max_api_calls_per_day === "number" &&
      pkg.max_api_calls_per_day > 0
    ) {
      return pkg.max_api_calls_per_day;
    }

    const halaman = Number(pkg.halaman_limit) || 0;
    const pesan = Number(pkg.pesan_limit) || 0;

    if (halaman >= 99999 || pesan >= 99999) {
      return UNLIMITED_PLAN_DAILY_CAP;
    }

    return Math.max(
      AUTO_LIMIT_MINIMUM,
      (halaman + pesan) * AUTO_LIMIT_MULTIPLIER
    );
  } catch (e) {
    console.error("Gagal ambil batas kuota paket:", e.message);
    return FALLBACK_DAILY_LIMIT;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // --- 1) Wajib login: cek header Authorization ---
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res
        .status(401)
        .json({ error: "Wajib login untuk menggunakan fitur AI." });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return res
        .status(500)
        .json({
          error:
            "SUPABASE_SERVICE_ROLE_KEY belum diset di Environment Variables Vercel",
        });
    }
    const sbAdmin = createClient(SUPABASE_URL, serviceRoleKey);

    // --- 2) Verifikasi token benar-benar valid & ambil identitas usernya ---
    const { data: userData, error: userErr } = await sbAdmin.auth.getUser(
      token
    );
    if (userErr || !userData || !userData.user) {
      return res
        .status(401)
        .json({
          error:
            "Sesi login tidak valid atau sudah kedaluwarsa. Silakan login ulang.",
        });
    }
    const userId = userData.user.id;

    // --- 3) Tolak akun yang sedang diblokir admin ---
    const { data: profile } = await sbAdmin
      .from("profiles")
      .select("blocked, plan")
      .eq("id", userId)
      .maybeSingle();
    if (profile && profile.blocked) {
      return res
        .status(403)
        .json({
          error:
            "Akun Anda sedang diblokir. Hubungi admin untuk informasi lebih lanjut.",
        });
    }

    // --- 4) Cek batas pemakaian AI harian di SERVER (jaring pengaman) ---
    // Ini terpisah dari tampilan kuota halaman/pesan di frontend — tujuannya
    // supaya endpoint ini tidak bisa dipanggil tanpa batas walau lewat
    // Postman/curl dengan token yang sah.
    const day = todayJakarta();
    const planKey = (profile && profile.plan) || "gratis";
    const dailyLimit = await getDailyLimitForPlan(sbAdmin, planKey);

    const { data: usageRow } = await sbAdmin
      .from("usage_tracking")
      .select("request_count")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();

    const currentCount = (usageRow && usageRow.request_count) || 0;
    if (currentCount >= dailyLimit) {
      return res.status(429).json({
        error: `Batas pemakaian AI harian untuk paket Anda sudah tercapai (${currentCount}/${dailyLimit} kali hari ini). Kuota akan reset besok, atau upgrade paket untuk batas yang lebih besar.`,
      });
    }

    const { prompt, task, messages, system } = req.body || {};

    if (!prompt && !messages) {
      return res
        .status(400)
        .json({ error: "Prompt atau messages wajib diisi" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "API key belum dikonfigurasi di server" });
    }

    const finalSystem = system
      ? `${system}\n\n${GAYA_PENULISAN}`
      : GAYA_PENULISAN;

    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: finalSystem,
      messages:
        messages && messages.length
          ? messages
          : [{ role: "user", content: prompt }],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json({
          error:
            (data.error && data.error.message) ||
            "Terjadi kesalahan dari Anthropic API",
        });
    }

    // --- 5) Baru dicatat SETELAH sukses, supaya panggilan yang gagal
    // (error dari Anthropic dsb) tidak ikut memakan jatah harian user. ---
    try {
      await sbAdmin.rpc("increment_api_usage", {
        p_user_id: userId,
        p_day: day,
      });
    } catch (e) {
      // Jangan gagalkan response ke user hanya gara-gara pencatatan
      // kuota gagal — cukup dicatat di log server untuk diperiksa.
      console.error("Gagal mencatat usage_tracking:", e.message);
    }

    const resultText =
      (data.content && data.content[0] && data.content[0].text) || "";
    return res.status(200).json({ text: resultText, task, raw: data });
  } catch (err) {
    console.error("Generate API error:", err);
    return res
      .status(500)
      .json({ error: "Terjadi kesalahan server: " + err.message });
  }
};
