/* * docx-realedit.js * ------------------------------------------------------------------ * Editor DOCX "asli" — TIDAK mengonversi/membangun ulang file Word. * * Cara kerja: * 1. File .docx yang diupload dibuka sebagai ZIP (JSZip) — persis * seperti isinya di disk, tanpa dikonversi ke HTML/teks datar. * 2. Hanya bagian word/document.xml yang diparse (DOM XML) untuk * dibaca teksnya paragraf per paragraf. * 3. Saat AI merevisi sebuah paragraf, HANYA node <w:t> pada * paragraf itu yang diubah teksnya. Properti paragraf (w:pPr — * alignment, spacing, style/heading) dan properti run pertama * (w:rPr — font, ukuran, bold) dipertahankan apa adanya. * 4. Bagian lain dari file (styles.xml, gambar, header/footer, * numbering, dsb.) tidak pernah disentuh. * 5. Saat diunduh, ZIP yang sama (dengan document.xml yang sudah * diperbarui) di-generate ulang menjadi .docx — bukan dibangun * dari nol. * * Hasil: struktur & format dokumen asli tetap utuh, kecuali bagian * yang memang diminta untuk direvisi. * ------------------------------------------------------------------ */

(function (global) {
  const WORD_NS =
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";

  function norm(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[“”„"']/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenSet(s) {
    return new Set(
      norm(s)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2)
    );
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return inter / (a.size + b.size - inter);
  }

  // Recursively pulls the visible text out of a <w:p> (or any node),
  // honoring tabs/line-breaks and ignoring markup like proofErr.
  function extractText(node) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      const ln = child.localName;
      if (ln === "t") out += child.textContent;
      else if (ln === "tab") out += "\t";
      else if (ln === "br" || ln === "cr") out += "\n";
      else out += extractText(child);
    }
    return out;
  }

  function directRuns(pEl) {
    return Array.from(pEl.children).filter((c) => c.localName === "r");
  }

  function hasDrawing(pEl) {
    return (
      !!pEl.getElementsByTagNameNS(WORD_NS, "drawing").length ||
      !!pEl.querySelector?.("[*|drawing]")
    );
  }

  function styleIdOf(pEl) {
    const pPr = Array.from(pEl.children).find((c) => c.localName === "pPr");
    if (!pPr) return "";
    const pStyle = Array.from(pPr.children).find(
      (c) => c.localName === "pStyle"
    );
    return pStyle ? pStyle.getAttributeNS(WORD_NS, "val") || "" : "";
  }

  function isBoldFirstRun(pEl) {
    const runs = directRuns(pEl);
    if (!runs.length) return false;
    const rPr = Array.from(runs[0].children).find((c) => c.localName === "rPr");
    if (!rPr) return false;
    return !!Array.from(rPr.children).find((c) => c.localName === "b");
  }

  function headingLevel(text, styleId, bold) {
    const t = (text || "").trim();
    const sid = (styleId || "").toLowerCase();
    if (/^(heading1|title|judul1)/.test(sid)) return 1;
    if (/^(heading2|judul2)/.test(sid)) return 2;
    if (/^(heading3|judul3)/.test(sid)) return 3;
    if (
      /^(bab\s+[ivx\d]+|daftar\s+pustaka|abstrak|kata\s+pengantar|lampiran)\b/i.test(
        t
      ) &&
      t.length < 60
    )
      return 1;
    if (/^\d+\.\d+(\.\d+)?\s+\S/.test(t) && t.length < 100) return 2;
    if (bold && t.length < 90 && /^[A-Z0-9][A-Z0-9\s.,:-]{3,}$/.test(t))
      return 2;
    return 0;
  }

  class DocxRealEditor {
    constructor(zip, xmlDoc, xmlText, fileName) {
      this.zip = zip;
      this.xmlDoc = xmlDoc;
      this.fileName = fileName || "dokumen.docx";
      this.blocks = []; // {type:'p'|'tbl', id, el, text, level, hasImage}
      this._refresh();
    }

    static async load(file) {
      if (!global.JSZip)
        throw new Error("Modul JSZip belum siap, refresh halaman.");
      const buf = await file.arrayBuffer();
      const zip = await global.JSZip.loadAsync(buf);
      const entry = zip.file("word/document.xml");
      if (!entry) throw new Error("File .docx tidak valid atau rusak.");
      const xmlText = await entry.async("string");
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");
      if (xmlDoc.getElementsByTagName("parsererror").length) {
        throw new Error("Gagal membaca struktur file Word.");
      }
      return new DocxRealEditor(zip, xmlDoc, xmlText, file.name);
    }

    _body() {
      return this.xmlDoc.getElementsByTagNameNS(WORD_NS, "body")[0];
    }

    _refresh() {
      const body = this._body();
      const blocks = [];
      let idx = 0;
      Array.from(body.children).forEach((child) => {
        if (child.localName === "p") {
          const text = extractText(child).trim();
          const sid = styleIdOf(child);
          const bold = isBoldFirstRun(child);
          blocks.push({
            type: "p",
            id: "b" + idx++,
            el: child,
            text,
            level: headingLevel(text, sid, bold),
            hasImage: hasDrawing(child),
          });
        } else if (child.localName === "tbl") {
          const rows = [];
          Array.from(child.getElementsByTagNameNS(WORD_NS, "tr")).forEach(
            (tr) => {
              const cells = Array.from(
                tr.getElementsByTagNameNS(WORD_NS, "tc")
              ).map((tc) => extractText(tc).trim());
              rows.push(cells);
            }
          );
          blocks.push({ type: "tbl", id: "b" + idx++, el: child, rows });
        }
      });
      this.blocks = blocks;
    }

    // Paragraphs only (used for AI context + text matching)
    paragraphTexts() {
      return this.blocks
        .filter((b) => b.type === "p" && b.text)
        .map((b) => b.text);
    }

    fullPlainText() {
      return this.blocks
        .map((b) =>
          b.type === "p"
            ? b.text
            : (b.rows || []).map((r) => r.join(" | ")).join("\n")
        )
        .filter(Boolean)
        .join("\n");
    }

    // Fuzzy-find the paragraph block index best matching a text snippet.
    findParagraphIndex(snippet, hintHeading) {
      const target = norm(snippet).slice(0, 300);
      if (!target) return -1;
      let best = -1,
        bestScore = 0;
      const targetTokens = tokenSet(snippet);
      this.blocks.forEach((b, i) => {
        if (b.type !== "p" || !b.text || b.hasImage) return;
        const bt = norm(b.text);
        let score = 0;
        if (
          bt.includes(target.slice(0, 80)) ||
          target.includes(bt.slice(0, 80))
        ) {
          score = 1;
        } else {
          score = jaccard(targetTokens, tokenSet(b.text));
        }
        if (
          hintHeading &&
          b.level > 0 &&
          norm(b.text).includes(norm(hintHeading))
        ) {
          score += 0.05;
        }
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      return bestScore >= 0.4 ? best : -1;
    }

    // Find a heading block matching a section name (e.g. "Kata Pengantar")
    findHeadingIndex(name) {
      if (!name) return -1;
      const target = norm(name);
      let best = -1,
        bestScore = 0;
      this.blocks.forEach((b, i) => {
        if (b.type !== "p" || b.level === 0) return;
        const score = jaccard(tokenSet(b.text), tokenSet(name));
        const contains =
          norm(b.text).includes(target) || target.includes(norm(b.text));
        const s = contains ? Math.max(score, 0.6) : score;
        if (s > bestScore) {
          bestScore = s;
          best = i;
        }
      });
      return bestScore >= 0.35 ? best : -1;
    }

    // Replace the visible text of a paragraph, preserving pPr + first run's rPr.
    // Supports multi-paragraph output when newText contains blank-line breaks.
    replaceParagraph(blockIdx, newText) {
      const block = this.blocks[blockIdx];
      if (!block || block.type !== "p" || block.hasImage) return false;
      const parts = String(newText)
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) return false;

      const pEl = block.el;
      this._setSingleParagraphText(pEl, parts[0]);

      // Insert additional paragraphs (cloning this paragraph's formatting) for
      // any extra chunks (e.g. "ubah jadi 3 paragraf").
      let anchor = pEl;
      for (let i = 1; i < parts.length; i++) {
        const clone = pEl.cloneNode(true);
        this._setSingleParagraphText(clone, parts[i]);
        anchor.parentNode.insertBefore(clone, anchor.nextSibling);
        anchor = clone;
      }
      this._refresh();
      return true;
    }

    _setSingleParagraphText(pEl, text) {
      const runs = directRuns(pEl);
      const doc = this.xmlDoc;
      if (!runs.length) {
        const r = doc.createElementNS(WORD_NS, "w:r");
        const t = doc.createElementNS(WORD_NS, "w:t");
        t.setAttributeNS(XML_NS, "xml:space", "preserve");
        t.textContent = text;
        r.appendChild(t);
        pEl.appendChild(r);
        return;
      }
      const firstRun = runs[0];
      let tEl = Array.from(firstRun.children).find((c) => c.localName === "t");
      if (!tEl) {
        tEl = doc.createElementNS(WORD_NS, "w:t");
        firstRun.appendChild(tEl);
      }
      // remove stray tab/break siblings inside the first run
      Array.from(firstRun.children).forEach((c) => {
        if (
          c !== tEl &&
          (c.localName === "tab" ||
            c.localName === "br" ||
            c.localName === "cr")
        ) {
          firstRun.removeChild(c);
        }
      });
      tEl.setAttributeNS(XML_NS, "xml:space", "preserve");
      tEl.textContent = text;
      // consolidate: drop any additional runs so text isn't duplicated
      for (let i = 1; i < runs.length; i++) pEl.removeChild(runs[i]);
    }

    // Insert a brand-new paragraph right after blockIdx, cloning its formatting.
    insertParagraphAfter(blockIdx, text) {
      const anchorBlock =
        this.blocks[blockIdx] || this.blocks[this.blocks.length - 1];
      const doc = this.xmlDoc;
      const parts = String(text)
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) return false;

      let templateP = null;
      if (anchorBlock && anchorBlock.type === "p") templateP = anchorBlock.el;
      else {
        // fall back to last paragraph in doc
        for (let i = this.blocks.length - 1; i >= 0; i--) {
          if (this.blocks[i].type === "p") {
            templateP = this.blocks[i].el;
            break;
          }
        }
      }

      let anchorEl = templateP || this._body().lastElementChild;
      parts.forEach((part) => {
        const clone = templateP
          ? templateP.cloneNode(true)
          : doc.createElementNS(WORD_NS, "w:p");
        if (!templateP) {
          const r = doc.createElementNS(WORD_NS, "w:r");
          const t = doc.createElementNS(WORD_NS, "w:t");
          t.setAttributeNS(XML_NS, "xml:space", "preserve");
          t.textContent = part;
          r.appendChild(t);
          clone.appendChild(r);
        } else {
          this._setSingleParagraphText(clone, part);
        }
        anchorEl.parentNode.insertBefore(clone, anchorEl.nextSibling);
        anchorEl = clone;
      });
      this._refresh();
      return true;
    }

    // Insert a markdown table as a real Word table (w:tbl) after blockIdx.
    insertTableAfter(blockIdx, markdown) {
      const doc = this.xmlDoc;
      const rows = markdown
        .split("\n")
        .map((r) => r.trim())
        .filter((r) => r.includes("|") && !/^[\s|:-]+$/.test(r))
        .map((r) =>
          r
            .split("|")
            .map((c) => c.trim())
            .filter(
              (c, i, arr) =>
                !(i === 0 && c === "") && !(i === arr.length - 1 && c === "")
            )
        );
      if (rows.length < 1) return false;

      const tbl = doc.createElementNS(WORD_NS, "w:tbl");
      const tblPr = doc.createElementNS(WORD_NS, "w:tblPr");
      const tblStyle = doc.createElementNS(WORD_NS, "w:tblStyle");
      tblStyle.setAttributeNS(WORD_NS, "w:val", "TableGrid");
      tblPr.appendChild(tblStyle);
      const tblW = doc.createElementNS(WORD_NS, "w:tblW");
      tblW.setAttributeNS(WORD_NS, "w:w", "0");
      tblW.setAttributeNS(WORD_NS, "w:type", "auto");
      tblPr.appendChild(tblW);
      const borders = doc.createElementNS(WORD_NS, "w:tblBorders");
      ["top", "left", "bottom", "right", "insideH", "insideV"].forEach(
        (side) => {
          const b = doc.createElementNS(WORD_NS, "w:" + side);
          b.setAttributeNS(WORD_NS, "w:val", "single");
          b.setAttributeNS(WORD_NS, "w:sz", "4");
          b.setAttributeNS(WORD_NS, "w:space", "0");
          b.setAttributeNS(WORD_NS, "w:color", "999999");
          borders.appendChild(b);
        }
      );
      tblPr.appendChild(borders);
      tbl.appendChild(tblPr);

      rows.forEach((row, ri) => {
        const tr = doc.createElementNS(WORD_NS, "w:tr");
        row.forEach((cell) => {
          const tc = doc.createElementNS(WORD_NS, "w:tc");
          const tcPr = doc.createElementNS(WORD_NS, "w:tcPr");
          const tcW = doc.createElementNS(WORD_NS, "w:tcW");
          tcW.setAttributeNS(WORD_NS, "w:w", "2000");
          tcW.setAttributeNS(WORD_NS, "w:type", "dxa");
          tcPr.appendChild(tcW);
          tc.appendChild(tcPr);
          const p = doc.createElementNS(WORD_NS, "w:p");
          const r = doc.createElementNS(WORD_NS, "w:r");
          if (ri === 0) {
            const rPr = doc.createElementNS(WORD_NS, "w:rPr");
            rPr.appendChild(doc.createElementNS(WORD_NS, "w:b"));
            r.appendChild(rPr);
          }
          const t = doc.createElementNS(WORD_NS, "w:t");
          t.setAttributeNS(XML_NS, "xml:space", "preserve");
          t.textContent = cell;
          r.appendChild(t);
          p.appendChild(r);
          tc.appendChild(p);
          tr.appendChild(tc);
        });
        tbl.appendChild(tr);
      });

      const anchorBlock = this.blocks[blockIdx];
      let anchorEl = anchorBlock
        ? anchorBlock.el
        : this._body().lastElementChild;
      anchorEl.parentNode.insertBefore(tbl, anchorEl.nextSibling);

      // Word requires a paragraph to follow a table if it's the last body element
      if (!tbl.nextSibling || tbl.nextSibling.localName === "sectPr") {
        const p = doc.createElementNS(WORD_NS, "w:p");
        tbl.parentNode.insertBefore(p, tbl.nextSibling);
      }
      this._refresh();
      return true;
    }

    // Render current true document content as clean HTML for the left panel.
    // changeMap: optional Map(blockId -> {before, badge}) to overlay track-changes.
    toHtml(changeMap, viewMode) {
      changeMap = changeMap || new Map();
      let html = "";
      this.blocks.forEach((b) => {
        if (b.type === "tbl") {
          if (!b.rows.length) return;
          html += '<table class="tc-table">';
          b.rows.forEach((row, ri) => {
            html += "<tr>";
            row.forEach((c) => {
              const tag = ri === 0 ? "th" : "td";
              html += `<${tag}>${escapeHtmlLocal(c)}</${tag}>`;
            });
            html += "</tr>";
          });
          html += "</table>";
          return;
        }
        if (!b.text && !b.hasImage) return;
        const chg = changeMap.get(b.id);
        const esc = escapeHtmlLocal(b.text || (b.hasImage ? "[Gambar]" : ""));
        const tag = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "p";
        const align = b.level === 1 ? ' style="text-align:center"' : "";
        if (chg && viewMode !== "final") {
          html += `<div class="tc-del-block"><span class="tc-badge sebelum">SEBELUM</span>${escapeHtmlLocal( chg.before )}</div>`;
          html += `<${tag}${align} data-block-id="${ b.id }"><span class="tc-badge ${chg.badge || "edit"}">${ chg.label || "SESUDAH" }</span><span class="tc-ins">${esc}</span></${tag}>`;
        } else if (chg && viewMode === "final") {
          html += `<${tag}${align} data-block-id="${b.id}">${esc}</${tag}>`;
        } else {
          html += `<${tag}${align} data-block-id="${b.id}">${esc}</${tag}>`;
        }
      });
      return (
        html || "<p>Dokumen tidak memiliki teks yang bisa ditampilkan.</p>"
      );
    }

    async toBlob() {
      const serializer = new XMLSerializer();
      const xmlStr = serializer.serializeToString(this.xmlDoc);
      this.zip.file("word/document.xml", xmlStr);
      return await this.zip.generateAsync({
        type: "blob",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    }
  }

  function escapeHtmlLocal(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  global.DocxRealEditor = DocxRealEditor;
})(window);
