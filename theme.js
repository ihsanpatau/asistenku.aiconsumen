/* theme.js — Pengelola Mode Gelap & Ukuran Font untuk asistenku.pro
   Menyediakan window.AkTheme dengan API:
     AkTheme.isDark()  -> boolean
     AkTheme.toggle()  -> 'dark' | 'light' (menerapkan & menyimpan)
     AkTheme.apply(mode) -> menerapkan tema tanpa toggle
   File ini di-load di SEMUA halaman, jadi ukuran font yang dipilih di
   halaman Pengaturan juga otomatis ikut diterapkan di halaman lain
   (sebelumnya cuma jalan di pengaturan.html).
*/
(function (global) {
  var THEME_KEY = "ak_theme";
  var FONT_KEY = "ak_fontSize";
  var FONT_PX = { Kecil: "13px", Normal: "15px", Besar: "17px", Ekstra: "19px" };

  function getStored() {
    var v = localStorage.getItem(THEME_KEY);
    return v === "dark" ? "dark" : "light";
  }

  function apply(mode) {
    var isDark = mode === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    if (document.body) {
      document.body.classList.toggle("dark", isDark);
    }
    return isDark;
  }

  function isDark() {
    return getStored() === "dark";
  }

  function toggle() {
    var next = isDark() ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    apply(next);
    document.dispatchEvent(new CustomEvent("ak-theme-changed", { detail: { theme: next } }));
    return next;
  }

  function applyFontSize() {
    var saved = localStorage.getItem(FONT_KEY) || "Normal";
    document.documentElement.style.fontSize = FONT_PX[saved] || FONT_PX.Normal;
  }

  global.AkTheme = {
    isDark: isDark,
    toggle: toggle,
    apply: function () {
      apply(getStored());
    },
    applyFontSize: applyFontSize
  };

  apply(getStored());
  applyFontSize();
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", function () {
      apply(getStored());
      applyFontSize();
    });
  }
})(window);
