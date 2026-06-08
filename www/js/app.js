// --- APP LOGIC ---
// Mengurus interaksi UI, Tema, Render Library, Fitur In-Book Bookmark, & Manajemen Memori Tingkat Dewa

// 1. GLOBAL STATE & DOM REFERENCES
let library = []; 
let activeBookId = null; 
let observer = null; 
let activePanel = null;
let activeOptsId = null; 
let currentSelection = { 
    text: "", 
    nodeIdx: -1, 
    startOff: 0, 
    endOff: 0 
}; 
let isBatchDeleteMode = false;
let selectedForDelete = [];
let activeNoteColor = 'yellow';
let editingAnnotId = null;

let isDark = localStorage.getItem('theme') !== 'light'; 
let currentThemeKey = localStorage.getItem('m3-key') || 'orchid';
let isAmoled = localStorage.getItem('amoled') === 'true';
let wikiLang = localStorage.getItem('wiki_lang') || 'en';

// State baru untuk menyembunyikan judul buku dari rak
let isTitlesHidden = localStorage.getItem('hide_book_titles') === 'true';

// --- CANVAS MODE STATE ---
let currentPdfDoc = null;
let currentCanvasPage = 1;
let currentCanvasScale = 1.0;
let isRenderingCanvas = false;

// Variabel untuk gesture Canvas
let canvasTouchStartScale = 1.0;
let canvasTouchStartDist = 0;
let canvasTranslateX = 0;
let canvasTranslateY = 0;
let canvasPanStartX = 0;
let canvasPanStartY = 0;
let canvasIsPinching = false;
let canvasTapStartX = 0;
let canvasTapStartY = 0;
let canvasTapStartTime = 0;

const DOM = {};

document.addEventListener("DOMContentLoaded", () => {
    
    // Terapkan state sembunyi judul kalau aktif dari localStorage
    if (isTitlesHidden) {
        document.body.classList.add('hide-book-titles');
    }

    // Inisialisasi DOM Elements
    Object.assign(DOM, {
        libView: document.getElementById('library-view'), 
        readView: document.getElementById('reader-view'),
        mainHeader: document.getElementById('main-header'),
        grid: document.getElementById('book-grid'), 
        empty: document.getElementById('empty-state'),
        topSection: document.getElementById('top-section'),
        libCount: document.getElementById('library-count'),
        bottomBar: document.getElementById('bottom-bar'),
        inner: document.getElementById('reader-content'),
        tocList: document.getElementById('toc-list'),
        progFill: document.getElementById('progress-fill'),
        progPct: document.getElementById('progress-pct'),
        searchIn: document.getElementById('inbook-search-input'),
        searchRes: document.getElementById('search-results-panel'),
        btnSearch: document.getElementById('btn-search'),
        load: document.getElementById('loading-overlay'),
        loadTxt: document.getElementById('loading-text'),
        loadBar: document.getElementById('loading-bar'),
        loadPct: document.getElementById('loading-pct')
    });

    applyTheme(); 
    setupGestureModals();
    
    // Inisialisasi Library dari LocalForage (Penyimpanan IndexedDB)
    localforage.getItem('pdf_epub_master').then(data => {
        if (data) { 
            library = data; 
            renderLibrary(); 
        } else { 
            DOM.empty.classList.remove('hidden'); 
            DOM.topSection.classList.add('hidden'); 
        }
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    updateAppStats();

    // Tampilkan Welcome Modal jika user pertama kali buka aplikasi
    if (!localStorage.getItem('welcome_seen')) {
        setTimeout(() => {
            openWelcomeModal();
        }, 500);
    }
});

// 2. RENDER LIBRARY DENGAN PEMISAHAN RAK CANVAS DAN SCROLL
window.renderLibrary = function() {
    const d = i18n[wikiLang] || i18n['id'];
    DOM.grid.innerHTML = '';
    
    if (library.length === 0) { 
        DOM.empty.classList.remove('hidden'); 
        DOM.topSection.classList.add('hidden'); 
        return; 
    }
    
    DOM.empty.classList.add('hidden'); 
    DOM.topSection.classList.remove('hidden');
    
    // Hitung total progres buku yang sedang dibaca untuk header
    let totalPct = 0; 
    let readingCount = 0;
    
    library.forEach(b => { 
        if (b.progressPct > 0 && b.progressPct < 100) { 
            totalPct += b.progressPct; 
            readingCount++; 
        } 
    });
    
    const avgPct = readingCount > 0 ? Math.round(totalPct / readingCount) : 0;
    
    document.getElementById('header-pct').textContent = `${avgPct}%`;
    document.getElementById('header-bar').style.width = `${avgPct}%`;
    DOM.libCount.innerHTML = `<b>${library.length}</b> ${d.booksCount}`;

    // Pemisahan Buku ke Rak masing-masing (Scroll vs Canvas)
    const scrollBooks = library.filter(b => b.type !== 'pdf' || b.pdfMode === 'scroll');
    const canvasBooks = library.filter(b => b.type === 'pdf' && b.pdfMode === 'canvas');

    const renderRak = (bukuArray, titleRak) => {
        if (bukuArray.length === 0) {
            return '';
        }
        
        let html = `
            <div class="px-4 mt-6 mb-2 text-[11px] font-bold uppercase tracking-widest opacity-60 text-m3-primary/80">
                ${titleRak}
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 p-4">
        `;
        
        bukuArray.forEach(book => {
            const isSel = selectedForDelete.includes(book.id);
            const selCls = isSel ? 'ring-4 ring-red-500 scale-95 opacity-80' : '';
            
            let shapeCls = "rounded-2xl";
            if (book.shape === 'round') {
                shapeCls = "rounded-[40px]";
            } else if (book.shape === 'square') {
                shapeCls = "rounded-lg";
            }
            
            // Lencana hanya mengambil tipe aslinya saja (PDF, EPUB, TXT, MD) tanpa imbuhan Scroll/Canvas
            const badgeTxt = book.type.toUpperCase();

            html += `
                <div class="relative card-morph cursor-pointer flex flex-col h-56 ${selCls}" onclick="handleBookClick('${book.id}')">
                    <div class="absolute inset-0 z-0 ${shapeCls} shadow-md overflow-hidden bg-m3-surfaceVariant">
                        <img id="cover-${book.id}" src="" class="w-full h-full object-cover opacity-0 transition-opacity duration-500" loading="lazy" />
                    </div>
                    
                    <div class="absolute top-2 left-2 z-10 flex flex-col gap-1" id="top-icons-${book.id}">
                        <div class="book-badge bg-m3-primary text-m3-onPrimary text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider backdrop-blur-sm bg-opacity-90">
                            ${badgeTxt}
                        </div>
                    </div>
                    
                    <div class="absolute top-2 right-2 z-10" onclick="event.stopPropagation(); openBookOptions('${book.id}')">
                        <div class="w-8 h-8 rounded-full bg-black/20 dark:bg-white/20 backdrop-blur-md flex justify-center items-center text-white active:scale-90 transition-transform">
                            <i data-lucide="more-vertical" class="w-4 h-4"></i>
                        </div>
                    </div>
                    
                    <div class="relative z-10 mt-auto p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent ${shapeCls} rounded-t-none flex flex-col justify-end min-h-[50%]">
                        <div id="title-${book.id}" class="text-white text-xs font-bold leading-snug line-clamp-2 text-shadow-sm">
                            ${book.title}
                        </div>
                        <div id="pct-${book.id}" class="text-white/80 text-[10px] mt-1 font-medium">
                            ${book.progressPct || 0}%
                        </div>
                        <div id="bar-${book.id}" class="w-full h-1 bg-white/20 rounded-full mt-1.5 overflow-hidden">
                            <div class="h-full bg-m3-primaryContainer rounded-full transition-all duration-500" style="width: ${book.progressPct || 0}%"></div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        return html;
    };

    // Render Rak yang ada dengan nama dari config
    const strScroll = d.scrollRakTitle || 'Mode Scroll';
    const strCanvas = d.canvasRakTitle || 'Canvas Mode Books';
    
    DOM.grid.innerHTML += renderRak(scrollBooks, strScroll);
    DOM.grid.innerHTML += renderRak(canvasBooks, strCanvas);

    // Lazy load gambar cover
    library.forEach(book => {
        localforage.getItem('cover_' + book.id).then(base64 => {
            const img = document.getElementById(`cover-${book.id}`);
            if (img && base64) { 
                img.src = base64; 
                img.classList.remove('opacity-0'); 
            }
        });
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    updateAppStats();
};

window.handleBookClick = function(id) {
    if (isBatchDeleteMode) {
        const idx = selectedForDelete.indexOf(id);
        if (idx > -1) {
            selectedForDelete.splice(idx, 1);
        } else {
            selectedForDelete.push(id);
        }
        renderLibrary();
        
        const d = i18n[wikiLang] || i18n['id'];
        document.getElementById('batch-del-count').textContent = `${selectedForDelete.length} ${d.selected}`;
        return;
    }
    
    openBook(id);
};

// 3. BUKA BUKU & RENDERING (CANVAS & SCROLL)
window.openBook = async function(id) {
    const d = i18n[wikiLang] || i18n['id'];
    activeBookId = id;
    const book = library.find(b => b.id === id);
    if (!book) return;

    DOM.load.classList.remove('hidden');
    if (DOM.loadTxt) {
        DOM.loadTxt.textContent = d.readerLoading || "Membaca Dokumen...";
    }
    
    DOM.libView.classList.add('hidden');
    DOM.readView.classList.remove('hidden');
    DOM.inner.innerHTML = '';
    
    renderToc(book);

    // ==========================================
    // MODE CANVAS UNTUK PDF SCANNED/ORIGINAL
    // ==========================================
    if (book.type === 'pdf' && book.pdfMode === 'canvas') {
        try {
            const pdfBlob = await localforage.getItem('rawpdf_' + id);
            if (!pdfBlob) {
                throw new Error("File PDF asli tidak ditemukan di storage.");
            }
            
            const arrayBuffer = await pdfBlob.arrayBuffer();
            currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            currentCanvasPage = book.lastReadId ? parseInt(book.lastReadId) : 1;
            
            // Setup layout HTML untuk Canvas murni (Satu Kontainer Tengah)
            DOM.inner.innerHTML = `
                <div id="canvas-zoom-viewport">
                    <div id="canvas-wrapper">
                        <canvas id="pdf-canvas"></canvas>
                    </div>
                </div>
            `;
            
            DOM.inner.style.overflow = 'hidden'; 
            
            document.getElementById('reader-top-bar').classList.add('hidden');
            const scrollBotBar = document.getElementById('reader-bottom-bar');
            if (scrollBotBar) {
                scrollBotBar.classList.add('hidden');
            }

            const canvasController = document.getElementById('canvas-page-controller');
            if (canvasController) {
                canvasController.classList.remove('hidden');
                document.getElementById('canvas-page-label').textContent = `${currentCanvasPage} / ${currentPdfDoc.numPages}`;
            }

            // Atur gaya opsi pengaturan agar dimatikan visualnya di Mode Canvas
            const disabledGroups = ['btn-font-size', 'btn-font-family', 'btn-text-align', 'search-capsule'];
            disabledGroups.forEach(eid => {
                const el = document.getElementById(eid);
                if (el) {
                    el.classList.add('ui-disabled-group');
                }
            });

            await renderCanvasPage();
            initCanvasGestures(); 
            
            DOM.load.classList.add('hidden');
        } catch(err) {
            console.error(err);
            DOM.load.classList.add('hidden');
            showDialog("Error", "Gagal memuat PDF Canvas.", "alert-triangle", [{text: "Tutup", primary: true, action: window.closeReader}]);
        }
        return;
    }

    // ==========================================
    // MODE SCROLL (Dinamis untuk EPUB/TXT/MD/PDF-Scroll)
    // ==========================================
    DOM.inner.style.overflow = 'auto'; 
    document.getElementById('reader-top-bar').classList.remove('hidden');
    
    const scrollBotBar = document.getElementById('reader-bottom-bar');
    if (scrollBotBar) {
        scrollBotBar.classList.remove('hidden');
    }
    
    const canvasController = document.getElementById('canvas-page-controller');
    if (canvasController) {
        canvasController.classList.add('hidden');
    }

    // Aktifkan kembali opsi yang dimatikan
    const enabledGroups = ['btn-font-size', 'btn-font-family', 'btn-text-align', 'search-capsule'];
    enabledGroups.forEach(eid => {
        const el = document.getElementById(eid);
        if (el) {
            el.classList.remove('ui-disabled-group');
        }
    });

    const nodes = await localforage.getItem('content_' + id);
    book.nodes = nodes; 
    let html = '';
    
    nodes.forEach((node, i) => {
        if (node.tag === 'img') {
            html += `
                <img id="node-${i}" src="${node.src}" class="w-full max-w-lg mx-auto rounded-xl my-6 shadow-sm" loading="lazy" />
            `;
        } else {
            html += `
                <${node.tag} id="node-${i}" class="mb-4 relative">
                    ${node.text}
                </${node.tag}>
            `;
        }
    });
    
    DOM.inner.innerHTML = `
        <div class="max-w-3xl mx-auto pb-32 reader-text-container">
            ${html}
        </div>
    `;
    
    // Render Annotations (Bookmarks/Highlights)
    if (book.annotations && book.annotations.length > 0) {
        book.annotations.forEach(annot => {
            const targetEl = document.getElementById(`node-${annot.nodeIdx}`);
            if (targetEl) {
                const walker = document.createTreeWalker(targetEl, NodeFilter.SHOW_TEXT, null, false);
                const textNodes = [];
                let n;
                
                while (n = walker.nextNode()) {
                    textNodes.push(n);
                }
                
                let currLen = 0;
                let modified = false;
                
                for (let i = 0; i < textNodes.length; i++) {
                    const node = textNodes[i];
                    const nodeText = node.nodeValue;
                    const nodeStart = currLen;
                    const nodeEnd = currLen + nodeText.length;
                    
                    if (annot.startOff < nodeEnd && annot.endOff > nodeStart) {
                        const relStart = Math.max(0, annot.startOff - nodeStart);
                        const relEnd = Math.min(nodeText.length, annot.endOff - nodeStart);
                        
                        if (relStart >= 0 && relEnd <= nodeText.length && relEnd > relStart) {
                            const before = nodeText.substring(0, relStart);
                            const match = nodeText.substring(relStart, relEnd);
                            const after = nodeText.substring(relEnd);
                            
                            const span = document.createElement('span');
                            span.innerHTML = `${before}<mark class="hl-${annot.color} cursor-pointer hover:opacity-80 transition-opacity rounded px-1" onclick="openNoteModal('${annot.id}')" data-annot-id="${annot.id}">${match}</mark>${after}`;
                            
                            node.parentNode.replaceChild(span, node);
                            modified = true;
                            break; 
                        }
                    }
                    currLen += nodeText.length;
                }
            }
        });
    }

    DOM.load.classList.add('hidden');
    
    setTimeout(() => {
        setupIntersectionObserver();
        setupTextSelection();
        if (book.lastReadId) {
            const target = document.getElementById(book.lastReadId);
            if (target) { 
                target.scrollIntoView({ behavior: 'auto', block: 'start' }); 
            }
        }
    }, 100);
};

// --- GESTURE CANVAS (PANNING & TAP TO TURN) ---
function initCanvasGestures() {
    const wrapper = document.getElementById('canvas-wrapper');
    const viewport = document.getElementById('canvas-zoom-viewport');
    
    if (!wrapper || !viewport) return;

    // Bersihkan listener lama dengan cloning element untuk mencegah duplikasi event
    const newWrapper = wrapper.cloneNode(true);
    wrapper.parentNode.replaceChild(newWrapper, wrapper);
    
    // Reset state dasar
    currentCanvasScale = 1.0;
    canvasTranslateX = 0;
    canvasTranslateY = 0;
    canvasPanStartX = 0;
    canvasPanStartY = 0;
    canvasIsPinching = false;
    canvasTapStartX = 0;
    canvasTapStartY = 0;
    canvasTapStartTime = 0;

    newWrapper.style.transform = `translate(0px, 0px) scale(1)`;

    newWrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            canvasIsPinching = true;
            canvasTouchStartDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            canvasTouchStartScale = currentCanvasScale;
        } else if (e.touches.length === 1) {
            canvasTapStartX = e.touches[0].clientX;
            canvasTapStartY = e.touches[0].clientY;
            canvasTapStartTime = Date.now();
            
            // Siapkan panning jika sedang di zoom
            if (currentCanvasScale > 1.0) {
                canvasPanStartX = e.touches[0].clientX - canvasTranslateX;
                canvasPanStartY = e.touches[0].clientY - canvasTranslateY;
            }
        }
    });

    newWrapper.addEventListener('touchmove', (e) => {
        if (canvasIsPinching && e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            
            currentCanvasScale = Math.max(1.0, canvasTouchStartScale * (dist / canvasTouchStartDist));
            
            // Reset translate saat zoom out mentok ke 1.0
            if (currentCanvasScale === 1.0) {
                canvasTranslateX = 0;
                canvasTranslateY = 0;
            }
            
            newWrapper.style.transform = `translate(${canvasTranslateX}px, ${canvasTranslateY}px) scale(${currentCanvasScale})`;
            e.preventDefault();
            
        } else if (e.touches.length === 1 && currentCanvasScale > 1.0) {
            // Logika Panning 4 Arah saat gambar sedang di zoom
            canvasTranslateX = e.touches[0].clientX - canvasPanStartX;
            canvasTranslateY = e.touches[0].clientY - canvasPanStartY;
            
            newWrapper.style.transform = `translate(${canvasTranslateX}px, ${canvasTranslateY}px) scale(${currentCanvasScale})`;
            e.preventDefault();
        }
    }, { passive: false });

    newWrapper.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
            canvasIsPinching = false;
            
            // Cegah halaman mengecil dari ukuran aslinya dengan membatasi scale ke 1.0
            if (currentCanvasScale <= 1.0) {
                currentCanvasScale = 1.0;
                canvasTranslateX = 0;
                canvasTranslateY = 0;
                newWrapper.style.transform = `translate(0px, 0px) scale(1)`;

                // Cek Tap untuk navigasi Halaman mundur / maju
                const touchTime = Date.now() - canvasTapStartTime;
                const tapEndX = e.changedTouches[0].clientX;
                const tapEndY = e.changedTouches[0].clientY;
                const distMoved = Math.hypot(tapEndX - canvasTapStartX, tapEndY - canvasTapStartY);
                
                if (touchTime < 300 && distMoved < 15) {
                    const screenW = window.innerWidth;
                    // Sisi kiri 30% untuk mundur, sisi kanan 30% untuk maju
                    if (tapEndX < screenW * 0.30) {
                        window.prevCanvasPage();
                    } else if (tapEndX > screenW * 0.70) {
                        window.nextCanvasPage();
                    }
                }
            }
        }
    });
}

window.renderCanvasPage = async function() {
    if (!currentPdfDoc || isRenderingCanvas) {
        return;
    }
    
    isRenderingCanvas = true;
    
    try {
        const page = await currentPdfDoc.getPage(currentCanvasPage);
        const canvas = document.getElementById('pdf-canvas');
        
        if (!canvas) { 
            isRenderingCanvas = false; 
            return; 
        }
        
        const ctx = canvas.getContext('2d');
        
        // Optimasi resolusi agar tajam saat dizoom
        const pixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: 1.5 });
        
        canvas.width = viewport.width * pixelRatio;
        canvas.height = viewport.height * pixelRatio;
        
        // Render Context Configuration
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport,
            transform: [pixelRatio, 0, 0, pixelRatio, 0, 0]
        };
        
        await page.render(renderContext).promise;
        
        const controllerLabel = document.getElementById('canvas-page-label');
        if (controllerLabel) {
            controllerLabel.textContent = `${currentCanvasPage} / ${currentPdfDoc.numPages}`;
        }
        
        // Simpan progress baca
        const bookIndex = library.findIndex(b => b.id === activeBookId);
        if (bookIndex > -1) {
            library[bookIndex].lastReadId = currentCanvasPage;
            library[bookIndex].progressPct = Math.round((currentCanvasPage / currentPdfDoc.numPages) * 100);
            await localforage.setItem('pdf_epub_master', library);
        }
    } catch (e) { 
        console.error(e); 
    }
    
    isRenderingCanvas = false;
};

window.nextCanvasPage = function() {
    if (currentPdfDoc && currentCanvasPage < currentPdfDoc.numPages) {
        currentCanvasPage++;
        renderCanvasPage();
    }
};

window.prevCanvasPage = function() {
    if (currentPdfDoc && currentCanvasPage > 1) {
        currentCanvasPage--;
        renderCanvasPage();
    }
};

window.jumpToCanvasPage = function() {
    const d = i18n[wikiLang] || i18n['id'];
    const pStr = prompt(`${d.txtPageGo || 'Pergi ke halaman'} (1 - ${currentPdfDoc.numPages}):`, currentCanvasPage);
    
    if (pStr) {
        const p = parseInt(pStr);
        if (p >= 1 && p <= currentPdfDoc.numPages) {
            currentCanvasPage = p;
            renderCanvasPage();
        }
    }
};

window.renderToc = function(book) {
    DOM.tocList.innerHTML = '';
    const d = i18n[wikiLang] || i18n['id'];

    // Peringatan jika pengguna menekan tombol TOC di Canvas Mode
    if (book.pdfMode === 'canvas') {
        DOM.tocList.innerHTML = `
            <div class="p-6 text-center text-sm opacity-60 font-bold">
                ${d.tocCanvasWarning || 'Untuk mode canvas, daftar isi tidak tersedia.'}
            </div>
        `;
        return;
    }

    if (!book.nodes) return;
    
    book.nodes.forEach((node, i) => {
        if (node.tag === 'h1' || node.tag === 'h2') {
            const el = document.createElement('div');
            el.className = `p-4 border-b border-m3-surfaceVariant active:bg-m3-surfaceVariant transition-colors cursor-pointer ${node.tag === 'h1' ? 'font-bold text-m3-primary text-sm' : 'text-m3-onSurface text-xs pl-6'}`;
            el.textContent = node.text;
            el.onclick = () => {
                closePanel();
                const target = document.getElementById(`node-${i}`);
                if (target) { 
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' }); 
                }
            };
            DOM.tocList.appendChild(el);
        }
    });
};

function setupIntersectionObserver() {
    if (observer) {
        observer.disconnect();
    }
    
    const book = library.find(b => b.id === activeBookId);
    if (!book || book.pdfMode === 'canvas') return;

    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const idxStr = entry.target.id.replace('node-', '');
                const idx = parseInt(idxStr);
                const pct = Math.round((idx / book.nodes.length) * 100);
                
                DOM.progFill.style.width = `${pct}%`;
                DOM.progPct.textContent = `${pct}%`;
                
                book.progressPct = pct;
                book.lastReadId = entry.target.id;
                localforage.setItem('pdf_epub_master', library);
            }
        });
    }, { root: DOM.inner, rootMargin: '0px', threshold: 0.1 });

    const nodes = DOM.inner.querySelectorAll('p, h1, h2');
    nodes.forEach(n => observer.observe(n));
}

function setupTextSelection() {
    document.addEventListener('selectionchange', () => {
        const sel = window.getSelection();
        const menu = document.getElementById('selection-menu');
        
        if (!sel.isCollapsed && DOM.readView.classList.contains('hidden') === false) {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            let targetNode = range.startContainer;
            if (targetNode.nodeType === 3) {
                targetNode = targetNode.parentNode;
            }
            
            while(targetNode && !targetNode.id?.startsWith('node-')) {
                targetNode = targetNode.parentNode;
            }
            
            if (targetNode) {
                currentSelection = {
                    text: sel.toString().trim(),
                    nodeIdx: parseInt(targetNode.id.replace('node-', '')),
                    startOff: range.startOffset,
                    endOff: range.endOffset
                };
                
                menu.style.top = `${Math.max(10, rect.top - 60)}px`;
                menu.style.left = `50%`;
                menu.style.transform = `translateX(-50%) scale(1)`;
                menu.classList.remove('hidden', 'opacity-0');
            }
        } else {
            hideSelectionMenu();
        }
    });
}

window.hideSelectionMenu = function() {
    const menu = document.getElementById('selection-menu');
    menu.style.transform = `translateX(-50%) scale(0.9)`;
    menu.classList.add('opacity-0');
    setTimeout(() => {
        menu.classList.add('hidden');
    }, 200);
};

// 4. BOOKMARKS & HIGHLIGHTS LOGIC
window.showHighlightMenu = function() {
    const colorsMenu = document.getElementById('highlight-colors');
    colorsMenu.classList.remove('hidden');
};

window.applyHighlight = function(color) {
    if (currentSelection.nodeIdx === -1) return;
    
    const bookIndex = library.findIndex(b => b.id === activeBookId);
    if (bookIndex === -1) return;
    
    if (!library[bookIndex].annotations) {
        library[bookIndex].annotations = [];
    }
    
    const annotId = 'ann_' + Date.now();
    library[bookIndex].annotations.push({
        id: annotId,
        color: color,
        text: currentSelection.text,
        nodeIdx: currentSelection.nodeIdx,
        startOff: currentSelection.startOff,
        endOff: currentSelection.endOff,
        note: '',
        date: new Date().toISOString()
    });
    
    localforage.setItem('pdf_epub_master', library);
    
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const mark = document.createElement('mark');
    
    mark.className = `hl-${color} cursor-pointer hover:opacity-80 transition-opacity rounded px-1`;
    mark.onclick = () => openNoteModal(annotId);
    mark.dataset.annotId = annotId;
    
    try { 
        range.surroundContents(mark); 
    } catch(e) { 
        console.error("Kompleks selection gagal di-wrap dinamis, but saved."); 
    }
    
    sel.removeAllRanges();
    hideSelectionMenu();
    document.getElementById('highlight-colors').classList.add('hidden');
};

window.openNoteModal = function(annotId) {
    const book = library.find(b => b.id === activeBookId);
    if (!book || !book.annotations) return;
    
    const annot = book.annotations.find(a => a.id === annotId);
    if (!annot) return;
    
    editingAnnotId = annotId;
    activeNoteColor = annot.color;
    
    const modal = document.getElementById('bookmark-sheet-modal');
    document.getElementById('bm-title-input').value = annot.title || "";
    document.getElementById('bm-note-input').value = annot.note || "";
    document.getElementById('bm-snippet').textContent = `"${annot.text.length > 60 ? annot.text.substring(0,60)+'...' : annot.text}"`;
    
    selectNoteColor(annot.color);
    
    pushAppHistory('bookmark-sheet-modal');
    modal.classList.remove('hidden');
    
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('bookmark-sheet').classList.remove('translate-y-full');
    });
};

window.selectNoteColor = function(color) {
    activeNoteColor = color;
    ['yellow', 'green', 'pink', 'blue'].forEach(c => {
        const el = document.getElementById(`color-btn-${c}`);
        if (el) {
            if (c === color) {
                el.classList.add('ring-4', 'ring-m3-onSurface', 'scale-110');
            } else {
                el.classList.remove('ring-4', 'ring-m3-onSurface', 'scale-110');
            }
        }
    });
};

window.saveNote = function() {
    const bookIndex = library.findIndex(b => b.id === activeBookId);
    if (bookIndex === -1 || !editingAnnotId) return;
    
    const annotIndex = library[bookIndex].annotations.findIndex(a => a.id === editingAnnotId);
    if (annotIndex === -1) return;
    
    library[bookIndex].annotations[annotIndex].title = document.getElementById('bm-title-input').value.trim();
    library[bookIndex].annotations[annotIndex].note = document.getElementById('bm-note-input').value.trim();
    
    const oldColor = library[bookIndex].annotations[annotIndex].color;
    library[bookIndex].annotations[annotIndex].color = activeNoteColor;
    
    localforage.setItem('pdf_epub_master', library);
    
    if (oldColor !== activeNoteColor) {
        const mark = document.querySelector(`mark[data-annot-id="${editingAnnotId}"]`);
        if (mark) {
            mark.classList.remove(`hl-${oldColor}`);
            mark.classList.add(`hl-${activeNoteColor}`);
        }
    }
    
    closeNoteModal();
};

window.deleteNote = function() {
    const d = i18n[wikiLang] || i18n['id'];
    showDialog(
        d.delete, 
        d.deleteNoteConfirm || "Hapus catatan/sorotan ini?", 
        "trash", 
        [
            { text: d.cancel, primary: false, action: closeDialog },
            { text: d.delete, primary: true, action: () => {
                const bookIndex = library.findIndex(b => b.id === activeBookId);
                
                if (bookIndex > -1 && editingAnnotId) {
                    library[bookIndex].annotations = library[bookIndex].annotations.filter(a => a.id !== editingAnnotId);
                    localforage.setItem('pdf_epub_master', library);
                    
                    const mark = document.querySelector(`mark[data-annot-id="${editingAnnotId}"]`);
                    if (mark) {
                        const text = document.createTextNode(mark.textContent);
                        mark.parentNode.replaceChild(text, mark);
                    }
                }
                
                closeDialog();
                closeNoteModal();
            }}
        ]
    );
};

window.closeNoteModal = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    
    const m = document.getElementById('bookmark-sheet-modal');
    const s = document.getElementById('bookmark-sheet');
    
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
    
    editingAnnotId = null;
};

// 5. THEME & PENGATURAN UI UTAMA
window.applyTheme = function() {
    const themeKey = currentThemeKey;
    const styleId = 'm3-dynamic-theme';
    let styleEl = document.getElementById(styleId);
    
    if (!styleEl) { 
        styleEl = document.createElement('style'); 
        styleEl.id = styleId; 
        document.head.appendChild(styleEl); 
    }
    
    const palette = typeof M3_PALETTES !== 'undefined' ? (M3_PALETTES[themeKey] || M3_PALETTES['orchid']) : null;
    
    if (palette) {
        styleEl.innerHTML = `
            :root { ${palette.light} }
            .dark { ${palette.dark} }
        `;
    }

    if (isDark) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    
    if (isAmoled) {
        document.documentElement.setAttribute('data-amoled', 'true');
    } else {
        document.documentElement.removeAttribute('data-amoled');
    }
    
    renderSettings();
    renderThemePalette();
    
    // Sinkronisasi warna bar status bar hp (Capacitor)
    if (window.Capacitor && window.Capacitor.Plugins.StatusBar) {
        const rootStyles = getComputedStyle(document.documentElement);
        let bgColor = rootStyles.getPropertyValue('--md-sys-color-background').trim();
        let isLightColor = !isDark;
        
        if (isDark && isAmoled) {
            bgColor = '#000000';
        }
        
        window.Capacitor.Plugins.StatusBar.setBackgroundColor({ color: bgColor }).catch(()=>{});
        window.Capacitor.Plugins.StatusBar.setStyle({ style: isLightColor ? 'LIGHT' : 'DARK' }).catch(()=>{});
    }
};

window.toggleTheme = function() { 
    isDark = !isDark; 
    localStorage.setItem('theme', isDark ? 'dark' : 'light'); 
    applyTheme(); 
};

window.setPalette = function(key) { 
    currentThemeKey = key; 
    localStorage.setItem('m3-key', key); 
    applyTheme(); 
};

window.toggleAmoled = function() { 
    isAmoled = !isAmoled; 
    localStorage.setItem('amoled', isAmoled); 
    applyTheme(); 
};

window.setLang = function(lang) { 
    wikiLang = lang; 
    localStorage.setItem('wiki_lang', lang); 
    renderSettings(); 
    renderLibrary(); 
};

// Fitur Baru Sembunyikan Judul di Rak Buku
window.toggleHideTitles = function() {
    isTitlesHidden = !isTitlesHidden;
    localStorage.setItem('hide_book_titles', isTitlesHidden.toString());
    
    if (isTitlesHidden) {
        document.body.classList.add('hide-book-titles');
    } else {
        document.body.classList.remove('hide-book-titles');
    }
    
    renderSettings();
};

window.renderSettings = function() {
    const d = i18n[wikiLang] || i18n['id'];
    const pnl = document.getElementById('settings-panel-content');
    if (!pnl) return;

    pnl.innerHTML = `
        <div class="px-6 py-4 border-b border-m3-surfaceVariant">
            <h2 class="text-xl font-bold font-playfair text-m3-primary">
                ${d.setMainTitle}
            </h2>
        </div>
        
        <div class="p-6">
            <div class="mb-6">
                <div class="text-xs font-bold text-m3-primary mb-3 uppercase tracking-wider">
                    ${d.setTheme}
                </div>
                <div class="flex gap-4">
                    <div onclick="isDark=false; localStorage.setItem('theme','light'); applyTheme();" 
                         class="flex-1 p-3 rounded-2xl border-2 transition-all cursor-pointer ${!isDark ? 'border-m3-primary bg-m3-primaryContainer text-m3-onPrimaryContainer' : 'border-m3-surfaceVariant text-m3-onSurface'}">
                        <i data-lucide="sun" class="w-6 h-6 mx-auto mb-2"></i>
                        <div class="text-center text-xs font-bold">${d.themeLight}</div>
                    </div>
                    <div onclick="isDark=true; localStorage.setItem('theme','dark'); applyTheme();" 
                         class="flex-1 p-3 rounded-2xl border-2 transition-all cursor-pointer ${isDark ? 'border-m3-primary bg-m3-primaryContainer text-m3-onPrimaryContainer' : 'border-m3-surfaceVariant text-m3-onSurface'}">
                        <i data-lucide="moon" class="w-6 h-6 mx-auto mb-2"></i>
                        <div class="text-center text-xs font-bold">${d.themeDark}</div>
                    </div>
                </div>
            </div>

            <div class="flex justify-between items-center bg-m3-surfaceVariant p-4 rounded-2xl mb-6">
                <span class="text-sm font-bold opacity-80">${d.amoledLabel}</span>
                <div class="w-12 h-6 rounded-full bg-m3-surface flex items-center p-1 cursor-pointer" onclick="toggleAmoled()">
                    <div class="w-4 h-4 rounded-full bg-m3-onSurfaceVariant transition-transform ${isAmoled ? 'translate-x-6 bg-m3-primary' : ''}"></div>
                </div>
            </div>

            <div class="flex justify-between items-center bg-m3-surfaceVariant p-4 rounded-2xl mb-6">
                <span class="text-sm font-bold opacity-80">${d.setHideTitles || 'Sembunyikan Judul Buku di Rak'}</span>
                <div class="w-12 h-6 rounded-full bg-m3-surface flex items-center p-1 cursor-pointer" onclick="toggleHideTitles()">
                    <div class="w-4 h-4 rounded-full bg-m3-onSurfaceVariant transition-transform ${isTitlesHidden ? 'translate-x-6 bg-m3-primary' : ''}"></div>
                </div>
            </div>

            <div class="mb-6" id="palette-container"></div>
            
            <div class="mb-6">
                <div class="text-xs font-bold text-m3-primary mb-3 uppercase tracking-wider">
                    ${d.setLang}
                </div>
                <div class="flex gap-2">
                    <button onclick="setLang('id')" class="flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${wikiLang==='id'?'bg-m3-primary text-m3-onPrimary':'bg-m3-surfaceVariant text-m3-onSurface'}">ID</button>
                    <button onclick="setLang('en')" class="flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${wikiLang==='en'?'bg-m3-primary text-m3-onPrimary':'bg-m3-surfaceVariant text-m3-onSurface'}">EN</button>
                    <button onclick="setLang('es')" class="flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${wikiLang==='es'?'bg-m3-primary text-m3-onPrimary':'bg-m3-surfaceVariant text-m3-onSurface'}">ES</button>
                </div>
            </div>
            
            <div class="mb-6">
                <div class="text-xs font-bold text-m3-primary mb-3 uppercase tracking-wider">
                    ${d.setData}
                </div>
                <div class="flex flex-col gap-2">
                    <button onclick="window.openBackupModal()" class="w-full py-3 bg-m3-surfaceVariant text-m3-onSurface rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <i data-lucide="download" class="w-4 h-4"></i> ${d.btnBackup}
                    </button>
                    <button onclick="document.getElementById('restore-upload').click()" class="w-full py-3 bg-m3-surfaceVariant text-m3-onSurface rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <i data-lucide="upload" class="w-4 h-4"></i> ${d.btnRestore}
                    </button>
                    <button onclick="window.clearAllCovers()" class="w-full py-3 bg-red-500/10 text-red-500 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform mt-2">
                        <i data-lucide="image-off" class="w-4 h-4"></i> ${d.btnClearCovers || "Hapus Semua Sampul"}
                    </button>
                </div>
            </div>

            <div class="mb-6">
                <div class="text-xs font-bold text-m3-primary mb-3 uppercase tracking-wider">
                    ${d.setAiConfig}
                </div>
                <div class="bg-m3-surfaceVariant p-4 rounded-2xl">
                    <p class="text-xs opacity-70 mb-3">${d.geminiDesc}</p>
                    <input type="text" id="api-key-input" placeholder="${d.geminiPlaceholder}" value="${localStorage.getItem('gemini_api_key')||''}" class="w-full p-3 rounded-xl bg-m3-surface text-sm text-m3-onSurface border-none mb-3">
                    <button onclick="saveApiKey()" class="w-full py-2 bg-m3-primary text-m3-onPrimary rounded-xl text-sm font-bold active:scale-95 transition-transform">
                        Simpan Key
                    </button>
                </div>
            </div>

            <div class="mb-6">
                <div class="text-xs font-bold text-m3-primary mb-3 uppercase tracking-wider">
                    ${d.setInfo}
                </div>
                <div class="flex flex-col gap-2">
                    <button onclick="window.checkUpdate()" class="w-full py-3 bg-m3-secondaryContainer text-m3-onSecondaryContainer rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i> ${d.btnUpdate || 'Cek Pembaruan'}
                    </button>
                    <button onclick="openWelcomeModal()" class="w-full py-3 bg-m3-surfaceVariant text-m3-onSurface rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <i data-lucide="help-circle" class="w-4 h-4"></i> ${d.btnInfo}
                    </button>
                    <a href="https://saweria.co/dyunayuna90" target="_blank" class="w-full py-3 bg-[#FFB020] text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform mt-2">
                        <i data-lucide="coffee" class="w-4 h-4"></i> ${d.btnDonate}
                    </a>
                </div>
            </div>
        </div>
    `;
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
    renderThemePalette();
};

window.renderThemePalette = function() {
    const d = i18n[wikiLang] || i18n['id'];
    const pContainer = document.getElementById('palette-container');
    if (!pContainer) return;
    
    let html = `
        <div class="text-xs font-bold text-m3-primary mb-3 uppercase tracking-wider">
            ${d.setPalette}
        </div>
        <div class="flex flex-wrap gap-3">
    `;
    
    const palettes = typeof M3_PALETTES !== 'undefined' ? M3_PALETTES : {};
    
    for (const key in palettes) {
        const isActive = key === currentThemeKey;
        const ring = isActive ? 'ring-4 ring-m3-primary scale-110' : '';
        const bgMatch = palettes[key].light.match(/--md-sys-color-primary:(#[0-9A-F]{6})/i);
        const bgColor = bgMatch ? bgMatch[1] : '#000';
        
        html += `
            <div onclick="setPalette('${key}')" 
                 class="w-10 h-10 rounded-full cursor-pointer transition-all ${ring}" 
                 style="background-color: ${bgColor};">
            </div>
        `;
    }
    
    html += `</div>`;
    pContainer.innerHTML = html;
};

// 6. READER APPEARANCE (FONT, SIZE, ALIGNMENT)
window.changeFont = function(font) { 
    document.documentElement.style.setProperty('--reader-font', font); 
    localStorage.setItem('r_font', font); 
};

window.changeSize = function(delta) {
    let s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-size')) || 1.2;
    s = Math.max(0.8, Math.min(2.5, s + delta));
    document.documentElement.style.setProperty('--reader-size', s + 'rem');
    localStorage.setItem('r_size', s);
};

window.changeAlign = function(align) { 
    document.documentElement.style.setProperty('--reader-align', align); 
    localStorage.setItem('r_align', align); 
};

// 7. BOOK OPTIONS & BATCH DELETE LOGIC
window.openBookOptions = function(id) {
    activeOptsId = id;
    const d = i18n[wikiLang] || i18n['id'];
    const book = library.find(b => b.id === id);
    if (!book) return;

    const modal = document.getElementById('b-opt-modal');
    const sheet = document.getElementById('b-opt-sheet');
    const content = document.getElementById('b-opt-content');
    
    const isPinned = book.pinned || false;
    const pinText = isPinned ? d.optUnpin : d.optPin;
    const pinIcon = isPinned ? 'pin-off' : 'pin';

    content.innerHTML = `
        <div class="flex items-center gap-4 mb-6 border-b border-m3-surfaceVariant pb-4">
            <div class="w-12 h-16 bg-m3-surfaceVariant rounded flex-shrink-0 overflow-hidden shadow-sm">
                <img id="opt-cover" src="" class="w-full h-full object-cover opacity-0 transition-opacity">
            </div>
            <div>
                <h3 class="font-bold text-m3-onSurface text-sm line-clamp-2">${book.title}</h3>
                <p class="text-[10px] uppercase font-bold text-m3-primary mt-1 opacity-80">
                    ${book.type} • ${book.progressPct}% Read
                </p>
            </div>
        </div>
        <div class="flex flex-col gap-1">
            <button onclick="togglePinBook()" class="w-full text-left px-4 py-3 rounded-xl hover:bg-m3-surfaceVariant text-m3-onSurface font-medium text-sm flex items-center gap-3">
                <i data-lucide="${pinIcon}" class="w-4 h-4"></i> ${pinText}
            </button>
            <button onclick="enterBatchDelete()" class="w-full text-left px-4 py-3 rounded-xl hover:bg-m3-surfaceVariant text-m3-onSurface font-medium text-sm flex items-center gap-3">
                <i data-lucide="check-square" class="w-4 h-4"></i> ${d.optSelect}
            </button>
            <button onclick="openEditModal()" class="w-full text-left px-4 py-3 rounded-xl hover:bg-m3-surfaceVariant text-m3-onSurface font-medium text-sm flex items-center gap-3">
                <i data-lucide="edit-3" class="w-4 h-4"></i> ${d.optEdit}
            </button>
            <button onclick="deleteSingleBook()" class="w-full text-left px-4 py-3 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm flex items-center gap-3 mt-2">
                <i data-lucide="trash-2" class="w-4 h-4"></i> ${d.optDelete}
            </button>
        </div>
    `;
    
    localforage.getItem('cover_' + id).then(b64 => {
        const img = document.getElementById('opt-cover');
        if (img && b64) { 
            img.src = b64; 
            img.classList.remove('opacity-0'); 
        }
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    pushAppHistory('b-opt-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        sheet.classList.remove('translate-y-full');
    });
};

window.closeOptsModal = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    const m = document.getElementById('b-opt-modal');
    const s = document.getElementById('b-opt-sheet');
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
};

window.togglePinBook = function() {
    const idx = library.findIndex(b => b.id === activeOptsId);
    if (idx > -1) {
        library[idx].pinned = !library[idx].pinned;
        
        const b = library.splice(idx, 1)[0];
        if (b.pinned) {
            library.unshift(b);
        } else {
            const lastPinIdx = library.findLastIndex(x => x.pinned);
            library.splice(lastPinIdx > -1 ? lastPinIdx + 1 : 0, 0, b);
        }
        
        localforage.setItem('pdf_epub_master', library);
        renderLibrary();
    }
    closeOptsModal();
};

window.enterBatchDelete = function() {
    isBatchDeleteMode = true;
    selectedForDelete = [activeOptsId];
    closeOptsModal();
    
    DOM.mainHeader.classList.add('hidden');
    document.getElementById('batch-del-header').classList.remove('hidden');
    
    const d = i18n[wikiLang] || i18n['id'];
    document.getElementById('batch-del-count').textContent = `1 ${d.selected}`;
    renderLibrary();
};

window.cancelBatchDelete = function() {
    isBatchDeleteMode = false;
    selectedForDelete = [];
    
    DOM.mainHeader.classList.remove('hidden');
    document.getElementById('batch-del-header').classList.add('hidden');
    renderLibrary();
};

window.executeBatchDelete = function() {
    if (selectedForDelete.length === 0) return;
    
    const d = i18n[wikiLang] || i18n['id'];
    showDialog(d.delete, d.deleteConfirm, "trash", [
        { 
            text: d.cancel, 
            primary: false, 
            action: closeDialog 
        },
        { 
            text: d.delete, 
            primary: true, 
            action: async () => {
                closeDialog();
                DOM.load.classList.remove('hidden');
                
                if (DOM.loadTxt) {
                    DOM.loadTxt.textContent = "Deleting files...";
                }
                
                for (const id of selectedForDelete) {
                    await localforage.removeItem('content_' + id);
                    await localforage.removeItem('cover_' + id);
                    await localforage.removeItem('rawpdf_' + id);
                }
                
                library = library.filter(b => !selectedForDelete.includes(b.id));
                await localforage.setItem('pdf_epub_master', library);
                
                DOM.load.classList.add('hidden');
                cancelBatchDelete();
            }
        }
    ]);
};

window.deleteSingleBook = function() {
    const d = i18n[wikiLang] || i18n['id'];
    showDialog(d.delete, d.deleteConfirm, "trash", [
        { 
            text: d.cancel, 
            primary: false, 
            action: closeDialog 
        },
        { 
            text: d.delete, 
            primary: true, 
            action: async () => {
                closeDialog();
                DOM.load.classList.remove('hidden');
                
                await localforage.removeItem('content_' + activeOptsId);
                await localforage.removeItem('cover_' + activeOptsId);
                await localforage.removeItem('rawpdf_' + activeOptsId);
                
                library = library.filter(b => b.id !== activeOptsId);
                await localforage.setItem('pdf_epub_master', library);
                
                DOM.load.classList.add('hidden');
                closeOptsModal();
                renderLibrary();
            }
        }
    ]);
};

// 7b. EDIT DETAILS BOOK
window.openEditModal = function() {
    closeOptsModal();
    const book = library.find(b => b.id === activeOptsId);
    if (!book) return;
    
    document.getElementById('edit-title-input').value = book.title;
    
    ['dyn', 'round', 'square'].forEach(s => {
        document.getElementById(`shape-btn-${s}`).classList.remove('ring-4', 'ring-m3-primary', 'bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
        document.getElementById(`shape-btn-${s}`).classList.add('border-m3-surfaceVariant', 'text-m3-onSurface');
    });
    
    const activeShapeBtn = document.getElementById(`shape-btn-${book.shape || 'dyn'}`);
    if (activeShapeBtn) {
        activeShapeBtn.classList.add('ring-4', 'ring-m3-primary', 'bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
        activeShapeBtn.classList.remove('border-m3-surfaceVariant');
    }

    localforage.getItem('cover_' + book.id).then(b64 => {
        const img = document.getElementById('edit-cover-preview');
        if (b64) {
            img.src = b64;
            img.classList.remove('hidden');
            document.getElementById('edit-cover-placeholder').classList.add('hidden');
        } else {
            img.src = "";
            img.classList.add('hidden');
            document.getElementById('edit-cover-placeholder').classList.remove('hidden');
        }
    });

    const modal = document.getElementById('edit-modal');
    pushAppHistory('edit-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('edit-sheet').classList.remove('translate-y-full');
    });
};

window.closeEditModal = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    const m = document.getElementById('edit-modal');
    const s = document.getElementById('edit-sheet');
    
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
};

window.changeCardShape = function(shape) {
    ['dyn', 'round', 'square'].forEach(s => {
        document.getElementById(`shape-btn-${s}`).classList.remove('ring-4', 'ring-m3-primary', 'bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
        document.getElementById(`shape-btn-${s}`).classList.add('border-m3-surfaceVariant', 'text-m3-onSurface');
    });
    
    const activeShapeBtn = document.getElementById(`shape-btn-${shape}`);
    if (activeShapeBtn) {
        activeShapeBtn.classList.add('ring-4', 'ring-m3-primary', 'bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
        activeShapeBtn.classList.remove('border-m3-surfaceVariant');
    }
    
    const bookIndex = library.findIndex(b => b.id === activeOptsId);
    if (bookIndex > -1) {
        library[bookIndex].shape = shape;
    }
};

window.handleEditCoverUpload = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const b64 = event.target.result;
        const img = document.getElementById('edit-cover-preview');
        img.src = b64;
        img.classList.remove('hidden');
        document.getElementById('edit-cover-placeholder').classList.add('hidden');
        
        localforage.setItem('cover_' + activeOptsId, b64);
    };
    reader.readAsDataURL(file);
};

window.saveEditDetail = function() {
    const bookIndex = library.findIndex(b => b.id === activeOptsId);
    if (bookIndex > -1) {
        library[bookIndex].title = document.getElementById('edit-title-input').value.trim();
        localforage.setItem('pdf_epub_master', library);
        renderLibrary();
    }
    closeEditModal();
};

// 7c. BACKUP & RESTORE TINGKAT DEWA
window.openBackupModal = function() {
    const d = i18n[wikiLang] || i18n['id'];
    const m = document.getElementById('bak-opt-modal');
    
    document.getElementById('bak-opt-title').textContent = d.bakModalTitle || "Pilih Jenis Backup";
    document.getElementById('bak-opt-desc').textContent = d.bakModalDesc || "Pilih format backup yang sesuai dengan kebutuhan lu:";
    
    pushAppHistory('bak-opt-modal');
    m.classList.remove('hidden');
    requestAnimationFrame(() => {
        m.classList.remove('opacity-0');
        document.getElementById('bak-opt-sheet').classList.remove('translate-y-full');
    });
};

window.closeBackupModal = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    const m = document.getElementById('bak-opt-modal');
    const s = document.getElementById('bak-opt-sheet');
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
};

window.doBackupJson = async function() {
    closeBackupModal();
    const d = i18n[wikiLang] || i18n['id'];
    DOM.load.classList.remove('hidden');
    
    if (DOM.loadTxt) {
        DOM.loadTxt.textContent = d.bakJsonLoading || "Menyiapkan file backup JSON...";
    }
    
    try {
        const dataStr = JSON.stringify(library);
        
        if (window.Capacitor && window.Capacitor.Plugins.Filesystem) {
            try {
                const date = new Date().toISOString().slice(0,10);
                const fileName = `baca_backup_${date}.json`;
                
                await window.Capacitor.Plugins.Filesystem.writeFile({
                    path: fileName,
                    data: dataStr,
                    directory: 'DOCUMENTS',
                    encoding: 'utf8'
                });
                
                DOM.load.classList.add('hidden');
                showDialog(
                    "Sukses", 
                    `Backup JSON tersimpan di folder Documents dengan nama ${fileName}`, 
                    "check-circle", 
                    [{text: "Oke", primary: true, action: closeDialog}]
                );
                return;
            } catch(e) {
                console.error("Capacitor save error, fallback to raw", e);
            }
        }
        
        DOM.load.classList.add('hidden');
        document.getElementById('raw-backup-data').value = dataStr;
        openRawBackupModal();

    } catch(err) {
        DOM.load.classList.add('hidden');
        showDialog("Error", "Gagal memproses JSON: " + err.message, "alert-triangle", [{text: "Tutup", primary: true, action: closeDialog}]);
    }
};

window.doBackupZip = async function() {
    closeBackupModal();
    const d = i18n[wikiLang] || i18n['id'];
    DOM.load.classList.remove('hidden');
    
    if (DOM.loadTxt) {
        DOM.loadTxt.textContent = d.bakZipLoading || "Menyiapkan ZIP...";
    }
    if (DOM.loadBar) {
        DOM.loadBar.style.width = '0%';
    }
    if (DOM.loadPct) {
        DOM.loadPct.textContent = '0%';
    }
    
    try {
        if (typeof JSZip === 'undefined') {
            throw new Error("JSZip library not found.");
        }
        
        const zip = new JSZip();
        
        // 1. Save index JSON
        zip.file("library_index.json", JSON.stringify(library));
        
        // 2. Save book contents and covers
        let processed = 0;
        const total = library.length * 2; // (content + cover) * books
        
        for (let book of library) {
            const content = await localforage.getItem('content_' + book.id);
            if (content) {
                zip.file(`content_${book.id}.json`, JSON.stringify(content));
            }
            
            processed++;
            
            if (DOM.loadBar) {
                DOM.loadBar.style.width = `${Math.round((processed/total)*100)}%`;
            }
            if (DOM.loadPct) {
                DOM.loadPct.textContent = `${Math.round((processed/total)*100)}%`;
            }

            // Kalau pdf canvas mode, usahakan backup raw file
            if (book.type === 'pdf' && book.pdfMode === 'canvas') {
                 const rawPdf = await localforage.getItem('rawpdf_' + book.id);
                 if (rawPdf) {
                     zip.file(`rawpdf_${book.id}.pdf`, rawPdf);
                 }
            }

            const cover = await localforage.getItem('cover_' + book.id);
            if (cover) {
                zip.file(`cover_${book.id}.txt`, cover); // B64 as txt
            }
            
            processed++;
            
            if (DOM.loadBar) {
                DOM.loadBar.style.width = `${Math.round((processed/total)*100)}%`;
            }
            if (DOM.loadPct) {
                DOM.loadPct.textContent = `${Math.round((processed/total)*100)}%`;
            }
        }
        
        if (DOM.loadTxt) {
            DOM.loadTxt.textContent = d.zipProcess || "Mengompres ZIP...";
        }
        
        const zipBlob = await zip.generateAsync({type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }});
        
        // Coba save pake Capacitor
        if (window.Capacitor && window.Capacitor.Plugins.Filesystem) {
            try {
                const reader = new FileReader();
                reader.readAsDataURL(zipBlob);
                reader.onloadend = async function() {
                    const base64data = reader.result.split(',')[1];
                    const date = new Date().toISOString().slice(0,10);
                    const fileName = `baca_full_backup_${date}.zip`;
                    
                    await window.Capacitor.Plugins.Filesystem.writeFile({
                        path: fileName,
                        data: base64data,
                        directory: 'DOCUMENTS'
                    });
                    
                    DOM.load.classList.add('hidden');
                    showDialog(
                        "Sukses", 
                        `Backup ZIP tersimpan di folder Documents dengan nama ${fileName}`, 
                        "check-circle", 
                        [{text: "Oke", primary: true, action: closeDialog}]
                    );
                };
                return;
            } catch(e) { 
                console.error("Zip save error", e); 
            }
        }
        
        // Fallback Web
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `baca_full_backup_${new Date().toISOString().slice(0,10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        DOM.load.classList.add('hidden');
        showDialog(
            "Sukses", 
            d.bakSuccessZip || "File ZIP berhasil disusun.", 
            "check-circle", 
            [{text: "Oke", primary: true, action: closeDialog}]
        );

    } catch(err) {
        DOM.load.classList.add('hidden');
        showDialog("Error", "Gagal memproses ZIP: " + err.message, "alert-triangle", [{text: "Tutup", primary: true, action: closeDialog}]);
    }
};

document.getElementById('restore-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.name.endsWith('.zip')) {
        await handleZipRestore(file);
    } else {
        const text = await file.text();
        document.getElementById('raw-restore-input').value = text;
        processRawRestore();
    }
    
    e.target.value = '';
});

async function handleZipRestore(file) {
    const d = i18n[wikiLang] || i18n['id'];
    DOM.load.classList.remove('hidden');
    
    if (DOM.loadTxt) {
        DOM.loadTxt.textContent = d.zipExtract || "Membaca file ZIP...";
    }
    if (DOM.loadBar) {
        DOM.loadBar.style.width = '10%';
    }
    
    try {
        if (typeof JSZip === 'undefined') {
            throw new Error("JSZip library not found.");
        }
        
        const zip = await JSZip.loadAsync(file);
        
        const indexFile = zip.file("library_index.json");
        if (!indexFile) {
            throw new Error("File index (library_index.json) tidak ditemukan di dalam ZIP.");
        }
        
        const indexData = await indexFile.async("string");
        const importedLibrary = JSON.parse(indexData);
        
        DOM.load.classList.add('hidden');
        
        const confirmText = (d.zipRestoreConfirm || "Ada {n} buku lengkap di file ZIP ini. Pulihkan?").replace('{n}', importedLibrary.length);
        
        showDialog("Pulihkan ZIP", confirmText, "upload", [
            { 
                text: d.cancel || "Batal", 
                primary: false, 
                action: closeDialog 
            },
            { 
                text: "Pulihkan", 
                primary: true, 
                action: async () => {
                    closeDialog();
                    DOM.load.classList.remove('hidden');
                    if (DOM.loadTxt) {
                        DOM.loadTxt.textContent = d.zipExtractWait || "Memulihkan data...";
                    }
                    
                    let processed = 0;
                    const total = importedLibrary.length;
                    
                    for (let book of importedLibrary) {
                        const contentFile = zip.file(`content_${book.id}.json`);
                        if (contentFile) {
                            const contentStr = await contentFile.async("string");
                            await localforage.setItem(`content_${book.id}`, JSON.parse(contentStr));
                        }

                        const rawPdfFile = zip.file(`rawpdf_${book.id}.pdf`);
                        if (rawPdfFile) {
                             const pdfBlob = await rawPdfFile.async("blob");
                             await localforage.setItem(`rawpdf_${book.id}`, pdfBlob);
                        }
                        
                        const coverFile = zip.file(`cover_${book.id}.txt`);
                        if (coverFile) {
                            const coverStr = await coverFile.async("string");
                            await localforage.setItem(`cover_${book.id}`, coverStr);
                        }
                        
                        const existIdx = library.findIndex(b => b.id === book.id);
                        if (existIdx === -1) {
                            library.push(book);
                        } else {
                            library[existIdx] = book;
                        }
                        
                        processed++;
                        if (DOM.loadBar) {
                            DOM.loadBar.style.width = `${Math.round((processed/total)*100)}%`;
                        }
                        if (DOM.loadPct) {
                            DOM.loadPct.textContent = `${Math.round((processed/total)*100)}%`;
                        }
                    }
                    
                    await localforage.setItem('pdf_epub_master', library);
                    DOM.load.classList.add('hidden');
                    renderLibrary();
                    showDialog("Sukses", "Data dari ZIP berhasil dipulihkan 100%.", "check-circle", [{text: "Oke", primary: true, action: closeDialog}]);
                }
            }
        ]);
        
    } catch(err) {
        DOM.load.classList.add('hidden');
        showDialog("Error", "Gagal memulihkan ZIP: " + err.message, "alert-triangle", [{text: "Tutup", primary: true, action: closeDialog}]);
    }
}

window.openRawBackupModal = function() {
    const modal = document.getElementById('raw-backup-modal');
    pushAppHistory('raw-backup-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('raw-backup-sheet').classList.remove('translate-y-full');
    });
};

window.closeRawBackupModal = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    const m = document.getElementById('raw-backup-modal');
    const s = document.getElementById('raw-backup-sheet');
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
};

window.copyRawBackup = function() {
    const ta = document.getElementById('raw-backup-data');
    ta.select();
    document.execCommand('copy');
    showDialog("Sukses", "Data backup disalin ke clipboard.", "check", [{text: "Oke", primary: true, action: closeDialog}]);
};

window.openRawRestoreModal = function() {
    const modal = document.getElementById('raw-restore-modal');
    pushAppHistory('raw-restore-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('raw-restore-sheet').classList.remove('translate-y-full');
    });
};

window.closeRawRestoreModal = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    const m = document.getElementById('raw-restore-modal');
    const s = document.getElementById('raw-restore-sheet');
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
};

window.processRawRestore = function() {
    const text = document.getElementById('raw-restore-input').value.trim();
    if (!text) return;
    
    try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
            throw new Error("Format tidak valid");
        }
        
        parsed.forEach(importedBook => {
            const existIdx = library.findIndex(b => b.id === importedBook.id);
            if (existIdx > -1) {
                library[existIdx].progressPct = importedBook.progressPct;
                library[existIdx].lastReadId = importedBook.lastReadId;
                if (importedBook.annotations) {
                    library[existIdx].annotations = importedBook.annotations;
                }
            } else {
                library.push(importedBook);
            }
        });
        
        localforage.setItem('pdf_epub_master', library);
        renderLibrary();
        closeRawRestoreModal();
        showDialog("Sukses", "Data Json berhasil dipulihkan.", "check-circle", [{text: "Oke", primary: true, action: closeDialog}]);
    } catch(err) {
        showDialog("Error", "Teks JSON tidak valid.", "alert-triangle", [{text: "Tutup", primary: true, action: closeDialog}]);
    }
};

window.clearAllCovers = function() {
    const d = i18n[wikiLang] || i18n['id'];
    showDialog(
        d.clearCoversTitle || "Hapus Semua Sampul?", 
        d.clearCoversDesc || "Semua gambar sampul akan dihapus permanen untuk menghemat memori. Lanjutkan?", 
        "image-off", 
        [
            { 
                text: d.cancel || "Batal", 
                primary: false, 
                action: closeDialog 
            },
            { 
                text: "Hapus", 
                primary: true, 
                action: async () => {
                    closeDialog();
                    DOM.load.classList.remove('hidden');
                    if (DOM.loadTxt) {
                        DOM.loadTxt.textContent = "Menghapus sampul...";
                    }
                    
                    for (const book of library) {
                        await localforage.removeItem('cover_' + book.id);
                    }
                    
                    DOM.load.classList.add('hidden');
                    renderLibrary();
                    showDialog("Sukses", d.clearCoversSuccess || "Semua sampul berhasil dihapus!", "check-circle", [{text: "Oke", primary: true, action: closeDialog}]);
                }
            }
        ]
    );
};

// 7d. BOOKMARKS PANEL RENDERING
window.renderBookmarksPanel = function() {
    const d = i18n[wikiLang] || i18n['id'];
    const pnl = document.getElementById('bookmark-panel-content');
    if (!pnl) return;

    let html = `
        <div class="px-6 py-4 border-b border-m3-surfaceVariant flex justify-between items-center">
            <h2 class="text-xl font-bold font-playfair text-m3-primary">
                ${d.bookmarkTitle || 'Panel Bookmark'}
            </h2>
            <button onclick="closePanel()" class="p-2 rounded-full hover:bg-m3-surfaceVariant text-m3-onSurface">
                <i data-lucide="x" class="w-5 h-5"></i>
            </button>
        </div>
        <div class="p-6 pb-24 overflow-y-auto">
    `;

    let hasBookmarks = false;
    
    library.forEach(book => {
        if (book.annotations && book.annotations.length > 0) {
            hasBookmarks = true;
            html += `
                <div class="mb-6">
                    <div class="text-xs font-bold text-m3-onSurface opacity-60 uppercase tracking-widest mb-3 line-clamp-1 border-b border-m3-surfaceVariant pb-1">
                        ${book.title}
                    </div>
                    <div class="flex flex-col gap-3">
            `;
            
            book.annotations.forEach(annot => {
                const titleStr = annot.title ? `<div class="font-bold text-sm text-m3-onSurface mb-1">${annot.title}</div>` : '';
                const noteStr = annot.note ? `<div class="text-xs text-m3-onSurfaceVariant mt-2 bg-m3-surface p-2 rounded">${annot.note}</div>` : '';
                
                html += `
                    <div class="bg-m3-surfaceVariant p-3 rounded-xl border-l-4 border-hl-${annot.color} cursor-pointer active:scale-95 transition-transform" onclick="openBookAndJump('${book.id}', '${annot.id}')">
                        ${titleStr}
                        <div class="text-xs text-m3-onSurface italic opacity-80 line-clamp-3">
                            "${annot.text}"
                        </div>
                        ${noteStr}
                    </div>
                `;
            });
            html += `</div></div>`;
        }
    });

    if (!hasBookmarks) {
        html += `
            <div class="text-center text-m3-onSurfaceVariant opacity-50 mt-10 text-sm font-medium">
                ${d.bookmarkEmpty || 'Belum ada pembatas buku.'}
            </div>
        `;
    }

    html += `</div>`;
    pnl.innerHTML = html;
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

window.openBookAndJump = function(bookId, annotId) {
    closePanel();
    const book = library.find(b => b.id === bookId);
    if (book && book.annotations) {
        const annot = book.annotations.find(a => a.id === annotId);
        if (annot && annot.nodeIdx > -1) {
            book.lastReadId = `node-${annot.nodeIdx}`;
            localforage.setItem('pdf_epub_master', library);
        }
    }
    openBook(bookId);
};

window.saveApiKey = function() {
    const val = document.getElementById('api-key-input').value.trim();
    localStorage.setItem('gemini_api_key', val);
    const d = i18n[wikiLang] || i18n['id'];
    showDialog("Sukses", d.keySaved || "API Key berhasil disimpan.", "check-circle", [{text: "Oke", primary: true, action: closeDialog}]);
};

window.checkUpdate = function() {
    const d = i18n[wikiLang] || i18n['id'];
    DOM.load.classList.remove('hidden');
    
    if (DOM.loadTxt) {
        DOM.loadTxt.textContent = d.updateChecking || "Mengecek versi...";
    }
    
    fetch(window.UPDATE_URL + "?t=" + Date.now())
        .then(res => res.json())
        .then(data => {
            DOM.load.classList.add('hidden');
            const currentVer = window.APP_VERSION;
            const remoteVer = data.version;
            
            if (remoteVer !== currentVer) {
                showDialog(
                    d.updateAvailableTitle || "Update Tersedia!", 
                    (d.updateAvailableDesc || "Versi terbaru rilis.") + `<br><br><b>v${currentVer}</b> ➔ <b class="text-m3-primary">v${remoteVer}</b>`, 
                    "arrow-up-circle", 
                    [
                        {
                            text: d.btnClose || "Tutup", 
                            primary: false, 
                            action: closeDialog
                        },
                        {
                            text: d.btnDownload || "Download", 
                            primary: true, 
                            action: () => { 
                                window.open(window.RELEASES_URL, '_blank'); 
                                closeDialog(); 
                            }
                        }
                    ]
                );
            } else {
                showDialog(
                    d.updateLatestTitle || "Sudah Versi Terbaru", 
                    d.updateLatestDesc || "Aplikasi sudah up to date.", 
                    "check-circle", 
                    [{text: "Oke", primary: true, action: closeDialog}]
                );
            }
        })
        .catch(err => {
            DOM.load.classList.add('hidden');
            showDialog("Error", d.updateError || "Gagal ngecek update. Cek internet.", "alert-triangle", [{text: "Tutup", primary: true, action: closeDialog}]);
        });
};

// 8. DIALOG & NAVIGATION UTILS
window.showDialog = function(title, desc, icon, buttons) {
    const m = document.getElementById('custom-dialog');
    const s = document.getElementById('custom-dialog-sheet');
    document.getElementById('cd-title').textContent = title;
    document.getElementById('cd-desc').innerHTML = desc;
    document.getElementById('cd-icon').innerHTML = `<i data-lucide="${icon}" class="w-6 h-6 text-m3-primary"></i>`;
    
    const btnContainer = document.getElementById('cd-buttons');
    btnContainer.innerHTML = '';
    
    buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = `flex-1 py-3 rounded-xl font-bold text-sm transition-transform active:scale-95 ${b.primary ? 'bg-m3-primary text-m3-onPrimary' : 'bg-m3-surfaceVariant text-m3-onSurface'}`;
        btn.textContent = b.text;
        btn.onclick = b.action;
        btnContainer.appendChild(btn);
    });
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    pushAppHistory('custom-dialog');
    m.classList.remove('hidden');
    requestAnimationFrame(() => {
        m.classList.remove('opacity-0');
        s.classList.remove('translate-y-full');
    });
};

window.closeDialog = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    const m = document.getElementById('custom-dialog');
    const s = document.getElementById('custom-dialog-sheet');
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
};

window.closeReader = function() {
    activeBookId = null;
    currentPdfDoc = null;
    
    if (observer) {
        observer.disconnect();
    }
    
    DOM.readView.classList.add('hidden');
    DOM.libView.classList.remove('hidden');
    document.getElementById('search-capsule').classList.remove('hidden');
    document.getElementById('reader-capsule').classList.add('hidden');
    DOM.searchRes.classList.add('hidden');
    DOM.searchIn.value = '';
    renderLibrary();
};

window.toggleSearch = function() {
    const r = document.getElementById('search-row');
    const c = document.getElementById('search-capsule');
    
    if (r.classList.contains('search-active')) {
        r.classList.remove('search-active');
        c.classList.remove('bg-m3-surfaceVariant');
        DOM.searchIn.value = '';
        DOM.searchRes.classList.add('hidden');
        if (typeof clearSearchHighlights === 'function') {
            clearSearchHighlights();
        }
    } else {
        r.classList.add('search-active');
        c.classList.add('bg-m3-surfaceVariant');
        DOM.searchIn.focus();
    }
};

window.openPanel = function(id) {
    const d = i18n[wikiLang] || i18n['id'];
    const p = document.getElementById(`${id}-panel`);
    activePanel = id;
    
    if (id === 'settings') {
        renderSettings();
    }
    if (id === 'bookmark') {
        renderBookmarksPanel();
    }
    
    pushAppHistory(`${id}-panel`);
    p.classList.remove('hidden');
    requestAnimationFrame(() => {
        p.classList.remove('opacity-0');
        p.querySelector('.side-panel').classList.remove('translate-x-full');
    });
};

window.closePanel = function(isFromHistory = false) {
    if (!activePanel) return;
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    
    const p = document.getElementById(`${activePanel}-panel`);
    const s = p.querySelector('.side-panel');
    s.classList.add('translate-x-full');
    p.classList.add('opacity-0');
    setTimeout(() => { 
        p.classList.add('hidden'); 
        activePanel = null; 
    }, 300);
};

// 9. APP STATISTICS
function updateAppStats() {
    const d = i18n[wikiLang] || i18n['id'];
    const sc = document.getElementById('stat-cards');
    if (!sc) return;
    
    const total = library.length;
    let reading = 0;
    let completed = 0;
    let notes = 0;
    
    library.forEach(b => {
        if (b.progressPct > 0 && b.progressPct < 100) reading++;
        if (b.progressPct === 100) completed++;
        if (b.annotations) notes += b.annotations.length;
    });
    
    sc.innerHTML = `
        <div class="bg-m3-surfaceVariant rounded-2xl p-4 flex flex-col items-center justify-center text-center">
            <i data-lucide="library" class="w-6 h-6 text-m3-primary mb-2 opacity-80"></i>
            <div class="text-2xl font-bold text-m3-onSurface">${total}</div>
            <div class="text-[10px] uppercase tracking-wider font-bold text-m3-onSurfaceVariant opacity-70">${d.statTotal || "Koleksi"}</div>
        </div>
        <div class="bg-m3-surfaceVariant rounded-2xl p-4 flex flex-col items-center justify-center text-center">
            <i data-lucide="book-open" class="w-6 h-6 text-blue-500 mb-2 opacity-80"></i>
            <div class="text-2xl font-bold text-m3-onSurface">${reading}</div>
            <div class="text-[10px] uppercase tracking-wider font-bold text-m3-onSurfaceVariant opacity-70">${d.statReading || "Dibaca"}</div>
        </div>
        <div class="bg-m3-surfaceVariant rounded-2xl p-4 flex flex-col items-center justify-center text-center">
            <i data-lucide="check-circle" class="w-6 h-6 text-green-500 mb-2 opacity-80"></i>
            <div class="text-2xl font-bold text-m3-onSurface">${completed}</div>
            <div class="text-[10px] uppercase tracking-wider font-bold text-m3-onSurfaceVariant opacity-70">${d.statCompleted || "Selesai"}</div>
        </div>
        <div class="bg-m3-surfaceVariant rounded-2xl p-4 flex flex-col items-center justify-center text-center">
            <i data-lucide="edit-3" class="w-6 h-6 text-pink-500 mb-2 opacity-80"></i>
            <div class="text-2xl font-bold text-m3-onSurface">${notes}</div>
            <div class="text-[10px] uppercase tracking-wider font-bold text-m3-onSurfaceVariant opacity-70">${d.statNotes || "Catatan"}</div>
        </div>
    `;
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// 10. WELCOME MODAL LOGIC
window.openWelcomeModal = function() {
    const modal = document.getElementById('welcome-modal');
    pushAppHistory('welcome-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('welcome-sheet').classList.remove('translate-y-full');
    });
};

window.closeWelcomeModal = function(isFromHistory = false) {
    if (!isFromHistory) { 
        history.back(); 
        return; 
    }
    const m = document.getElementById('welcome-modal');
    const s = document.getElementById('welcome-sheet');
    s.classList.add('translate-y-full');
    m.classList.add('opacity-0');
    setTimeout(() => {
        m.classList.add('hidden');
    }, 300);
    localStorage.setItem('welcome_seen', 'true');
};

// 11. HW BACK BUTTON / SWIPE DISMISS ROUTING TINGKAT DEWA
const appHistory = [];
function pushAppHistory(id) {
    appHistory.push(id);
    window.history.pushState({ modalId: id }, "");
}

window.addEventListener('popstate', (e) => {
    if (appHistory.length > 0) {
        const lastId = appHistory.pop();
        if (lastId === 'welcome-modal') closeWelcomeModal(true);
        else if (lastId === 'custom-dialog') closeDialog(true);
        else if (lastId === 'b-opt-modal') closeOptsModal(true);
        else if (lastId === 'edit-modal') closeEditModal(true);
        else if (lastId === 'bookmark-sheet-modal') closeNoteModal(true);
        else if (lastId === 'ai-modal') closeAiModal(true);
        else if (lastId === 'raw-backup-modal') closeRawBackupModal(true);
        else if (lastId === 'raw-restore-modal') closeRawRestoreModal(true);
        else if (lastId === 'bak-opt-modal') closeBackupModal(true);
        else if (lastId.endsWith('-panel')) { 
            activePanel = lastId.replace('-panel',''); 
            closePanel(true); 
        }
    } else if (!DOM.readView.classList.contains('hidden')) {
        closeReader();
        window.history.pushState({ view: 'library' }, "");
    }
});

function setupGestureModals() {
    const swipeables = [
        { outer: 'welcome-modal', inner: 'welcome-sheet', closeFn: closeWelcomeModal },
        { outer: 'custom-dialog', inner: 'custom-dialog-sheet', closeFn: closeDialog },
        { outer: 'b-opt-modal', inner: 'b-opt-sheet', closeFn: closeOptsModal },
        { outer: 'edit-modal', inner: 'edit-sheet', closeFn: closeEditModal },
        { outer: 'bookmark-sheet-modal', inner: 'bookmark-sheet', closeFn: closeNoteModal },
        { outer: 'ai-modal', inner: 'ai-sheet', closeFn: closeAiModal },
        { outer: 'raw-backup-modal', inner: 'raw-backup-sheet', closeFn: closeRawBackupModal },
        { outer: 'raw-restore-modal', inner: 'raw-restore-sheet', closeFn: closeRawRestoreModal },
        { outer: 'bak-opt-modal', inner: 'bak-opt-sheet', closeFn: closeBackupModal }
    ];

    swipeables.forEach(s => {
        const sheet = document.getElementById(s.inner);
        if (!sheet) return;
        
        let startY = 0;
        let currentY = 0;
        
        sheet.addEventListener('touchstart', (e) => {
            if (sheet.scrollTop > 0) return;
            startY = e.touches[0].clientY;
            sheet.style.transition = 'none';
        }, {passive: true});

        sheet.addEventListener('touchmove', (e) => {
            if (sheet.scrollTop > 0) return;
            currentY = e.touches[0].clientY - startY;
            if (currentY > 0) {
                sheet.style.transform = `translateY(${currentY}px)`;
            }
        }, {passive: true});

        sheet.addEventListener('touchend', (e) => {
            sheet.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
            if (currentY > 150) { 
                s.closeFn(false); 
            } else { 
                sheet.style.transform = '';
            }
        });
    });

    const panels = ['settings-panel', 'toc-panel', 'bookmark-panel'];
    panels.forEach(id => {
        const p = document.getElementById(id);
        if (!p) return;
        
        const panel = p.querySelector('.side-panel');
        let startX = 0;
        let currentX = 0;

        panel.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            panel.style.transition = 'none';
        }, {passive: true});

        panel.addEventListener('touchmove', (e) => {
            currentX = e.touches[0].clientX - startX;
            if (currentX > 0) {
                panel.style.transform = `translateX(${currentX}px)`;
            }
        }, {passive: true});

        panel.addEventListener('touchend', (e) => {
            panel.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
            if (currentX > 100) { 
                setTimeout(() => { 
                    history.back(); 
                    setTimeout(() => { 
                        panel.style.transform = ''; 
                    }, 100); 
                }, 100);
            } else { 
                panel.style.transform = 'translateX(0)';
            }
        });
    });
}

// 12. PWA & CAPACITOR SETUP (100% UTUH)
if ('serviceWorker' in navigator) {
    const swCode = `
    const CACHE_NAME = 'baca-pwa-v6';
    self.addEventListener('install', (e) => {
        self.skipWaiting();
        e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll([
            '/', 'libs/tailwindcss.js', 'libs/pdf.min.js', 'libs/pdf.worker.min.js', 'libs/localforage.min.js', 'libs/jszip.min.js', 'libs/lucide.js',
            'css/style.css', 'js/config.js', 'js/reader.js', 'js/app.js'
       ])));
    });
    self.addEventListener('fetch', (e) => { 
        e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); 
    });
    `;
    
    const blob = new Blob([swCode], {type: 'application/javascript'});
    navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(err => console.log("SW Error:", err));
}

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if (window.Capacitor && window.Capacitor.Plugins) {
            const capApp = window.Capacitor.Plugins.App;
            if (capApp) {
                capApp.addListener('backButton', ({canGoBack}) => {
                    if (appHistory.length > 0) {
                        history.back();
                    } else if (!DOM.readView.classList.contains('hidden')) { 
                        closeReader(); 
                        history.pushState({view:'library'},""); 
                    } else {
                        capApp.exitApp();
                    }
                });
            }
        }
    }, 1000);
});

