/* sync-plan.js
   Letakkan file ini di website KONSUMEN (asistenku.aiconsumen).
   Taruh script tag-nya di semua halaman yang butuh data plan akurat,
   SETELAH <script src="account.js"></script>.

   Cara kerja:
   - Saat halaman dimuat, fungsi ini membaca paket (plan) terbaru
     dari Supabase (tabel 'profiles', kolom 'plan').
   - Hasilnya disimpan ke localStorage('user_plan').
   - Dengan begitu, perubahan paket yang dilakukan admin di panel admin
     langsung berlaku di sisi konsumen tanpa perlu logout/login ulang.
*/

(async function initSyncPlan() {
  // Jika Supabase SDK belum siap, tunggu sampai window load
  if (typeof window.supabase === 'undefined') {
    window.addEventListener('load', doSync);
  } else {
    await doSync();
  }

  async function doSync() {
    if (typeof AkAccount === 'undefined') return;
    await AkAccount.syncPlanFromSupabase();
    if (AkAccount.syncPlanLimits) await AkAccount.syncPlanLimits();

    // Setelah sync, perbarui tampilan badge plan jika ada di halaman ini
    const badge = document.getElementById('planBadge');
    if (badge) {
      const k = AkAccount.getKuota();
      badge.textContent = k.planLabel.toUpperCase();
      badge.className = 'plan-pill ' + (k.planKey === 'gratis' ? 'gratis' : k.planKey);
    }
  }
})();
