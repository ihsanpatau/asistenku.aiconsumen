/* shared-config.js
   Konfigurasi Supabase yang dipakai BERSAMA oleh website konsumen (asistenku.pro)
   dan website admin (admin-asistenku.vercel.app).

   PENTING SOAL KEAMANAN:
   - Kunci di bawah ini adalah "anon / publishable key" — kunci ini MEMANG
     didesain untuk berada di kode browser/publik (GitHub, Vercel, dsb).
     Kunci ini TIDAK bisa dipakai untuk mencuri data karena semua akses
     diatur oleh Row Level Security.
   - JANGAN PERNAH menaruh "service_role key" atau "Personal Access Token"
     (yang diawali sbp_...) di file manapun yang diupload ke GitHub. Kedua
     kunci itu punya akses penuh ke seluruh project Supabase Anda tanpa
     dibatasi RLS — kalau bocor, orang lain bisa menghapus/mengubah semua
     data Anda.
*/
const AK_SUPABASE_URL = 'https://dkpztybbcvvzatgwhano.supabase.co';
const AK_SUPABASE_ANON_KEY = 'sb_publishable_yYIlVG0GWf85R3wK_xjhfQ_1gqucStm';

// Dipakai di halaman yang sudah memuat <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
function akCreateClient() {
  return window.supabase.createClient(AK_SUPABASE_URL, AK_SUPABASE_ANON_KEY);
}
