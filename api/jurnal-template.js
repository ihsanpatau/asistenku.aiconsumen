// /api/jurnal-template.js
// Endpoint khusus untuk fitur "Konversi Skripsi → Jurnal dengan Template .docx"
//
// ALUR:
// 1. Terima: teks skripsi (dari browser) + file template .docx (base64) + prompt AI
// 2. Panggil AI dengan teks skripsi + struktur template → dapatkan konten jurnal terstruktur (JSON)
// 3. [OPSI B] Coba inject konten ke dalam file template .docx asli:
// - Parse template: deteksi heading, tabel kosong, placeholder {{...}}, atau section kosong
// - Tulis ulang konten AI ke posisi yang tepat → output .docx dengan layout template terjaga
// 4. [FALLBACK OPSI A] Jika Opsi B gagal (template tidak punya struktur yang bisa dideteksi):
// - Ambil style (font, margin) dari template
// - Buat .docx baru dari konten AI dengan style tersebut
// 5. Return: file .docx sebagai binary response (base64) + metadata

const { createClient } = require("@supabase/supabase-js");
const JSZip = require("jszip");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");

const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayJakarta() {
  const now = new Date();
  const jakarta = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
  );
  return `${jakarta.getFullYear()}-${String(jakarta.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(jakarta.getDate()).padStart(2, "0")}`;
}

function truncate(text, max) {
  text = (text || "").trim();
  return text.length > max ? text.slice(0, max) + "\n...(dipotong)" : text;
}

// ─── Anthropic AI Call ───────────────────────────────────────────────────────

async function callAI(apiKey, systemPrompt, userPrompt, maxTokens = 12000) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      (data.error && data.error.message) || "Anthropic API error"
    );
  return (data.content && data.content[0] && data.content[0].text) || "";
}

// ─── DOCX Parser: ekstrak struktur dari template ─────────────────────────────

async function parseDocxTemplate(base64) {
  const buffer = Buffer.from(base64, "base64");
  const zip = await JSZip.loadAsync(buffer);

  const documentXml = await zip.file("word/document.xml").async("string");
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");

  // Ambil semua paragraf & tabel
  const body = doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "body"
  )[0];
  const elements = body ? body.childNodes : [];

  const structure = {
    headings: [],
    placeholders: [],
    emptySections: [],
    hasStructure: false,
  };

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || !el.tagName) continue;

    const tagLocal = el.tagName.replace(/^w:/, "");

    if (tagLocal === "p") {
      // Cek apakah heading
      const pPr = el.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "pPr"
      )[0];
      const pStyle =
        pPr &&
        pPr.getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "pStyle"
        )[0];
      const styleVal = (pStyle && pStyle.getAttribute("w:val")) || "";

      // Ambil teks paragraf
      const runs = el.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "r"
      );
      let paraText = "";
      for (let r = 0; r < runs.length; r++) {
        const t = runs[r].getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "t"
        )[0];
        if (t) paraText += t.textContent || "";
      }
      paraText = paraText.trim();

      // Deteksi placeholder {{...}}
      const placeholderMatch = paraText.match(/\{\{([^}]+)\}\}/g);
      if (placeholderMatch) {
        placeholderMatch.forEach((ph) =>
          structure.placeholders.push({
            placeholder: ph,
            text: paraText,
            index: i,
          })
        );
        structure.hasStructure = true;
      }

      // Deteksi heading
      if (
        styleVal.toLowerCase().includes("heading") ||
        styleVal.match(/^[Hh][1-6]$/)
      ) {
        structure.headings.push({ text: paraText, style: styleVal, index: i });
        structure.hasStructure = true;
      }

      // Deteksi paragraf kosong setelah heading (kemungkinan area tulis)
      if (paraText === "" && structure.headings.length > 0) {
        structure.emptySections.push({
          afterHeading: structure.headings[structure.headings.length - 1].text,
          index: i,
        });
      }
    }
  }

  // Ambil info style (font, ukuran, margin) dari template
  let styleInfo = {
    fontName: "Times New Roman",
    fontSize: "12",
    marginTop: "1440",
    marginBottom: "1440",
    marginLeft: "1800",
    marginRight: "1800",
  };
  try {
    const stylesXml = zip.file("word/styles.xml");
    if (stylesXml) {
      const stylesContent = await stylesXml.async("string");
      const fontMatch = stylesContent.match(/w:ascii="([^"]+)"/); if (fontMatch) styleInfo.fontName = fontMatch[1]; const sizeMatch = stylesContent.match(/w:sz w:val="(\d+)"/); if (sizeMatch) styleInfo.fontSize = String(parseInt(sizeMatch[1]) / 2); } const settingsXml = zip.file("word/settings.xml"); if (!settingsXml) { // Coba ambil margin dari document.xml sectPr const sectPr = doc.getElementsByTagNameNS( "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "sectPr"
      )[0];
      const pgMar =
        sectPr &&
        sectPr.getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "pgMar"
        )[0];
      if (pgMar) {
        styleInfo.marginTop =
          pgMar.getAttribute("w:top") || styleInfo.marginTop;
        styleInfo.marginBottom =
          pgMar.getAttribute("w:bottom") || styleInfo.marginBottom;
        styleInfo.marginLeft =
          pgMar.getAttribute("w:left") || styleInfo.marginLeft;
        styleInfo.marginRight =
          pgMar.getAttribute("w:right") || styleInfo.marginRight;
      }
    }
  } catch (e) {
    /* gunakan default */
  }

  return { structure, styleInfo, zip, documentXml, doc };
}

// ─── OPSI B: Inject konten ke template .docx ────────────────────────────────

async function injectIntoTemplate(templateData, aiContent, apiKey) {
  const { structure, styleInfo, zip, documentXml } = templateData;

  // Minta AI hasilkan konten per-section sesuai heading yang ditemukan di template
  const sectionKeys =
    structure.headings.length > 0
      ? structure.headings.map((h) => h.text).filter(Boolean)
      : null;

  // Jika ada placeholder → replace langsung
  if (structure.placeholders.length > 0) {
    const phNames = structure.placeholders.map((p) => p.placeholder).join(", ");
    const phFillPrompt = `Kamu diberikan konten jurnal berikut:\n\n${truncate(
      aiContent,
      8000
    )}\n\nIsi placeholder berikut dari konten di atas. Balas HANYA JSON valid:\n{\n${structure.placeholders
      .map((p) => `  "${p.placeholder}": "isi teks di sini"`)
      .join(",\n")}\n}`;

    const phJson = await callAI(
      apiKey,
      "Kamu adalah asisten pengisi template jurnal. Isi placeholder dengan konten yang sesuai. Balas HANYA JSON valid tanpa backtick.",
      phFillPrompt,
      4000
    );

    let phData = {};
    try {
      phData = JSON.parse(phJson.replace(/```json|```/g, "").trim());
    } catch (e) {}

    let newXml = documentXml;
    for (const [ph, val] of Object.entries(phData)) {
      const escaped = (val || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      newXml = newXml.split(ph).join(escaped);
    }
    zip.file("word/document.xml", newXml);
    return await zip.generateAsync({ type: "nodebuffer" });
  }

  // Jika ada heading → inject konten setelah tiap heading
  if (structure.headings.length >= 2) {
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    // Minta AI split konten per-heading
    const splitPrompt = `Kamu diberikan konten jurnal berikut:\n\n${truncate(
      aiContent,
      10000
    )}\n\nFile template jurnal mempunyai section/heading berikut:\n${structure.headings
      .map((h, i) => `${i + 1}. ${h.text}`)
      .join(
        "\n"
      )}\n\nBagi dan sesuaikan konten jurnal ke dalam section tersebut. Balas HANYA JSON valid:\n{\n${structure.headings
      .map(
        (h) =>
          `  "${h.text}": "isi teks untuk section ini (paragraf, bukan bullet)"`
      )
      .join(",\n")}\n}`;

    const splitJson = await callAI(
      apiKey,
      "Kamu adalah asisten pembagi konten jurnal. Distribusikan konten ke section yang sesuai. Balas HANYA JSON tanpa backtick.",
      splitPrompt,
      6000
    );

    let sectionContent = {};
    try {
      sectionContent = JSON.parse(splitJson.replace(/```json|```/g, "").trim());
    } catch (e) {}

    // Buat XML baru: insert paragraf konten setelah setiap heading
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(documentXml, "application/xml");
    const body = xmlDoc.getElementsByTagNameNS(W, "body")[0];
    if (!body) throw new Error("No body in template XML");

    // Fungsi buat paragraf teks
    function makePara(text, fontName, fontSize) {
      const lines = text.split(/\n+/).filter((l) => l.trim());
      return lines
        .map((line) => {
          const escaped = line
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:rPr><w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}"/><w:sz w:val="${ parseInt(fontSize) * 2 }"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}"/><w:sz w:val="${ parseInt(fontSize) * 2 }"/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
        })
        .join("");
    }

    // Insert setelah tiap heading: hapus empty paragraf lama, insert konten baru
    const children = Array.from(body.childNodes);
    let newBodyXml = "";
    let lastHeadingText = null;
    let skipEmpties = false;

    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (!el || !el.tagName) continue;
      const ser = new XMLSerializer();
      const elXml = ser.serializeToString(el);

      const runs =
        el.getElementsByTagNameNS && el.getElementsByTagNameNS(W, "r");
      let paraText = "";
      if (runs)
        for (let r = 0; r < runs.length; r++) {
          const t = runs[r].getElementsByTagNameNS(W, "t")[0];
          if (t) paraText += t.textContent || "";
        }
      paraText = paraText.trim();

      const isHeading = structure.headings.some((h) => h.index === i);
      const isEmptyPara = el.tagName.endsWith(":p") || el.tagName === "w:p";

      if (isHeading && sectionContent[paraText] !== undefined) {
        newBodyXml += elXml; // pertahankan heading asli
        lastHeadingText = paraText;
        skipEmpties = true; // skip empty paragraf setelahnya
        // Insert konten
        newBodyXml += makePara(
          sectionContent[paraText] || "(konten tidak tersedia)",
          styleInfo.fontName,
          styleInfo.fontSize
        );
      } else if (skipEmpties && paraText === "") {
        // Skip paragraf kosong setelah heading yang sudah diisi
        continue;
      } else {
        skipEmpties = false;
        newBodyXml += elXml;
      }
    }

    // Rebuild document.xml
    const sectPrMatch = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
    const sectPr = sectPrMatch ? sectPrMatch[0] : "";
    const newDocXml = documentXml.replace(
      /<w:body>[\s\S]*<\/w:body>/,
      `<w:body>${newBodyXml}${sectPr}</w:body>`
    );

    zip.file("word/document.xml", newDocXml);
    return await zip.generateAsync({ type: "nodebuffer" });
  }

  // Tidak ada struktur yang bisa dideteksi → throw supaya fallback ke Opsi A
  throw new Error("TEMPLATE_NO_STRUCTURE");
}

// ─── OPSI A: Buat .docx baru dengan style dari template ─────────────────────

async function buildDocxFromStyle(styleInfo, aiContent, judul) {
  // Buat docx sederhana dengan font/margin dari template
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const font = styleInfo.fontName || "Times New Roman";
  const sz = parseInt(styleInfo.fontSize || "12") * 2;
  const mt = styleInfo.marginTop || "1440";
  const mb = styleInfo.marginBottom || "1440";
  const ml = styleInfo.marginLeft || "1800";
  const mr = styleInfo.marginRight || "1800";

  // Pisahkan konten AI menjadi paragraf
  const lines = aiContent.split(/\n+/).filter((l) => l.trim());

  function escapedPara(text, isBold, fontSize) {
    const esc = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const bold = isBold ? "<w:b/>" : "";
    return `<w:p><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:rPr>${bold}<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="${ fontSize || sz }"/></w:rPr></w:pPr><w:r><w:rPr>${bold}<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="${ fontSize || sz }"/></w:rPr><w:t xml:space="preserve">${esc}</w:t></w:r></w:p>`;
  }

  let bodyXml = "";
  // Judul
  if (judul) bodyXml += escapedPara(judul, true, sz + 4);
  bodyXml += `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr></w:p>`;

  for (const line of lines) {
    const isHeading =
      /^(BAB|PENDAHULUAN|ABSTRAK|ABSTRACT|METODE|HASIL|KESIMPULAN|DAFTAR PUSTAKA|[IVX]+\.|[A-Z][A-Z ]{3,}:?)$/.test(
        line.trim()
      ) || line.trim().match(/^\d+\.\s+[A-Z]/);
    bodyXml += escapedPara(line, !!isHeading, isHeading ? sz + 2 : sz);
  }

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  mc:Ignorable="w14 w15">
<w:body>
${bodyXml}
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>
  <w:pgMar w:top="${mt}" w:right="${mr}" w:bottom="${mb}" w:left="${ml}" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body></w:document>`;

  const zip = new JSZip();
  zip.file("word/document.xml", docXml);
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`
  );

  return await zip.generateAsync({ type: "nodebuffer" });
}

// ─── Main Handler ────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    // --- Auth ---
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Wajib login." });

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey)
      return res
        .status(500)
        .json({ error: "SUPABASE_SERVICE_ROLE_KEY belum diset." });

    const sbAdmin = createClient(SUPABASE_URL, serviceRoleKey);
    const { data: userData, error: userErr } = await sbAdmin.auth.getUser(
      token
    );
    if (userErr || !userData?.user)
      return res.status(401).json({ error: "Sesi login tidak valid." });
    const userId = userData.user.id;

    const { data: profile } = await sbAdmin
      .from("profiles")
      .select("blocked, plan")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.blocked)
      return res.status(403).json({ error: "Akun diblokir." });

    // --- Rate limit (repakai pola dari generate.js) ---
    const day = todayJakarta();
    const { data: usageRow } = await sbAdmin
      .from("usage_tracking")
      .select("request_count")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    const currentCount = usageRow?.request_count || 0;
    if (currentCount >= 100)
      return res
        .status(429)
        .json({ error: "Batas pemakaian harian tercapai." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
      return res.status(500).json({ error: "API key belum dikonfigurasi." });

    const {
      skripsiText,
      templateDocxB64,
      templateText,
      prompt,
      judul,
      targetKata,
    } = req.body || {};
    if (!skripsiText)
      return res.status(400).json({ error: "Teks skripsi wajib diisi." });

    // --- Step 1: Generate konten jurnal dari AI ---
    const systemPrompt = `Kamu adalah ahli penulisan jurnal ilmiah Indonesia. Buat artikel jurnal akademik yang mengkonversi isi skripsi menjadi format jurnal. Tulis dalam Bahasa Indonesia formal dan akademis. Jangan gunakan markdown heading (#), gunakan teks biasa.`;

    const userPromptAI = `${
      prompt || "Konversi skripsi ini menjadi artikel jurnal ilmiah:"
    }\n\n=== ISI SKRIPSI ===\n${truncate(skripsiText, 14000)}\n\n${
      templateText
        ? `=== STRUKTUR TEMPLATE JURNAL TARGET ===\n${truncate(
            templateText,
            4000
          )}\n\nIkuti urutan dan nama bagian dari template di atas.`
        : "Gunakan format standar: Judul, Abstrak (ID & EN), Kata Kunci, Pendahuluan, Metode, Hasil dan Pembahasan, Kesimpulan, Daftar Pustaka."
    }\n\nTarget: ±${
      targetKata || 3000
    } kata. Tulis lengkap dengan semua bagian.`;

    const aiContent = await callAI(
      apiKey,
      systemPrompt,
      userPromptAI,
      Math.min(20000, Math.max(4000, parseInt(targetKata || 3000) * 2))
    );

    let docxBuffer = null;
    let mode = "A"; // default fallback

    // --- Step 2: Coba Opsi B (inject ke template) ---
    if (templateDocxB64) {
      try {
        const templateData = await parseDocxTemplate(templateDocxB64);
        docxBuffer = await injectIntoTemplate(templateData, aiContent, apiKey);
        mode = "B";
      } catch (injectErr) {
        if (injectErr.message !== "TEMPLATE_NO_STRUCTURE") {
          console.error("Inject error (non-structure):", injectErr.message);
        }
        // Fallback ke Opsi A dengan style dari template
        try {
          const templateData = await parseDocxTemplate(templateDocxB64);
          docxBuffer = await buildDocxFromStyle(
            templateData.styleInfo,
            aiContent,
            judul || "Jurnal Ilmiah"
          );
          mode = "A-styled"; // A dengan style template
        } catch (e2) {
          console.error("Fallback also failed:", e2.message);
          // Fallback murni Opsi A default
          docxBuffer = await buildDocxFromStyle(
            {
              fontName: "Times New Roman",
              fontSize: "12",
              marginTop: "1440",
              marginBottom: "1440",
              marginLeft: "1800",
              marginRight: "1800",
            },
            aiContent,
            judul || "Jurnal Ilmiah"
          );
          mode = "A-default";
        }
      }
    } else {
      // Tidak ada template docx → langsung Opsi A default
      docxBuffer = await buildDocxFromStyle(
        {
          fontName: "Times New Roman",
          fontSize: "12",
          marginTop: "1440",
          marginBottom: "1440",
          marginLeft: "1800",
          marginRight: "1800",
        },
        aiContent,
        judul || "Jurnal Ilmiah"
      );
      mode = "A-default";
    }

    // --- Step 3: Catat usage ---
    try {
      await sbAdmin.rpc("increment_api_usage", {
        p_user_id: userId,
        p_day: day,
      });
    } catch (e) {
      console.error("Usage tracking error:", e.message);
    }

    // --- Step 4: Return docx sebagai base64 + teks AI ---
    const docxB64 = docxBuffer.toString("base64");
    return res.status(200).json({
      docxBase64: docxB64,
      aiText: aiContent,
      mode,
      modeLabel:
        mode === "B"
          ? "Inject ke Template (Opsi B)"
          : mode === "A-styled"
          ? "Baru dengan Style Template (Opsi A)"
          : "Format Standar (Opsi A)",
    });
  } catch (err) {
    console.error("jurnal-template error:", err);
    return res
      .status(500)
      .json({ error: "Terjadi kesalahan server: " + err.message });
  }
};
