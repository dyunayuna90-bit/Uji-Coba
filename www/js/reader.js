// --- READER ENGINE ---
// File ini mengurus semua logika berat: Parsing PDF, Ekstrak EPUB, In-Book Search, & Gemini AI.

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
}

// 1. EVENT LISTENER UNTUK UPLOAD BUKU & PENCARIAN
let inbookSearchTimeout;
document.addEventListener("DOMContentLoaded", () => {
    // Listener Upload File (PDF/EPUB/TXT) — support multi-file
    const fileInput = document.getElementById('doc-upload');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            await processMultipleFiles(files);
            e.target.value = '';
        });
    }

    // Listener Scan Folder (input folder picker)
    const folderInput = document.getElementById('folder-scan-upload');
    if (folderInput) {
        folderInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files).filter(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                return ['pdf', 'epub', 'txt', 'md'].includes(ext);
            });
            if (!files.length) {
                showDialog("Info", "Tidak ada file PDF, EPUB, TXT, atau MD di folder ini.", "info", [{text: "Oke", primary: true}]);
                return;
            }
            await processMultipleFiles(files);
            e.target.value = '';
        });
    }

    // Listener Pencarian dalam Buku
    // Pakai getElementById langsung buat hindari race condition dengan app.js
    const searchInputEl = document.getElementById('inbook-search-input');
    const searchResEl = document.getElementById('search-results-panel');

    if(searchInputEl) {
        searchInputEl.addEventListener('input', (e) => {
            clearTimeout(inbookSearchTimeout);
            const val = e.target.value.trim().toLowerCase();
            if (!val || val.length < 2) { 
                if(searchResEl) searchResEl.classList.add('hidden'); 
                clearSearchHighlights();
                return; 
            }
            
            inbookSearchTimeout = setTimeout(() => {
                const lib = typeof library !== 'undefined' ? library : [];
                const currentBookId = typeof activeBookId !== 'undefined' ? activeBookId : null;
                const book = lib.find(b => b.id === currentBookId);
                if (!book || !book.nodes) return;
                
                const results = [];
                const regex = new RegExp(`(${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                
                book.nodes.forEach((node, i) => {
                    if (node.tag !== 'img' && node.text && node.text.toLowerCase().includes(val)) {
                        let snippet = node.text;
                        const matchIdx = snippet.toLowerCase().indexOf(val);
                        let start = Math.max(0, matchIdx - 40);
                        let end = Math.min(snippet.length, matchIdx + val.length + 40);
                        let preview = snippet.substring(start, end);
                        if(start > 0) preview = "..." + preview;
                        if(end < snippet.length) preview = preview + "...";
                        
                        preview = preview.replace(regex, '<mark class="bg-m3-primary text-m3-onPrimary rounded px-0.5">$1</mark>');
                        
                        let contextStr = "Chapter / Section";
                        for(let j=i; j>=0; j--){
                            if(book.nodes[j].tag === 'h1' || book.nodes[j].tag === 'h2') {
                                contextStr = book.nodes[j].text.length > 25 ? book.nodes[j].text.substring(0,25)+'...' : book.nodes[j].text;
                                break;
                            }
                        }
                        
                        results.push({ nodeIdx: i, preview: preview, context: contextStr });
                    }
                });

                renderSearchResults(results, val);
            }, 400);
        });
    }
});

// 1b. PROSES BANYAK FILE SEKALIGUS (multi-select atau folder scan)
async function processMultipleFiles(files) {
    const skipped = [];
    const failed = [];
    let imported = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const originalFilename = file.name;
        const ext = originalFilename.split('.').pop().toLowerCase();
        const bookTitle = originalFilename.replace(/\.[^/.]+$/, "");

        // Cek duplikat by judul
        if (library.some(b => b.title.toLowerCase() === bookTitle.toLowerCase())) {
            skipped.push(bookTitle);
            continue;
        }

        // Update loading UI — tampilkan nama file + progress index
        DOM.load.classList.remove('hidden');
        DOM.loadBar.style.width = '0%';
        DOM.loadPct.textContent = '0%';
        if (DOM.loadTxt) DOM.loadTxt.textContent = `(${i + 1}/${files.length}) ${bookTitle}`;

        try {
            if (ext === 'pdf') await handlePdf(file, bookTitle);
            else if (ext === 'epub') await handleEpub(file, bookTitle);
            else if (ext === 'txt') await handleTxt(file, bookTitle);
            else if (ext === 'md') await handleMd(file, bookTitle);
            else { skipped.push(bookTitle); continue; }
            imported++;
        } catch (err) {
            console.error(`Gagal import: ${bookTitle}`, err);
            failed.push(bookTitle);
        }
    }

    setTimeout(() => { DOM.load.classList.add('hidden'); }, 800);
    if (DOM.loadTxt) DOM.loadTxt.textContent = 'Reading Document...';

    // Ringkasan hasil
    let summary = `${imported} buku berhasil diimpor.`;
    if (skipped.length > 0) summary += `\n${skipped.length} dilewati (sudah ada).`;
    if (failed.length > 0) summary += `\n${failed.length} gagal.`;

    if (files.length > 1) {
        showDialog("Selesai Import", summary, "check-circle", [{ text: "Oke", primary: true }]);
    }
}

// 1c. HANDLER TXT
async function handleTxt(file, bookTitle) {
    const text = await file.text();
    const parsedNodes = [];

    // Coba split by baris kosong dulu (paragraf standar)
    let paragraphs = text.split(/\n\s*\n/).map(p => p.trim().replace(/\s+/g, ' ')).filter(p => p.length > 0);

    // Kalau hasilnya cuma 1 blok (tidak ada baris kosong), fallback ke split per baris
    if (paragraphs.length <= 1) {
        paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    }

    paragraphs.forEach(para => {
        // Deteksi heading sederhana: pendek, huruf kapital, atau diawali angka bab
        const isHeading = para.length < 80 && (
            /^(bab|chapter|bagian|part|section)\s/i.test(para) ||
            /^[IVX]+\./i.test(para) ||
            /^\d+[\.\)]\s/.test(para) ||
            para === para.toUpperCase()
        );
        parsedNodes.push({ tag: isHeading ? 'h2' : 'p', text: para });
    });

    if (parsedNodes.length === 0) throw new Error("File TXT kosong atau tidak bisa dibaca.");

    // Cover placeholder untuk TXT (tidak ada gambar)
    const coverBase64 = null;

    library.push({
        id: Date.now().toString(),
        type: 'txt',
        title: bookTitle,
        nodes: parsedNodes,
        pages: Math.ceil(parsedNodes.length / 10),
        progressPct: 0,
        lastReadId: null,
        coverBase64: coverBase64,
        shape: 'square'
    });

    await localforage.setItem('pdf_epub_master', library);
    renderLibrary();
}

// 1e. HANDLER MARKDOWN (.md)
async function handleMd(file, bookTitle) {
    const lang = typeof wikiLang !== 'undefined' ? wikiLang : 'id';
    const d = typeof i18n !== 'undefined' ? (i18n[lang] || i18n['id']) : {};
    if (DOM.loadTxt) DOM.loadTxt.textContent = d.loadingMd || 'Reading Markdown...';

    const text = await file.text();
    const parsedNodes = [];

    // Gunakan marked.js jika tersedia, fallback ke parser sederhana
    if (typeof marked !== 'undefined') {
        const tokens = marked.lexer(text);

        function processTokens(tokens) {
            tokens.forEach(token => {
                if (token.type === 'heading') {
                    const tag = token.depth <= 2 ? (token.depth === 1 ? 'h1' : 'h2') : 'h2';
                    parsedNodes.push({ tag, text: token.text.replace(/\*\*|__|`/g, '') });
                } else if (token.type === 'paragraph') {
                    const cleanText = token.text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`(.*?)`/g, '$1').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/\n/g, ' ').trim();
                    if (cleanText.length > 0) parsedNodes.push({ tag: 'p', text: cleanText });
                } else if (token.type === 'list') {
                    token.items.forEach(item => {
                        const cleanText = item.text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`(.*?)`/g, '$1').trim();
                        if (cleanText.length > 0) parsedNodes.push({ tag: 'p', text: '• ' + cleanText });
                    });
                } else if (token.type === 'blockquote') {
                    if (token.tokens) processTokens(token.tokens);
                } else if (token.type === 'code') {
                    parsedNodes.push({ tag: 'p', text: token.text });
                } else if (token.type === 'space') {
                    // skip
                }
            });
        }

        processTokens(tokens);
    } else {
        // Fallback: parse manual baris per baris
        const lines = text.split('\n');
        let buffer = '';

        const flushBuffer = () => {
            const t = buffer.trim().replace(/\s+/g, ' ');
            if (t.length > 0) parsedNodes.push({ tag: 'p', text: t });
            buffer = '';
        };

        lines.forEach(line => {
            const trimmed = line.trim();
            if (/^#{1,2}\s/.test(trimmed)) {
                flushBuffer();
                parsedNodes.push({ tag: trimmed.startsWith('# ') ? 'h1' : 'h2', text: trimmed.replace(/^#+\s/, '') });
            } else if (/^#{3,6}\s/.test(trimmed)) {
                flushBuffer();
                parsedNodes.push({ tag: 'h2', text: trimmed.replace(/^#+\s/, '') });
            } else if (trimmed === '') {
                flushBuffer();
            } else {
                buffer += (buffer ? ' ' : '') + trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`(.*?)`/g, '$1');
            }
        });
        flushBuffer();
    }

    if (parsedNodes.length === 0) throw new Error("File MD kosong atau tidak bisa dibaca.");

    library.push({
        id: Date.now().toString(),
        type: 'md',
        title: bookTitle,
        nodes: parsedNodes,
        pages: Math.ceil(parsedNodes.length / 10),
        progressPct: 0,
        lastReadId: null,
        coverBase64: null,
        shape: 'square'
    });

    await localforage.setItem('pdf_epub_master', library);
    renderLibrary();
}

function clearSearchHighlights() {
    if(!DOM.inner) return;
    const marks = DOM.inner.querySelectorAll('mark.search-hl');
    marks.forEach(m => {
        const parent = m.parentNode;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
    });
}

function renderSearchResults(results, keyword) {
    const searchResEl = document.getElementById('search-results-panel');
    const readContentEl = document.getElementById('reader-content');
    if(!searchResEl) return;
    searchResEl.innerHTML = '';
    const lang = typeof wikiLang !== 'undefined' ? wikiLang : 'id';
    const d = (typeof i18n !== 'undefined' ? (i18n[lang] || i18n['id']) : {});
    
    if(results.length === 0) {
        searchResEl.innerHTML = `<div class="p-6 text-center text-sm opacity-60 font-medium">${d.searchNotFound || 'Tidak ditemukan'}</div>`;
        searchResEl.classList.remove('hidden');
        return;
    }
    
    const countHeader = document.createElement('div');
    countHeader.className = "px-4 pt-3 pb-2 text-xs font-bold uppercase tracking-wider text-m3-primary/80 border-b border-m3-surfaceVariant";
    countHeader.textContent = `${results.length} Found`;
    searchResEl.appendChild(countHeader);

    results.forEach(res => {
        const item = document.createElement('div');
        item.className = "p-4 border-b border-m3-surfaceVariant hover:bg-m3-surface transition-colors cursor-pointer";
        item.innerHTML = `
            <div class="text-[10px] font-bold text-m3-primary mb-1 uppercase tracking-widest">${res.context}</div>
            <div class="text-sm text-m3-onSurface leading-relaxed line-clamp-3">${res.preview}</div>
        `;
        
        item.onclick = () => {
            const lib = typeof library !== 'undefined' ? library : [];
            const currentBookId = typeof activeBookId !== 'undefined' ? activeBookId : null;
            const book = lib.find(b => b.id === currentBookId);
            if(!book) return;
            
            searchResEl.classList.add('hidden');
            const targetEl = document.getElementById(`node-${res.nodeIdx}`);
            const container = readContentEl;
            
            if(targetEl && container) {
                clearSearchHighlights();
                
                const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                
                const walker = document.createTreeWalker(targetEl, NodeFilter.SHOW_TEXT, null, false);
                const textNodes = [];
                let n;
                while(n = walker.nextNode()) textNodes.push(n);
                
                textNodes.forEach(node => {
                    const text = node.nodeValue;
                    if(regex.test(text)) {
                        const span = document.createElement('span');
                        span.innerHTML = text.replace(regex, '<mark class="search-hl transition-colors duration-1000">$1</mark>');
                        node.parentNode.replaceChild(span, node);
                    }
                });

                const cRect = container.getBoundingClientRect();
                const tRect = targetEl.getBoundingClientRect();
                const offset = tRect.top - cRect.top + container.scrollTop - (cRect.height / 2) + (tRect.height / 2);
                
                container.scrollTo({ top: offset, behavior: 'smooth' });
                
                setTimeout(() => {
                    const marks = targetEl.querySelectorAll('mark.search-hl');
                    marks.forEach(m => {
                        m.style.backgroundColor = 'transparent';
                        m.style.color = 'inherit';
                    });
                    setTimeout(() => clearSearchHighlights(), 1500);
                }, 2000);
            }
        };
        
        searchResEl.appendChild(item);
    });
    searchResEl.classList.remove('hidden');
}

// 2. FUNGSI EKSTRAK PDF
async function handlePdf(file, bookTitle) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let parsedNodes = [];
    const total = pdf.numPages;

    // Render cover dari halaman pertama
    const coverCanvas = document.createElement('canvas'); const coverCtx = coverCanvas.getContext('2d');
    const firstPage = await pdf.getPage(1); const viewport = firstPage.getViewport({ scale: 0.5 });
    coverCanvas.width = viewport.width; coverCanvas.height = viewport.height;
    await firstPage.render({ canvasContext: coverCtx, viewport: viewport }).promise;
    const coverBase64 = coverCanvas.toDataURL('image/jpeg', 0.8);

    // --- DETEKSI PDF TYPE (teks vs gambar) ---
    // Hitung halaman yang punya teks ekstraktabel
    let pagesWithText = 0;
    const sampleSize = Math.min(total, 5); // sampling 5 halaman pertama
    for (let i = 1; i <= sampleSize; i++) {
        const pg = await pdf.getPage(i);
        const tc = await pg.getTextContent();
        const pageText = tc.items.map(it => it.str).join('').trim();
        if (pageText.length > 20) pagesWithText++;
    }
    // Jika kurang dari 40% halaman sample punya teks, anggap PDF gambar
    const pdfType = (pagesWithText / sampleSize) >= 0.4 ? 'text' : 'image';

    // Untuk PDF gambar: simpan semua halaman sebagai base64 canvas
    // Untuk PDF teks: ekstrak teks seperti biasa
    let pdfPages = null; // array base64 per halaman (hanya untuk PDF image & original view)

    if (pdfType === 'image') {
        // PDF gambar: TIDAK di-scan saat import
        // Simpan file sebagai base64 string, render halaman saat dibuka (lazy)
        DOM.loadBar.style.width = '100%';
        DOM.loadPct.textContent = '100%';
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
        const pdfFileBase64 = 'data:application/pdf;base64,' + btoa(binary);
        parsedNodes.push({ tag: 'p', text: '[PDF Gambar]' });

        library.push({
            id: Date.now().toString(),
            type: 'pdf',
            pdfType: 'image',
            pdfFileBase64: pdfFileBase64,
            pdfTotalPages: total,
            title: bookTitle,
            nodes: parsedNodes,
            pages: total,
            progressPct: 0,
            lastReadId: null,
            pdfOriginalPage: 0,
            coverBase64: coverBase64,
            shape: 'square'
        });
        await localforage.setItem('pdf_epub_master', library);
        renderLibrary();
        return;
    } else {
        // Ekstrak teks
        for (let i = 1; i <= total; i++) {
            DOM.loadBar.style.width = `${Math.round((i / total) * 100)}%`;
            DOM.loadPct.textContent = `${Math.round((i / total) * 100)}%`;

            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            let currentBlock = ""; let lastY = -1; let isTitle = false;

            textContent.items.forEach(item => {
                const y = Math.round(item.transform[5]); const height = item.height;
                if (lastY !== -1 && Math.abs(y - lastY) > height * 1.5) {
                    if (currentBlock.trim().length > 0) {
                        let cleanText = currentBlock.trim().replace(/\s+/g, ' ');
                        parsedNodes.push({ tag: isTitle ? 'h2' : 'p', text: cleanText });
                    }
                    currentBlock = ""; isTitle = false;
                }
                if (height > 18) isTitle = true;
                currentBlock += item.str + " "; lastY = y;
            });

            if (currentBlock.trim().length > 0) {
                let cleanText = currentBlock.trim().replace(/\s+/g, ' ');
                parsedNodes.push({ tag: isTitle ? 'h2' : 'p', text: cleanText });
            }
        }
    }

    const newBookId = Date.now().toString();
    library.push({
        id: newBookId,
        type: 'pdf',
        pdfType: pdfType,
        pdfTotalPages: total,
        title: bookTitle,
        nodes: parsedNodes,
        pages: total,
        progressPct: 0,
        lastReadId: null,
        pdfOriginalPage: 0,
        coverBase64: coverBase64,
        shape: 'square'
    });

    // Cache pdfjsLib doc untuk mode kanvas (sesi ini saja, hilang saat app restart)
    window._pdfDocCache = { bookId: newBookId, doc: pdf };

    await localforage.setItem('pdf_epub_master', library);
    renderLibrary();
}

// 3. FUNGSI EKSTRAK EPUB (REVISI ALGORITMA: ANTI-LAG & ANTI-DUPLIKAT MURNI)
async function handleEpub(file, bookTitle) {
    const zip = await JSZip.loadAsync(file); 
    let parsedNodes = []; 
    let coverBase64 = null;

    const containerXml = await zip.file("META-INF/container.xml").async("text");
    const opfPath = (new DOMParser()).parseFromString(containerXml, "text/xml").getElementsByTagName("rootfile")[0].getAttribute("full-path");
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : "";
    const opfXml = await zip.file(opfPath).async("text");
    const opfDoc = (new DOMParser()).parseFromString(opfXml, "text/xml");

    const titleEl = opfDoc.getElementsByTagName("dc:title")[0]; 
    if (titleEl && titleEl.textContent) bookTitle = titleEl.textContent;

    const manifest = {};
    Array.from(opfDoc.getElementsByTagName("item")).forEach(item => { 
        manifest[item.getAttribute("id")] = { href: item.getAttribute("href"), mediaType: item.getAttribute("media-type") }; 
    });

    const metaCover = opfDoc.querySelector("meta[name='cover']");
    if (metaCover) {
        const coverId = metaCover.getAttribute("content");
        if (manifest[coverId]) {
            let coverPath = opfDir + manifest[coverId].href;
            const coverFile = zip.file(coverPath);
            if (coverFile) {
                const b64 = await coverFile.async("base64");
                coverBase64 = "data:" + manifest[coverId].mediaType + ";base64," + b64;
            }
        }
    }

    if (!coverBase64) {
        const potentialCover = Object.values(manifest).find(m => m.href.toLowerCase().includes('cover') && m.mediaType.startsWith('image/'));
        if (potentialCover) {
            let coverPath = opfDir + potentialCover.href;
            const coverFile = zip.file(coverPath);
            if (coverFile) {
                const b64 = await coverFile.async("base64");
                coverBase64 = "data:" + potentialCover.mediaType + ";base64," + b64;
            }
        }
    }

    const spine = Array.from(opfDoc.getElementsByTagName("itemref")).map(item => item.getAttribute("idref"));
    let order = 0;
    
    // Tag yang sah buat dijadiin blok paragraf / heading
    const validBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'div', 'section', 'article', 'header'];

    for (const idref of spine) {
        order++;
        DOM.loadBar.style.width = `${Math.round((order / spine.length) * 100)}%`;
        DOM.loadPct.textContent = `${Math.round((order / spine.length) * 100)}%`;

        if (!manifest[idref]) continue;
        const htmlPath = opfDir + manifest[idref].href; 
        const htmlFile = zip.file(htmlPath);
        if (!htmlFile) continue;

        const htmlStr = await htmlFile.async("text");
        const doc = (new DOMParser()).parseFromString(htmlStr, "text/html");
        
        // Bersihin sampah yang bikin layout kotor
        doc.querySelectorAll('script, style, nav, footer, iframe, svg, button').forEach(el => el.remove());

        // Scan semua elemen secara berurutan dari atas ke bawah (Pre-order Traversal)
        const allElements = doc.body.querySelectorAll('*');

        for (let el of allElements) {
            let tag = el.tagName.toLowerCase();
            
            // 1. Eksekusi Gambar
            if (tag === 'img' || tag === 'image') {
                let src = el.getAttribute('src') || el.getAttribute('href');
                if (src && !src.startsWith('http') && !src.startsWith('data:')) {
                    let absPath = resolveRelativePath(htmlPath, src); 
                    const imgFile = zip.file(absPath);
                    if (imgFile) { 
                        const b64 = await imgFile.async("base64"); 
                        let mime = "image/jpeg";
                        if(absPath.toLowerCase().endsWith('.png')) mime = "image/png";
                        else if(absPath.toLowerCase().endsWith('.gif')) mime = "image/gif";
                        parsedNodes.push({ tag: 'img', src: `data:${mime};base64,${b64}` }); 
                    }
                } else if (src && src.startsWith('data:')) {
                    parsedNodes.push({ tag: 'img', src: src });
                }
                continue;
            }

            // 2. Eksekusi Blok Teks
            if (validBlockTags.includes(tag)) {
                // Cek apakah elemen ini punya anak blok lain di dalamnya (Kalo punya, ini cuma Wrapper, lewatin aja)
                let hasBlockChild = false;
                const descendants = el.querySelectorAll('*');
                for (let i = 0; i < descendants.length; i++) {
                    if (validBlockTags.includes(descendants[i].tagName.toLowerCase())) {
                        hasBlockChild = true;
                        break;
                    }
                }
                
                if (hasBlockChild) continue; // Jangan ambil teksnya, tunggu iterasi sampai ke anak terdalamnya
                
                let text = el.textContent.trim().replace(/\s+/g, ' ');
                if (text.length === 0) continue;
                
                let finalTag = 'p';
                if (['h1', 'h2', 'h3', 'h4'].includes(tag)) finalTag = tag === 'h1' ? 'h1' : 'h2';
                
                // Pembersihan kasus Bab spasi alay ("B a B", "B A B")
                text = text.replace(/B\s*A\s*B/gi, 'BAB');

                // Kalau teks h1/h2 tapi panjangnya ngotak (kayak paragraf utuh), turunin pangkas jadi paragraf
                if ((finalTag === 'h1' || finalTag === 'h2') && text.length > 150) finalTag = 'p';

                parsedNodes.push({ tag: finalTag, text: text });
            }
        }
    }
    
    library.push({ id: Date.now().toString(), type: 'epub', title: bookTitle, nodes: parsedNodes, pages: spine.length, progressPct: 0, lastReadId: null, coverBase64: coverBase64, shape: 'square' });
    await localforage.setItem('pdf_epub_master', library); 
    renderLibrary();
}

function resolveRelativePath(base, relative) {
    const stack = base.split('/'); stack.pop(); 
    const parts = relative.split('/');
    for (const part of parts) { 
        if (part === '.') continue; 
        if (part === '..') stack.pop(); 
        else stack.push(part); 
    }
    return stack.join('/');
}

// 4. LOOKUP DICTIONARY — Orchestrator Wikipedia + Gemini
window.lookupDictionary = function() {
    const savedText = currentSelection.text;
    if (!savedText) return;

    const apiKey = localStorage.getItem('gemini_api_key');

    window.hideSelectionMenu();
    window.getSelection().removeAllRanges();

    const modal = document.getElementById('ai-modal');
    const termEl = document.getElementById('ai-term');
    const wikiCard = document.getElementById('wiki-card');
    const wikiContent = document.getElementById('wiki-content');
    const wikiLoading = document.getElementById('wiki-loading');
    const geminiCard = document.getElementById('gemini-card');
    const geminiContent = document.getElementById('gemini-content');
    const geminiLoading = document.getElementById('gemini-loading');

    termEl.textContent = savedText.length > 40 ? savedText.substring(0, 40) + '...' : savedText;

    if (wikiCard) wikiCard.classList.remove('hidden');
    if (wikiLoading) wikiLoading.classList.remove('hidden');
    if (wikiContent) { wikiContent.innerHTML = ''; wikiContent.classList.add('hidden'); }

    if (geminiCard) {
        if (apiKey) {
            geminiCard.classList.remove('hidden');
            if (geminiLoading) geminiLoading.classList.remove('hidden');
            if (geminiContent) { geminiContent.innerHTML = ''; geminiContent.classList.add('hidden'); }
        } else {
            geminiCard.classList.add('hidden');
        }
    }

    pushAppHistory('ai-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('ai-sheet').classList.remove('translate-y-full');
    });

    // Fetch Wikipedia
    const wikiLangCode = wikiLang === 'id' ? 'id' : wikiLang === 'es' ? 'es' : 'en';
    const wikiQuery = encodeURIComponent(savedText.split(' ').slice(0, 4).join(' '));
    fetch(`https://${wikiLangCode}.wikipedia.org/api/rest_v1/page/summary/${wikiQuery}`)
        .then(r => r.json())
        .then(data => {
            if (wikiLoading) wikiLoading.classList.add('hidden');
            if (!wikiContent) return;
            const extract = (data.extract || '').trim();
            if (extract) {
                wikiContent.innerHTML = `
                    <p class="text-sm leading-relaxed text-m3-onSurfaceVariant font-medium">${extract}</p>
                    ${data.content_urls ? `<a href="${data.content_urls.mobile.page}" target="_blank" class="mt-3 inline-flex items-center gap-1 text-xs font-bold text-m3-primary opacity-80">Wikipedia <i data-lucide="external-link" class="w-3 h-3"></i></a>` : ''}
                `;
                if (window.lucide) window.lucide.createIcons();
            } else {
                const notFound = wikiLang === 'id' ? 'Tidak ditemukan di Wikipedia.' : wikiLang === 'es' ? 'No encontrado en Wikipedia.' : 'Not found on Wikipedia.';
                wikiContent.innerHTML = `<p class="text-sm opacity-50 font-medium">${notFound}</p>`;
            }
            wikiContent.classList.remove('hidden');
        })
        .catch(() => {
            if (wikiLoading) wikiLoading.classList.add('hidden');
            if (wikiContent) {
                const failMsg = wikiLang === 'id' ? 'Gagal memuat Wikipedia.' : wikiLang === 'es' ? 'Error al cargar Wikipedia.' : 'Failed to load Wikipedia.';
                wikiContent.innerHTML = `<p class="text-sm opacity-50 font-medium">${failMsg}</p>`;
                wikiContent.classList.remove('hidden');
            }
        });

    // Fetch Gemini (kalau ada API key)
    if (apiKey) {
        const modelVersion = localStorage.getItem('gemini_model') || 'gemini-2.5-flash-preview-05-20';
        let langInstruction;
        if (wikiLang === 'id') {
            langInstruction = 'Gunakan bahasa Indonesia. Jelaskan arti, konteks, dan berikan contoh kalimat singkat. Tulis dalam paragraf biasa, tanpa poin atau bullet. Langsung ke penjelasan tanpa kata pembuka.';
        } else if (wikiLang === 'es') {
            langInstruction = 'Usa español. Explica el significado, el contexto y proporciona una oración de ejemplo breve. Escribe en párrafos normales, sin puntos ni viñetas. Ve directo a la explicación sin frases introductorias.';
        } else {
            langInstruction = 'Use English. Explain the meaning, context, and provide a short example sentence. Write in plain paragraphs, no bullet points. No introductory phrases, go straight to the explanation.';
        }
        let promptText = `Provide a concise dictionary definition and explanation for: "${savedText}". ${langInstruction}`;

        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelVersion}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
        })
        .then(r => { if (!r.ok) throw new Error(`API Error: ${r.status}`); return r.json(); })
        .then(data => {
            if (geminiLoading) geminiLoading.classList.add('hidden');
            if (!geminiContent) return;
            const rawText = data.candidates[0].content.parts[0].text;
            const formatted = rawText
                .replace(/\*\*(.*?)\*\*/g, '<strong class="text-m3-primary font-bold">$1</strong>')
                .replace(/\*(.*?)\*/g, '<em class="italic opacity-90">$1</em>')
                .replace(/\n\n/g, '<br><br>')
                .replace(/\n/g, '<br>');
            geminiContent.innerHTML = formatted;
            geminiContent.classList.remove('hidden');
        })
        .catch((err) => {
            if (geminiLoading) geminiLoading.classList.add('hidden');
            if (geminiContent) {
                geminiContent.innerHTML = `<div class="text-red-500 text-sm font-bold">Error: ${err.message}</div>`;
                geminiContent.classList.remove('hidden');
            }
        });
    }
};

window.closeAiModal = function(isFromHistory = false) {
    if (!isFromHistory) { history.back(); return; }
    const m = document.getElementById('ai-modal');
    const s = document.getElementById('ai-sheet');
    
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => m.classList.add('hidden'), 300);
}

// 5. PDF CANVAS RENDERER
// Render PDF halaman per halaman, horizontal swipe/tap, pinch+pan zoom
// Dipanggil dari app.js: PDF image saat openBook, PDF teks saat toggle kanvas

window.renderPdfOriginalView = async function(book, containerEl) {
    if (!containerEl) return;
    containerEl.innerHTML = '';

    const lang = typeof wikiLang !== 'undefined' ? wikiLang : 'id';

    // Tentukan sumber PDF
    let pdfDoc = null;
    try {
        if (book.pdfFileBase64) {
            // PDF image: load dari base64 yang disimpan saat import
            pdfDoc = await pdfjsLib.getDocument({ url: book.pdfFileBase64 }).promise;
        } else if (window._pdfDocCache && window._pdfDocCache.bookId === book.id) {
            // PDF teks: pakai cache pdfjsLib doc yang disimpan saat import
            pdfDoc = window._pdfDocCache.doc;
        } else {
            // Tidak ada sumber — minta import ulang
            containerEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:24px;text-align:center;color:var(--md-sys-color-on-surface);">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p style="font-weight:700;font-size:13px;">${lang === 'id' ? 'Import ulang PDF untuk mode kanvas.' : lang === 'es' ? 'Reimporta el PDF para el modo canvas.' : 'Re-import PDF to use canvas mode.'}</p>
            </div>`;
            return;
        }
    } catch(e) {
        console.error('PDF load error', e);
        return;
    }

    _renderPdfCanvas(pdfDoc, containerEl, book);
};

async function _renderPdfCanvas(pdfDoc, containerEl, book) {
    const totalPages = pdfDoc.numPages;
    let currentPage = (book.pdfOriginalPage || 0);
    if (currentPage >= totalPages) currentPage = 0;

    // State zoom & pan
    let scale = 1;
    let panX = 0;
    let panY = 0;

    // Layout: container full, satu canvas ditampilkan
    containerEl.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#1a1a1a;display:flex;align-items:center;justify-content:center;';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;max-width:100%;max-height:100%;object-fit:contain;touch-action:none;';
    canvas.classList.add('pdf-original-page');
    containerEl.appendChild(canvas);

    // Counter halaman
    const counter = document.createElement('div');
    counter.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.5);color:#fff;font-size:11px;font-weight:700;padding:3px 12px;border-radius:99px;pointer-events:none;z-index:5;';
    containerEl.appendChild(counter);

    // Render halaman ke canvas
    async function renderPage(idx) {
        scale = 1; panX = 0; panY = 0;
        applyTransform();
        const page = await pdfDoc.getPage(idx + 1);
        const vp = page.getViewport({ scale: 1.5 });
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        counter.textContent = `${idx + 1} / ${totalPages}`;

        // Simpan progress
        if (typeof library !== 'undefined' && typeof activeBookId !== 'undefined') {
            const bIdx = library.findIndex(b => b.id === activeBookId);
            if (bIdx > -1) { library[bIdx].pdfOriginalPage = idx; localforage.setItem('pdf_epub_master', library); }
        }

        // Dark mode
        if (typeof isDark !== 'undefined' && isDark) {
            canvas.style.filter = 'invert(1) hue-rotate(180deg)';
        } else {
            canvas.style.filter = '';
        }
    }

    function applyTransform() {
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        canvas.style.transformOrigin = 'center center';
    }

    function goTo(idx) {
        if (idx < 0 || idx >= totalPages) return;
        currentPage = idx;
        renderPage(currentPage);
    }

    await renderPage(currentPage);

    // --- GESTURE ---
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    let pinchStartDist = 0, pinchStartScale = 1;
    let panStartX = 0, panStartY = 0, panStartPanX = 0, panStartPanY = 0;
    let isPinching = false, isSwiping = false, isPanning = false;

    containerEl.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true; isSwiping = false; isPanning = false;
            pinchStartDist = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
            pinchStartScale = scale;
            panStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            panStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            panStartPanX = panX; panStartPanY = panY;
        } else if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
            panStartPanX = panX; panStartPanY = panY;
            isSwiping = false; isPanning = false;
        }
    }, { passive: true });

    containerEl.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && isPinching) {
            const dist = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
            scale = Math.min(5, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
            // Pan saat pinch
            const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            panX = panStartPanX + (mx - panStartX);
            panY = panStartPanY + (my - panStartY);
            if (scale <= 1) { panX = 0; panY = 0; }
            applyTransform();
            if (e.cancelable) e.preventDefault();
            return;
        }

        if (e.touches.length === 1 && !isPinching) {
            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;

            if (scale > 1) {
                // Mode pan
                isPanning = true;
                panX = panStartPanX + dx;
                panY = panStartPanY + dy;
                applyTransform();
                if (e.cancelable) e.preventDefault();
            } else {
                // Mode swipe ganti halaman
                if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
                    isSwiping = true;
                    if (e.cancelable) e.preventDefault();
                }
            }
        }
    }, { passive: false });

    containerEl.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) { isPinching = false; return; }
        if (isPanning) { isPanning = false; return; }
        if (!isSwiping) {
            // Tap — cek kiri atau kanan layar
            const tapX = e.changedTouches[0].clientX;
            const w = containerEl.offsetWidth;
            if (tapX < w * 0.3) goTo(currentPage - 1);
            else if (tapX > w * 0.7) goTo(currentPage + 1);
            return;
        }
        isSwiping = false;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dt = Date.now() - touchStartTime;
        const isFlick = dt < 300 && Math.abs(dx) > 40;
        const isSlide = Math.abs(dx) > containerEl.offsetWidth * 0.25;
        if (isFlick || isSlide) {
            if (dx < 0) goTo(currentPage + 1);
            else goTo(currentPage - 1);
        }
    }, { passive: true });

    // Double tap reset zoom
    let lastTap = 0;
    containerEl.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTap < 300) { scale = 1; panX = 0; panY = 0; applyTransform(); }
        lastTap = now;
    }, { passive: true });
}

// Toggle dark mode filter untuk PDF Canvas
window.togglePdfOriginalDark = function(enable) {
    const pages = document.querySelectorAll('.pdf-original-page');
    pages.forEach(el => { el.style.filter = enable ? 'invert(1) hue-rotate(180deg)' : ''; });
    localStorage.setItem('pdf_original_dark', enable ? '1' : '0');
};




