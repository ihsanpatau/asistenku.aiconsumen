/* account.js — sumber tunggal untuk data akun, kuota, profil & favorit. Semua halaman memakai fungsi di sini supaya angka yang tampil (kuota, jumlah dokumen, tanggal bergabung, foto profil, nama) selalu sesuai aktivitas & akun pengguna yang sebenarnya — bukan angka contoh/template. */
const AkAccount = (function () {
  // Batas kuota BAWAAN (fallback) — dipakai kalau data admin belum sempat
  // diambil (mis. offline / belum pernah sync). Begitu syncPlanLimits() berhasil
  // mengambil data dari tabel 'packages' (yang diatur admin di Admin Panel),
  // nilai di bawah ini DITIMPA supaya kuota yang tampil ke user selalu sesuai
  // pengaturan admin — bukan angka bawaan yang sudah kedaluwarsa.
  const DEFAULT_LIMITS = {
    gratis: { halaman: 10, pesan: 5, label: "Gratis" },
    standar: { halaman: 20, pesan: 20, label: "Standar" },
    pro: { halaman: 35, pesan: 50, label: "Pro" },
    lanjutan: { halaman: 60, pesan: 99999, label: "Lanjutan" },
  };
  const PLAN_LIMITS = DEFAULT_LIMITS; // nama lama dipertahankan untuk kompatibilitas
  const LIMITS_CACHE_KEY = "ak_plan_limits_cache";
  const DURASI_CACHE_KEY = "ak_plan_durasi_cache"; // { gratis:0, standar:30, pro:30, lanjutan:30, ... } — hari, diatur admin
  const PROMO_CACHE_KEY = "ak_promo_cache";
  const FLASH_PROMO_CACHE_KEY = "ak_flash_promo_cache";
  const DEFAULT_DURASI_HARI = 30; // fallback kalau admin belum sempat set / belum sync
  const PESAN_INTERVAL_CACHE_KEY = "ak_pesan_interval_cache"; // { gratis:7, standar:1, ... } — hari, diatur admin
  const DEFAULT_PESAN_INTERVAL_HARI = 1; // fallback: reset harian kalau admin belum atur
  const PESAN_WINDOW_KEY = "ak_pesan_window"; // { start: ISOString, count: N } — jendela pesan berjalan saat ini

  // Baca override kuota terakhir yang berhasil disinkron dari tabel 'packages'.
  function getLimitsOverride() {
    try {
      return JSON.parse(localStorage.getItem(LIMITS_CACHE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem("ak_user") || "{}");
    } catch (e) {
      return {};
    }
  }

  function getPlanKey() {
    return (localStorage.getItem("user_plan") || "gratis").toLowerCase();
  }
  // --- PROMO (diatur admin lewat Admin Panel > Promo) ---
  // Kalau admin mengaktifkan promo, SEMUA pengguna (apapun paketnya) memakai
  // limit dari promo selama jendela waktunya masih berlaku. Jendela waktu
  // dihitung dari 'started_at' (waktu admin menyalakan) + 'durasi_hari' (diatur admin).
  function getActivePromo() {
    try {
      const p = JSON.parse(localStorage.getItem(PROMO_CACHE_KEY) || "null");
      if (!p || !p.active || !p.started_at) return null;
      const start = new Date(p.started_at).getTime();
      const durasiMs =
        (Number(p.durasi_hari) > 0 ? Number(p.durasi_hari) : 1) * 86400000;
      const end = start + durasiMs;
      if (Date.now() >= end) return null; // jendela promo sudah lewat
      return { ...p, endsAt: new Date(end).toISOString() };
    } catch (e) {
      return null;
    }
  }

  async function syncPromo() {
    try {
      if (typeof window.supabase === "undefined") return null;
      const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";
      const SUPABASE_ANON_KEY =
        "sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm";
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data, error } = await sb
        .from("promo_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error || !data) {
        localStorage.removeItem(PROMO_CACHE_KEY);
        return null;
      }
      localStorage.setItem(PROMO_CACHE_KEY, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn("syncPromo gagal:", e);
      return null;
    }
  }

  // --- PROMO KILAT (Flash Sale — tampil banner kuning di upgrade.html, bisa ON/OFF admin) ---
  function getActiveFlashPromo() {
    try {
      const p = JSON.parse(
        localStorage.getItem(FLASH_PROMO_CACHE_KEY) || "null"
      );
      if (!p || !p.active) return null;
      return p;
    } catch (e) {
      return null;
    }
  }

  async function syncFlashPromo() {
    try {
      if (typeof window.supabase === "undefined") return null;
      const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";
      const SUPABASE_ANON_KEY =
        "sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm";
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data, error } = await sb
        .from("flash_promo_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error || !data) {
        localStorage.removeItem(FLASH_PROMO_CACHE_KEY);
        return null;
      }
      localStorage.setItem(FLASH_PROMO_CACHE_KEY, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn("syncFlashPromo gagal:", e);
      return null;
    }
  }

  function getPlan() {
    const promo = getActivePromo();
    if (promo) {
      return {
        halaman: promo.halaman_unlimited
          ? 99999
          : Number(promo.halaman_limit) || 0,
        pesan: promo.pesan_unlimited ? 99999 : Number(promo.pesan_limit) || 0,
        label: "🎁 " + (promo.label || "Promo"),
        isPromo: true,
        promoEndsAt: promo.endsAt,
        wordsPerPage: 300,
      };
    }
    const key = getPlanKey();
    const base = DEFAULT_LIMITS[key] || DEFAULT_LIMITS.gratis;
    const override = getLimitsOverride()[key];
    // Gabungkan: pakai angka dari admin kalau ada & valid, sisanya (mis. label) dari default.
    if (override) {
      return {
        halaman:
          typeof override.halaman === "number" && override.halaman >= 0
            ? override.halaman
            : base.halaman,
        pesan:
          typeof override.pesan === "number" && override.pesan >= 0
            ? override.pesan
            : base.pesan,
        label: override.label || base.label,
        wordsPerPage: override.wordsPerPage || 300,
      };
    }
    return {
      ...base,
      wordsPerPage: 300,
    };
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  // Daftar id aktivitas yang sudah dihitung ke kuota, supaya tidak dobel
  // dihitung kalau halaman hasil dibuka ulang / direfresh.
  function getCountedIds() {
    try {
      return JSON.parse(localStorage.getItem("ak_usage_ids") || "[]");
    } catch (e) {
      return [];
    }
  }
  function markCounted(id) {
    const ids = getCountedIds();
    if (id && !ids.includes(id)) {
      ids.push(id);
      localStorage.setItem("ak_usage_ids", JSON.stringify(ids.slice(-500)));
    }
  }

  // Catat pemakaian halaman untuk aktivitas dengan id unik (mis. id dokumen).
  // Kalau id sudah pernah dicatat, tidak dihitung lagi.
  function catatHalaman(id, jumlah) {
    if (!jumlah || jumlah <= 0) return;
    if (id) {
      const ids = getCountedIds();
      if (ids.includes(id)) return;
      markCounted(id);
    }
    const key = "ak_usage_halaman_" + todayKey();
    const cur = parseFloat(localStorage.getItem(key) || "0");
    localStorage.setItem(key, String(cur + jumlah));
  }

  // Interval reset pesan (hari) untuk 1 paket, sesuai admin di tabel packages.pesan_interval_hari.
  // Contoh: Gratis=7 (1x per minggu), Standar=1 (harian), dst — bebas diatur admin.
  function getPesanIntervalHari(planKey) {
    try {
      const d = JSON.parse(
        localStorage.getItem(PESAN_INTERVAL_CACHE_KEY) || "{}"
      );
      const key = (planKey || getPlanKey()).toLowerCase();
      const v = d[key];
      return v && v > 0 ? v : DEFAULT_PESAN_INTERVAL_HARI;
    } catch (e) {
      return DEFAULT_PESAN_INTERVAL_HARI;
    }
  }

  // Baca jendela pesan SAAT INI. Kalau jendela sebelumnya sudah lewat durasi
  // interval paket aktif, otomatis dianggap mulai jendela baru (count=0) —
  // TANPA menulis ke localStorage (murni untuk dibaca/ditampilkan).
  function getPesanWindow() {
    const intervalHari = getPesanIntervalHari();
    const intervalMs = intervalHari * 86400000;
    let w = null;
    try {
      w = JSON.parse(localStorage.getItem(PESAN_WINDOW_KEY) || "null");
    } catch (e) {}
    const now = Date.now();
    if (!w || !w.start || now - new Date(w.start).getTime() >= intervalMs) {
      w = { start: new Date(now).toISOString(), count: 0 };
    }
    return {
      start: w.start,
      count: w.count || 0,
      intervalHari,
      nextResetAt: new Date(
        new Date(w.start).getTime() + intervalMs
      ).toISOString(),
    };
  }

  // Catat 1 (atau n) pemakaian pesan/chat AI — otomatis mulai jendela baru
  // kalau jendela sebelumnya sudah lewat interval reset paket aktif.
  function catatPesan(n) {
    n = n || 1;
    const w = getPesanWindow();
    localStorage.setItem(
      PESAN_WINDOW_KEY,
      JSON.stringify({ start: w.start, count: w.count + n })
    );
  }

  function getUsage() {
    const halaman = Math.round(
      parseFloat(localStorage.getItem("ak_usage_halaman_" + todayKey()) || "0")
    );
    const pesan = getPesanWindow().count;
    return { halaman, pesan };
  }

  // Ringkasan kuota hari ini, siap dipakai untuk ditampilkan di UI.
  function getKuota() {
    const plan = getPlan();
    const usage = getUsage();
    const pesanWindow = getPesanWindow();
    return {
      planKey: getPlanKey(),
      planLabel: plan.label,
      halamanUsed: Math.min(usage.halaman, plan.halaman),
      halamanLimit: plan.halaman,
      pesanUsed: Math.min(usage.pesan, plan.pesan),
      pesanLimit: plan.pesan,
      pesanUnlimited: plan.pesan >= 99999,
      pesanIntervalHari: pesanWindow.intervalHari,
      pesanNextResetAt: pesanWindow.nextResetAt,
    };
  }

  // Statistik dokumen nyata dari RiwayatStore (kalau tersedia di halaman ini).
  function getDokumenStats() {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem("ak_riwayat_items") || "[]");
    } catch (e) {}
    const dokumen = items.filter((x) => x.kategori !== "chat");
    const totalHalaman = dokumen.reduce(
      (sum, x) =>
        sum +
        (x.halaman ||
          (x.kataTerhitung
            ? Math.max(1, Math.round(x.kataTerhitung / 275))
            : 0)),
      0
    );
    const now = new Date();
    const bulanIni = dokumen.filter((x) => {
      const d = new Date(x.waktu);
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    }).length;
    return { total: dokumen.length, totalHalaman, bulanIni, items: dokumen };
  }

  function getJoinDate() {
    const user = getUser();
    const iso = user.created_at;
    if (!iso) return null;
    const d = new Date(iso);
    const bulan = [
      "Januari",
      "Februari",
      "Maret",
      "April",
      "Mei",
      "Juni",
      "Juli",
      "Agustus",
      "September",
      "Oktober",
      "November",
      "Desember",
    ];
    return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
  }

  function getDisplayName() {
    const user = getUser();
    if (user.id) {
      const local = localStorage.getItem("ak_name_" + user.id);
      if (local) return local;
    }
    return (
      user.user_metadata?.full_name || user.email?.split("@")[0] || "Pengguna"
    );
  }
  function setDisplayName(name) {
    const user = getUser();
    if (user.id) localStorage.setItem("ak_name_" + user.id, name);
  }

  function getAvatarUrl() {
    const user = getUser();
    if (user.id) {
      const local = localStorage.getItem("ak_avatar_" + user.id);
      if (local) return local;
    }
    return user.user_metadata?.avatar_url || null;
  }
  function setAvatarUrl(dataUrl) {
    const user = getUser();
    if (user.id) localStorage.setItem("ak_avatar_" + user.id, dataUrl);
  }

  // --- Ambil token yang masih berlaku, refresh otomatis kalau sudah kedaluwarsa ---
  // Supaya user TIDAK perlu logout/login manual tiap kali sesi lamanya habis (biasanya ±1 jam).
  //
  // PERBAIKAN BUG "harus login ulang setelah idle 1-2 jam":
  // Sebelumnya, kalau halaman yang sama menembak beberapa request AI hampir
  // bersamaan (mis. generate PPT yang memanggil getValidToken() dua kali
  // paralel), tiap panggilan bisa memicu refresh token SENDIRI-SENDIRI ke
  // Supabase secara bersamaan. Supabase me-ROTASI refresh token setiap kali
  // dipakai (refresh token lama langsung tidak berlaku begitu dipakai sekali).
  // Kalau dua permintaan refresh terjadi bersamaan, permintaan yang datang
  // sedikit lebih lambat akan ditolak ("refresh token sudah tidak valid")
  // walau access token yang lama sebenarnya baru saja sukses diperbarui oleh
  // request yang lain — akibatnya user mendapat pesan "Sesi login tidak
  // valid, silakan login ulang" walau sebenarnya masih dalam keadaan login.
  //
  // Perbaikannya: pakai SATU promise refresh yang dibagi (lock) untuk semua
  // pemanggil yang terjadi bersamaan, dan sebelum benar-benar refresh ke
  // server, cek dulu apakah localStorage sudah punya token baru yang masih
  // berlaku (mis. sudah diperbarui oleh tab/panggilan lain barusan).
  let _refreshInFlight = null;

  function _decodeExpiry(token) {
    try {
      const payload = JSON.parse(
        decodeURIComponent(
          escape(
            atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
          )
        )
      );
      return payload.exp ? payload.exp * 1000 : 0;
    } catch (e) {
      return 0;
    }
  }

  async function _doRefresh(refreshToken) {
    const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm";
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem("ak_token", data.access_token);
      if (data.refresh_token)
        localStorage.setItem("ak_refresh_token", data.refresh_token);
      return data.access_token;
    }
    throw new Error(
      (data && (data.error_description || data.error || data.msg)) ||
        "Refresh token gagal"
    );
  }

  async function getValidToken() {
    let token = localStorage.getItem("ak_token");
    if (!token) return null;

    const expiryMs = _decodeExpiry(token);
    const expired = !expiryMs || expiryMs < Date.now() + 30000;
    if (!expired) return token;

    // Kalau proses refresh dari panggilan lain (paralel) sedang berjalan,
    // ikut menunggu hasil YANG SAMA — jangan buat request refresh baru
    // yang bisa saling bentrok/merebut refresh token yang sama.
    if (_refreshInFlight) {
      try {
        return await _refreshInFlight;
      } catch (e) {
        // lanjut ke bawah, coba jalur normal sebagai upaya terakhir
      }
    }

    const refreshToken = localStorage.getItem("ak_refresh_token");
    if (!refreshToken) return token; // tidak ada refresh token tersimpan, coba pakai yang lama (mungkin tetap gagal)

    _refreshInFlight = (async () => {
      // Cek ulang: mungkin sudah diperbarui oleh panggilan/tab lain barusan.
      const latestToken = localStorage.getItem("ak_token");
      if (latestToken && latestToken !== token) {
        const latestExpiry = _decodeExpiry(latestToken);
        if (latestExpiry && latestExpiry > Date.now() + 30000) {
          return latestToken;
        }
      }
      const latestRefreshToken =
        localStorage.getItem("ak_refresh_token") || refreshToken;

      // Coba refresh, dengan SATU kali retry ringan kalau gagal karena
      // masalah jaringan sesaat (bukan karena refresh token benar-benar
      // sudah tidak valid) — supaya idle lama + koneksi sempat putus-nyambung
      // tidak langsung memaksa login ulang.
      try {
        return await _doRefresh(latestRefreshToken);
      } catch (e1) {
        try {
          await new Promise((r) => setTimeout(r, 800));
          const retryRefreshToken =
            localStorage.getItem("ak_refresh_token") || latestRefreshToken;
          return await _doRefresh(retryRefreshToken);
        } catch (e2) {
          console.warn("Refresh token gagal:", e2.message || e2);
          throw e2;
        }
      }
    })();

    try {
      const fresh = await _refreshInFlight;
      return fresh;
    } catch (e) {
      // Refresh benar-benar gagal (refresh token sudah dicabut/kedaluwarsa
      // sungguhan) — kembalikan token lama sebagai upaya terakhir. Server
      // (/api/generate) akan menolaknya dengan pesan yang jelas kalau memang
      // sudah tidak valid, daripada kita menebak di sini.
      return token;
    } finally {
      _refreshInFlight = null;
    }
  }

  // Masa aktif (hari) untuk 1 paket, sesuai yang diatur admin di tabel packages.durasi_hari
  function getDurasiHari(planKey) {
    try {
      const d = JSON.parse(localStorage.getItem(DURASI_CACHE_KEY) || "{}");
      const key = (planKey || getPlanKey()).toLowerCase();
      return d[key] || DEFAULT_DURASI_HARI;
    } catch (e) {
      return DEFAULT_DURASI_HARI;
    }
  }

  // Info masa aktif siap-pakai untuk ditampilkan di UI (Beranda/Profil).
  function getMasaAktifInfo() {
    const planKey = getPlanKey();
    const expiryRaw = localStorage.getItem("user_plan_expiry");
    if (planKey === "gratis" || !expiryRaw) {
      return {
        planKey,
        expiryDate: null,
        expiryLabel: "-",
        daysLeft: null,
        isExpired: false,
      };
    }
    const expiryDate = new Date(expiryRaw);
    const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
    const bulan = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agu",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];
    const expiryLabel = `${expiryDate.getDate()} ${ bulan[expiryDate.getMonth()] } ${expiryDate.getFullYear()}`;
    return {
      planKey,
      expiryDate,
      expiryLabel,
      daysLeft,
      isExpired: daysLeft < 0,
    };
  }

  // --- Cek kuota SEBELUM generate — dipanggil oleh skripsi/jurnal/makalah/dll ---
  // jumlahDiminta = perkiraan halaman yang mau dibuat (boleh dikosongkan untuk cek sisa saja).
  function cekKuotaHalaman(jumlahDiminta) {
    const k = getKuota();
    if (k.halamanLimit >= 99999)
      return { ok: true, unlimited: true, sisa: Infinity };
    const sisa = Math.max(0, k.halamanLimit - k.halamanUsed);
    if (sisa <= 0) {
      return {
        ok: false,
        sisa: 0,
        pesan: `Kuota halaman harian paket ${k.planLabel} sudah habis (${k.halamanUsed}/${k.halamanLimit} halaman). Kuota otomatis reset besok jam 00:00, atau upgrade paket untuk kuota lebih besar.`,
      };
    }
    if (jumlahDiminta && jumlahDiminta > sisa) {
      return {
        ok: true,
        sisa,
        pesan: `Sisa kuota halaman hari ini tinggal ${sisa} dari paket ${k.planLabel} (target kamu ${jumlahDiminta} halaman).`,
        partial: true,
      };
    }
    return { ok: true, sisa };
  }

  function cekKuotaPesan(n) {
    n = n || 1;
    const k = getKuota();
    if (k.pesanUnlimited) return { ok: true, unlimited: true };
    const sisa = Math.max(0, k.pesanLimit - k.pesanUsed);
    if (sisa < n) {
      const resetLabel = new Date(k.pesanNextResetAt).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const intervalTeks =
        k.pesanIntervalHari === 1
          ? "harian (tiap 1 hari)"
          : `tiap ${k.pesanIntervalHari} hari`;
      return {
        ok: false,
        sisa,
        pesan: `Kuota pesan DoktrAI paket ${k.planLabel} sudah habis (${k.pesanUsed}/${k.pesanLimit}, reset ${intervalTeks}). Kuota berikutnya reset pada ${resetLabel}, atau upgrade paket.`,
      };
    }
    return { ok: true, sisa };
  }

  // Ini yang membuat "Jatah Halaman/Hari" & "Jatah Pesan DoktrAI/Hari" yang
  // diubah admin langsung terpakai di dashboard konsumen, tanpa perlu update kode.
  // Tabel ini publik dibaca (dipakai juga oleh upgrade.html lewat sync-plan.js),
  // jadi tidak perlu token login.
  async function syncPlanLimits() {
    try {
      if (typeof window.supabase === "undefined") return false;
      const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";
      const SUPABASE_ANON_KEY =
        "sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm";
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      const { data, error } = await sb
        .from("packages")
        .select(
          "key, label, halaman_limit, pesan_limit, durasi_hari, words_per_page, pesan_interval_hari"
        )
        .eq("active", true);

      if (error || !Array.isArray(data) || data.length === 0) return false;

      const override = {};
      const durasi = {};
      const pesanInterval = {};
      data.forEach((p) => {
        if (!p.key) return;
        const k = p.key.toLowerCase();
        override[k] = {
          halaman: Number(p.halaman_limit),
          pesan: Number(p.pesan_limit),
          label: p.label || undefined,
          wordsPerPage:
            Number(p.words_per_page) > 0 ? Number(p.words_per_page) : 300,
        };
        // Masa aktif (hari) per paket — diatur admin. Fallback 30 hari kalau kolom belum diisi.
        durasi[k] =
          p.durasi_hari !== null &&
          p.durasi_hari !== undefined &&
          Number(p.durasi_hari) > 0
            ? Number(p.durasi_hari)
            : DEFAULT_DURASI_HARI;
        // Interval reset pesan (hari) per paket — diatur admin. Fallback 1 hari (harian).
        pesanInterval[k] =
          Number(p.pesan_interval_hari) > 0
            ? Number(p.pesan_interval_hari)
            : DEFAULT_PESAN_INTERVAL_HARI;
      });
      localStorage.setItem(LIMITS_CACHE_KEY, JSON.stringify(override));
      localStorage.setItem(DURASI_CACHE_KEY, JSON.stringify(durasi));
      localStorage.setItem(
        PESAN_INTERVAL_CACHE_KEY,
        JSON.stringify(pesanInterval)
      );
      // Sekalian sync promo tiap kali sync limits dipanggil (satu kali fetch, hemat request)
      await syncPromo();
      await syncFlashPromo();
      return true;
    } catch (e) {
      console.warn("syncPlanLimits gagal:", e);
      return false;
    }
  }

  // --- Sync Plan dari Supabase (dipanggil saat halaman load) ---
  // Fungsi ini membaca kolom 'plan' dari tabel 'profiles' di Supabase
  // dan menyimpannya ke localStorage, sehingga perubahan yang dilakukan
  // admin di panel admin langsung berpengaruh ke konsumen.
  async function syncPlanFromSupabase() {
    try {
      const token = await getValidToken();
      if (!token) return;

      // Sinkron & tegakkan masa aktif LEWAT SERVER (bukan tulis langsung dari
      // browser). Ini sengaja dipindah ke /api/sync-plan supaya user tidak
      // bisa membuka Console browser dan menaikkan plan-nya sendiri secara
      // curang — server hanya pernah menurunkan ke 'gratis', tidak pernah
      // menaikkan plan apapun.
      const res = await fetch("/api/sync-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data) return;

      const planBaru = (data.plan || "gratis").toLowerCase();
      const expiryBaru = data.plan_expiry || null;

      localStorage.setItem("user_plan", planBaru);
      if (expiryBaru) localStorage.setItem("user_plan_expiry", expiryBaru);
      else localStorage.removeItem("user_plan_expiry");
    } catch (e) {
      console.warn("syncPlanFromSupabase gagal:", e);
    }
  }

  // --- Favorit ---
  function getFavoritIds() {
    try {
      return JSON.parse(localStorage.getItem("ak_favorit_ids") || "[]");
    } catch (e) {
      return [];
    }
  }
  function isFavorit(id) {
    return getFavoritIds().includes(id);
  }
  function toggleFavorit(id) {
    let ids = getFavoritIds();
    if (ids.includes(id)) ids = ids.filter((x) => x !== id);
    else ids.push(id);
    localStorage.setItem("ak_favorit_ids", JSON.stringify(ids));
    return ids.includes(id);
  }

  return {
    PLAN_LIMITS,
    getUser,
    getPlanKey,
    getPlan,
    getKuota,
    catatHalaman,
    catatPesan,
    getDokumenStats,
    getJoinDate,
    getDisplayName,
    setDisplayName,
    getAvatarUrl,
    setAvatarUrl,
    getFavoritIds,
    isFavorit,
    toggleFavorit,
    syncPlanFromSupabase,
    syncPlanLimits,
    getValidToken,
    getDurasiHari,
    getMasaAktifInfo,
    cekKuotaHalaman,
    cekKuotaPesan,
    getPesanIntervalHari,
    syncPromo,
    getActivePromo,
    syncFlashPromo,
    getActiveFlashPromo,
  };
})();

// --- Perbaikan bug "harus login ulang setelah idle lama" ---
// Kalau tab/HP ditinggal 1-2 jam lalu dibuka lagi (mis. layar dikunci,
// pindah app, lalu balik lagi), access token yang tersimpan hampir pasti
// sudah kedaluwarsa. Daripada menunggu user menekan tombol generate dan
// baru ketahuan gagal (lalu disuruh login ulang), kita refresh token di
// LATAR BELAKANG begitu halaman terlihat kembali (tab/app aktif lagi),
// supaya saat user benar-benar menekan tombol generate, token yang
// dipakai sudah pasti fresh.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", function () {
    if (
      document.visibilityState === "visible" &&
      localStorage.getItem("ak_token")
    ) {
      AkAccount.getValidToken().catch(function () {});
    }
  });
  // Jaring pengaman tambahan: begitu skrip ini dimuat (halaman baru dibuka
  // / direfresh), langsung cek & refresh juga kalau perlu.
  if (localStorage.getItem("ak_token")) {
    AkAccount.getValidToken().catch(function () {});
  }
}
