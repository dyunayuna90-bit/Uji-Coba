```javascript
// --- APP LOGIC ---
// Mengurus interaksi UI, Tema, Render Library, & Fitur In-Book Bookmark Berwarna

// 1. GLOBAL STATE & DOM REFERENCES
let library = []; 
let activeBookId = null; 
let observer = null; 
let activePanel = null;
let activeOptsId = null; 
let currentSelection = { text: "", nodeIdx: -1, startOff: 0, endOff: 0 }; 
let isBatchDeleteMode = false;
let selectedForDelete = [];
let activeNoteColor = 'yellow';
let editingAnnotId = null;

let isDark = localStorage.getItem('theme') !== 'light'; 
let currentThemeKey = localStorage.getItem('m3-key') || 'orchid';
let isAmoled = localStorage.getItem('amoled') === 'true';
let wikiLang = localStorage.getItem('wiki_lang') || 'en';

// === TAMBAHAN STATE PDF ===
let pdfDocNative = null; // Nyimpen referensi doc PDF.js asli kalo lagi mode canvas
let isOriginalViewActive = false; // Mode horizontal on/off

const DOM = {};

document.addEventListener("DOMContentLoaded", () => {
    // Inisialisasi DOM Elements
    Object.assign(DOM, {
        libView: document.getElementById('library-view'), 
        readView: document.getElementById('reader-view'),
        mainHeader: document.getElementById('main-header'),
        grid: document.getElementById('book-grid'), 
        empty: document.getElementById('empty-state'),
        topSection: document.getElementById('continue-reading-section'), 
        topSlider: document.getElementById('top-books-slider'),
        load: document.getElementById('loading-state'), 
        loadTxt: document.getElementById('loading-text'), 
        loadBar: document.getElementById('loading-bar'), 
        loadPct: document.getElementById('loading-percent'),
        inner: document.getElementById('reader-inner'),
        content: document.getElementById('reader-content'),
        
        // Elemen Canvas
        pdfContainer: document.getElementById('pdf-render-container'),
        pdfSettingRow: document.getElementById('pdf-original-view-setting'),
        typoSettingRow: document.getElementById('text-typography-settings'),
        pdfSwitchKnob: document.getElementById('pdf-view-switch-knob'),
        pdfSwitchBg: document.getElementById('pdf-view-switch-bg'),

        progText: document.getElementById('reader-progress-text'),
        progBar: document.getElementById('reading-progress-bar'),
        title: document.getElementById('reader-title'),
        selMenu: document.getElementById('selection-menu'),
        
        tocPanel: document.getElementById('toc-panel'), 
        tocList: document.getElementById('toc-list'),
        bookmarkPanel: document.getElementById('bookmark-panel'), 
        bookmarkList: document.getElementById('bookmark-list'),
        settingsPanel: document.getElementById('settings-panel'),
        sideOverlay: document.getElementById('side-panel-overlay'),
        
        pinnedSection: document.getElementById('pinned-books-section'),
        pinnedGrid: document.getElementById('pinned-book-grid'),
        colHeading: document.getElementById('collection-heading'),
        statSect: document.getElementById('statistics-section'),
        btnBatchCancel: document.getElementById('btn-batch-cancel'),
        btnBatchExec: document.getElementById('btn-batch-exec'),
    });

    applyTheme(currentThemeKey); 
    updateThemeState();
    updateTrilingualUI();

    localforage.getItem('pdf_epub_master').then(val => { 
        if (val) library = val; 
        renderLibrary(); 
    });

    // Handle Selection untuk AI / Copy / Highlight
    DOM.content.addEventListener('pointerup', handleSelection);
    DOM.pdfContainer.addEventListener('pointerup', handleSelection); // Support layer canvas

    // Observer Pindah Halaman/Bab (Buat Teks Vertikal)
    observer = new IntersectionObserver(es => {
        es.forEach(e => {
            if (e.isIntersecting && !isOriginalViewActive) {
                const b = library.find(x => x.id === activeBookId);
                if (b) { 
                    b.lastReadId = e.target.id; 
                    updateProgress(); 
                    saveLib(); 
                }
            }
        });
    }, { root: DOM.content, rootMargin: '0px', threshold: 0.1 });

    // Observer Pindah Halaman buat PDF Horizontal
    DOM.pdfContainer.addEventListener('scroll', () => {
        if (!isOriginalViewActive) return;
        const width = DOM.pdfContainer.clientWidth;
        if (width <= 0) return;
        const scrollX = DOM.pdfContainer.scrollLeft;
        
        // Cari halaman paling tengah
        const currentPageIndex = Math.round(scrollX / width);
        const b = library.find(x => x.id === activeBookId);
        
        if (b && b.pages > 0) {
            b.progressPct = Math.round(((currentPageIndex + 1) / b.pages) * 100);
            b.lastReadId = `pdf-page-${currentPageIndex + 1}`; // Simpan halaman terakhir
            updateProgress();
            saveLib();
        }
    });

    document.addEventListener('selectionchange', () => {
        if (!window.getSelection().toString().trim()) {
            hideSelectionMenu();
        }
    });

    // PWA Back Button Support
    window.addEventListener('popstate', (e) => {
        if (activePanel) closePanel();
        else if (DOM.selMenu && !DOM.selMenu.classList.contains('hidden')) hideSelectionMenu();
        else if (!document.getElementById('welcome-modal').classList.contains('hidden')) closeWelcome();
        else if (!document.getElementById('b-opt-modal').classList.contains('hidden')) _closeModalAction('b-opt-modal', 'b-opt-sheet');
        else if (!document.getElementById('edit-modal').classList.contains('hidden')) closeEditModal();
        else if (!document.getElementById('bookmark-modal').classList.contains('hidden')) _closeModalAction('bookmark-modal', 'bookmark-sheet');
        else if (!document.getElementById('ai-modal').classList.contains('hidden')) window.closeAiModal(true);
        else if (!document.getElementById('global-settings-modal').classList.contains('hidden')) _closeModalAction('global-settings-modal', 'global-settings-sheet');
        else if (!document.getElementById('raw-backup-modal').classList.contains('hidden')) _closeModalAction('raw-backup-modal', 'raw-backup-sheet');
        else if (!document.getElementById('raw-restore-modal').classList.contains('hidden')) _closeModalAction('raw-restore-modal', 'raw-restore-sheet');
        else if (!document.getElementById('custom-dialog').classList.contains('hidden')) _closeModalAction('custom-dialog', 'custom-dialog-sheet');
        else if (!DOM.readView.classList.contains('translate-y-full')) closeBook();
    });

    const initTheme = localStorage.getItem('theme');
    if(!initTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setReaderTheme('dark');
    } else if(initTheme) {
        setReaderTheme(initTheme);
    }

    if (window.lucide) window.lucide.createIcons();

    if (!localStorage.getItem('welcomed_v2')) {
        setTimeout(() => openModal('welcome-modal', 'welcome-sheet'), 800);
    }
});

// === LOGIKA BARU: RENDER PDF NATIVE ===
window.togglePdfOriginalView = async function() {
    const b = library.find(x => x.id === activeBookId);
    if (!b || b.type !== 'pdf') return;

    if (b.isImageOnly) {
        // PDF Gambar = Ga boleh dimatiin view aslinya
        return;
    }

    isOriginalViewActive = !isOriginalViewActive;
    applyPdfViewUIState();
    
    if (isOriginalViewActive) {
        await initPdfNativeRender();
    } else {
        DOM.pdfContainer.classList.add('hidden');
        DOM.content.classList.remove('hidden');
        DOM.pdfContainer.innerHTML = ''; // Bersihkan memory canvas
        
        // Restore progress posisi vertikal
        requestAnimationFrame(() => {
            if (b.lastReadId) {
                const el = document.getElementById(b.lastReadId);
                if (el) el.scrollIntoView();
            }
        });
    }
}

function applyPdfViewUIState() {
    if (isOriginalViewActive) {
        DOM.pdfSwitchKnob.classList.add('translate-x-6');
        DOM.pdfSwitchBg.classList.add('bg-m3-primary');
        DOM.pdfSwitchBg.classList.remove('bg-m3-onSurfaceVariant/20');
        // Kunci setting typography (size, align, dll karena PDF canvas fixed)
        DOM.typoSettingRow.classList.add('opacity-30', 'pointer-events-none');
    } else {
        DOM.pdfSwitchKnob.classList.remove('translate-x-6');
        DOM.pdfSwitchBg.classList.remove('bg-m3-primary');
        DOM.pdfSwitchBg.classList.add('bg-m3-onSurfaceVariant/20');
        // Buka lagi setting typography
        DOM.typoSettingRow.classList.remove('opacity-30', 'pointer-events-none');
    }
}

async function initPdfNativeRender() {
    DOM.content.classList.add('hidden');
    DOM.pdfContainer.classList.remove('hidden');
    DOM.pdfContainer.innerHTML = '<div class="w-full flex items-center justify-center p-10"><div class="w-8 h-8 border-4 border-m3-primary border-t-transparent rounded-full animate-spin"></div></div>';

    const b = library.find(x => x.id === activeBookId);
    if (!b) return;

    try {
        const rawBuffer = await localforage.getItem(`pdf_raw_${b.id}`);
        if (!rawBuffer) throw new Error("Raw PDF tidak ditemukan, harap import ulang file PDF.");

        pdfDocNative = await pdfjsLib.getDocument({ data: rawBuffer }).promise;
        DOM.pdfContainer.innerHTML = ''; // Clear loading

        // Setup IntersectionObserver biar canvas cuma di-render kalo diliat layar (Lazy Load Memory)
        const canvasObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const pageNum = parseInt(entry.target.dataset.page);
                    if (!entry.target.dataset.rendered) {
                        renderPdfPage(pageNum, entry.target);
                    }
                }
            });
        }, { root: DOM.pdfContainer, rootMargin: '100% 0px' }); // Render +- 1 hal sekeliling

        for (let i = 1; i <= pdfDocNative.numPages; i++) {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'pdf-page-wrapper';
            pageDiv.dataset.page = i;
            pageDiv.id = `pdf-page-${i}`;
            
            // Bikin struktur kerangka kosong dulu
            pageDiv.innerHTML = `
                <div class="relative max-w-full h-auto">
                    <canvas class="pdf-canvas" id="canvas-p${i}"></canvas>
                    <div class="textLayer" id="txt-layer-p${i}"></div>
                </div>
            `;
            DOM.pdfContainer.appendChild(pageDiv);
            canvasObserver.observe(pageDiv);
        }

        // Lompat ke halaman terakhir yg dibaca
        setTimeout(() => {
            let targetPage = 1;
            if (b.lastReadId && b.lastReadId.startsWith('pdf-page-')) {
                targetPage = parseInt(b.lastReadId.replace('pdf-page-', ''));
            } else if (b.progressPct > 0) {
                targetPage = Math.max(1, Math.round((b.progressPct / 100) * b.pages));
            }
            
            const targetDiv = document.getElementById(`pdf-page-${targetPage}`);
            if (targetDiv) {
                DOM.pdfContainer.scrollLeft = targetDiv.offsetLeft;
            }
        }, 150);

    } catch (e) {
        console.error(e);
        DOM.pdfContainer.innerHTML = `<div class="p-5 text-center text-red-500 font-bold">${e.message}</div>`;
    }
}

async function renderPdfPage(pageNum, containerEl) {
    if (!pdfDocNative) return;
    
    containerEl.dataset.rendered = "true";
    const canvas = containerEl.querySelector('canvas');
    const txtLayer = containerEl.querySelector('.textLayer');
    const wrapper = containerEl.querySelector('.relative');

    try {
        const page = await pdfDocNative.getPage(pageNum);
        
        // Kalkulasi ukuran canvas menyesuaikan lebar device
        const parentWidth = DOM.pdfContainer.clientWidth - 20; // - padding
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const scale = parentWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale: scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;

        const renderContext = {
            canvasContext: canvas.getContext('2d'),
            viewport: viewport
        };
        await page.render(renderContext).promise;

        // Bikin TextLayer transparan biar bisa diblok
        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: txtLayer,
            viewport: viewport,
            textDivs: []
        });

    } catch (e) {
        console.warn(`Gagal render page ${pageNum}`, e);
    }
}

function updateTrilingualUI() {
    const langs = ['id', 'en', 'es'];
    langs.forEach(l => {
        const el = document.getElementById(`wiki-lang-${l}`);
        if(el) {
            if(wikiLang === l) {
                el.classList.add('bg-m3-primary', 'text-m3-onPrimary');
                el.classList.remove('text-m3-onSurfaceVariant');
            } else {
                el.classList.remove('bg-m3-primary', 'text-m3-onPrimary');
                el.classList.add('text-m3-onSurfaceVariant');
            }
        }
    });

    const d = (typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {});
    
    const setTxt = (id, key) => { const el = document.getElementById(id); if(el && d[key]) el.textContent = d[key]; };
    
    setTxt('global-search', 'searchPlaceholder');
    const sb = document.getElementById('global-search'); if(sb && d.searchPlaceholder) sb.placeholder = d.searchPlaceholder;
    
    setTxt('str-stat-title', 'statTitle'); setTxt('str-stat-total', 'statTotal'); setTxt('str-stat-reading', 'statReading');
    setTxt('str-stat-completed', 'statCompleted'); setTxt('str-stat-notes', 'statNotes');
    
    setTxt('str-continue-reading', 'continueReading'); setTxt('str-pinned-books', 'pinnedBooks');
    setTxt('str-book-collection', 'bookCollection'); setTxt('str-lib-empty', 'libEmpty');
    setTxt('str-reader-loading', 'readerLoading'); setTxt('str-toc-title', 'tocTitle');
    setTxt('str-bookmark-title', 'bookmarkTitle'); setTxt('str-bookmark-empty', 'bookmarkEmpty');
    
    const bsi = document.getElementById('bookmark-search-input'); if(bsi && d.bookmarkSearch) bsi.placeholder = d.bookmarkSearch;
    
    setTxt('str-set-title', 'setTitle'); setTxt('str-set-search', 'setSearch'); setTxt('str-set-theme', 'setTheme');
    setTxt('str-set-size', 'setSize'); setTxt('str-set-align', 'setAlign'); setTxt('str-set-font', 'setFont');
    
    const isi = document.getElementById('inbook-search-input'); if(isi && d.searchPlaceholder) isi.placeholder = d.searchPlaceholder;
    
    setTxt('str-nav-back', 'navBack'); setTxt('str-nav-toc', 'navToc'); setTxt('str-nav-bookmark', 'navBookmark');
    setTxt('str-nav-text', 'navText'); setTxt('str-nav-full', 'navFull');
    
    setTxt('str-wel-title', 'welTitle'); setTxt('str-wel-desc', 'welDesc'); setTxt('str-wel-backup', 'welBackup');
    setTxt('str-wel-backup-desc', 'welBackupDesc'); setTxt('str-wel-format', 'welFormat'); setTxt('str-wel-format-desc', 'welFormatDesc');
    setTxt('str-wel-privacy', 'welPrivacy'); setTxt('str-wel-privacy-desc', 'welPrivacyDesc'); setTxt('str-wel-btn', 'welBtn');
    
    setTxt('str-set-main-title', 'setMainTitle'); setTxt('str-amoled-label', 'amoledLabel'); setTxt('str-set-palette', 'setPalette');
    setTxt('str-set-lang', 'setLang'); setTxt('str-set-ai-config', 'setAiConfig');
    
    const gapi = document.getElementById('gemini-api-key'); if(gapi && d.geminiPlaceholder) gapi.placeholder = d.geminiPlaceholder;
    setTxt('gemini-desc', 'geminiDesc');
    
    setTxt('str-set-data', 'setData'); setTxt('str-btn-backup', 'btnBackup'); setTxt('str-btn-restore', 'btnRestore');
    setTxt('str-set-info', 'setInfo'); setTxt('str-btn-info', 'btnInfo'); setTxt('str-btn-update', 'btnUpdate');
    setTxt('str-btn-donate', 'btnDonate'); setTxt('str-btn-close', 'btnClose');
    
    setTxt('str-raw-bak-title', 'rawBakTitle'); setTxt('str-raw-bak-desc', 'rawBakDesc');
    setTxt('str-raw-bak-btn-close', 'rawBakClose'); setTxt('str-raw-bak-btn-copy', 'rawBakCopy');
    
    setTxt('str-raw-res-title', 'rawResTitle'); setTxt('str-raw-res-desc', 'rawResDesc');
    setTxt('str-raw-res-btn-file', 'rawResFile'); setTxt('str-raw-res-btn-process', 'rawResProcess'); setTxt('str-raw-res-btn-close', 'rawResClose');
    
    setTxt('str-opt-pin', 'optPin'); setTxt('str-opt-select', 'optSelect'); setTxt('str-opt-edit', 'optEdit');
    setTxt('str-opt-delete', 'optDelete'); setTxt('str-opt-cancel', 'optCancel');
    
    setTxt('str-edit-title', 'editTitle'); setTxt('str-edit-book-title', 'editBookTitle'); setTxt('str-edit-book-cover', 'editBookCover');
    setTxt('str-edit-book-shape', 'editBookShape'); setTxt('str-edit-cancel', 'editCancel'); setTxt('str-edit-save', 'editSave');
    
    setTxt('shape-default', 'shapeDyn'); setTxt('shape-rounded', 'shapeRound'); setTxt('shape-square', 'shapeSquare');
    
    setTxt('str-bookmark-modal-title', 'bookmarkTitle'); setTxt('str-bookmark-cancel', 'editCancel'); setTxt('str-bookmark-save', 'editSave');
    const bit = document.getElementById('bookmark-input-title'); if(bit && d.bookmarkInputTitle) bit.placeholder = d.bookmarkInputTitle;
    const bitx = document.getElementById('bookmark-input-text'); if(bitx && d.bookmarkInputNote) bitx.placeholder = d.bookmarkInputNote;

    // Spesifik PDF Tampilan
    setTxt('str-set-original', 'originalView');
    setTxt('str-set-original-desc', 'originalViewDesc');
}

window.setWikiLang = function(langCode) {
    wikiLang = langCode;
    localStorage.setItem('wiki_lang', langCode);
    updateTrilingualUI();
    renderLibrary(); // Re-render untuk statistik yg terjemahannya ganti
}

// 2. TEMA WARNA, GELAP & TYPOGRAPHY
function applyTheme(key) {
    if (!window.tailwind || !window.tailwind.config) return;
    const t = window.tailwind.config.theme.extend.colors.m3;
    const dyn = document.getElementById('dynamic-theme');
    
    let kPrimary = key, kPrimaryCont = key, kBg = key, kSurf = key, kSurfVar = key;
    if (isDark) { kPrimary += '-dark'; kPrimaryCont += '-dark'; kBg += '-dark'; kSurf += '-dark'; kSurfVar += '-dark'; }
    if (isAmoled && isDark) { kBg = 'amoled-bg'; kSurf = 'amoled-surface'; }

    let css = ':root {\n';
    if(t.dynamic[kPrimary]) { css += `--md-sys-color-primary: ${t.dynamic[kPrimary]};\n`; css += `--md-sys-color-on-primary: ${t.dynamic[kPrimary+'-on']};\n`; }
    if(t.dynamic[kPrimaryCont]) { css += `--md-sys-color-primary-container: ${t.dynamic[kPrimaryCont]};\n`; css += `--md-sys-color-on-primary-container: ${t.dynamic[kPrimaryCont+'-on']};\n`; }
    if(t.dynamic[kBg]) { css += `--md-sys-color-background: ${t.dynamic[kBg]};\n`; css += `--md-sys-color-on-background: ${t.dynamic[kBg+'-on']};\n`; }
    if(t.dynamic[kSurf]) { css += `--md-sys-color-surface: ${t.dynamic[kSurf]};\n`; css += `--md-sys-color-on-surface: ${t.dynamic[kSurf+'-on']};\n`; }
    if(t.dynamic[kSurfVar]) { css += `--md-sys-color-surface-variant: ${t.dynamic[kSurfVar]};\n`; css += `--md-sys-color-on-surface-variant: ${t.dynamic[kSurfVar+'-on']};\n`; }
    css += '}'; dyn.innerHTML = css;

    updateThemeState();
}

window.setTheme = function(key) {
    currentThemeKey = key;
    localStorage.setItem('m3-key', key);
    applyTheme(key);
}

window.toggleThemeState = function() {
    isDark = !isDark;
    if(isDark) document.documentElement.classList.add('dark');
    else { document.documentElement.classList.remove('dark'); isAmoled = false; localStorage.setItem('amoled', 'false'); document.documentElement.classList.remove('amoled'); }
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    applyTheme(currentThemeKey);
}

window.toggleAmoled = function() {
    if(!isDark) return;
    isAmoled = !isAmoled;
    localStorage.setItem('amoled', isAmoled ? 'true' : 'false');
    if(isAmoled) document.documentElement.classList.add('amoled');
    else document.documentElement.classList.remove('amoled');
    applyTheme(currentThemeKey);
}

window.setReaderTheme = function(mode) {
    if(mode === 'light') { isDark = false; isAmoled = false; document.documentElement.classList.remove('dark', 'amoled'); localStorage.setItem('theme', 'light'); localStorage.setItem('amoled', 'false'); }
    else if(mode === 'dark') { isDark = true; isAmoled = false; document.documentElement.classList.add('dark'); document.documentElement.classList.remove('amoled'); localStorage.setItem('theme', 'dark'); localStorage.setItem('amoled', 'false'); }
    else if(mode === 'amoled') { isDark = true; isAmoled = true; document.documentElement.classList.add('dark', 'amoled'); localStorage.setItem('theme', 'dark'); localStorage.setItem('amoled', 'true'); }
    applyTheme(currentThemeKey);
}

function updateThemeState() {
    if(isDark) document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark');
    if(isAmoled) document.documentElement.classList.add('amoled'); else document.documentElement.classList.remove('amoled');
    
    const thKnob = document.getElementById('theme-switch-knob');
    const thBg = document.getElementById('theme-switch-bg');
    const thIcon = document.getElementById('theme-switch-icon');
    const thLbl = document.getElementById('theme-label-text');
    const amCont = document.getElementById('amoled-toggle-container');
    const amKnob = document.getElementById('amoled-switch-knob');
    const amBg = document.getElementById('amoled-switch-bg');

    const d = (typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {});

    if(isDark) {
        if(thKnob) thKnob.classList.add('translate-x-8', 'bg-m3-primary'); if(thBg) thBg.classList.add('bg-m3-primary/30');
        if(thIcon) { thIcon.setAttribute('data-lucide', 'moon'); thIcon.classList.add('text-m3-onPrimary'); }
        if(thLbl) thLbl.textContent = d.themeDark || "Mode Gelap";
        if(amCont) amCont.classList.remove('hidden');
    } else {
        if(thKnob) thKnob.classList.remove('translate-x-8', 'bg-m3-primary'); if(thBg) thBg.classList.remove('bg-m3-primary/30');
        if(thIcon) { thIcon.setAttribute('data-lucide', 'sun'); thIcon.classList.remove('text-m3-onPrimary'); }
        if(thLbl) thLbl.textContent = d.themeLight || "Mode Terang";
        if(amCont) amCont.classList.add('hidden');
    }

    if(isAmoled && isDark) {
        if(amKnob) amKnob.classList.add('translate-x-8', 'bg-black'); if(amBg) amBg.classList.add('bg-white');
    } else {
        if(amKnob) amKnob.classList.remove('translate-x-8', 'bg-black'); if(amBg) amBg.classList.remove('bg-white');
        if(amBg) amBg.classList.add('bg-m3-onSurfaceVariant/20');
    }

    const tL = document.getElementById('theme-btn-light'); const tD = document.getElementById('theme-btn-dark'); const tA = document.getElementById('theme-btn-amoled');
    [tL, tD, tA].forEach(e => { if(e) { e.classList.remove('bg-m3-primary', 'text-m3-onPrimary'); e.classList.add('text-m3-onSurfaceVariant'); }});
    
    if(!isDark && tL) { tL.classList.add('bg-m3-primary', 'text-m3-onPrimary'); tL.classList.remove('text-m3-onSurfaceVariant'); }
    else if(isDark && !isAmoled && tD) { tD.classList.add('bg-m3-primary', 'text-m3-onPrimary'); tD.classList.remove('text-m3-onSurfaceVariant'); }
    else if(isDark && isAmoled && tA) { tA.classList.add('bg-m3-primary', 'text-m3-onPrimary'); tA.classList.remove('text-m3-onSurfaceVariant'); }

    if (window.lucide) window.lucide.createIcons();
}

window.changeTypo = function(type, val) {
    if(type === 'size') {
        document.documentElement.style.setProperty('--reader-size', val); localStorage.setItem('typo-size', val);
        ['sm','md','lg'].forEach(k => document.getElementById(`typo-sz-${k}`).classList.remove('bg-m3-primary', 'text-m3-onPrimary'));
        const m = {'1rem':'sm','1.2rem':'md','1.5rem':'lg'};
        const bt = document.getElementById(`typo-sz-${m[val]}`); if(bt) bt.classList.add('bg-m3-primary', 'text-m3-onPrimary');
    } else if(type === 'align') {
        document.documentElement.style.setProperty('--reader-align', val); localStorage.setItem('typo-align', val);
        ['left','center','justify'].forEach(k => document.getElementById(`typo-al-${k}`).classList.remove('bg-m3-primary', 'text-m3-onPrimary'));
        const bt = document.getElementById(`typo-al-${val}`); if(bt) bt.classList.add('bg-m3-primary', 'text-m3-onPrimary');
    } else if(type === 'font') {
        document.documentElement.style.setProperty('--reader-font', `"${val}", sans-serif`); localStorage.setItem('typo-font', val);
        ['lora','merri','playfair','inter','mono','google'].forEach(k => { const el = document.getElementById(`typo-fn-${k}`); if(el) { el.classList.remove('bg-m3-primary', 'text-m3-onPrimary', 'border-transparent'); el.classList.add('text-m3-onSurfaceVariant'); } });
        const m = {'Lora':'lora','Merriweather':'merri','Playfair Display':'playfair','Inter':'inter','Space Mono':'mono','Google Sans Flex':'google'};
        const bt = document.getElementById(`typo-fn-${m[val]}`); if(bt) { bt.classList.add('bg-m3-primary', 'text-m3-onPrimary'); bt.classList.remove('text-m3-onSurfaceVariant'); }
    }
}

// 3. SELECTION & BOOKMARK IN-TEXT (Modifikasi support AI)
function handleSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideSelectionMenu(); return; }

    const range = sel.getRangeAt(0);
    currentSelection.text = sel.toString().trim();
    
    // Cari index parent kalo di mode vertikal
    let currentContainer = range.startContainer;
    while (currentContainer && currentContainer.nodeType !== 1) currentContainer = currentContainer.parentNode;
    let parentNodeEl = currentContainer.closest('[id^="node-"]');
    if (parentNodeEl) currentSelection.nodeIdx = parseInt(parentNodeEl.id.replace('node-', ''));
    
    // Posisi Menu AI
    const rect = range.getBoundingClientRect();
    if (rect.width === 0) return;

    let selWidth = DOM.selMenu.offsetWidth;
    if(selWidth < 50) selWidth = 180;
    
    let top = rect.top - 60;
    if (top < 80) top = rect.bottom + 10; // Kalo mentok atas, taruh bawah teks
    
    let left = rect.left + (rect.width / 2) - (selWidth / 2);
    if (left < 10) left = 10;
    if (left + selWidth > window.innerWidth - 10) left = window.innerWidth - selWidth - 10;

    DOM.selMenu.style.top = `${top}px`;
    DOM.selMenu.style.left = `${left}px`;
    DOM.selMenu.classList.remove('hidden');
    requestAnimationFrame(() => {
        DOM.selMenu.classList.remove('opacity-0', 'scale-75');
    });
}

window.hideSelectionMenu = function() {
    if (!DOM.selMenu) return;
    DOM.selMenu.classList.add('opacity-0', 'scale-75');
    setTimeout(() => { DOM.selMenu.classList.add('hidden'); }, 200);
}

window.copySelection = function() {
    if (!currentSelection.text) return;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(currentSelection.text);
    } else {
        const t = document.createElement("textarea");
        t.value = currentSelection.text;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        document.body.removeChild(t);
    }

    hideSelectionMenu();
    window.getSelection().removeAllRanges();
    showDialog("Berhasil", "Teks telah disalin ke clipboard.", "check-circle", [{text:"Oke", primary:true}]);
}

window.openBookmarkModal = function(color = 'yellow') {
    const b = library.find(x => x.id === activeBookId);
    if(!b) return;

    // CEGAT JIKA PDF GAMBAR DAN SEDANG DALAM MODE ORIGINAL VIEW
    if(b.type === 'pdf' && isOriginalViewActive && b.isImageOnly) {
        let title = "Maaf / Sorry";
        let msg = "PDF kamu cuma gambar jadi ga bisa di-bookmark teks aslinya.";
        if(wikiLang === 'en') msg = "Sorry, your PDF is image-only and cannot be bookmarked.";
        else if(wikiLang === 'es') msg = "Lo siento, su PDF es solo imagen y no se puede agregar a marcadores.";
        
        showDialog(title, msg, "file-warning", [{text:"Oke", primary:true}]);
        hideSelectionMenu();
        window.getSelection().removeAllRanges();
        return;
    }

    activeNoteColor = color;
    document.getElementById('bookmark-input-title').value = '';
    document.getElementById('bookmark-input-text').value = currentSelection.text ? `"${currentSelection.text}"` : '';
    document.getElementById('btn-delete-bookmark').classList.add('hidden');
    editingAnnotId = null;
    
    hideSelectionMenu();
    
    const d = (typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {});
    document.getElementById('str-bookmark-modal-title').innerHTML = `<i data-lucide="bookmark" class="w-5 h-5"></i> ${d.addBookmark || 'Tambah Bookmark'}`;
    
    if (window.lucide) window.lucide.createIcons();
    
    pushAppHistory('bookmark-modal');
    openModal('bookmark-modal', 'bookmark-sheet');
}

window.saveBookmarkAnnotation = function() {
    const b = library.find(x => x.id === activeBookId);
    if (!b) return;

    const title = document.getElementById('bookmark-input-title').value.trim() || "Catatan";
    const note = document.getElementById('bookmark-input-text').value.trim();

    if (!b.annotations) b.annotations = [];

    if (editingAnnotId) {
        const an = b.annotations.find(a => a.id === editingAnnotId);
        if (an) {
            an.title = title;
            an.note = note;
        }
    } else {
        // Jika dari Original View Horizontal, ambil halaman
        let savedPageOrNode = currentSelection.nodeIdx;
        if(isOriginalViewActive && b.type === 'pdf') {
            const width = DOM.pdfContainer.clientWidth;
            const scrollX = DOM.pdfContainer.scrollLeft;
            savedPageOrNode = `pdf-page-${Math.round(scrollX / width) + 1}`;
        }

        b.annotations.push({
            id: Date.now().toString(),
            color: activeNoteColor,
            title: title,
            note: note,
            text: currentSelection.text,
            nodeIdx: savedPageOrNode,
            date: new Date().toISOString()
        });
    }

    saveLib();
    _closeModalAction('bookmark-modal', 'bookmark-sheet', true);
    
    if (!isOriginalViewActive) applyHighlights(); // Highlight cuma jalan di vertikal HTML
    populateBookmarkPanel();

    showDialog("Disimpan", "Bookmark berhasil disimpan.", "check-circle", [{text:"Oke", primary:true}]);
}


// 4. RENDER LIBRARY & UI DASAR
function renderLibrary() {
    const searchVal = document.getElementById('global-search') ? document.getElementById('global-search').value.toLowerCase() : '';
    let filteredLib = library.filter(b => b.title.toLowerCase().includes(searchVal));

    if (DOM.grid) DOM.grid.innerHTML = '';
    if (DOM.topSlider) DOM.topSlider.innerHTML = '';
    if (DOM.pinnedGrid) DOM.pinnedGrid.innerHTML = '';

    const reading = filteredLib.filter(b => b.progressPct > 0 && b.progressPct < 100);
    const pinned = filteredLib.filter(b => b.pinned);
    
    let totalStat = library.length;
    let readingStat = library.filter(b => b.progressPct > 0 && b.progressPct < 100).length;
    let completedStat = library.filter(b => b.progressPct === 100).length;
    let notesStat = library.reduce((sum, b) => sum + (b.annotations ? b.annotations.length : 0), 0);
    
    if(document.getElementById('stat-val-total')) document.getElementById('stat-val-total').textContent = totalStat;
    if(document.getElementById('stat-val-reading')) document.getElementById('stat-val-reading').textContent = readingStat;
    if(document.getElementById('stat-val-completed')) document.getElementById('stat-val-completed').textContent = completedStat;
    if(document.getElementById('stat-val-notes')) document.getElementById('stat-val-notes').textContent = notesStat;

    if (library.length === 0) {
        DOM.empty.classList.remove('hidden');
        DOM.topSection.classList.add('hidden');
        DOM.pinnedSection.classList.add('hidden');
        DOM.colHeading.classList.add('hidden');
        DOM.statSect.classList.add('hidden');
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    DOM.empty.classList.add('hidden');
    DOM.statSect.classList.remove('hidden');

    if (reading.length > 0 && searchVal === '') {
        DOM.topSection.classList.remove('hidden');
        reading.sort((a,b) => b.progressPct - a.progressPct).forEach(b => {
            const c = b.coverBase64 ? `<img src="${b.coverBase64}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-m3-surface flex items-center justify-center p-2"><span class="text-xs font-bold text-center opacity-40 line-clamp-3">${b.title}</span></div>`;
            const div = document.createElement('div');
            div.className = "flex-none w-[140px] snap-center shrink-0 cursor-pointer group";
            div.innerHTML = `
                <div class="aspect-[2/3] rounded-[24px] overflow-hidden bg-m3-surfaceVariant relative shadow-sm border border-m3-onSurface/5" onclick="openBook('${b.id}')">
                    ${c}
                    <div class="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                        <div class="h-full bg-m3-primary progress-smooth" style="width: ${b.progressPct}%"></div>
                    </div>
                </div>
                <h4 class="mt-2 text-xs font-bold truncate px-1 group-hover:text-m3-primary transition-colors text-m3-onBg">${b.title}</h4>
                <p class="text-[10px] opacity-60 font-bold px-1 uppercase tracking-widest mt-0.5">${b.progressPct}%</p>
            `;
            DOM.topSlider.appendChild(div);
        });
    } else { DOM.topSection.classList.add('hidden'); }

    if (pinned.length > 0 && searchVal === '') {
        DOM.pinnedSection.classList.remove('hidden');
        pinned.forEach(b => {
            DOM.pinnedGrid.appendChild(createBookCard(b));
        });
    } else { DOM.pinnedSection.classList.add('hidden'); }

    DOM.colHeading.classList.remove('hidden');
    filteredLib.filter(b => !b.pinned).forEach(b => {
        DOM.grid.appendChild(createBookCard(b));
    });

    if (window.lucide) window.lucide.createIcons();
}

function createBookCard(b) {
    const div = document.createElement('div');
    const isSelected = selectedForDelete.includes(b.id);
    let shapeClass = "rounded-[24px] aspect-[2/3]"; 
    if(b.shape === 'rounded') shapeClass = "rounded-full aspect-square";
    else if(b.shape === 'square') shapeClass = "rounded-[32px] aspect-square";

    div.className = `relative cursor-pointer group transition-transform ${isSelected ? 'scale-90 opacity-80' : ''}`;
    
    let typeColor = 'bg-m3-primary';
    if(b.type === 'epub') typeColor = 'bg-blue-500';
    else if(b.type === 'txt') typeColor = 'bg-green-500';
    else if(b.type === 'md') typeColor = 'bg-purple-500';

    const c = b.coverBase64 ? `<img src="${b.coverBase64}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-m3-surfaceVariant flex items-center justify-center p-3"><span class="text-xs font-bold text-center opacity-40 line-clamp-3">${b.title}</span></div>`;
    
    div.innerHTML = `
        <div class="relative w-full ${shapeClass} overflow-hidden shadow-sm border ${isSelected ? 'border-4 border-red-500' : 'border-m3-onSurface/5'}" onclick="${isBatchDeleteMode ? `toggleSelectDelete('${b.id}')` : `openBook('${b.id}')`}">
            ${c}
            ${isSelected ? `<div class="absolute inset-0 bg-red-500/20 flex items-center justify-center"><i data-lucide="check-circle" class="text-white w-8 h-8 drop-shadow-md"></i></div>` : ''}
            ${!isBatchDeleteMode ? `<button class="absolute top-2 right-2 w-7 h-7 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); openBookOptions('${b.id}')"><i data-lucide="more-vertical" class="w-4 h-4"></i></button>` : ''}
            <div class="absolute bottom-2 left-2 px-2 py-0.5 rounded-full ${typeColor} text-white text-[8px] font-black uppercase tracking-widest shadow-sm">${b.type}</div>
        </div>
        <h4 class="mt-2 text-xs font-bold text-center truncate px-1 group-hover:text-m3-primary transition-colors text-m3-onBg">${b.title}</h4>
    `;
    return div;
}

// 5. BUKA BUKU & RENDER KONTEN (UPDATE FASE 4: DUKUNGAN NATIVE/HORIZONTAL & MD)
window.openBook = function(id) {
    const b = library.find(x => x.id === id);
    if (!b) return;

    activeBookId = id;
    DOM.title.textContent = b.title;
    DOM.inner.innerHTML = '';
    
    // Reset State
    isOriginalViewActive = false;
    pdfDocNative = null;
    applyPdfViewUIState();
    DOM.pdfContainer.innerHTML = '';
    DOM.pdfContainer.classList.add('hidden');
    DOM.content.classList.remove('hidden');

    document.getElementById('reader-loading-overlay').classList.remove('hidden');
    document.getElementById('reader-loading-overlay').classList.remove('opacity-0');

    // Atur visibilitas tombol Setting "Tampilan Asli"
    if (b.type === 'pdf') {
        DOM.pdfSettingRow.classList.remove('hidden');
        if (b.isImageOnly) {
            document.getElementById('str-set-original-desc').classList.remove('hidden');
            // Jika murni gambar, langsung nyalakan mode horizontal
            isOriginalViewActive = true;
            DOM.pdfSwitchKnob.classList.add('translate-x-6');
            DOM.pdfSwitchBg.classList.add('bg-m3-primary');
            DOM.pdfSwitchBg.classList.remove('bg-m3-onSurfaceVariant/20');
            DOM.typoSettingRow.classList.add('opacity-30', 'pointer-events-none');
            // Ga boleh dimatikan
            document.getElementById('pdf-original-view-setting').firstElementChild.onclick = null;
        } else {
            document.getElementById('str-set-original-desc').classList.add('hidden');
            document.getElementById('pdf-original-view-setting').firstElementChild.onclick = window.togglePdfOriginalView;
        }
    } else {
        DOM.pdfSettingRow.classList.add('hidden');
    }

    pushAppHistory('reader');
    DOM.readView.classList.remove('translate-y-full');

    setTimeout(async () => {
        // Tentukan mau render vertical (DOM) atau horizontal (Native Canvas)
        if (isOriginalViewActive) {
            await initPdfNativeRender();
        } else {
            // Render Vertikal Standar
            const frag = document.createDocumentFragment();
            b.nodes.forEach((n, i) => {
                const el = document.createElement(n.tag);
                el.id = `node-${i}`;
                if (n.tag === 'img') el.src = n.src;
                else el.textContent = n.text;
                frag.appendChild(el);
            });
            DOM.inner.appendChild(frag);

            requestAnimationFrame(() => {
                if (b.lastReadId) {
                    const el = document.getElementById(b.lastReadId);
                    if (el) el.scrollIntoView();
                } else DOM.content.scrollTo(0, 0);

                applyHighlights();
                setTimeout(() => { updateProgress(); }, 500);
            });
        }

        populateToc();
        populateBookmarkPanel();

        // Terapkan tipografi user
        const sz = localStorage.getItem('typo-size') || '1.2rem';
        const al = localStorage.getItem('typo-align') || 'left';
        const fn = localStorage.getItem('typo-font') || 'Lora';
        changeTypo('size', sz); changeTypo('align', al); changeTypo('font', fn);

        document.getElementById('reader-loading-overlay').classList.add('opacity-0');
        setTimeout(() => document.getElementById('reader-loading-overlay').classList.add('hidden'), 300);
    }, 400);
}

window.closeBook = function() {
    DOM.readView.classList.add('translate-y-full');
    activeBookId = null;
    pdfDocNative = null;
    isOriginalViewActive = false;
    DOM.pdfContainer.innerHTML = '';
    DOM.inner.innerHTML = ''; 
    DOM.tocList.innerHTML = '';
    DOM.bookmarkList.innerHTML = '';
    renderLibrary();
}

// 6. HIGHLIGHT, TOC, & BOOKMARKS
function applyHighlights() {
    const b = library.find(x => x.id === activeBookId);
    if(!b || !b.annotations) return;

    // Highlight cuma buat mode teks vertikal
    b.annotations.forEach(an => {
        if(typeof an.nodeIdx === 'number') {
            const parent = document.getElementById(`node-${an.nodeIdx}`);
            if(!parent || !an.text) return;
            
            const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let n;
            while(n = walker.nextNode()) textNodes.push(n);

            textNodes.forEach(node => {
                const text = node.nodeValue;
                const idx = text.indexOf(an.text);
                if(idx !== -1) {
                    const span = document.createElement('span');
                    const before = text.substring(0, idx);
                    const match = text.substring(idx, idx + an.text.length);
                    const after = text.substring(idx + an.text.length);
                    
                    span.innerHTML = `${before}<mark class="hl-${an.color} cursor-pointer rounded px-0.5 transition-opacity hover:opacity-80" onclick="editAnnotation('${an.id}')">${match}</mark>${after}`;
                    node.parentNode.replaceChild(span, node);
                }
            });
        }
    });
}

window.editAnnotation = function(id) {
    const b = library.find(x => x.id === activeBookId);
    if(!b || !b.annotations) return;
    const an = b.annotations.find(a => a.id === id);
    if(!an) return;

    editingAnnotId = id;
    activeNoteColor = an.color;
    document.getElementById('bookmark-input-title').value = an.title;
    document.getElementById('bookmark-input-text').value = an.note;
    document.getElementById('btn-delete-bookmark').classList.remove('hidden');

    const d = (typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {});
    document.getElementById('str-bookmark-modal-title').innerHTML = `<i data-lucide="bookmark" class="w-5 h-5"></i> ${d.editTitle || 'Edit Bookmark'}`;
    
    if (window.lucide) window.lucide.createIcons();

    pushAppHistory('bookmark-modal');
    openModal('bookmark-modal', 'bookmark-sheet');
}

window.deleteBookmarkInsideModal = function() {
    if(!editingAnnotId) return;
    const b = library.find(x => x.id === activeBookId);
    if(!b) return;

    const d = (typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {});
    
    showDialog("Hapus Bookmark", d.deleteNoteConfirm || "Hapus bookmark ini?", "trash-2", [
        {text: d.editCancel || "Batal", primary: false},
        {text: "Hapus", primary: true, action: () => {
            b.annotations = b.annotations.filter(a => a.id !== editingAnnotId);
            saveLib();
            _closeModalAction('bookmark-modal', 'bookmark-sheet', true);
            
            // Bersihkan highlight manual (re-render node)
            const parent = document.getElementById(`node-${b.annotations.find(a=>a.id === editingAnnotId)?.nodeIdx}`);
            if(parent) {
                const marks = parent.querySelectorAll('mark');
                marks.forEach(m => {
                    const p = m.parentNode;
                    p.replaceChild(document.createTextNode(m.textContent), m);
                    p.normalize();
                });
                applyHighlights();
            }
            populateBookmarkPanel();
        }}
    ]);
}

function populateToc() {
    DOM.tocList.innerHTML = '';
    const b = library.find(x => x.id === activeBookId);
    if(!b) return;
    
    b.nodes.forEach((n, i) => {
        if (n.tag === 'h1' || n.tag === 'h2') {
            const d = document.createElement('div');
            d.className = `p-3 mb-1 rounded-2xl cursor-pointer btn-morph font-bold text-sm bg-m3-surface hover:bg-m3-primary/10 transition-colors ${n.tag === 'h1' ? 'text-m3-primary ml-0' : 'text-m3-onSurfaceVariant ml-4 opacity-80'}`;
            d.textContent = n.text;
            d.onclick = () => { 
                closePanel(); 
                // Jika vertikal
                if (!isOriginalViewActive) {
                    const el = document.getElementById(`node-${i}`); 
                    if(el) el.scrollIntoView({behavior:'smooth'}); 
                } 
                // Di horizontal PDF, TOC kurang akurat node-nya, jadi lompat proporsional
                else if (b.type === 'pdf') {
                    const estPage = Math.max(1, Math.round((i / b.nodes.length) * b.pages));
                    const targetDiv = document.getElementById(`pdf-page-${estPage}`);
                    if (targetDiv) DOM.pdfContainer.scrollLeft = targetDiv.offsetLeft;
                }
            };
            DOM.tocList.appendChild(d);
        }
    });
}

function populateBookmarkPanel() {
    DOM.bookmarkList.innerHTML = '';
    const b = library.find(x => x.id === activeBookId);
    if(!b || !b.annotations || b.annotations.length === 0) {
        document.getElementById('bookmark-empty').classList.remove('hidden');
        return;
    }
    
    document.getElementById('bookmark-empty').classList.add('hidden');
    
    const colorMap = { 'yellow': 'border-[#EAB308]', 'green': 'border-[#22C55E]', 'pink': 'border-[#EC4899]', 'blue': 'border-[#3B82F6]' };

    b.annotations.forEach(an => {
        const d = document.createElement('div');
        d.className = `p-4 mb-2 rounded-2xl cursor-pointer btn-morph bg-m3-surface border-l-4 ${colorMap[an.color] || 'border-m3-surfaceVariant'} shadow-sm`;
        
        let preview = an.text ? `<p class="text-[10px] italic opacity-60 mt-1 line-clamp-2">"${an.text}"</p>` : '';
        let noteStr = an.note && an.note !== `"${an.text}"` ? `<p class="text-xs font-medium text-m3-onSurfaceVariant mt-2 break-words leading-relaxed">${an.note}</p>` : '';
        
        d.innerHTML = `
            <div class="flex justify-between items-start gap-2">
                <h4 class="font-bold text-sm text-m3-primary line-clamp-1">${an.title}</h4>
                <span class="text-[8px] font-bold uppercase tracking-widest opacity-40 shrink-0">${new Date(an.date).toLocaleDateString()}</span>
            </div>
            ${preview}
            ${noteStr}
        `;
        
        d.onclick = () => { 
            closePanel(); 
            // Cek lokasi
            if (typeof an.nodeIdx === 'string' && an.nodeIdx.startsWith('pdf-page-')) {
                // Lompat ke PDF Canvas Mode jika aktif
                if (isOriginalViewActive) {
                    const targetDiv = document.getElementById(an.nodeIdx);
                    if(targetDiv) DOM.pdfContainer.scrollLeft = targetDiv.offsetLeft;
                } else {
                    // Paksa nyalain mode original kalo bookmarknya dibikin di situ
                    window.togglePdfOriginalView().then(() => {
                        setTimeout(() => {
                            const targetDiv = document.getElementById(an.nodeIdx);
                            if(targetDiv) DOM.pdfContainer.scrollLeft = targetDiv.offsetLeft;
                        }, 500);
                    });
                }
            } else {
                // Lompat ke mode HTML Vertikal
                if (isOriginalViewActive && !b.isImageOnly) {
                    window.togglePdfOriginalView().then(() => {
                        const el = document.getElementById(`node-${an.nodeIdx}`); 
                        if(el) {
                            el.scrollIntoView({behavior:'smooth'});
                            highlightTemporary(el);
                        }
                    });
                } else {
                    const el = document.getElementById(`node-${an.nodeIdx}`); 
                    if(el) {
                        el.scrollIntoView({behavior:'smooth'});
                        highlightTemporary(el);
                    }
                }
            }
        };
        DOM.bookmarkList.appendChild(d);
    });
}

function highlightTemporary(el) {
    const origBg = el.style.backgroundColor;
    el.style.backgroundColor = 'var(--md-sys-color-surface-variant)';
    el.style.borderRadius = '8px';
    el.style.transition = 'background-color 1s ease';
    setTimeout(() => { el.style.backgroundColor = origBg; }, 1500);
}

window.filterBookmarkPanel = function(val) {
    val = val.toLowerCase();
    const items = DOM.bookmarkList.children;
    for(let i=0; i<items.length; i++) {
        const title = items[i].querySelector('h4').textContent.toLowerCase();
        const note = items[i].querySelector('.text-xs') ? items[i].querySelector('.text-xs').textContent.toLowerCase() : '';
        if(title.includes(val) || note.includes(val)) items[i].style.display = 'block';
        else items[i].style.display = 'none';
    }
}

function updateProgress() {
    const b = library.find(x => x.id === activeBookId);
    if (!b) return;

    if (!isOriginalViewActive) {
        // Vertical HTML Progress calculation
        let nodes = Array.from(DOM.content.querySelectorAll('[id^="node-"]'));
        if (nodes.length > 0) {
            let visible = nodes.find(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.top <= window.innerHeight; });
            if (!visible) visible = nodes[0];
            let idx = parseInt(visible.id.replace('node-', ''));
            b.progressPct = Math.round((idx / b.nodes.length) * 100);
        }
    }
    
    // UI Update
    DOM.progText.textContent = `${b.progressPct}%`;
    DOM.progBar.style.width = `${b.progressPct}%`;

    const rh = document.getElementById('reader-floating-header');
    if(rh) {
        rh.classList.remove('translate-y-0', 'opacity-100');
        rh.classList.add('-translate-y-full', 'opacity-0');
        clearTimeout(rh.timeout);
        rh.timeout = setTimeout(() => {
            rh.classList.remove('-translate-y-full', 'opacity-0');
            rh.classList.add('translate-y-0', 'opacity-100');
        }, 1500);
    }
}

// 7. PANEL & MODAL SYSTEM (Murni Logika)
let appHistoryStack = [];

function pushAppHistory(stateName) {
    appHistoryStack.push(stateName);
    history.pushState({ panel: stateName }, "");
}

window.togglePanel = function(panelEl, panelName, btnId) {
    if (activePanel === panelEl) { closePanel(); return; }
    if (activePanel) { activePanel.classList.add('translate-x-full'); activePanel.classList.remove('opacity-100'); }
    
    DOM.sideOverlay.classList.remove('hidden');
    requestAnimationFrame(() => DOM.sideOverlay.classList.remove('opacity-0'));
    
    panelEl.classList.remove('translate-x-full', 'opacity-0');
    activePanel = panelEl;
    
    pushAppHistory(`panel-${panelName}`);
}

function closePanel() {
    if (!activePanel) return;
    activePanel.classList.add('translate-x-full', 'opacity-0');
    DOM.sideOverlay.classList.add('opacity-0');
    setTimeout(() => { DOM.sideOverlay.classList.add('hidden'); activePanel = null; }, 300);
}

document.getElementById('btn-toc').addEventListener('click', () => togglePanel(DOM.tocPanel, 'toc', 'btn-toc'));
document.getElementById('btn-settings').addEventListener('click', () => togglePanel(DOM.settingsPanel, 'settings', 'btn-settings'));
document.getElementById('btn-back').addEventListener('click', () => { if(activePanel) closePanel(); else history.back(); });

window.openModal = function(modalId, sheetId, skipHistory = false) {
    const m = document.getElementById(modalId);
    const s = document.getElementById(sheetId);
    if(!skipHistory) pushAppHistory(modalId);
    
    m.classList.remove('hidden');
    requestAnimationFrame(() => {
        m.classList.remove('opacity-0');
        if(s.classList.contains('translate-y-12')) s.classList.remove('scale-75', 'translate-y-12');
        else s.classList.remove('translate-y-full');
    });
}

window._closeModalAction = function(modalId, sheetId, triggerBack = false) {
    if(triggerBack) { history.back(); return; }
    const m = document.getElementById(modalId);
    const s = document.getElementById(sheetId);
    if(s.classList.contains('scale-75') || s.classList.contains('translate-y-12')) {
        s.classList.add('scale-75', 'translate-y-12');
    } else {
        s.classList.add('translate-y-full');
    }
    m.classList.add('opacity-0');
    setTimeout(() => m.classList.add('hidden'), 300);
}

// 8. BATCH DELETE & EDIT OPTIONS
window.triggerSelectMode = function() {
    _closeModalAction('b-opt-modal', 'b-opt-sheet', true);
    isBatchDeleteMode = true;
    selectedForDelete = [];
    document.getElementById('fab-container').classList.add('translate-y-32', 'opacity-0');
    document.getElementById('batch-delete-bar').classList.remove('translate-y-32');
    renderLibrary();
}

window.toggleSelectDelete = function(id) {
    if(selectedForDelete.includes(id)) selectedForDelete = selectedForDelete.filter(x => x !== id);
    else selectedForDelete.push(id);
    document.getElementById('batch-delete-count').textContent = `${selectedForDelete.length} Terpilih`;
    renderLibrary();
}

window.toggleBatchDelete = function() {
    isBatchDeleteMode = false;
    selectedForDelete = [];
    document.getElementById('fab-container').classList.remove('translate-y-32', 'opacity-0');
    document.getElementById('batch-delete-bar').classList.add('translate-y-32');
    renderLibrary();
}

window.executeBatchDelete = function() {
    if(selectedForDelete.length === 0) { toggleBatchDelete(); return; }
    showDialog("Hapus Buku", `Yakin ingin menghapus ${selectedForDelete.length} buku? Data tidak bisa kembali.`, "trash-2", [
        {text: "Batal", primary: false},
        {text: "Hapus", primary: true, action: () => {
            selectedForDelete.forEach(id => { localforage.removeItem(`pdf_raw_${id}`); });
            library = library.filter(b => !selectedForDelete.includes(b.id));
            saveLib(); toggleBatchDelete();
            showDialog("Selesai", "Buku berhasil dihapus.", "check-circle", [{text:"Oke", primary:true}]);
        }}
    ]);
}

window.openBookOptions = function(id) {
    activeOptsId = id;
    const b = library.find(x => x.id === id);
    const pinStr = b.pinned ? (wikiLang === 'id' ? 'Lepaskan Sematan' : 'Unpin Book') : (wikiLang === 'id' ? 'Sematkan Buku' : 'Pin Book');
    document.getElementById('str-opt-pin').textContent = pinStr;
    document.getElementById('icon-opt-pin').classList.toggle('fill-current', b.pinned);
    openModal('b-opt-modal', 'b-opt-sheet');
}

window.togglePinBook = function() {
    const b = library.find(x => x.id === activeOptsId);
    if(b) { b.pinned = !b.pinned; saveLib(); renderLibrary(); }
    _closeModalAction('b-opt-modal', 'b-opt-sheet', true);
}

window.triggerDeleteView = function() {
    _closeModalAction('b-opt-modal', 'b-opt-sheet', true);
    showDialog("Hapus Permanen", "Yakin ingin menghapus buku ini dari library?", "trash-2", [
        {text: "Batal", primary: false},
        {text: "Hapus", primary: true, action: () => {
            localforage.removeItem(`pdf_raw_${activeOptsId}`);
            library = library.filter(x => x.id !== activeOptsId);
            saveLib(); renderLibrary();
        }}
    ]);
}

window.triggerEditView = function() {
    const b = library.find(x => x.id === activeOptsId);
    if(!b) return;
    _closeModalAction('b-opt-modal', 'b-opt-sheet', true);
    
    document.getElementById('edit-book-id').value = b.id;
    document.getElementById('edit-book-title').value = b.title;
    document.getElementById('edit-book-shape').value = b.shape || 'default';
    
    selectShape(b.shape || 'default');
    
    setTimeout(() => { openModal('edit-modal', 'edit-sheet'); }, 300);
}

window.closeEditModal = function() { _closeModalAction('edit-modal', 'edit-sheet', true); }

window.selectShape = function(s) {
    document.getElementById('edit-book-shape').value = s;
    ['default','rounded','square'].forEach(k => document.getElementById(`shape-${k}`).classList.remove('bg-m3-primary', 'text-m3-onPrimary'));
    document.getElementById(`shape-${s}`).classList.add('bg-m3-primary', 'text-m3-onPrimary');
}

window.saveBookEdit = function() {
    const id = document.getElementById('edit-book-id').value;
    const b = library.find(x => x.id === id);
    if(!b) return;

    b.title = document.getElementById('edit-book-title').value;
    b.shape = document.getElementById('edit-book-shape').value;

    const file = document.getElementById('edit-book-cover').files[0];
    if(file) {
        const r = new FileReader();
        r.onload = e => { b.coverBase64 = e.target.result; saveLib(); renderLibrary(); closeEditModal(); };
        r.readAsDataURL(file);
    } else { saveLib(); renderLibrary(); closeEditModal(); }
}

function saveLib() { 
    localforage.setItem('pdf_epub_master', library);
    renderLibrary();
}

window.toggleFullscreenReading = function() {
    if (!document.fullscreenElement) { DOM.readView.requestFullscreen().catch(err => console.log(err)); } 
    else { document.exitFullscreen(); }
}

window.closeWelcome = function() {
    localStorage.setItem('welcomed_v2', 'true');
    _closeModalAction('welcome-modal', 'welcome-sheet');
}

// 9. SETTINGS, API KEYS, BACKUP & UPDATE
window.saveGeminiKey = function() {
    const val = document.getElementById('gemini-api-key').value.trim();
    localStorage.setItem('gemini_api_key', val);
    const d = (typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {});
    showDialog("Berhasil", d.keySaved || "API Key Gemini disimpan.", "check-circle", [{text:"Oke", primary:true}]);
}

window.saveGeminiModel = function() {
    const val = document.getElementById('gemini-model-select').value;
    localStorage.setItem('gemini_model', val);
}

document.addEventListener("DOMContentLoaded", () => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if(savedKey) document.getElementById('gemini-api-key').value = savedKey;
    const savedModel = localStorage.getItem('gemini_model');
    if(savedModel) document.getElementById('gemini-model-select').value = savedModel;
});

window.exportData = function() {
    const dataStr = JSON.stringify(library);
    document.getElementById('raw-backup-textarea').value = dataStr;
    _closeModalAction('global-settings-modal', 'global-settings-sheet', true);
    setTimeout(() => openModal('raw-backup-modal', 'raw-backup-sheet'), 300);
}

window.copyRawBackup = function() {
    const txt = document.getElementById('raw-backup-textarea');
    txt.select();
    document.execCommand('copy');
    showDialog("Berhasil", "Data teks telah disalin ke clipboard. Simpan teks ini baik-baik.", "copy", [{text:"Oke", primary:true}]);
}

window.openRestoreOptions = function() {
    _closeModalAction('global-settings-modal', 'global-settings-sheet', true);
    setTimeout(() => {
        document.getElementById('raw-restore-textarea').value = '';
        openModal('raw-restore-modal', 'raw-restore-sheet');
    }, 300);
}

window.processRawRestore = function() {
    try {
        const val = document.getElementById('raw-restore-textarea').value;
        if(!val.trim()) { showDialog("Error", "Teks kosong.", "alert-circle", [{text:"Oke", primary:true}]); return; }
        const parsed = JSON.parse(val);
        if(!Array.isArray(parsed)) throw new Error("Format salah");
        
        library = parsed;
        saveLib();
        _closeModalAction('raw-restore-modal', 'raw-restore-sheet', true);
        showDialog("Berhasil", "Data sukses dipulihkan.", "check-circle", [{text:"Oke", primary:true}]);
    } catch (e) {
        showDialog("Gagal", "Teks JSON tidak valid atau korup.", "alert-circle", [{text:"Oke", primary:true}]);
    }
}

window.importDataFile = function(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        document.getElementById('raw-restore-textarea').value = event.target.result;
        window.processRawRestore();
    };
    reader.readAsText(file);
    e.target.value = '';
}

window.checkForUpdate = async function() {
    const btn = document.getElementById('btn-update-app');
    const icon = document.getElementById('icon-update-app');
    const d = (typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {});
    
    icon.classList.add('animate-spin');
    try {
        const res = await fetch(window.UPDATE_URL);
        const data = await res.json();
        const latest = data.version;
        const current = window.APP_VERSION;
        
        icon.classList.remove('animate-spin');
        
        if(latest !== current) {
            showDialog("Update Tersedia!", `Versi terbaru (${latest}) sudah rilis. Versi kamu: ${current}.`, "arrow-up-circle", [
                {text: d.optCancel || "Nanti", primary: false},
                {text: "Unduh Sekarang", primary: true, action: () => { window.open(window.RELEASES_URL, '_blank'); }}
            ]);
        } else {
            showDialog("Sudah Versi Terbaru", `Aplikasi kamu (v${current}) sudah up-to-date.`, "check-circle", [{text: "Oke", primary: true}]);
        }
    } catch(e) {
        icon.classList.remove('animate-spin');
        showDialog("Gagal Cek Update", "Pastikan internet menyala atau server sedang sibuk.", "wifi-off", [{text: "Oke", primary: true}]);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const verEl = document.getElementById('app-version-display');
    if(verEl) verEl.textContent = `v${window.APP_VERSION}`;
});

// 10. CUSTOM DIALOG
window.showDialog = function(title, message, iconName = 'info', actions = []) {
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-message').textContent = message;
    
    const iconEl = document.getElementById('dialog-icon');
    iconEl.setAttribute('data-lucide', iconName);
    
    const cont = document.getElementById('dialog-icon-container');
    cont.className = 'w-10 h-10 rounded-full flex items-center justify-center shrink-0 ';
    if(iconName.includes('alert') || iconName.includes('trash') || iconName.includes('warning')) { cont.classList.add('bg-red-100', 'text-red-700', 'dark:bg-red-900/40', 'dark:text-red-400'); }
    else if(iconName.includes('check')) { cont.classList.add('bg-green-100', 'text-green-700', 'dark:bg-green-900/40', 'dark:text-green-400'); }
    else { cont.classList.add('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer'); }

    const acts = document.getElementById('dialog-actions');
    acts.innerHTML = '';
    
    actions.forEach(act => {
        const b = document.createElement('button');
        b.className = act.primary ? 'px-5 py-2.5 bg-m3-primary text-m3-onPrimary font-bold rounded-full text-sm btn-morph' : 'px-5 py-2.5 bg-transparent text-m3-onSurface font-bold rounded-full text-sm btn-morph';
        b.textContent = act.text;
        b.onclick = () => {
            if(act.action) act.action();
            _closeModalAction('custom-dialog', 'custom-dialog-sheet', true);
        };
        acts.appendChild(b);
    });

    if(window.lucide) window.lucide.createIcons();
    
    pushAppHistory('custom-dialog');
    openModal('custom-dialog', 'custom-dialog-sheet', true);
}

// 11. SWIPE GESTURES
let touchStartX = 0, touchStartY = 0;
document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; }, {passive: true});
document.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].screenX; const touchEndY = e.changedTouches[0].screenY;
    const diffX = touchEndX - touchStartX; const diffY = touchEndY - touchStartY;
    
    // Jangan trigger swipe back kalo lagi scroll canvas/halaman horizontal
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60 && diffX > 0) {
        if(activePanel || !DOM.readView.classList.contains('translate-y-full')) {
            // Abaikan swipe dari kiri kalo targetnya di dalem canvas
            if (e.target.closest('#pdf-render-container')) return; 
            if(touchStartX < 30) { if(activePanel) closePanel(); else history.back(); }
        }
    }
}, {passive: true});

// 12. CAPACITOR STATUS BAR ADAPTATION
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if (window.Capacitor && window.Capacitor.Plugins) {
            const capApp = window.Capacitor.Plugins.App;
            capApp.addListener('backButton', ({canGoBack}) => {
                if(appHistoryStack.length > 0) { history.back(); return; }
                if(activePanel) { closePanel(); return; }
                if(!DOM.readView.classList.contains('translate-y-full')) { closeBook(); return; }
                capApp.exitApp();
            });
        }
    }, 1000);
});

