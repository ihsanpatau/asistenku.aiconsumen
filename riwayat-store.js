/* riwayat-store.js – penyimpanan riwayat aktivitas nyata (bukan data contoh/template). Semua halaman yang menghasilkan dokumen (Tugas & Project, Skripsi, Makalah, dll.) memanggil RiwayatStore.tambah() setelah AI benar-benar selesai memproses. Halaman yang menampilkan riwayat (tugas.html, riwayat.html) memanggil RiwayatStore.semua() / RiwayatStore.byKategori() supaya yang muncul selalu sesuai aktivitas asli pengguna. */
const RiwayatStore = (function () {
  const KEY = "ak_riwayat_items";

  function semua() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
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
  };
})();
