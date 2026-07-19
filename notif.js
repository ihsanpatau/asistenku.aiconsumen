/* notif.js — sistem notifikasi nyata untuk asistenku.pro.
   Notifikasi dibangun dari aktivitas & kondisi akun yang sesungguhnya:
   dokumen yang baru selesai dibuat (RiwayatStore), kuota yang hampir habis,
   masa paket yang akan berakhir, dan pesan selamat datang untuk akun baru.
   Tidak ada data contoh/template — kalau tidak ada aktivitas, panel akan
   menampilkan status kosong yang jujur. */
const AkNotif = (function () {
  const READ_KEY = 'ak_notif_read_ids';
  const DISMISS_KEY = 'ak_notif_dismissed_ids';
  const SB_URL = 'https://dkpztybbcvvzatgwhano.supabase.co';
  const SB_KEY = 'sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm';
  let adminCache = null;
  let adminCacheTime = 0;

  function getIds(key) {
    try { const a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function setIds(key, ids) { try { localStorage.setItem(key, JSON.stringify(ids.slice(-300))); } catch (e) {} }

  function relatif(iso) {
    if (window.RiwayatStore) return RiwayatStore.waktuRelatif(iso);
    return new Date(iso).toLocaleDateString('id-ID');
  }

  // Ambil pemberitahuan yang dikirim ADMIN lewat panel admin (tabel 'notifications').
  // Di-cache 1 menit supaya tidak query berkali-kali tiap buka panel.
  async function fetchAdminNotifs() {
    try {
      if (adminCache && (Date.now() - adminCacheTime) < 60000) return adminCache;
      if (typeof window.supabase === 'undefined') return adminCache || [];

      const planKey = window.AkAccount ? AkAccount.getPlanKey() : 'gratis';
      const sb = window.supabase.createClient(SB_URL, SB_KEY);
      const { data, error } = await sb
        .from('notifications')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error || !data) return adminCache || [];

      adminCache = data
        .filter(n => n.target === 'all' || n.target === planKey)
        .map(n => ({
          id: 'admin_' + n.id,
          icon: 'info',
          title: n.title,
          desc: n.message,
          waktu: n.created_at,
          link: n.link || null
        }));
      adminCacheTime = Date.now();
      return adminCache;
    } catch (e) {
      console.warn('fetchAdminNotifs gagal:', e);
      return adminCache || [];
    }
  }

  // Bangun daftar notifikasi terkini dari kondisi akun yang sebenarnya.
  function build() {
    const list = [];

    // 1) Dokumen yang baru selesai dibuat
    let items = [];
    try { items = JSON.parse(localStorage.getItem('ak_riwayat_items') || '[]'); } catch (e) {}
    items.slice(0, 6).forEach(it => {
      list.push({
        id: 'doc_' + it.id,
        icon: 'doc',
        title: 'Dokumen berhasil dibuat',
        desc: (it.judul || 'Dokumen') + ' siap dilihat & diunduh',
        waktu: it.waktu || new Date().toISOString(),
        link: it.link || 'dokumen.html'
      });
    });

    // 2) Peringatan kuota hampir habis (≥80% terpakai)
    if (window.AkAccount) {
      const k = AkAccount.getKuota();
      if (k.halamanLimit > 0 && (k.halamanUsed / k.halamanLimit) >= 0.8) {
        list.push({
          id: 'kuota_halaman_' + new Date().toDateString(),
          icon: 'warn',
          title: 'Kuota halaman hampir habis',
          desc: `${k.halamanUsed} dari ${k.halamanLimit} halaman hari ini sudah terpakai`,
          waktu: new Date().toISOString(),
          link: 'upgrade.html'
        });
      }
      if (!k.pesanUnlimited && k.pesanLimit > 0 && (k.pesanUsed / k.pesanLimit) >= 0.8) {
        list.push({
          id: 'kuota_pesan_' + new Date().toDateString(),
          icon: 'warn',
          title: 'Kuota chat DoktrAI hampir habis',
          desc: `${k.pesanUsed} dari ${k.pesanLimit} pesan hari ini sudah terpakai`,
          waktu: new Date().toISOString(),
          link: 'upgrade.html'
        });
      }
    }

    // 3) Masa paket akan berakhir (≤7 hari)
    const exp = localStorage.getItem('user_plan_expiry');
    if (exp) {
      const days = Math.ceil((new Date(exp) - new Date()) / 86400000);
      if (days >= 0 && days <= 7) {
        list.push({
          id: 'plan_exp_' + exp,
          icon: 'clock',
          title: 'Paket Anda akan segera berakhir',
          desc: days === 0 ? 'Paket Anda berakhir hari ini' : `Berakhir dalam ${days} hari lagi \u2013 perpanjang agar tidak terganggu`,
          waktu: new Date().toISOString(),
          link: 'upgrade.html'
        });
      }
    }

    // 4) Selamat datang (sekali, untuk akun yang belum lama bergabung)
    if (window.AkAccount) {
      const user = AkAccount.getUser();
      if (user && user.created_at) {
        const joinedDaysAgo = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
        if (joinedDaysAgo <= 14) {
          list.push({
            id: 'welcome_' + (user.id || 'user'),
            icon: 'star',
            title: 'Selamat datang di asistenku.pro',
            desc: 'Mulai buat dokumen akademik pertama Anda dengan bantuan AI',
            waktu: user.created_at,
            link: 'beranda.html'
          });
        }
      }
    }

    const dismissed = getIds(DISMISS_KEY);
    const filtered = list.filter(n => !dismissed.includes(n.id));
    filtered.sort((a, b) => new Date(b.waktu) - new Date(a.waktu));
    return filtered;
  }

  // Gabungan notifikasi otomatis (lokal) + notifikasi dari admin (Supabase)
  async function buildAll() {
    const local = build();
    const admin = await fetchAdminNotifs();
    const dismissed = getIds(DISMISS_KEY);
    const merged = local.concat(admin.filter(n => !dismissed.includes(n.id)));
    merged.sort((a, b) => new Date(b.waktu) - new Date(a.waktu));
    return merged;
  }

  async function unreadCount() {
    const read = getIds(READ_KEY);
    const list = await buildAll();
    return list.filter(n => !read.includes(n.id)).length;
  }

  async function updateBadges() {
    const n = await unreadCount();
    document.querySelectorAll('.notif-badge').forEach(b => { b.style.display = n > 0 ? '' : 'none'; });
  }

  const ICONS = {
    doc:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  function injectPanel() {
    if (document.getElementById('akNotifOverlay')) return;
    const wrap = document.createElement('div');
    wrap.id = 'akNotifOverlay';
    wrap.className = 'modal-overlay';
    wrap.innerHTML =
      '<div class="modal-sheet">' +
        '<div class="modal-handle"></div>' +
        '<div class="ak-notif-header">' +
          '<div class="ak-notif-header-title">Notifikasi</div>' +
          '<button type="button" class="ak-notif-mark-read" onclick="AkNotif.markAllRead()">Tandai semua dibaca</button>' +
        '</div>' +
        '<div class="ak-notif-list" id="akNotifBody"></div>' +
        '<button class="btn btn-outline" style="margin-top:14px;" onclick="AkNotif.closePanel()">Tutup</button>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closePanel(); });
  }

  async function render() {
    const list = await buildAll();
    const read = getIds(READ_KEY);
    const body = document.getElementById('akNotifBody');
    if (!body) return;
    if (list.length === 0) {
      body.innerHTML =
        '<div style="text-align:center;padding:36px 10px 10px;color:var(--gray-400);">' +
          '<div style="font-size:38px;margin-bottom:10px;">🔔</div>' +
          '<div style="font-size:13px;font-weight:600;color:var(--gray-500);">Tidak ada notifikasi baru</div>' +
          '<div style="font-size:12px;margin-top:4px;">Aktivitas terbaru Anda akan muncul di sini</div>' +
        '</div>';
      return;
    }
    body.innerHTML = list.map(function (n) {
      const isRead = read.includes(n.id);
      return (
        '<div class="ak-notif-item' + (isRead ? '' : ' unread') + '" onclick="AkNotif.open(\'' + n.id + '\',\'' + (n.link || '') + '\')">' +
          '<div class="ak-notif-icon ' + n.icon + '">' + (ICONS[n.icon] || ICONS.info) + '</div>' +
          '<div class="ak-notif-body">' +
            '<div class="ak-notif-title">' + n.title + '</div>' +
            '<div class="ak-notif-desc">' + n.desc + '</div>' +
            '<div class="ak-notif-time">' + relatif(n.waktu) + '</div>' +
          '</div>' +
          (isRead ? '' : '<div class="ak-notif-dot"></div>') +
        '</div>'
      );
    }).join('');
  }

  async function openPanel() {
    injectPanel();
    document.getElementById('akNotifOverlay').classList.add('open');
    const body = document.getElementById('akNotifBody');
    if (body) body.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--gray-400);font-size:13px;">Memuat...</div>';
    await render();
  }
  function closePanel() {
    const el = document.getElementById('akNotifOverlay');
    if (el) el.classList.remove('open');
  }
  async function toggle() {
    const el = document.getElementById('akNotifOverlay');
    if (el && el.classList.contains('open')) { closePanel(); }
    else { await openPanel(); }
  }

  async function open(id, link) {
    const read = getIds(READ_KEY);
    if (!read.includes(id)) { read.push(id); setIds(READ_KEY, read); }
    await updateBadges();
    await render();
    if (link && link !== 'null' && link !== 'undefined') window.location.href = link;
  }

  async function markAllRead() {
    const all = (await buildAll()).map(function (n) { return n.id; });
    const read = getIds(READ_KEY);
    setIds(READ_KEY, Array.from(new Set(read.concat(all))));
    await updateBadges();
    await render();
    if (window.showToast) showToast('Semua notifikasi ditandai dibaca');
  }

  function init() {
    document.querySelectorAll('.notif-btn').forEach(function (btn) {
      btn.onclick = function (e) { e.preventDefault(); toggle(); };
    });
    updateBadges();
  }

  return { init, toggle, openPanel, closePanel, open, markAllRead, unreadCount };
})();

document.addEventListener('DOMContentLoaded', function () { AkNotif.init(); });
