/* ai-loading.js — Popup "AI sedang bekerja" yang tampil di TENGAH layar setiap kali AI sedang memproses sesuatu (parafrase, generate PPT, revisi skripsi, generate tugas, dsb), supaya pengguna TAHU proses sedang berjalan (bukan diam / macet / belum mulai). Menampilkan maskot kucing berjalan (cat-tugas.png) + progress bar animasi + pesan tahap proses yang bisa diganti-ganti (mis. "Membaca dokumen...", "AI sedang menulis...", "Menyusun hasil..."). Cara pakai di halaman manapun: <script src="ai-loading.js"></script> Lalu di kode generate: AkLoading.show('AI sedang membuat parafrase...'); ... AkLoading.update('Menyusun hasil akhir...'); // opsional, ganti pesan ... AkLoading.hide(); Kalau proses gagal / error, tetap panggil AkLoading.hide() di blok catch/finally supaya popup tidak nyangkut di layar. */
const AkLoading = (function () {
  let injected = false;
  let openCount = 0; // dukung pemanggilan bertumpuk (nested) dengan aman

  function injectOnce() {
    if (injected) return;
    injected = true;

    const style = document.createElement("style");
    style.textContent = `
      #akLoadingOverlay{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;
        background:rgba(15,23,42,.6);backdrop-filter:blur(4px);padding:20px;}
      #akLoadingOverlay.open{display:flex;animation:akLoadFadeBg .2s ease;}
      @keyframes akLoadFadeBg{from{opacity:0}to{opacity:1}}
      .ak-load-card{position:relative;width:100%;max-width:320px;background:var(--white,#fff);
        border-radius:24px;padding:26px 22px 22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35);
        animation:akLoadPop .3s cubic-bezier(.34,1.56,.64,1);overflow:hidden;}
      @keyframes akLoadPop{from{transform:scale(.85) translateY(16px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
      .ak-load-track{position:relative;width:100%;height:76px;margin-bottom:6px;overflow:hidden;
        border-radius:14px;background:linear-gradient(135deg,#EEF2FF,#FDF2F8);}
      .ak-load-track::before{content:'';position:absolute;left:0;right:0;bottom:14px;height:2px;
        background:repeating-linear-gradient(90deg,#C7D2FE 0 8px,transparent 8px 16px);}
      .ak-load-cat{position:absolute;bottom:10px;left:-56px;width:56px;height:56px;
        animation:akLoadWalk 2.6s linear infinite;filter:drop-shadow(0 6px 8px rgba(0,0,0,.18));}
      .ak-load-cat img{width:100%;height:100%;object-fit:contain;animation:akLoadBob .38s ease-in-out infinite;}
      @keyframes akLoadWalk{
        0%{left:-56px;}
        100%{left:100%;}
      }
      @keyframes akLoadBob{
        0%,100%{transform:translateY(0) rotate(-2deg);}
        50%{transform:translateY(-6px) rotate(2deg);}
      }
      .ak-load-dots{display:inline-flex;gap:4px;vertical-align:middle;margin-left:2px;}
      .ak-load-dots span{width:5px;height:5px;border-radius:50%;background:var(--pink,#DB2777);
        animation:akLoadDot 1.2s ease-in-out infinite;}
      .ak-load-dots span:nth-child(2){animation-delay:.15s;}
      .ak-load-dots span:nth-child(3){animation-delay:.3s;}
      @keyframes akLoadDot{0%,80%,100%{opacity:.25;transform:scale(.8);}40%{opacity:1;transform:scale(1.1);}}
      .ak-load-title{font-size:15.5px;font-weight:800;color:var(--gray-900,#111827);margin-bottom:4px;}
      .ak-load-msg{font-size:12.5px;line-height:1.5;color:var(--gray-600,#4B5563);min-height:18px;}
      .ak-load-bar-wrap{width:100%;height:6px;border-radius:6px;background:#E5E7EB;margin-top:16px;overflow:hidden;}
      .ak-load-bar{width:40%;height:100%;border-radius:6px;
        background:linear-gradient(90deg,#7C3AED,#DB2777);
        animation:akLoadBar 1.3s ease-in-out infinite;}
      @keyframes akLoadBar{
        0%{transform:translateX(-100%);}
        100%{transform:translateX(250%);}
      }
      .ak-load-note{margin-top:12px;font-size:10.5px;color:var(--gray-400,#9CA3AF);}
    `;
    document.head.appendChild(style);

    const wrap = document.createElement("div");
    wrap.id = "akLoadingOverlay";
    wrap.innerHTML = `
      <div class="ak-load-card">
        <div class="ak-load-track">
          <div class="ak-load-cat"><img src="cat-tugas.png" alt="AI sedang bekerja"></div>
        </div>
        <div class="ak-load-title">AI Sedang Bekerja<span class="ak-load-dots"><span></span><span></span><span></span></span></div>
        <div class="ak-load-msg" id="akLoadingMsg">Mohon tunggu sebentar...</div>
        <div class="ak-load-bar-wrap"><div class="ak-load-bar"></div></div>
        <div class="ak-load-note">Jangan tutup atau tinggalkan halaman ini</div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  function show(message) {
    injectOnce();
    openCount++;
    const msg = document.getElementById("akLoadingMsg");
    if (msg) msg.textContent = message || "Mohon tunggu sebentar...";
    document.getElementById("akLoadingOverlay").classList.add("open");
  }

  function update(message) {
    const msg = document.getElementById("akLoadingMsg");
    if (msg && message) msg.textContent = message;
  }

  function hide(force) {
    openCount = force ? 0 : Math.max(0, openCount - 1);
    if (openCount > 0) return; // masih ada proses lain yang butuh popup ini
    const el = document.getElementById("akLoadingOverlay");
    if (el) el.classList.remove("open");
  }

  return { show, update, hide };
})();
