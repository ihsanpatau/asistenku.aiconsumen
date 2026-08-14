/* riwayat-store.js – penyimpanan riwayat aktivitas nyata (bukan data contoh/template). Semua halaman yang menghasilkan dokumen (Tugas & Project, Skripsi, Makalah, dll.) memanggil RiwayatStore.tambah() setelah AI benar-benar selesai memproses. Halaman yang menampilkan riwayat (tugas.html, riwayat.html) memanggil RiwayatStore.semua() / RiwayatStore.byKategori() supaya yang muncul selalu sesuai aktivitas asli pengguna. Setiap tambah() juga mengirim ringkasan ke Supabase (tabel 'document_log', lihat syncKeSupabase()) supaya panel ADMIN bisa melihat jumlah dokumen yang dibuat tiap pengguna — sebelumnya data ini cuma ada di localStorage browser pengguna dan tidak terlihat admin sama sekali. */
const RiwayatStore = (function () {
  const KEY = "ak_riwayat_items";

  // Dokumen & riwayat otomatis dihapus (beserta isi lengkapnya) setelah sekian hari,
  // supaya localStorage browser pengguna tidak menumpuk/penuh tanpa batas. Dipakai juga
  // oleh riwayat.html untuk menampilkan info ke pengguna.
  const MASA_BERLAKU_HARI = 7;

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
  function bersihkanKedaluwarsa() {
    const list = bacaMentah();
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
  // Wajib jalankan sql/tambahan-document-log.sql di Supabase SQL Editor dulu
  // supaya tabel 'document_log' ada, kalau belum baris ini akan gagal senyap.
  function syncKeSupabase(item) {
    try {
      const token = localStorage.getItem("ak_token");
      if (!token) return;
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
      fetch(AK_SUPABASE_URL + "/rest/v1/document_log", {
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
      }).catch(function () {});
    } catch (e) {}
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
  function hariTersisa(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    const sisaMs = t + MASA_BERLAKU_HARI * 24 * 60 * 60 * 1000 - Date.now();
    return Math.max(0, Math.ceil(sisaMs / (24 * 60 * 60 * 1000)));
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
  };
})();
