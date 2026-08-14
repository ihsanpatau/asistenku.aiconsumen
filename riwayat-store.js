/* riwayat-store.js – penyimpanan riwayat aktivitas nyata (bukan data contoh/template). Semua halaman yang menghasilkan dokumen (Tugas & Project, Skripsi, Makalah, dll.) memanggil RiwayatStore.tambah() setelah AI benar-benar selesai memproses. Halaman yang menampilkan riwayat (tugas.html, riwayat.html) memanggil RiwayatStore.semua() / RiwayatStore.byKategori() supaya yang muncul selalu sesuai aktivitas asli pengguna. Setiap tambah() juga mengirim ringkasan ke Supabase (tabel 'document_log', lihat syncKeSupabase()) supaya panel ADMIN bisa melihat jumlah dokumen yang dibuat tiap pengguna — sebelumnya data ini cuma ada di localStorage browser pengguna dan tidak terlihat admin sama sekali. */
const RiwayatStore = (function () {
  const KEY = "ak_riwayat_items";

  // Dokumen & riwayat otomatis dihapus (beserta isi lengkapnya) setelah sekian hari,
  // supaya localStorage browser pengguna tidak menumpuk/penuh tanpa batas.
  // PERBAIKAN: sebelumnya batas 7 hari ini berlaku untuk SEMUA pengguna tanpa
  // kecuali — padahal paket STANDAR (& paket berbayar lain) menjanjikan
  // "Riwayat tanpa batas" (lihat upgrade.html). Jadi pengguna yang sudah bayar
  // pun riwayat & dokumennya tetap terhapus paksa setelah 7 hari. Sekarang
  // fungsi pembersihan mengecek dulu paket aktif pengguna (retensiTanpaBatas())
  // — kalau bukan paket gratis, tidak ada yang dihapus otomatis sama sekali.
  const MASA_BERLAKU_HARI = 7;

  function retensiTanpaBatas() {
    try {
      const plan = (
        localStorage.getItem("user_plan") || "gratis"
      ).toLowerCase();
      return plan !== "gratis";
    } catch (e) {
      return false;
    }
  }

  function bacaMentah() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  // Buang otomatis entri riwayat + KONTEN LENGKAPnya yang sudah lebih tua dari
  // MASA_BERLAKU_HARI hari. Dipanggil otomatis setiap kali daftar riwayat dibaca
  // (lewat semua()), jadi tidak perlu proses/cron terpisah — begitu ada entri yang
  // sudah kedaluwarsa, otomatis lenyap sendiri saat halaman manapun dibuka.
  // TIDAK dijalankan sama sekali kalau paket pengguna punya "Riwayat tanpa batas".
  function bersihkanKedaluwarsa() {
    const list = bacaMentah();
    if (retensiTanpaBatas()) return list;
    const batas = Date.now() - MASA_BERLAKU_HARI * 24 * 60 * 60 * 1000;
    const gugur = [];
    const sisa = [];
    list.forEach((x) => {
      const t = new Date(x.waktu).getTime();
      if (!isNaN(t) && t < batas) gugur.push(x);
      else sisa.push(x);
    });
    if (gugur.length) {
      simpan(sisa);
      gugur.forEach((x) => hapusKonten(x.id));
    }
    return sisa;
  }

  function semua() {
    return bersihkanKedaluwarsa();
  }

  function simpan(arr) {
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  // item: { id, judul, kategori, kategoriLabel, subtitle, waktu(ISO), status, iconBg, iconType, link }
  function tambah(item) {
    const list = semua();
    if (item.id && list.some((x) => x.id === item.id)) return; // hindari duplikat saat refresh
    list.unshift(
      Object.assign(
        {
          id:
            item.id ||
            "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          waktu: new Date().toISOString(),
          status: "done",
        },
        item
      )
    );
    simpan(list.slice(0, 100)); // batasi maksimum 100 entri
    // Kirim juga ke Supabase (tabel 'document_log') supaya ADMIN bisa melihat
    // berapa file yang dibuat tiap pengguna (hari ini/minggu/bulan) — sebelumnya
    // data ini HANYA tersimpan di localStorage browser pengguna, sama sekali
    // tidak terlihat dari panel admin. "chat" dilewati karena itu bukan file/
    // dokumen (chat dihitung terpisah lewat 'usage_tracking' yang sudah ada).
    if (item.kategori !== "chat") syncKeSupabase(item);
  }

  // Kirim SATU baris ringkas ke Supabase, best-effort (fire-and-forget).
  // Kalau gagal (offline, RLS belum di-setup, dsb) TIDAK mengganggu apapun —
  // localStorage di atas tetap jadi sumber utama tampilan riwayat konsumen.
  // Wajib jalankan sql/perbaikan-document-log-dan-akses-admin.sql di Supabase
  // SQL Editor dulu supaya tabel 'document_log' ada, kalau belum baris ini
  // akan gagal senyap.
  //
  // PERBAIKAN: sebelumnya fungsi ini membaca token mentah langsung dari
  // localStorage('ak_token') TANPA mengecek apakah token itu sudah kedaluwarsa.
  // Proses generate dokumen (apalagi skripsi 5 BAB) bisa makan waktu cukup lama,
  // jadi kalau access token sudah expired persis pada saat sinkron ini dikirim,
  // Supabase menolaknya (401) — request gagal SENYAP (fire-and-forget, tidak ada
  // error yang terlihat), dan dokumen itu tidak pernah tercatat di 'document_log'
  // walau sudah berhasil dibuat & muncul normal di Dokumen Saya (yang datanya
  // dari localStorage, bukan dari server). Ini sebabnya panel admin bisa
  // menunjukkan "Permintaan AI" yang benar (itu dicatat SERVER-SIDE lewat
  // service role di api/generate.js, tidak kena masalah token expired) tapi
  // "Dokumen Dibuat" tetap 0. Sekarang pakai AkAccount.getValidToken() (kalau
  // tersedia) supaya token di-refresh dulu bila perlu, sama seperti semua
  // panggilan API lain di aplikasi ini — dan errornya dicatat ke console supaya
  // bisa dicek lewat DevTools kalau masih gagal.
  async function syncKeSupabase(item) {
    try {
      if (
        typeof AK_SUPABASE_URL === "undefined" ||
        typeof AK_SUPABASE_ANON_KEY === "undefined"
      )
        return; // shared-config.js belum dimuat di halaman ini
      let user = {};
      try {
        user = JSON.parse(localStorage.getItem("ak_user") || "{}");
      } catch (e) {}
      if (!user.id) return;

      let token = localStorage.getItem("ak_token");
      if (typeof AkAccount !== "undefined" && AkAccount.getValidToken) {
        try {
          token = await AkAccount.getValidToken();
        } catch (e) {
          /* pakai token lama sebagai upaya terakhir */
        }
      }
      if (!token) return;

      const res = await fetch(AK_SUPABASE_URL + "/rest/v1/document_log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: AK_SUPABASE_ANON_KEY,
          Authorization: "Bearer " + token,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          user_id: user.id,
          user_email: user.email || null,
          kategori: item.kategori || "lainnya",
          judul: (item.judul || "").toString().substring(0, 200),
          halaman:
            item.halaman ||
            (item.kataTerhitung
              ? Math.max(1, Math.round(item.kataTerhitung / 275))
              : 0),
        }),
      });
      if (!res.ok) {
        const teks = await res.text().catch(() => "");
        console.error(
          "RiwayatStore: gagal sinkron document_log ke Supabase (" +
            res.status +
            "): " +
            teks
        );
      }
    } catch (e) {
      console.error("RiwayatStore: error sinkron document_log:", e);
    }
  }

  function hapus(id) {
    simpan(semua().filter((x) => x.id !== id));
    hapusKonten(id);
  }

  // ================================================================
  // Penyimpanan KONTEN LENGKAP per dokumen (bukan cuma metadata riwayat).
  // Sebelumnya halaman hasil (hasil-skripsi.html, hasil-tugas.html) cuma
  // menyimpan isi dokumen di satu slot localStorage tunggal (mis. 'skripsi_hasil',
  // 'task_result') yang selalu ketiban/ketimpa oleh generate berikutnya. Akibatnya
  // dokumen LAMA di "Dokumen Saya" tidak bisa dibuka/diunduh ulang — yang muncul
  // malah isi dokumen TERBARU (salah), atau kosong (lalu terasa seperti "diarahkan
  // ke halaman generate lagi"). Fungsi di bawah menyimpan isi lengkap per-id supaya
  // tiap dokumen bisa dibuka & diunduh ulang kapan saja, selama-lamanya.
  const KEY_KONTEN_PREFIX = "ak_doc_konten_";

  function simpanKonten(id, konten) {
    if (!id) return;
    try {
      localStorage.setItem(KEY_KONTEN_PREFIX + id, JSON.stringify(konten));
    } catch (e) {}
  }

  function ambilKonten(id) {
    if (!id) return null;
    try {
      const raw = localStorage.getItem(KEY_KONTEN_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function hapusKonten(id) {
    if (!id) return;
    try {
      localStorage.removeItem(KEY_KONTEN_PREFIX + id);
    } catch (e) {}
  }

  // Bangun URL tautan sebuah item riwayat sambil menyisipkan ?id=... supaya halaman
  // hasil bisa memuat KONTEN LENGKAP dokumen tsb dari penyimpanan permanen di atas,
  // bukan cuma slot sesi generate terakhir. Dipakai dokumen.html, riwayat.html, favorit.html.
  function tautan(item) {
    if (!item || !item.link) return "";
    if (!item.id) return item.link;
    if (item.link.indexOf("?") !== -1) return item.link; // sudah ada query string, jangan diubah
    return item.link + "?id=" + encodeURIComponent(item.id);
  }

  // upsert: tambah item baru, atau perbarui item yang sudah ada (dicocokkan lewat id).
  // Dipakai oleh halaman chat (mis. DoktrAI, Tanya Jawab) yang perlu memperbarui
  // judul/waktu percakapan yang sama setiap kali ada pesan baru, bukan membuat entri baru terus-menerus.
  function upsert(item) {
    const list = semua();
    const idx = item.id ? list.findIndex((x) => x.id === item.id) : -1;
    if (idx === -1) {
      tambah(item);
      return;
    }
    list[idx] = Object.assign({}, list[idx], item, {
      waktu: new Date().toISOString(),
    });
    simpan(list);
  }

  function byKategori(kategori, limit) {
    const list = semua().filter((x) =>
      kategori === "semua" ? true : x.kategori === kategori
    );
    return limit ? list.slice(0, limit) : list;
  }

  function waktuRelatif(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Baru saja";
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffJam = Math.floor(diffMin / 60);
    if (diffJam < 24) return `${diffJam} jam lalu`;
    const diffHari = Math.floor(diffJam / 24);
    if (diffHari < 7) return `${diffHari} hari lalu`;
    const bulan = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agt",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];
    return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
  }

  // Berapa hari lagi sebuah item akan otomatis dihapus (dipakai buat info di riwayat.html).
  // Mengembalikan null kalau paket pengguna punya "Riwayat tanpa batas" (tidak ada hitung mundur).
  function hariTersisa(iso) {
    if (retensiTanpaBatas()) return null;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    const sisaMs = t + MASA_BERLAKU_HARI * 24 * 60 * 60 * 1000 - Date.now();
    return Math.max(0, Math.ceil(sisaMs / (24 * 60 * 60 * 1000)));
  }

  // ================================================================
  // PERBAIKAN: "tempat khusus simpan file" — backup file hasil generate ke
  // Supabase Storage (bukan cuma localStorage browser). Ini penting karena
  // localStorage browser bisa hilang kapan saja (cache dibersihkan, ganti HP/
  // browser, mode private, dsb) — beda dengan penyimpanan di server yang tetap
  // ada meski begitu. Dipakai terutama oleh skripsi.html supaya kalau mahasiswa
  // lupa unduh, filenya tetap bisa diambil lagi lewat Riwayat/Dokumen kapan pun,
  // bahkan kalau localStorage browsernya sendiri sudah hilang/dibersihkan.
  //
  // Struktur penyimpanan: bucket 'dokumen-hasil', path "{user_id}/{id}.docx" —
  // path-nya deterministik (dibangun dari id yang sama dipakai RiwayatStore),
  // jadi tidak perlu kolom database tambahan untuk mencatat lokasi filenya.
  // WAJIB jalankan sql/perbaikan-storage-dokumen-hasil.sql di Supabase dulu
  // (bikin bucket + izin akses) sebelum fitur ini bisa jalan.
  // ================================================================
  const STORAGE_BUCKET = "dokumen-hasil";

  function _userId() {
    try {
      const u = JSON.parse(localStorage.getItem("ak_user") || "{}");
      return u.id || null;
    } catch (e) {
      return null;
    }
  }

  async function _tokenValid() {
    let token = localStorage.getItem("ak_token");
    if (typeof AkAccount !== "undefined" && AkAccount.getValidToken) {
      try {
        token = await AkAccount.getValidToken();
      } catch (e) {}
    }
    return token;
  }

  // Unggah file (Blob) hasil dokumen ke Supabase Storage, best-effort — kalau
  // gagal (offline, bucket belum dibuat, dsb), TIDAK mengganggu apa pun; file
  // tetap tersimpan penuh di localStorage seperti biasa lewat simpanKonten().
  async function unggahFile(id, blob, filename) {
    if (!id || !blob) return false;
    try {
      if (typeof AK_SUPABASE_URL === "undefined") return false;
      const userId = _userId();
      const token = await _tokenValid();
      if (!userId || !token) return false;
      const ext = (filename || "").split(".").pop() || "docx";
      const path = `${userId}/${id}.${ext}`;
      const res = await fetch(
        `${AK_SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
        {
          method: "POST",
          headers: {
            apikey: AK_SUPABASE_ANON_KEY,
            Authorization: "Bearer " + token,
            "Content-Type":
              blob.type ||
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "x-upsert": "true",
          },
          body: blob,
        }
      );
      if (!res.ok) {
        console.error(
          "RiwayatStore: gagal unggah file ke Storage (" + res.status + ")"
        );
        return false;
      }
      return true;
    } catch (e) {
      console.error("RiwayatStore: error unggah file ke Storage:", e);
      return false;
    }
  }

  // Unduh balik file dari Supabase Storage & langsung trigger download browser.
  // Dipakai sebagai jalur cadangan di hasil-skripsi.html saat isi lengkap di
  // localStorage sudah tidak ada (mis. localStorage dibersihkan / ganti device),
  // tapi file cadangannya masih ada di server.
  async function unduhDariCloud(id, filenameJatuhTempo) {
    if (!id) return false;
    try {
      if (typeof AK_SUPABASE_URL === "undefined") return false;
      const userId = _userId();
      const token = await _tokenValid();
      if (!userId || !token) return false;
      const ext = "docx";
      const path = `${userId}/${id}.${ext}`;
      const res = await fetch(
        `${AK_SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
        {
          headers: {
            apikey: AK_SUPABASE_ANON_KEY,
            Authorization: "Bearer " + token,
          },
        }
      );
      if (!res.ok) return false;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameJatuhTempo || id + ".docx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error("RiwayatStore: error unduh dari Storage:", e);
      return false;
    }
  }

  return {
    semua,
    tambah,
    upsert,
    hapus,
    byKategori,
    waktuRelatif,
    simpanKonten,
    ambilKonten,
    hapusKonten,
    tautan,
    hariTersisa,
    masaBerlakuHari: MASA_BERLAKU_HARI,
    retensiTanpaBatas,
    unggahFile,
    unduhDariCloud,
  };
})();
