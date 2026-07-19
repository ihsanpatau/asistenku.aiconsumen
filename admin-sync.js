/* admin-sync.js
   Dipakai di halaman KONSUMEN (asistenku.aiconsumen) untuk mengambil data
   harga & limit paket TERBARU yang diatur admin lewat Admin Panel
   (tabel 'packages' di Supabase), supaya harga yang tampil di upgrade.html
   selalu sesuai dengan yang diatur admin — bukan angka bawaan/template.

   Wajib dimuat SETELAH:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script src="shared-config.js"></script>
*/
window.AkPricing = (function () {
  let cache = null;
  let cacheTime = 0;
  const CACHE_MS = 60 * 1000; // 1 menit, supaya tidak query berkali-kali tiap ganti halaman

  async function getPackages(forceRefresh) {
    try {
      if (!forceRefresh && cache && (Date.now() - cacheTime) < CACHE_MS) {
        return cache;
      }
      if (typeof window.supabase === 'undefined' || typeof akCreateClient !== 'function') {
        return cache || [];
      }
      const sb = akCreateClient();
      const { data, error } = await sb
        .from('packages')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      if (error || !data) return cache || [];

      cache = data;
      cacheTime = Date.now();
      return cache;
    } catch (e) {
      console.warn('AkPricing.getPackages gagal:', e);
      return cache || [];
    }
  }

  return { getPackages };
})();
