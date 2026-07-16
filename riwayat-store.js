/* riwayat-store.js – penyimpanan riwayat aktivitas nyata (bukan data contoh/template).
   Semua halaman yang menghasilkan dokumen (Tugas & Project, Skripsi, Makalah, dll.)
   memanggil RiwayatStore.tambah() setelah AI benar-benar selesai memproses.
   Halaman yang menampilkan riwayat (tugas.html, riwayat.html) memanggil RiwayatStore.semua()
   / RiwayatStore.byKategori() supaya yang muncul selalu sesuai aktivitas asli pengguna. */
const RiwayatStore = (function () {
  const KEY = 'ak_riwayat_items';

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
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
  }

  // item: { id, judul, kategori, kategoriLabel, subtitle, waktu(ISO), status, iconBg, iconType, link }
  function tambah(item) {
    const list = semua();
    if (item.id && list.some(x => x.id === item.id)) return; // hindari duplikat saat refresh
    list.unshift(Object.assign({
      id: item.id || ('r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      waktu: new Date().toISOString(),
      status: 'done'
    }, item));
    simpan(list.slice(0, 100)); // batasi maksimum 100 entri
  }

  function hapus(id) {
    simpan(semua().filter(x => x.id !== id));
  }

  // upsert: tambah item baru, atau perbarui item yang sudah ada (dicocokkan lewat id).
  // Dipakai oleh halaman chat (mis. DoktrAI, Tanya Jawab) yang perlu memperbarui
  // judul/waktu percakapan yang sama setiap kali ada pesan baru, bukan membuat entri baru terus-menerus.
  function upsert(item) {
    const list = semua();
    const idx = item.id ? list.findIndex(x => x.id === item.id) : -1;
    if (idx === -1) {
      tambah(item);
      return;
    }
    list[idx] = Object.assign({}, list[idx], item, { waktu: new Date().toISOString() });
    simpan(list);
  }

  function byKategori(kategori, limit) {
    const list = semua().filter(x => kategori === 'semua' ? true : x.kategori === kategori);
    return limit ? list.slice(0, limit) : list;
  }

  function waktuRelatif(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Baru saja';
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffJam = Math.floor(diffMin / 60);
    if (diffJam < 24) return `${diffJam} jam lalu`;
    const diffHari = Math.floor(diffJam / 24);
    if (diffHari < 7) return `${diffHari} hari lalu`;
    const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
    return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
  }

  return { semua, tambah, upsert, hapus, byKategori, waktuRelatif };
})();
