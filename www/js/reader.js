// --- READER ENGINE ---
// File ini mengurus semua logika berat: Parsing PDF, Ekstrak EPUB, In-Book Search, & Gemini AI.

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
}

// 1. EVENT LISTENER UNTUK UPLOAD BUKU & PENCARIAN
let inbookSearchTimeout;
document.addEventListener("DOMContentLoaded", () => {
    // Listener Upload File (PDF/EPUB/TXT/MD) — support multi-file
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
    const failed = [];
    let imported = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const originalFilename = file.name;
        const ext = originalFilename.split('.').pop().toLowerCase();
        const bookTitle = originalFilename.replace(/\.[^/.]+$/, "");

        // Pengecekan duplikat DIHAPUS. User bisa memasukkan buku yang sama berkali-kali.

        // Update loading UI
        DOM.load.classList.remove('hidden');
        DOM.loadBar.style.width = '0%';
        DOM.loadPct.textContent = '0%';
        if (DOM.loadTxt) DOM.loadTxt.textContent = `(${i + 1}/${files.length}) ${bookTitle}`;

        try {
            if (ext === 'pdf') await handlePdf(file, bookTitle);
            else if (ext === 'epub') await handleEpub(file, bookTitle);
            else if (ext === 'txt') await handleTxt(file, bookTitle);
            else if (ext === 'md') await handleMd(file, bookTitle);
            else { continue; }
            imported++;
        } catch (err) {
            console.error(`Gagal import: ${bookTitle}`, err);
            failed.push(bookTitle);
        }
    }

    setTimeout(() => { DOM.load.classList.add('hidden'); }, 800);
    if (DOM.loadTxt) DOM.loadTxt.textContent = 'Reading Document...';

    let summary = `${imported} buku berhasil diimpor.`;
    if (failed.length > 0) summary += `\n${failed.length} gagal.`;

    if (files.length > 1) {
        showDialog("Selesai Import", summary, "check-circle", [{ text: "Oke", primary: true }]);
    }
}

// 1c. HANDLER TXT
async function handleTxt(file, bookTitle) {
    const text = await file.text();
    const parsedNodes = [];

    let paragraphs = text.split(/\n\s*\n/).map(p => p.trim().replace(/\s+/g, ' ')).filter(p => p.length > 0);

    if (paragraphs.length <= 1) {
        paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    }

    paragraphs.forEach(para => {
        const isHeading = para.length < 80 && (
            /^(bab|chapter|bagian|part|section)\s/i.test(para) ||
            /^[IVX]+\./i.test(para) ||
            /^\d+[\.\)]\s/.test(para) ||
            para === para.toUpperCase()
        );
        parsedNodes.push({ tag: isHeading ? 'h2' : 'p', text: para });
    });

    if (parsedNodes.length === 0) throw new Error("File TXT kosong atau tidak bisa dibaca.");

    library.push({
        id: Date.now().toString() + Math.floor(Math.random() * 1000), // Tambahin random biar ID duplikat bener-bener aman
        type: 'txt',
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

// 1d. HANDLER MD (MARKDOWN)
async function handleMd(file, bookTitle) {
    if (typeof marked === 'undefined') throw new Error("Library marked.js tidak ditemukan.");
    
    const text = await file.text();
    const htmlStr = marked.parse(text);
    const doc = (new DOMParser()).parseFromString(htmlStr, "text/html");
    
    let parsedNodes = [];
    const validBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre'];

    const allElements = doc.body.querySelectorAll('*');
    for (let el of allElements) {
        let tag = el.tagName.toLowerCase();
        
        if (tag === 'img' || tag === 'image') {
            let src = el.getAttribute('src');
            if (src) parsedNodes.push({ tag: 'img', src: src });
            continue;
        }

        if (validBlockTags.includes(tag)) {
            let hasBlockChild = false;
            const descendants = el.querySelectorAll('*');
            for (let i = 0; i < descendants.length; i++) {
                if (validBlockTags.includes(descendants[i].tagName.toLowerCase())) {
                    hasBlockChild = true;
                    break;
                }
            }
            
            if (hasBlockChild) continue;
            
            let textContent = el.textContent.trim().replace(/\s+/g, ' ');
            if (textContent.length === 0) continue;
            
            let finalTag = 'p';
            if (['h1', 'h2', 'h3', 'h4'].includes(tag)) finalTag = tag === 'h1' ? 'h1' : 'h2';
            
            parsedNodes.push({ tag: finalTag, text: textContent });
        }
    }

    if (parsedNodes.length === 0) throw new Error("File MD kosong atau tidak valid.");

    library.push({
        id: Date.now().toString() + Math.floor(Math.random() * 1000),
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

// 2. FUNGSI EKSTRAK PDF (ALGORITMA CERDAS + STITCHING & HYPHENATION FIX)
async function handlePdf(file, bookTitle) {
    const arrayBuffer = await file.arrayBuffer(); 
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let parsedNodes = []; 
    const total = pdf.numPages;

    // --- EKSTRAK COVER ---
    const coverCanvas = document.createElement('canvas'); const coverCtx = coverCanvas.getContext('2d');
    const firstPage = await pdf.getPage(1); const viewport = firstPage.getViewport({ scale: 0.5 });
    coverCanvas.width = viewport.width; coverCanvas.height = viewport.height;
    await firstPage.render({ canvasContext: coverCtx, viewport: viewport }).promise;
    const coverBase64 = coverCanvas.toDataURL('image/jpeg', 0.8);

    // --- PHASE 1: STATISTICAL FONT PROFILING ---
    let fontSizes = {};
    const samplePages = Math.min(total, 10);
    for (let i = 1; i <= samplePages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        textContent.items.forEach(item => {
            const h = Math.round(item.height);
            if (h > 0 && item.str.trim().length > 0) {
                fontSizes[h] = (fontSizes[h] || 0) + item.str.length;
            }
        });
    }

    let baseFontSize = 12;
    let maxWeight = 0;
    for (const [size, weight] of Object.entries(fontSizes)) {
        if (weight > maxWeight) {
            maxWeight = weight;
            baseFontSize = parseInt(size);
        }
    }

    // --- PHASE 2: EKSTRAKSI & STITCHING PARAGRAF ---
    for (let i = 1; i <= total; i++) {
        DOM.loadBar.style.width = `${Math.round((i / total) * 100)}%`; 
        DOM.loadPct.textContent = `${Math.round((i / total) * 100)}%`;

        const page = await pdf.getPage(i); 
        const textContent = await page.getTextContent();
        
        let currentBlock = ""; 
        let lastY = -1; 
        let blockMaxHeight = 0;

        const processBlock = (text, maxHeight) => {
            let cleanText = text.replace(/\s+/g, ' ').trim();
            cleanText = cleanText.replace(/B\s*A\s*B/gi, 'BAB');

            if (cleanText.length < 2 && !/^\d+$/.test(cleanText)) return;

            let tag = 'p';
            const isChapter = /^(bab|chapter|bagian)\s*([IVXLCDM\d]+|[a-zA-Z]+)/i.test(cleanText);
            const isSignificantlyLarger = maxHeight >= (baseFontSize * 1.4);
            const isSlightlyLarger = maxHeight >= (baseFontSize * 1.15);
            const isAllCaps = cleanText === cleanText.toUpperCase() && cleanText.length > 5 && /[A-Z]/.test(cleanText);

            if (isChapter) {
                tag = 'h1';
            } else if (isSignificantlyLarger && cleanText.length < 120 && /[a-zA-Z]/.test(cleanText)) {
                tag = 'h1';
            } else if ((isSlightlyLarger || isAllCaps) && cleanText.length < 150 && /[a-zA-Z]/.test(cleanText)) {
                tag = 'h2';
            }

            if (tag !== 'p' && cleanText.length > 200) {
                tag = 'p';
            }

            parsedNodes.push({ tag: tag, text: cleanText });
        };

        textContent.items.forEach(item => {
            const y = Math.round(item.transform[5]); 
            const height = item.height;
            const str = item.str;

            // Lewati item yang cuma berisi string kosong untuk kalkulasi posisi, tapi tetep simpen spasinya
            if (str.trim() === '') {
                currentBlock += str;
                return;
            }
            
            if (lastY !== -1) {
                const gap = Math.abs(lastY - y);
                // Logika Pemisahan Paragraf:
                // Pisah jika gap > 1.6x baseFont (jarak enter yang jauh)
                // ATAU gap > 0.8x baseFont (baris baru normal) TAPI baris sebelumnya diakhiri titik, tanda tanya, atau seru.
                const isBigGap = gap > (baseFontSize * 1.6);
                const isEndOfSentence = gap > (baseFontSize * 0.8) && currentBlock.trim().match(/[.!?]$/);

                if (isBigGap || isEndOfSentence) {
                    if (currentBlock.trim().length > 0) { 
                        processBlock(currentBlock, blockMaxHeight);
                    }
                    currentBlock = ""; 
                    blockMaxHeight = 0;
                }
            }
            
            if (height > blockMaxHeight) blockMaxHeight = height;
            
            // Logika Penyambungan (Stitching) & Pemenggalan Kata (Hyphenation)
            let cbTrimmed = currentBlock.trim();
            if (cbTrimmed.endsWith('-')) {
                // Hapus strip, dan gabungkan tanpa spasi (cth: "se-" + "jarah" = "sejarah")
                currentBlock = cbTrimmed.slice(0, -1) + str.trimStart();
            } else {
                // Normal append. Kasih spasi buat gabungin kata antar baris.
                if (currentBlock.length > 0 && !currentBlock.endsWith(" ")) {
                    currentBlock += " ";
                }
                currentBlock += str;
            }

            lastY = y;
        });

        // Proses sisa blok terakhir di halaman
        if (currentBlock.trim().length > 0) { 
            processBlock(currentBlock, blockMaxHeight);
        }
    }
    
    library.push({ 
        id: Date.now().toString() + Math.floor(Math.random() * 1000), 
        type: 'pdf', 
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

// 3. FUNGSI EKSTRAK EPUB
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
        
        doc.querySelectorAll('script, style, nav, footer, iframe, svg, button').forEach(el => el.remove());

        const allElements = doc.body.querySelectorAll('*');

        for (let el of allElements) {
            let tag = el.tagName.toLowerCase();
            
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

            if (validBlockTags.includes(tag)) {
                let hasBlockChild = false;
                const descendants = el.querySelectorAll('*');
                for (let i = 0; i < descendants.length; i++) {
                    if (validBlockTags.includes(descendants[i].tagName.toLowerCase())) {
                        hasBlockChild = true;
                        break;
                    }
                }
                
                if (hasBlockChild) continue; 
                
                let text = el.textContent.trim().replace(/\s+/g, ' ');
                if (text.length === 0) continue;
                
                let finalTag = 'p';
                if (['h1', 'h2', 'h3', 'h4'].includes(tag)) finalTag = tag === 'h1' ? 'h1' : 'h2';
                
                text = text.replace(/B\s*A\s*B/gi, 'BAB');
                if ((finalTag === 'h1' || finalTag === 'h2') && text.length > 150) finalTag = 'p';

                parsedNodes.push({ tag: finalTag, text: text });
            }
        }
    }
    
    library.push({ 
        id: Date.now().toString() + Math.floor(Math.random() * 1000), 
        type: 'epub', 
        title: bookTitle, 
        nodes: parsedNodes, 
        pages: spine.length, 
        progressPct: 0, 
        lastReadId: null, 
        coverBase64: coverBase64, 
        shape: 'square' 
    });
    
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

// 4. LOOKUP DICTIONARY — Orchestrator Wikipedia + Gemini (Support EN/ID/ES)
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
    const wikiLangCode = wikiLang === 'id' ? 'id' : (wikiLang === 'es' ? 'es' : 'en');
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
                let notFoundMsg = 'Not found on Wikipedia.';
                if (wikiLang === 'id') notFoundMsg = 'Tidak ditemukan di Wikipedia.';
                else if (wikiLang === 'es') notFoundMsg = 'No encontrado en Wikipedia.';
                wikiContent.innerHTML = `<p class="text-sm opacity-50 font-medium">${notFoundMsg}</p>`;
            }
            wikiContent.classList.remove('hidden');
        })
        .catch(() => {
            if (wikiLoading) wikiLoading.classList.add('hidden');
            if (wikiContent) {
                let failMsg = 'Failed to load Wikipedia.';
                if (wikiLang === 'id') failMsg = 'Gagal memuat Wikipedia.';
                else if (wikiLang === 'es') failMsg = 'Error al cargar Wikipedia.';
                wikiContent.innerHTML = `<p class="text-sm opacity-50 font-medium">${failMsg}</p>`;
                wikiContent.classList.remove('hidden');
            }
        });

    // Fetch Gemini (kalau ada API key)
    if (apiKey) {
        const modelVersion = localStorage.getItem('gemini_model') || 'gemini-2.5-flash-preview-05-20';
        
        let langInstruction = 'Use English. Explain the meaning, context, and provide a short example sentence. Write in plain paragraphs, no bullet points. No introductory phrases, go straight to the explanation.';
        if (wikiLang === 'id') {
            langInstruction = 'Gunakan bahasa Indonesia. Jelaskan arti, konteks, dan berikan contoh kalimat singkat. Tulis dalam paragraf biasa, tanpa poin atau bullet. Langsung ke penjelasan tanpa kata pembuka.';
        } else if (wikiLang === 'es') {
            langInstruction = 'Usa español. Explica el significado, el contexto y proporciona una breve oración de ejemplo. Escribe en párrafos normales, sin viñetas. Sin frases introductorias, ve directo a la explicación.';
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

