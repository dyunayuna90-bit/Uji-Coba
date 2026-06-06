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
        // Render semua halaman sebagai gambar
        pdfPages = [];
        for (let i = 1; i <= total; i++) {
            DOM.loadBar.style.width = `${Math.round((i / total) * 100)}%`;
            DOM.loadPct.textContent = `${Math.round((i / total) * 100)}%`;

            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width; canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            pdfPages.push(canvas.toDataURL('image/jpeg', 0.85));
        }
        // Buat 1 node placeholder agar struktur library tidak kosong
        parsedNodes.push({ tag: 'p', text: '[PDF Gambar — gunakan Tampilan Asli]' });
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

    library.push({
        id: Date.now().toString(),
        type: 'pdf',
        pdfType: pdfType,           // 'text' | 'image'
        pdfPages: pdfPages,         // array base64 halaman (null untuk pdf teks)
        title: bookTitle,
        nodes: parsedNodes,
        pages: total,
        progressPct: 0,
        lastReadId: null,
        coverBase64: coverBase64,
        shape: 'square'
    });
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

// 5. PDF ORIGINAL VIEW RENDERER
// Render semua halaman PDF sebagai canvas horizontal scroll
// Dipanggil dari app.js saat openBook (pdf image) atau user klik "Tampilan Asli" (pdf teks)

window.renderPdfOriginalView = async function(book, containerEl) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    containerEl.classList.remove('hidden');

    const lang = typeof wikiLang !== 'undefined' ? wikiLang : 'id';
    const d = typeof i18n !== 'undefined' ? (i18n[lang] || i18n['id']) : {};

    // Jika halaman sudah tersimpan sebagai base64 (PDF gambar saat import)
    if (book.pdfPages && book.pdfPages.length > 0) {
        _renderPdfPagesFromBase64(book.pdfPages, containerEl, book);
        return;
    }

    // Fallback: render ulang dari ArrayBuffer (PDF teks yang switch ke Original View)
    // Data PDF asli tidak disimpan di library, jadi minta user buka ulang
    // Gunakan pdfPagesCache jika ada
    if (window._pdfPageCache && window._pdfPageCache.bookId === book.id) {
        _renderPdfPagesFromBase64(window._pdfPageCache.pages, containerEl, book);
        return;
    }

    // Tampilkan pesan minta render ulang
    containerEl.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
            <div class="w-16 h-16 rounded-full bg-m3-primaryContainer flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-m3-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
            </div>
            <p class="text-sm font-bold text-m3-onSurface">${d.pdfOriginalView || 'Tampilan Asli'}</p>
            <p class="text-xs text-m3-onSurfaceVariant opacity-70">${lang === 'id' ? 'Buka ulang file PDF untuk mode ini.' : lang === 'es' ? 'Vuelve a abrir el archivo PDF para este modo.' : 'Reopen the PDF file to use this mode.'}</p>
        </div>
    `;
};

function _renderPdfPagesFromBase64(pages, containerEl, book) {
    const totalPages = pages.length;
    let currentPage = book.pdfOriginalPage || 0;
    let scale = 1;
    let isPinching = false;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let translateX = 0;
    let translateY = 0;
    let panStartX = 0;
    let panStartY = 0;
    let isPanning = false;

    // Outer wrapper: full size, no overflow, posisi relatif untuk overlay tombol
    containerEl.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden; background:transparent; display:flex; flex-direction:column;';

    // Strip scroll horizontal — 1 halaman per view, snap per halaman
    const strip = document.createElement('div');
    strip.style.cssText = `
        display: flex;
        flex-direction: row;
        width: ${totalPages * 100}%;
        height: 100%;
        transition: transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        will-change: transform;
        touch-action: none;
    `;

    // Render semua halaman
    pages.forEach((base64, idx) => {
        const pageSlot = document.createElement('div');
        pageSlot.style.cssText = `
            width: ${100 / totalPages}%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            padding: 8px;
            box-sizing: border-box;
        `;

        const img = document.createElement('img');
        img.src = base64;
        img.alt = `Halaman ${idx + 1}`;
        img.id = `pdf-page-${idx}`;
        img.loading = idx === 0 ? 'eager' : 'lazy';
        img.draggable = false;
        img.classList.add('pdf-original-page');
        img.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
            object-fit: contain;
            border-radius: 8px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.18);
            display: block;
            user-select: none;
            -webkit-user-select: none;
        `;

        pageSlot.appendChild(img);
        strip.appendChild(pageSlot);
    });

    containerEl.appendChild(strip);

    // Fungsi pindah ke halaman tertentu
    function goToPage(idx) {
        if (idx < 0) idx = 0;
        if (idx >= totalPages) idx = totalPages - 1;
        currentPage = idx;
        // Reset zoom saat pindah halaman
        scale = 1; translateX = 0; translateY = 0;
        strip.style.transform = `translateX(-${(currentPage / totalPages) * 100}%)`;
        updatePageCounter();
        updateNavButtons();
        // Simpan progress
        if (typeof library !== 'undefined' && typeof activeBookId !== 'undefined') {
            const bIdx = library.findIndex(b => b.id === activeBookId);
            if (bIdx > -1) { library[bIdx].pdfOriginalPage = currentPage; localforage.setItem('pdf_epub_master', library); }
        }
    }

    // Terapkan posisi awal
    strip.style.transition = 'none';
    strip.style.transform = `translateX(-${(currentPage / totalPages) * 100}%)`;
    setTimeout(() => { strip.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)'; }, 50);

    // --- TOMBOL NAVIGASI KIRI / KANAN ---
    const btnPrev = document.createElement('button');
    btnPrev.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    btnPrev.style.cssText = `
        position:absolute; left:8px; top:50%; transform:translateY(-50%);
        z-index:10; width:36px; height:36px; border-radius:50%;
        background:rgba(0,0,0,0.35); color:#fff; border:none;
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; transition:opacity 0.2s, background 0.2s;
        -webkit-tap-highlight-color:transparent;
    `;

    const btnNext = document.createElement('button');
    btnNext.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    btnNext.style.cssText = `
        position:absolute; right:8px; top:50%; transform:translateY(-50%);
        z-index:10; width:36px; height:36px; border-radius:50%;
        background:rgba(0,0,0,0.35); color:#fff; border:none;
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; transition:opacity 0.2s, background 0.2s;
        -webkit-tap-highlight-color:transparent;
    `;

    // --- PAGE COUNTER ---
    const pageCounter = document.createElement('div');
    pageCounter.style.cssText = `
        position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
        z-index:10; background:rgba(0,0,0,0.4); color:#fff;
        font-size:11px; font-weight:700; padding:4px 12px;
        border-radius:99px; pointer-events:none; letter-spacing:0.05em;
    `;

    function updatePageCounter() {
        pageCounter.textContent = `${currentPage + 1} / ${totalPages}`;
    }
    function updateNavButtons() {
        btnPrev.style.opacity = currentPage === 0 ? '0.25' : '0.8';
        btnNext.style.opacity = currentPage === totalPages - 1 ? '0.25' : '0.8';
    }

    btnPrev.addEventListener('click', () => goToPage(currentPage - 1));
    btnNext.addEventListener('click', () => goToPage(currentPage + 1));

    containerEl.appendChild(btnPrev);
    containerEl.appendChild(btnNext);
    containerEl.appendChild(pageCounter);
    updatePageCounter();
    updateNavButtons();

    // --- SWIPE GESTURE (horizontal, dengan threshold) ---
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isSwiping = false;

    containerEl.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch start
            isPinching = true;
            isSwiping = false;
            pinchStartDist = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
            pinchStartScale = scale;
            return;
        }
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
            isSwiping = false;
        }
    }, { passive: true });

    containerEl.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && isPinching) {
            // Pinch zoom
            const dist = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
            scale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
            _applyZoom();
            if (e.cancelable) e.preventDefault();
            return;
        }
        if (e.touches.length === 1 && !isPinching) {
            const dx = e.touches[0].clientX - touchStartX;
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (Math.abs(dx) > 8 && Math.abs(dx) > dy) {
                isSwiping = true;
                if (e.cancelable) e.preventDefault();
            }
        }
    }, { passive: false });

    containerEl.addEventListener('touchend', (e) => {
        if (isPinching) {
            isPinching = false;
            return;
        }
        if (!isSwiping) return;
        isSwiping = false;

        const dx = e.changedTouches[0].clientX - touchStartX;
        const dt = Date.now() - touchStartTime;
        const isFlick = dt < 300 && Math.abs(dx) > 40;
        const isSlide = Math.abs(dx) > containerEl.offsetWidth * 0.3;

        if ((isFlick || isSlide) && dx < 0) goToPage(currentPage + 1);
        else if ((isFlick || isSlide) && dx > 0) goToPage(currentPage - 1);
    }, { passive: true });

    // --- PINCH ZOOM helper ---
    function _applyZoom() {
        const currentImg = containerEl.querySelector(`#pdf-page-${currentPage}`);
        if (!currentImg) return;
        if (scale <= 1) { scale = 1; translateX = 0; translateY = 0; }
        currentImg.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
        currentImg.style.transformOrigin = 'center center';
    }

    // Reset zoom saat double tap
    containerEl.addEventListener('dblclick', () => {
        scale = 1; translateX = 0; translateY = 0;
        _applyZoom();
    });

    // Apply dark mode jika aktif
    if (typeof isDark !== 'undefined' && isDark) {
        setTimeout(() => window.togglePdfOriginalDark(true), 100);
    }
}

// Toggle dark mode filter untuk PDF Original View
window.togglePdfOriginalDark = function(enable) {
    const pages = document.querySelectorAll('.pdf-original-page');
    pages.forEach(img => {
        img.style.filter = enable ? 'invert(1) hue-rotate(180deg)' : '';
    });
    localStorage.setItem('pdf_original_dark', enable ? '1' : '0');
};




