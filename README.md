# asistenku.pro — Static Website

Website HTML statis siap deploy ke GitHub → Vercel → domain Hostinger.

## Struktur File

```
/
├── index.html         → Splash screen (auto redirect ke login/home)
├── login.html         → Login (Google/Apple/Email + Supabase Auth)
├── register.html      → Daftar akun baru
├── home.html          → Dashboard beranda (3 menu utama + kuota)
├── upgrade.html       → Halaman harga & pembayaran (Midtrans)
├── menu1.html         → Fitur Akademik (Mahasiswa & Siswa)
├── menu2.html         → Tugas & Project (chat serba-bisa)
├── menu3.html         → Konsultasi DoktrAI (chat bebas)
└── assets/
    ├── style.css      → Stylesheet global
    ├── app.js         → Supabase Auth + interaksi UI
    ├── mascot.png     → Maskot kucing (full body)
    └── mascot-head.png→ Maskot kucing (head only)
```

## Cara Deploy

1. **Push ke GitHub**: Upload semua file dalam folder ini ke repo GitHub Anda.
2. **Hubungkan ke Vercel**: 
   - Login vercel.com
   - Import repo GitHub Anda
   - Framework Preset: **Other** (static site)
   - Deploy tanpa build command
3. **Hubungkan domain Hostinger**:
   - Di Vercel: Settings → Domains → Add `asistenku.pro`
   - Di Hostinger DNS: Set A record ke `76.76.21.21` atau CNAME `cname.vercel-dns.com`

## Konfigurasi Supabase (Wajib)

URL & Key sudah tertanam di `assets/app.js`:
```
SUPABASE_URL = 'https://dkpztybbcvvzatgwhano.supabase.co'
SUPABASE_KEY = 'sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm'
```

### Setup di Dashboard Supabase:
1. **Authentication → Providers**: aktifkan Google & Apple (opsional Email)
2. **Authentication → URL Configuration**:
   - Site URL: `https://asistenku.pro`
   - Redirect URLs: `https://asistenku.pro/*`, `https://*.vercel.app/*`, `http://localhost:*`
3. **Authentication → Email Templates**: sesuaikan template konfirmasi email (opsional)

## Preview Mode (Testing)

Untuk melihat halaman terproteksi tanpa login, tambahkan `?preview=1`:
- `home.html?preview=1`
- `upgrade.html?preview=1`
- `menu1.html?preview=1`, dll.

## Yang Belum Terintegrasi (Menunggu API Key dari Anda)

1. **Anthropic Claude API** — untuk otak AI (generate dokumen, chat DoktrAI, Tugas & Project)
   - Nanti Anda kirim API key, akan dihubungkan ke chat & fitur akademik
2. **Midtrans Payment Gateway** — untuk tombol "Beli Sekarang" di halaman Upgrade
   - Butuh Server Key & Client Key Midtrans

## Warna Brand

- Primary Blue: `#2563eb`
- Navy: `#1a1a2e`
- Success Green: `#10b981`
- Purple (DoktrAI): `#8b5cf6`
- Gold (Pro): `#f59e0b`

## Font

Plus Jakarta Sans (Google Fonts) — sudah di-load via CDN.
