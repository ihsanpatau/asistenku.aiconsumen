/* account.js — sumber tunggal untuk data akun, kuota, profil & favorit.
   Semua halaman memakai fungsi di sini supaya angka yang tampil (kuota, jumlah
   dokumen, tanggal bergabung, foto profil, nama) selalu sesuai aktivitas &
   akun pengguna yang sebenarnya — bukan angka contoh/template. */
const AkAccount = (function () {

  // Batas kuota per paket. Kunci HARUS sama persis dengan yang dipakai upgrade.html
  // (localStorage 'user_plan': 'gratis' | 'standar' | 'pro' | 'lanjutan').
  const PLAN_LIMITS = {
    gratis:   { halaman: 5,  pesan: 5,    label: 'Gratis'   },
    standar:  { halaman: 10, pesan: 20,   label: 'Standar'  },
    pro:      { halaman: 35, pesan: 50,   label: 'Pro'      },
    lanjutan: { halaman: 60, pesan: 99999, label: 'Lanjutan' }
  };

  function getUser() {
    try { return JSON.parse(localStorage.getItem('ak_user') || '{}'); }
    catch (e) { return {}; }
  }

  function getPlanKey() {
    return (localStorage.getItem('user_plan') || 'gratis').toLowerCase();
  }
  function getPlan() {
    return PLAN_LIMITS[getPlanKey()] || PLAN_LIMITS.gratis;
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // Daftar id aktivitas yang sudah dihitung ke kuota, supaya tidak dobel
  // dihitung kalau halaman hasil dibuka ulang / direfresh.
  function getCountedIds() {
    try { return JSON.parse(localStorage.getItem('ak_usage_ids') || '[]'); }
    catch (e) { return []; }
  }
  function markCounted(id) {
    const ids = getCountedIds();
    if (id && !ids.includes(id)) {
      ids.push(id);
      localStorage.setItem('ak_usage_ids', JSON.stringify(ids.slice(-500)));
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
    const key = 'ak_usage_halaman_' + todayKey();
    const cur = parseFloat(localStorage.getItem(key) || '0');
    localStorage.setItem(key, String(cur + jumlah));
  }

  // Catat 1 (atau n) pemakaian pesan/chat AI.
  function catatPesan(n) {
    n = n || 1;
    const key = 'ak_usage_pesan_' + todayKey();
    const cur = parseInt(localStorage.getItem(key) || '0', 10);
    localStorage.setItem(key, String(cur + n));
  }

  function getUsage() {
    const halaman = Math.round(parseFloat(localStorage.getItem('ak_usage_halaman_' + todayKey()) || '0'));
    const pesan = parseInt(localStorage.getItem('ak_usage_pesan_' + todayKey()) || '0', 10);
    return { halaman, pesan };
  }

  // Ringkasan kuota hari ini, siap dipakai untuk ditampilkan di UI.
  function getKuota() {
    const plan = getPlan();
    const usage = getUsage();
    return {
      planKey: getPlanKey(),
      planLabel: plan.label,
      halamanUsed: Math.min(usage.halaman, plan.halaman),
      halamanLimit: plan.halaman,
      pesanUsed: Math.min(usage.pesan, plan.pesan),
      pesanLimit: plan.pesan,
      pesanUnlimited: plan.pesan >= 99999
    };
  }

  // Statistik dokumen nyata dari RiwayatStore (kalau tersedia di halaman ini).
  function getDokumenStats() {
    let items = [];
    try { items = JSON.parse(localStorage.getItem('ak_riwayat_items') || '[]'); } catch (e) {}
    const dokumen = items.filter(x => x.kategori !== 'chat');
    const totalHalaman = dokumen.reduce((sum, x) => sum + (x.halaman || (x.kataTerhitung ? Math.max(1, Math.round(x.kataTerhitung / 275)) : 0)), 0);
    const now = new Date();
    const bulanIni = dokumen.filter(x => {
      const d = new Date(x.waktu);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    return { total: dokumen.length, totalHalaman, bulanIni, items: dokumen };
  }

  function getJoinDate() {
    const user = getUser();
    const iso = user.created_at;
    if (!iso) return null;
    const d = new Date(iso);
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
  }

  function getDisplayName() {
    const user = getUser();
    if (user.id) {
      const local = localStorage.getItem('ak_name_' + user.id);
      if (local) return local;
    }
    return user.user_metadata?.full_name || user.email?.split('@')[0] || 'Pengguna';
  }
  function setDisplayName(name) {
    const user = getUser();
    if (user.id) localStorage.setItem('ak_name_' + user.id, name);
  }

  function getAvatarUrl() {
    const user = getUser();
    if (user.id) {
      const local = localStorage.getItem('ak_avatar_' + user.id);
      if (local) return local;
    }
    return user.user_metadata?.avatar_url || null;
  }
  function setAvatarUrl(dataUrl) {
    const user = getUser();
    if (user.id) localStorage.setItem('ak_avatar_' + user.id, dataUrl);
  }

  // --- Sync Plan dari Supabase (dipanggil saat halaman load) ---
  // Fungsi ini membaca kolom 'plan' dari tabel 'profiles' di Supabase
  // dan menyimpannya ke localStorage, sehingga perubahan yang dilakukan
  // admin di panel admin langsung berpengaruh ke konsumen.
  async function syncPlanFromSupabase() {
    try {
      // Pastikan Supabase SDK sudah dimuat di halaman ini
      if (typeof window.supabase === 'undefined') return;

      const token = localStorage.getItem('ak_token');
      if (!token) return;

      // Decode user ID dari JWT token
      let userId = null;
      try {
        const payload = JSON.parse(decodeURIComponent(escape(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))));
        userId = payload.sub;
      } catch(e) { return; }

      if (!userId) return;

      // Koneksi ke Supabase (URL & key sama dengan shared-config.js)
      const SUPABASE_URL = 'https://dkpztybbcvvzatgwhano.supabase.co';
      const SUPABASE_ANON_KEY = 'sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm';
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: 'Bearer ' + token } }
      });

      const { data, error } = await sb
        .from('profiles')
        .select('plan, plan_expiry')
        .eq('id', userId)
        .single();

      if (error || !data) return;

      // Update localStorage dengan nilai terbaru dari Supabase
      const planBaru = (data.plan || 'gratis').toLowerCase();
      localStorage.setItem('user_plan', planBaru);
      if (data.plan_expiry) {
        localStorage.setItem('user_plan_expiry', data.plan_expiry);
      }
    } catch(e) {
      console.warn('syncPlanFromSupabase gagal:', e);
    }
  }

  // --- Favorit ---
  function getFavoritIds() {
    try { return JSON.parse(localStorage.getItem('ak_favorit_ids') || '[]'); }
    catch (e) { return []; }
  }
  function isFavorit(id) { return getFavoritIds().includes(id); }
  function toggleFavorit(id) {
    let ids = getFavoritIds();
    if (ids.includes(id)) ids = ids.filter(x => x !== id);
    else ids.push(id);
    localStorage.setItem('ak_favorit_ids', JSON.stringify(ids));
    return ids.includes(id);
  }

  return {
    PLAN_LIMITS, getUser, getPlanKey, getPlan, getKuota,
    catatHalaman, catatPesan, getDokumenStats, getJoinDate,
    getDisplayName, setDisplayName, getAvatarUrl, setAvatarUrl,
    getFavoritIds, isFavorit, toggleFavorit,
    syncPlanFromSupabase
  };
})();
