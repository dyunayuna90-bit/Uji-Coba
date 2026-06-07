// --- APP LOGIC ---
// Mengurus interaksi UI, Tema, Render Library, Fitur In-Book Bookmark, & Manajemen Memori Tingkat Dewa

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

const DOM = {};

document.addEventListener("DOMContentLoaded", () => {
    // Inisialisasi DOM Elements secara komplit
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
        rTitle: document.getElementById('reader-title'), 
        rInner: document.getElementById('reader-inner'),
        rProgress: document.getElementById('reading-progress-bar'), 
        rProgressTxt: document.getElementById('reader-progress-text'),
        rFloatHead: document.getElementById('reader-floating-header'),
        rBotBar: document.getElementById('reader-bottom-bar'),
        tocPanel: document.getElementById('toc-panel'), 
        tocList: document.getElementById('toc-list'),
        setPanel: document.getElementById('settings-panel'), 
        bookmarkPanel: document.getElementById('bookmark-panel'),
        sideOverlay: document.getElementById('side-panel-overlay'),
        pinSec: document.getElementById('pinned-books-section'),
        pinGrid: document.getElementById('pinned-book-grid'),
        colHead: document.getElementById('collection-heading')
    });

    initTheme();
    applyTranslations();
    lucide.createIcons();
    initApp();

    // Event Listener Navigasi Native / Android Back Button via History API
    window.addEventListener('popstate', (e) => {
        if (activePanel) { togglePanel(activePanel); return; }
        
        // Cek semua modal yang mungkin terbuka, lalu tutup jika tombol back ditekan
        const modals = ['b-opt-modal', 'edit-modal', 'global-settings-modal', 'bookmark-modal', 'ai-modal', 'welcome-modal', 'custom-dialog', 'raw-backup-modal', 'raw-restore-modal', 'backup-type-modal'];
        for (let id of modals) {
            const m = document.getElementById(id);
            if (m && !m.classList.contains('hidden')) {
                let sheetId = id.replace('-modal', '-sheet');
                if (id === 'custom-dialog') sheetId = 'custom-dialog-sheet';
                _closeModalAction(id, sheetId);
                return;
            }
        }
        
        if (!DOM.readView.classList.contains('translate-y-full')) { 
            closeReader(); 
            return; 
        }
        
        if (isBatchDeleteMode) {
            toggleBatchDelete();
            return;
        }
    });

    // Observer untuk progres baca waktu scrolling di reader
    DOM.rInner.addEventListener('scroll', () => {
        if (!activeBookId) return;
        const total = DOM.rInner.scrollHeight - DOM.rInner.clientHeight;
        const pct = total > 0 ? (DOM.rInner.scrollTop / total) * 100 : 100;
        DOM.rProgress.style.width = `${pct}%`;
        DOM.rProgressTxt.innerText = `${Math.round(pct)}%`;
        
        // Simpan progres ke objek library lokal dan memori
        const b = library.find(x => x.id === activeBookId);
        if (b) { b.progress = pct; b.lastRead = new Date().toISOString(); }
        saveLibrary();

        // Sembunyikan floating menu kalau lagi aktif scroll
        const sm = document.getElementById('selection-menu');
        if(sm && !sm.classList.contains('hidden')) {
            hideSelectionMenu();
        }
    }, { passive: true });

    // Inisialisasi Gesture Swipe Down untuk nutup modal
    initGestureDismiss();

    // Inisialisasi Pencarian Global
    document.getElementById('global-search').addEventListener('input', (e) => {
        renderLibrary(e.target.value.toLowerCase());
    });

    // Reset URL hash biar bersih saat baru mulai
    if (window.location.hash) { history.replaceState(null, '', window.location.pathname); }
});

async function initApp() {
    try {
        const stored = await localforage.getItem('baca_library');
        library = stored || [];
        
        // Memastikan field yang mungkin undefined jadi punya nilai default
        library.forEach(b => {
            if (b.pinned === undefined) b.pinned = false;
            if (b.shape === undefined) b.shape = 'default';
        });

        renderLibrary();
        updateStats();
        
        if (!localStorage.getItem('baca_welcomed')) {
            openModal('welcome-modal', 'welcome-sheet', true);
            localStorage.setItem('baca_welcomed', 'true');
        }

        const vDisplay = document.getElementById('app-version-display');
        if (vDisplay) vDisplay.innerText = `v${window.APP_VERSION}`;

    } catch (e) { 
        console.error("Gagal init app:", e); 
        library = []; 
        renderLibrary(); 
    }
}

// 2. SISTEM TRANSLASI (i18n)
window.setWikiLang = function(lang) {
    wikiLang = lang;
    localStorage.setItem('wiki_lang', lang);
    applyTranslations();
    // Re-render UI untuk merefleksikan perubahan bahasa
    renderLibrary(document.getElementById('global-search').value.toLowerCase());
    updateStats();
    
    // Update visual tombol bahasa yang aktif
    document.querySelectorAll('[id^="wiki-lang-"]').forEach(el => {
        el.classList.remove('bg-m3-primary', 'text-m3-onPrimary');
        el.classList.add('text-m3-onSurfaceVariant');
    });
    const activeBtn = document.getElementById(`wiki-lang-${lang}`);
    if (activeBtn) {
        activeBtn.classList.remove('text-m3-onSurfaceVariant');
        activeBtn.classList.add('bg-m3-primary', 'text-m3-onPrimary');
    }
}

function applyTranslations() {
    const txt = i18n[wikiLang] || i18n['id'];
    
    // Header & Umum
    document.getElementById('str-lib-empty').innerText = txt.libEmpty;
    document.getElementById('global-search').placeholder = txt.searchBooks;
    
    // Section Library
    document.getElementById('str-continue-reading').innerText = txt.continueReading;
    document.getElementById('str-pinned-books').innerText = txt.pinnedBooks;
    document.getElementById('str-book-collection').innerText = txt.bookCollection;
    
    // Statistik
    document.getElementById('str-stat-title').innerText = txt.statTitle;
    document.getElementById('str-stat-total').innerText = txt.statTotal;
    document.getElementById('str-stat-reading').innerText = txt.statReading;
    document.getElementById('str-stat-completed').innerText = txt.statCompleted;
    document.getElementById('str-stat-notes').innerText = txt.statNotes;

    // Welcome Modal
    document.getElementById('str-wel-title').innerText = txt.welcomeTitle;
    document.getElementById('str-wel-desc').innerText = txt.welcomeDesc;
    document.getElementById('str-wel-backup').innerText = txt.welBackup;
    document.getElementById('str-wel-backup-desc').innerHTML = txt.welBackupDesc;
    document.getElementById('str-wel-format').innerText = txt.welFormat;
    document.getElementById('str-wel-format-desc').innerHTML = txt.welFormatDesc;
    document.getElementById('str-wel-privacy').innerText = txt.welPrivacy;
    document.getElementById('str-wel-privacy-desc').innerText = txt.welPrivacyDesc;
    document.getElementById('str-wel-btn').innerText = txt.welBtn;
    
    // Settings Modal
    document.getElementById('str-set-main-title').innerText = txt.setMainTitle;
    document.getElementById('str-set-palette').innerText = txt.setPalette;
    document.getElementById('str-set-lang').innerText = txt.setLang;
    document.getElementById('str-set-info').innerText = txt.setInfo;
    document.getElementById('str-btn-info').innerText = txt.btnInfo;
    document.getElementById('str-btn-donate').innerText = txt.btnDonate;
    document.getElementById('str-btn-close').innerText = txt.btnClose;
    document.getElementById('str-set-data').innerText = txt.setData;
    document.getElementById('str-btn-backup').innerText = txt.btnBackup;
    document.getElementById('str-btn-restore').innerText = txt.btnRestore;
    document.getElementById('str-set-ai-config').innerText = txt.setAiConfig;
    document.getElementById('gemini-desc').innerText = txt.geminiDesc;
    document.getElementById('gemini-api-key').placeholder = txt.geminiPlaceholder;
    document.getElementById('str-btn-update').innerText = txt.btnUpdate;
    document.getElementById('str-btn-clear-covers').innerText = txt.btnClearCovers;

    // Reader UI & Sidebar
    document.getElementById('str-nav-back').innerText = txt.navBack;
    document.getElementById('str-nav-toc').innerText = txt.navToc;
    document.getElementById('str-nav-bookmark').innerText = txt.navBookmark;
    document.getElementById('str-nav-text').innerText = txt.navText;
    document.getElementById('str-nav-full').innerText = txt.navFull;
    document.getElementById('str-toc-title').innerHTML = `<i data-lucide="list-tree"></i> ${txt.tocTitle}`;
    document.getElementById('str-bookmark-title').innerHTML = `<i data-lucide="bookmark"></i> ${txt.bookmarkTitle}`;
    document.getElementById('str-set-title').innerHTML = `<i data-lucide="sliders-horizontal"></i> ${txt.setTitle}`;
    
    // Search In Book
    document.getElementById('str-set-theme').innerText = txt.setTheme;
    document.getElementById('str-set-size').innerText = txt.setSize;
    document.getElementById('str-set-align').innerText = txt.setAlign;
    document.getElementById('str-set-font').innerText = txt.setFont;
    document.getElementById('inbook-search-input').placeholder = txt.searchPlaceholder;
    document.getElementById('str-reader-loading').innerText = txt.readerLoading;

    // Menu Buku (Options & Edit)
    document.getElementById('str-opt-pin').innerText = txt.optPin;
    document.getElementById('str-opt-select').innerText = txt.optSelect;
    document.getElementById('str-opt-edit').innerText = txt.optEdit;
    document.getElementById('str-opt-delete').innerText = txt.optDelete;
    document.getElementById('str-opt-cancel').innerText = txt.optCancel;

    document.getElementById('str-edit-title').innerText = txt.editTitle;
    document.getElementById('str-edit-book-title').innerText = txt.editBookTitle;
    document.getElementById('str-edit-book-cover').innerText = txt.editBookCover;
    document.getElementById('str-edit-book-shape').innerText = txt.editBookShape;
    document.getElementById('str-edit-cancel').innerText = txt.editCancel;
    document.getElementById('str-edit-save').innerText = txt.editSave;

    document.getElementById('shape-default').innerText = txt.shapeDyn;
    document.getElementById('shape-rounded').innerText = txt.shapeRound;
    document.getElementById('shape-square').innerText = txt.shapeSquare;

    // AI & Bookmark Modal
    document.getElementById('str-ai-title').innerHTML = `<i data-lucide="search" class="w-5 h-5 text-m3-primary"></i> ${txt.aiTitle}`;
    document.getElementById('str-bookmark-modal-title').innerHTML = `<i data-lucide="bookmark" class="w-5 h-5"></i> ${txt.bookmarkModalTitle}`;
    document.getElementById('bookmark-input-title').placeholder = txt.bookmarkTitlePlaceholder;
    document.getElementById('bookmark-input-text').placeholder = txt.bookmarkNotePlaceholder;
    document.getElementById('str-bookmark-cancel').innerText = txt.bookmarkCancel;
    document.getElementById('str-bookmark-save').innerText = txt.bookmarkSave;
    document.getElementById('str-bookmark-empty').innerText = txt.bookmarkEmpty;
    document.getElementById('bookmark-search-input').placeholder = txt.searchPlaceholder;

    // Batch Delete Bar
    document.getElementById('btn-batch-cancel').innerText = txt.cancel;
    document.getElementById('btn-batch-exec').innerText = txt.delete;

    // Raw Backup / Restore
    document.getElementById('str-raw-bak-title').innerText = txt.rawBakTitle;
    document.getElementById('str-raw-bak-desc').innerText = txt.rawBakDesc;
    document.getElementById('str-raw-bak-btn-close').innerText = txt.rawBakClose;
    document.getElementById('str-raw-bak-btn-copy').innerText = txt.rawBakCopy;

    document.getElementById('str-raw-res-title').innerText = txt.rawResTitle;
    document.getElementById('str-raw-res-desc').innerText = txt.rawResDesc;
    document.getElementById('str-raw-res-btn-file').innerText = txt.rawResFile;
    document.getElementById('str-raw-res-btn-process').innerText = txt.rawResProcess;
    document.getElementById('str-raw-res-btn-close').innerText = txt.rawResClose;

    // Type Backup Modal (Fix Bug 3 Bahasa)
    if(document.getElementById('str-bak-modal-title')) {
        document.getElementById('str-bak-modal-title').innerText = txt.bakModalTitle;
        document.getElementById('str-bak-modal-desc').innerText = txt.bakModalDesc;
        document.getElementById('str-bak-json-title').innerText = txt.bakJsonTitle;
        document.getElementById('str-bak-json-desc').innerText = txt.bakJsonDesc;
        document.getElementById('str-bak-zip-title').innerText = txt.bakZipTitle;
        document.getElementById('str-bak-zip-desc').innerText = txt.bakZipDesc;
        document.getElementById('str-bak-zip-warn').innerText = txt.bakZipWarn;
        document.getElementById('str-bak-cancel').innerText = txt.bakCancel;
    }

    // Refresh UI Status
    updateThemeUI();
    setWikiLang(wikiLang); // Ini sekadar rekursi visual btn aktif
}

// 3. PENGATURAN TEMA MATERIAL 3
function initTheme() {
    const savedKey = localStorage.getItem('m3-key');
    if (savedKey && M3_PALETTES[savedKey]) { currentThemeKey = savedKey; }
    
    // Pastikan kalau terang, amoled otomatis false
    if (!isDark) isAmoled = false;
    
    applyTheme();
}

window.setTheme = function(key) {
    if (!M3_PALETTES[key]) return;
    currentThemeKey = key;
    localStorage.setItem('m3-key', key);
    applyTheme();
}

window.toggleThemeState = function() {
    isDark = !isDark;
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (!isDark) {
        isAmoled = false;
        localStorage.setItem('amoled', 'false');
    }
    applyTheme();
}

window.toggleAmoled = function() {
    if (!isDark) return;
    isAmoled = !isAmoled;
    localStorage.setItem('amoled', isAmoled.toString());
    applyTheme();
}

function applyTheme() {
    const root = document.documentElement;
    const dynamicStyle = document.getElementById('dynamic-theme');
    const palette = M3_PALETTES[currentThemeKey];
    const txt = i18n[wikiLang] || i18n['id'];
    
    if (isDark) {
        root.classList.add('dark');
        
        // Cek mode AMOLED
        if (isAmoled) {
            let amoledCss = palette.dark;
            amoledCss = amoledCss.replace(/--md-sys-color-background:[^;]+;/, '--md-sys-color-background:#000000;');
            amoledCss = amoledCss.replace(/--md-sys-color-surface:[^;]+;/, '--md-sys-color-surface:#000000;');
            dynamicStyle.innerHTML = `:root { ${amoledCss} }`;
            document.querySelector('meta[name="theme-color"]').setAttribute('content', '#000000');
        } else {
            dynamicStyle.innerHTML = `:root { ${palette.dark} }`;
            const bgMatch = palette.dark.match(/--md-sys-color-background:([^;]+);/);
            if (bgMatch) document.querySelector('meta[name="theme-color"]').setAttribute('content', bgMatch[1]);
        }
        
        document.getElementById('theme-label-text').innerText = txt.themeDark;
        document.getElementById('theme-switch-bg').classList.replace('bg-m3-onSurfaceVariant/20', 'bg-m3-primary');
        document.getElementById('theme-switch-knob').style.transform = 'translateX(32px)';
        document.getElementById('theme-switch-icon').setAttribute('data-lucide', 'moon');
        document.getElementById('theme-switch-icon').classList.replace('text-m3-onSurface', 'text-m3-primary');
        
        document.getElementById('amoled-toggle-container').classList.remove('hidden');
        
    } else {
        root.classList.remove('dark');
        dynamicStyle.innerHTML = `:root { ${palette.light} }`;
        const bgMatch = palette.light.match(/--md-sys-color-background:([^;]+);/);
        if (bgMatch) document.querySelector('meta[name="theme-color"]').setAttribute('content', bgMatch[1]);
        
        document.getElementById('theme-label-text').innerText = txt.themeLight;
        document.getElementById('theme-switch-bg').classList.replace('bg-m3-primary', 'bg-m3-onSurfaceVariant/20');
        document.getElementById('theme-switch-knob').style.transform = 'translateX(0)';
        document.getElementById('theme-switch-icon').setAttribute('data-lucide', 'sun');
        document.getElementById('theme-switch-icon').classList.replace('text-m3-primary', 'text-m3-onSurface');
        
        document.getElementById('amoled-toggle-container').classList.add('hidden');
    }
    
    // Update visual tombol AMOLED
    const amBg = document.getElementById('amoled-switch-bg');
    const amKnob = document.getElementById('amoled-switch-knob');
    if (isAmoled) {
        amBg.classList.add('bg-m3-primary');
        amBg.classList.remove('bg-m3-onSurfaceVariant/20');
        amKnob.style.transform = 'translateX(32px)';
        amKnob.classList.add('bg-m3-onPrimary');
        amKnob.classList.remove('bg-m3-onSurface');
    } else {
        amBg.classList.remove('bg-m3-primary');
        amBg.classList.add('bg-m3-onSurfaceVariant/20');
        amKnob.style.transform = 'translateX(0)';
        amKnob.classList.remove('bg-m3-onPrimary');
        amKnob.classList.add('bg-m3-onSurface');
    }
    
    lucide.createIcons();
}

function updateThemeUI() {
    const txt = i18n[wikiLang] || i18n['id'];
    document.getElementById('str-amoled-label').innerText = txt.amoledLabel;
    if (isDark) {
        document.getElementById('theme-label-text').innerText = txt.themeDark;
    } else {
        document.getElementById('theme-label-text').innerText = txt.themeLight;
    }
}

// 4. RENDER UI PERPUSTAKAAN UTAMA
function renderLibrary(query = "") {
    DOM.grid.innerHTML = '';
    DOM.topSlider.innerHTML = '';
    
    const txt = i18n[wikiLang] || i18n['id'];
    
    if (library.length === 0) {
        DOM.empty.classList.remove('hidden');
        DOM.colHead.classList.add('hidden');
        DOM.topSection.classList.add('hidden');
        renderPinnedBooks();
        return;
    }
    
    DOM.empty.classList.add('hidden');
    DOM.colHead.classList.remove('hidden');

    let sorted = [...library].sort((a, b) => new Date(b.lastRead) - new Date(a.lastRead));
    let filtered = query ? sorted.filter(b => b.title.toLowerCase().includes(query)) : sorted;
    
    // Pisahin buku yang disematkan
    renderPinnedBooks(filtered);
    
    let regularBooks = filtered.filter(b => !b.pinned);

    // Kalo lagi gak cari buku, munculin slider "Lanjutkan Membaca"
    if (!query && sorted.length > 0) {
        DOM.topSection.classList.remove('hidden');
        const recent = sorted.slice(0, 5);
        recent.forEach(b => {
            const pct = Math.round(b.progress || 0);
            let shapeClass = 'rounded-3xl aspect-[3/4]'; // Default dinamis/rounded-3xl
            if (b.shape === 'square') shapeClass = 'rounded-none aspect-[3/4]';
            if (b.shape === 'rounded') shapeClass = 'rounded-[2rem] aspect-[3/4]';

            const card = document.createElement('div');
            card.className = `snap-start shrink-0 w-32 flex flex-col gap-2 relative group`;
            card.innerHTML = `
                <div onclick="openReader('${b.id}')" class="${shapeClass} bg-m3-surfaceVariant overflow-hidden shadow-sm relative cursor-pointer active:scale-95 transition-transform flex items-center justify-center">
                    ${b.cover_image ? `<img src="${b.cover_image}" class="w-full h-full object-cover" loading="lazy">` : `<div class="p-3 text-center opacity-40"><i data-lucide="book" class="w-8 h-8 mx-auto mb-2"></i><span class="text-[10px] font-bold leading-tight line-clamp-3">${b.title}</span></div>`}
                    <div class="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                        <div class="h-full bg-m3-primary" style="width: ${pct}%"></div>
                    </div>
                </div>
                <div class="flex items-start justify-between gap-1 px-1">
                    <p class="text-xs font-bold truncate flex-1 text-m3-onBg">${b.title}</p>
                    <span class="text-[9px] font-black opacity-60 shrink-0 mt-0.5">${pct}%</span>
                </div>
            `;
            DOM.topSlider.appendChild(card);
        });
    } else {
        DOM.topSection.classList.add('hidden');
    }

    // Render Grid Buku Biasa
    regularBooks.forEach(b => {
        const pct = Math.round(b.progress || 0);
        const isSel = selectedForDelete.includes(b.id);
        
        let shapeClass = 'rounded-3xl aspect-[3/4]';
        if (b.shape === 'square') shapeClass = 'rounded-none aspect-[3/4]';
        if (b.shape === 'rounded') shapeClass = 'rounded-[2rem] aspect-[3/4]';

        const card = document.createElement('div');
        card.className = `flex flex-col gap-2 relative group transition-transform ${isSel ? 'scale-90 opacity-70' : ''}`;
        card.innerHTML = `
            <div class="relative ${shapeClass} shadow-sm overflow-hidden bg-m3-surfaceVariant active:scale-95 transition-transform flex items-center justify-center cursor-pointer"
                 onclick="handleBookClick('${b.id}')">
                
                ${b.cover_image ? `<img src="${b.cover_image}" class="w-full h-full object-cover" loading="lazy">` : `<div class="p-3 text-center opacity-40"><i data-lucide="book" class="w-8 h-8 mx-auto mb-2"></i><span class="text-[10px] font-bold leading-tight line-clamp-3">${b.title}</span></div>`}
                
                <div class="absolute bottom-0 left-0 right-0 h-1 bg-black/20 z-10">
                    <div class="h-full bg-m3-primary" style="width: ${pct}%"></div>
                </div>

                ${isSel ? `
                <div class="absolute inset-0 bg-red-500/20 flex items-center justify-center z-20 backdrop-blur-sm">
                    <i data-lucide="check-circle" class="text-red-600 w-10 h-10 bg-white/80 rounded-full"></i>
                </div>
                ` : ''}

            </div>
            <div class="flex justify-between items-start px-1 gap-1">
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-bold truncate text-m3-onBg">${b.title}</p>
                    <p class="text-[10px] opacity-60 font-medium truncate mt-0.5">${b.type.toUpperCase()}</p>
                </div>
                <button onclick="openBookOptions('${b.id}')" class="w-6 h-6 flex items-center justify-center shrink-0 opacity-40 active:opacity-100 rounded-full btn-morph ${isBatchDeleteMode ? 'hidden' : ''}">
                    <i data-lucide="more-vertical" class="w-4 h-4"></i>
                </button>
            </div>
        `;
        DOM.grid.appendChild(card);
    });

    lucide.createIcons();
}

function renderPinnedBooks(filteredList = null) {
    const list = filteredList || library;
    const pinnedBooks = list.filter(b => b.pinned);
    
    if (pinnedBooks.length === 0) {
        DOM.pinSec.classList.add('hidden');
        return;
    }

    DOM.pinSec.classList.remove('hidden');
    DOM.pinGrid.innerHTML = '';

    pinnedBooks.forEach(b => {
        const pct = Math.round(b.progress || 0);
        const isSel = selectedForDelete.includes(b.id);
        
        let shapeClass = 'rounded-3xl aspect-[3/4]';
        if (b.shape === 'square') shapeClass = 'rounded-none aspect-[3/4]';
        if (b.shape === 'rounded') shapeClass = 'rounded-[2rem] aspect-[3/4]';

        const card = document.createElement('div');
        card.className = `flex flex-col gap-2 relative group transition-transform ${isSel ? 'scale-90 opacity-70' : ''}`;
        card.innerHTML = `
            <div class="relative ${shapeClass} shadow-sm overflow-hidden bg-m3-surfaceVariant active:scale-95 transition-transform flex items-center justify-center cursor-pointer"
                 onclick="handleBookClick('${b.id}')">
                
                ${b.cover_image ? `<img src="${b.cover_image}" class="w-full h-full object-cover" loading="lazy">` : `<div class="p-3 text-center opacity-40"><i data-lucide="book" class="w-8 h-8 mx-auto mb-2"></i><span class="text-[10px] font-bold leading-tight line-clamp-3">${b.title}</span></div>`}
                
                <div class="absolute bottom-0 left-0 right-0 h-1 bg-black/20 z-10">
                    <div class="h-full bg-m3-primary" style="width: ${pct}%"></div>
                </div>

                ${isSel ? `
                <div class="absolute inset-0 bg-red-500/20 flex items-center justify-center z-20 backdrop-blur-sm">
                    <i data-lucide="check-circle" class="text-red-600 w-10 h-10 bg-white/80 rounded-full"></i>
                </div>
                ` : ''}

            </div>
            <div class="flex justify-between items-start px-1 gap-1">
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-bold truncate text-m3-onBg">${b.title}</p>
                    <p class="text-[10px] opacity-60 font-medium truncate mt-0.5">${b.type.toUpperCase()}</p>
                </div>
                <button onclick="openBookOptions('${b.id}')" class="w-6 h-6 flex items-center justify-center shrink-0 opacity-40 active:opacity-100 rounded-full btn-morph ${isBatchDeleteMode ? 'hidden' : ''}">
                    <i data-lucide="more-vertical" class="w-4 h-4"></i>
                </button>
            </div>
        `;
        DOM.pinGrid.appendChild(card);
    });
    
    lucide.createIcons();
}

function updateStats() {
    const total = library.length;
    const reading = library.filter(b => b.progress > 0 && b.progress < 99).length;
    const completed = library.filter(b => b.progress >= 99).length;
    
    document.getElementById('stat-val-total').innerText = total;
    document.getElementById('stat-val-reading').innerText = reading;
    document.getElementById('stat-val-completed').innerText = completed;

    // Hitung total catatan dari localforage
    localforage.getItem('baca_annotations').then(notes => {
        let count = 0;
        if(notes) {
            Object.values(notes).forEach(arr => { count += arr.length; });
        }
        document.getElementById('stat-val-notes').innerText = count;
    });

    const statSec = document.getElementById('statistics-section');
    if (total === 0) {
        statSec.style.height = '0px';
        statSec.style.opacity = '0';
        statSec.style.marginBottom = '0px';
    } else {
        statSec.style.height = statSec.scrollHeight + 'px';
        statSec.style.opacity = '1';
        statSec.style.marginBottom = '2rem';
        setTimeout(() => { statSec.style.height = 'auto'; }, 300);
    }
}

// 5. FITUR: OPSI BUKU, EDIT, & HAPUS
window.openBookOptions = function(id) {
    activeOptsId = id;
    const b = library.find(x => x.id === id);
    if (!b) return;

    document.getElementById('opt-title').innerText = b.title;
    const txt = i18n[wikiLang] || i18n['id'];
    
    if (b.pinned) {
        document.getElementById('str-opt-pin').innerText = txt.optUnpin;
        document.getElementById('icon-opt-pin').setAttribute('data-lucide', 'pin-off');
        document.getElementById('icon-opt-pin').classList.add('text-red-500');
    } else {
        document.getElementById('str-opt-pin').innerText = txt.optPin;
        document.getElementById('icon-opt-pin').setAttribute('data-lucide', 'pin');
        document.getElementById('icon-opt-pin').classList.remove('text-red-500');
    }
    
    lucide.createIcons();
    openModal('b-opt-modal', 'b-opt-sheet', true);
}

window.togglePinBook = function() {
    if (!activeOptsId) return;
    const b = library.find(x => x.id === activeOptsId);
    if (b) {
        b.pinned = !b.pinned;
        saveLibrary();
        renderLibrary(document.getElementById('global-search').value.toLowerCase());
    }
    history.back();
}

window.triggerSelectMode = function() {
    history.back();
    setTimeout(() => { toggleBatchDelete(activeOptsId); }, 200);
}

window.triggerEditView = function() {
    history.back();
    setTimeout(() => {
        const b = library.find(x => x.id === activeOptsId);
        if (!b) return;
        document.getElementById('edit-book-id').value = b.id;
        document.getElementById('edit-book-title').value = b.title;
        selectShape(b.shape || 'default');
        openModal('edit-modal', 'edit-sheet', true);
    }, 300);
}

window.triggerDeleteView = function() {
    history.back();
    setTimeout(() => {
        const txt = i18n[wikiLang] || i18n['id'];
        showDialog("Hapus Buku", txt.deleteConfirm, "alert-triangle", [
            { text: txt.cancel, primary: false },
            { text: txt.delete, primary: true, danger: true, action: `deleteSingleBook('${activeOptsId}')` }
        ]);
    }, 300);
}

window.deleteSingleBook = function(id) {
    library = library.filter(b => b.id !== id);
    saveLibrary();
    renderLibrary(document.getElementById('global-search').value.toLowerCase());
    updateStats();
    _closeModalAction('custom-dialog', 'custom-dialog-sheet');
}

window.selectShape = function(shape) {
    document.getElementById('edit-book-shape').value = shape;
    document.querySelectorAll('[id^="shape-"]').forEach(el => {
        el.classList.remove('border-m3-primary', 'bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
        el.classList.add('border-transparent', 'bg-m3-surfaceVariant', 'text-m3-onSurfaceVariant');
    });
    const sel = document.getElementById(`shape-${shape}`);
    if(sel) {
        sel.classList.remove('border-transparent', 'bg-m3-surfaceVariant', 'text-m3-onSurfaceVariant');
        sel.classList.add('border-m3-primary', 'bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
    }
}

window.closeEditModal = function() {
    history.back();
}

window.saveBookEdit = async function() {
    const id = document.getElementById('edit-book-id').value;
    const title = document.getElementById('edit-book-title').value.trim();
    const coverFile = document.getElementById('edit-book-cover').files[0];
    const shape = document.getElementById('edit-book-shape').value;
    
    if (!title) return;

    let b = library.find(x => x.id === id);
    if (!b) return;

    b.title = title;
    b.shape = shape;

    if (coverFile) {
        b.cover_image = await readFileAsBase64(coverFile);
    }

    saveLibrary();
    renderLibrary(document.getElementById('global-search').value.toLowerCase());
    closeEditModal();
}

window.handleBookClick = function(id) {
    if (isBatchDeleteMode) {
        const idx = selectedForDelete.indexOf(id);
        if (idx > -1) {
            selectedForDelete.splice(idx, 1);
        } else {
            selectedForDelete.push(id);
        }
        updateBatchDeleteBar();
        renderLibrary(document.getElementById('global-search').value.toLowerCase());
    } else {
        openReader(id);
    }
}

window.toggleBatchDelete = function(initialId = null) {
    isBatchDeleteMode = !isBatchDeleteMode;
    selectedForDelete = initialId ? [initialId] : [];
    
    const bar = document.getElementById('batch-delete-bar');
    if (isBatchDeleteMode) {
        bar.classList.remove('translate-y-32');
        bar.classList.add('translate-y-0');
        document.getElementById('fab-container').classList.add('translate-y-32');
    } else {
        bar.classList.add('translate-y-32');
        bar.classList.remove('translate-y-0');
        document.getElementById('fab-container').classList.remove('translate-y-32');
    }
    updateBatchDeleteBar();
    renderLibrary(document.getElementById('global-search').value.toLowerCase());
}

function updateBatchDeleteBar() {
    const txt = i18n[wikiLang] || i18n['id'];
    document.getElementById('batch-delete-count').innerText = `${selectedForDelete.length} ${txt.selected}`;
}

window.executeBatchDelete = function() {
    if (selectedForDelete.length === 0) {
        toggleBatchDelete();
        return;
    }
    const txt = i18n[wikiLang] || i18n['id'];
    showDialog("Hapus Masal", txt.deleteConfirm, "alert-triangle", [
        { text: txt.cancel, primary: false },
        { text: txt.delete, primary: true, danger: true, action: `processBatchDelete()` }
    ]);
}

window.processBatchDelete = function() {
    library = library.filter(b => !selectedForDelete.includes(b.id));
    saveLibrary();
    toggleBatchDelete();
    updateStats();
    _closeModalAction('custom-dialog', 'custom-dialog-sheet');
}

window.clearAllCoversConfirm = function() {
    const txt = i18n[wikiLang] || i18n['id'];
    showDialog(
        txt.clearCoversTitle || "Hapus Semua Sampul?", 
        txt.clearCoversDesc || "Semua gambar sampul akan dihapus permanen untuk menghemat memori. Buku dan progres bacaan tetap aman 100%. Lanjutkan?", 
        "image-off", 
        [
            { text: txt.cancel || "Batal", primary: false },
            { text: "Hapus", primary: true, danger: true, action: "executeClearCovers()" }
        ]
    );
}

window.executeClearCovers = function() {
    library.forEach(b => {
        b.cover_image = null; // Kosongin gambar base64-nya
    });
    saveLibrary();
    renderLibrary(document.getElementById('global-search').value.toLowerCase());
    
    _closeModalAction('custom-dialog', 'custom-dialog-sheet');
    const txt = i18n[wikiLang] || i18n['id'];
    setTimeout(() => {
        showDialog("Sukses", txt.clearCoversSuccess || "Semua sampul berhasil dihapus!", "check-circle", [
            { text: "OK", primary: true }
        ]);
    }, 400);
}

// 6. READER UI LOGIC (Navigasi, Tampilan, dll)
window.openReader = function(id) {
    activeBookId = id;
    const b = library.find(x => x.id === id);
    if (!b) return;

    DOM.rTitle.innerText = b.title;
    DOM.rProgress.style.width = `${b.progress || 0}%`;
    DOM.rProgressTxt.innerText = `${Math.round(b.progress || 0)}%`;
    
    document.getElementById('inbook-search-input').value = '';
    document.getElementById('search-results-panel').classList.add('hidden');
    
    // Hide Status Bar (Capacitor)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) {
        window.Capacitor.Plugins.StatusBar.hide().catch(e => console.log(e));
    }

    DOM.readView.classList.remove('translate-y-full');
    DOM.readView.classList.add('translate-y-0');
    
    document.body.style.overflow = 'hidden';
    
    // History State biar tombol native back Android bisa tutup reader
    history.pushState({reader: true}, '', '#reader');
    
    loadBookContent(b);
    applyTypoSettings();
}

window.closeReader = function() {
    DOM.readView.classList.remove('translate-y-0');
    DOM.readView.classList.add('translate-y-full');
    document.body.style.overflow = '';
    
    // Show Status Bar again
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) {
        window.Capacitor.Plugins.StatusBar.show().catch(e => console.log(e));
    }
    
    if (activePanel) togglePanel(activePanel);
    hideSelectionMenu();
    updateStats();
    activeBookId = null;
    
    // Render ulang biar slider update
    renderLibrary(document.getElementById('global-search').value.toLowerCase());
}

document.getElementById('btn-back').addEventListener('click', () => { history.back(); });
document.getElementById('btn-toc').addEventListener('click', () => togglePanel(DOM.tocPanel, 'toc', 'btn-toc'));
document.getElementById('btn-settings').addEventListener('click', () => togglePanel(DOM.setPanel, 'settings', 'btn-settings'));

window.togglePanel = function(panel, name, btnId) {
    if (activePanel === panel) {
        panel.classList.remove('translate-x-0');
        panel.classList.add('translate-x-full');
        panel.classList.remove('opacity-100');
        panel.classList.add('opacity-0');
        DOM.sideOverlay.classList.add('hidden');
        activePanel = null;
        
        if(btnId) {
            document.getElementById(btnId).classList.remove('text-m3-primary');
            document.getElementById(btnId).classList.add('text-m3-onSurfaceVariant');
        }
        
        // Hapus hash panel jika pakai pushState
        if(window.location.hash.includes(name)) history.back();

    } else {
        if (activePanel) {
            activePanel.classList.remove('translate-x-0');
            activePanel.classList.add('translate-x-full');
            activePanel.classList.remove('opacity-100');
            activePanel.classList.add('opacity-0');
            // reset all btns
            ['btn-toc', 'btn-settings', 'btn-bookmarks'].forEach(id => {
                document.getElementById(id).classList.remove('text-m3-primary');
                document.getElementById(id).classList.add('text-m3-onSurfaceVariant');
            });
        }
        
        panel.classList.remove('translate-x-full');
        panel.classList.add('translate-x-0');
        panel.classList.remove('opacity-0');
        panel.classList.add('opacity-100');
        DOM.sideOverlay.classList.remove('hidden');
        activePanel = panel;
        
        if(btnId) {
            document.getElementById(btnId).classList.add('text-m3-primary');
            document.getElementById(btnId).classList.remove('text-m3-onSurfaceVariant');
        }

        if(name === 'bookmark') renderBookmarkPanel();
        
        history.pushState({panel: name}, '', '#' + name);
    }
}

DOM.sideOverlay.addEventListener('click', () => {
    history.back(); // Trigger popstate
});

window.toggleFullscreenReading = function() {
    const isFull = DOM.rBotBar.classList.contains('translate-y-full');
    if (isFull) {
        DOM.rBotBar.classList.remove('translate-y-full', 'opacity-0');
        DOM.rFloatHead.classList.remove('-translate-y-full', 'opacity-0');
        document.getElementById('btn-fullscreen').classList.remove('text-m3-primary');
    } else {
        DOM.rBotBar.classList.add('translate-y-full', 'opacity-0');
        DOM.rFloatHead.classList.add('-translate-y-full', 'opacity-0');
        document.getElementById('btn-fullscreen').classList.add('text-m3-primary');
    }
}

// Interaksi Reader (Ketuk layat tengah buat fullscreen)
DOM.rInner.addEventListener('click', (e) => {
    if (e.target.tagName.toLowerCase() === 'a' || e.target.closest('.annot-hl')) return;
    
    const rect = DOM.rInner.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Area klik tengah (20% margin kiri-kanan, 25% margin atas-bawah)
    if (x > rect.width * 0.2 && x < rect.width * 0.8 && y > rect.height * 0.25 && y < rect.height * 0.75) {
        if(document.getSelection().toString().trim().length === 0) {
            toggleFullscreenReading();
        }
    }
});

window.setReaderTheme = function(mode) {
    const r = document.documentElement;
    document.querySelectorAll('[id^="theme-btn-"]').forEach(el => {
        el.classList.remove('bg-m3-primary', 'text-m3-onPrimary');
    });
    
    if (mode === 'light') {
        isDark = false; isAmoled = false;
        document.getElementById('theme-btn-light').classList.add('bg-m3-primary', 'text-m3-onPrimary');
    } else if (mode === 'dark') {
        isDark = true; isAmoled = false;
        document.getElementById('theme-btn-dark').classList.add('bg-m3-primary', 'text-m3-onPrimary');
    } else if (mode === 'amoled') {
        isDark = true; isAmoled = true;
        document.getElementById('theme-btn-amoled').classList.add('bg-m3-primary', 'text-m3-onPrimary');
    }
    
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    localStorage.setItem('amoled', isAmoled.toString());
    applyTheme();
}

window.changeTypo = function(prop, val) {
    const root = document.documentElement;
    if(prop === 'size') {
        root.style.setProperty('--reader-size', val);
        localStorage.setItem('typo_size', val);
        highlightBtnGroup('typo-sz-', val, {'1rem':'sm', '1.2rem':'md', '1.5rem':'lg'});
    }
    if(prop === 'align') {
        root.style.setProperty('--reader-align', val);
        localStorage.setItem('typo_align', val);
        highlightBtnGroup('typo-al-', val, {'left':'left', 'center':'center', 'justify':'justify'});
    }
    if(prop === 'font') {
        const fonts = {
            'Lora': "'Lora', serif",
            'Merriweather': "'Merriweather', serif",
            'Playfair Display': "'Playfair Display', serif",
            'Inter': "'Inter', sans-serif",
            'Space Mono': "'Space Mono', monospace",
            'Google Sans Flex': "'Google Sans Flex', sans-serif"
        };
        root.style.setProperty('--reader-font', fonts[val] || fonts['Lora']);
        localStorage.setItem('typo_font', val);
        
        document.querySelectorAll('[id^="typo-fn-"]').forEach(el => {
            el.classList.remove('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer', 'border-m3-primary');
            el.classList.add('bg-m3-surface', 'border-transparent');
        });
        
        const map = {'Lora':'lora', 'Merriweather':'merri', 'Playfair Display':'playfair', 'Inter':'inter', 'Space Mono':'mono', 'Google Sans Flex':'google'};
        const btn = document.getElementById(`typo-fn-${map[val]}`);
        if(btn) {
            btn.classList.remove('bg-m3-surface', 'border-transparent');
            btn.classList.add('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer', 'border', 'border-m3-primary');
        }
    }
}

function highlightBtnGroup(prefix, val, map) {
    Object.values(map).forEach(suffix => {
        const el = document.getElementById(prefix + suffix);
        if(el) el.classList.remove('bg-m3-primary', 'text-m3-onPrimary');
    });
    const active = document.getElementById(prefix + map[val]);
    if(active) active.classList.add('bg-m3-primary', 'text-m3-onPrimary');
}

function applyTypoSettings() {
    const sz = localStorage.getItem('typo_size') || '1.2rem';
    const al = localStorage.getItem('typo_align') || 'left';
    const fn = localStorage.getItem('typo_font') || 'Lora';
    changeTypo('size', sz);
    changeTypo('align', al);
    changeTypo('font', fn);
    
    // Set theme btn state in panel
    document.querySelectorAll('[id^="theme-btn-"]').forEach(el => el.classList.remove('bg-m3-primary', 'text-m3-onPrimary'));
    if(!isDark) document.getElementById('theme-btn-light').classList.add('bg-m3-primary', 'text-m3-onPrimary');
    else if(isDark && !isAmoled) document.getElementById('theme-btn-dark').classList.add('bg-m3-primary', 'text-m3-onPrimary');
    else document.getElementById('theme-btn-amoled').classList.add('bg-m3-primary', 'text-m3-onPrimary');
}

// 7. IN-BOOK SEARCH LOGIC
document.getElementById('inbook-search-input').addEventListener('input', (e) => {
    clearTimeout(inbookSearchTimeout);
    const q = e.target.value.trim().toLowerCase();
    const panel = document.getElementById('search-results-panel');
    
    if (q.length < 3) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }
    
    inbookSearchTimeout = setTimeout(() => {
        const textNodes = getTextNodes(DOM.rInner);
        let results = [];
        let limit = 20;
        
        for (let i = 0; i < textNodes.length; i++) {
            const node = textNodes[i];
            const txt = node.nodeValue.toLowerCase();
            let idx = txt.indexOf(q);
            
            while (idx !== -1 && results.length < limit) {
                const start = Math.max(0, idx - 20);
                const end = Math.min(txt.length, idx + q.length + 20);
                let snippet = node.nodeValue.substring(start, end);
                snippet = snippet.replace(new RegExp(q, 'ig'), match => `<strong class="text-m3-primary">${match}</strong>`);
                
                results.push({ node: node, snippet: `...${snippet}...` });
                idx = txt.indexOf(q, idx + 1);
            }
            if (results.length >= limit) break;
        }
        
        panel.innerHTML = '';
        if (results.length > 0) {
            results.forEach(res => {
                const btn = document.createElement('button');
                btn.className = 'w-full text-left p-3 hover:bg-m3-surfaceVariant rounded-xl transition-colors border-b border-m3-surfaceVariant last:border-0 btn-morph';
                btn.innerHTML = `<p class="opacity-80">${res.snippet}</p>`;
                btn.onclick = () => {
                    res.node.parentElement.scrollIntoView({behavior: 'smooth', block: 'center'});
                    togglePanel(DOM.setPanel);
                };
                panel.appendChild(btn);
            });
            panel.classList.remove('hidden');
            panel.classList.add('flex');
        } else {
            const txtL = i18n[wikiLang] || i18n['id'];
            panel.innerHTML = `<div class="p-3 text-center opacity-50 font-bold">${txtL.searchNotFound}</div>`;
            panel.classList.remove('hidden');
            panel.classList.add('flex');
        }
    }, 500);
});

// 8. HIGHLIGHT / BOOKMARK ENGINE (Sistem Catatan dalam Buku)
document.addEventListener('selectionchange', () => {
    if (!activeBookId || activePanel) return;
    
    const sel = window.getSelection();
    const menu = document.getElementById('selection-menu');
    
    if (!sel || sel.isCollapsed || sel.toString().trim() === "") {
        hideSelectionMenu();
        return;
    }

    const range = sel.getRangeAt(0);
    
    // Pastikan seleksi ada di dalam reader
    if (!DOM.rInner.contains(range.commonAncestorContainer)) {
        hideSelectionMenu();
        return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0) return;

    // Simpan posisi seleksi pakai xpath / node index biar kuat pas dirender ulang
    const textNodes = getTextNodes(DOM.rInner);
    let startNodeIdx = textNodes.indexOf(range.startContainer);
    
    // Jika start container bukan text node langsung, cari anak pertamanya
    if (startNodeIdx === -1) {
        const tw = document.createTreeWalker(range.startContainer, NodeFilter.SHOW_TEXT, null, false);
        const firstText = tw.nextNode();
        if (firstText) startNodeIdx = textNodes.indexOf(firstText);
    }

    if (startNodeIdx !== -1) {
        currentSelection = {
            text: sel.toString(),
            nodeIdx: startNodeIdx,
            startOff: range.startOffset,
            endOff: range.endOffset, // Cuma akurat kalo select di dalem 1 node
            textToMatch: range.startContainer.nodeValue // fallback buat cocokin textnya
        };
        
        // Tampilkan floating menu
        menu.classList.remove('hidden');
        
        // Posisi menu relatif terhadap layar
        let top = rect.top - 60; 
        if (top < 80) top = rect.bottom + 10; 
        
        menu.style.top = `${top}px`;
        menu.style.left = `50%`;
        menu.style.transform = `translateX(-50%) scale(1)`;
        menu.classList.remove('opacity-0', 'scale-75');
        menu.classList.add('opacity-100');
    }
});

function hideSelectionMenu() {
    const menu = document.getElementById('selection-menu');
    menu.classList.remove('opacity-100');
    menu.classList.add('opacity-0', 'scale-75');
    setTimeout(() => { menu.classList.add('hidden'); }, 200);
}

window.copySelection = function() {
    if(currentSelection.text) {
        document.execCommand('copy'); 
        hideSelectionMenu();
        window.getSelection().removeAllRanges();
        showDialog("Sukses", "Teks disalin ke clipboard.", "check-circle", [{text: "OK", primary: true}]);
    }
}

window.openBookmarkModal = function(color, isEdit = false, annotData = null) {
    activeNoteColor = color;
    hideSelectionMenu();
    
    if (isEdit && annotData) {
        editingAnnotId = annotData.id;
        document.getElementById('bookmark-input-title').value = annotData.title || '';
        document.getElementById('bookmark-input-text').value = annotData.note || '';
        document.getElementById('btn-delete-bookmark').classList.remove('hidden');
    } else {
        editingAnnotId = null;
        document.getElementById('bookmark-input-title').value = '';
        document.getElementById('bookmark-input-text').value = currentSelection.text; // auto fill note dgn teks yg diselect
        document.getElementById('btn-delete-bookmark').classList.add('hidden');
    }
    
    openModal('bookmark-modal', 'bookmark-sheet', true);
}

window.saveBookmarkAnnotation = async function() {
    if (!activeBookId) return;
    
    const title = document.getElementById('bookmark-input-title').value.trim() || 'Highlight';
    const note = document.getElementById('bookmark-input-text').value.trim();
    
    let annots = await localforage.getItem('baca_annotations') || {};
    if (!annots[activeBookId]) annots[activeBookId] = [];

    if (editingAnnotId) {
        // Mode Update
        let target = annots[activeBookId].find(a => a.id === editingAnnotId);
        if (target) {
            target.title = title;
            target.note = note;
            target.color = activeNoteColor;
        }
    } else {
        // Mode Create Baru
        const newAnnot = {
            id: 'annot_' + Date.now(),
            title: title,
            note: note,
            color: activeNoteColor,
            textRef: currentSelection.text, // Simpan teks aslinya
            date: new Date().toISOString(),
            // Lokasi kasar untuk fallback
            progress: DOM.rInner.scrollTop / DOM.rInner.scrollHeight
        };
        annots[activeBookId].push(newAnnot);
    }

    await localforage.setItem('baca_annotations', annots);
    _closeModalAction('bookmark-modal', 'bookmark-sheet');
    window.getSelection().removeAllRanges();
    updateStats();
    
    // Kasih tau sukses
    setTimeout(() => {
        showDialog("Tersimpan", "Bookmark/Catatan berhasil disimpan.", "check-circle", [{text: "OK", primary: true}]);
    }, 400);
}

window.deleteBookmarkInsideModal = async function() {
    if (!editingAnnotId || !activeBookId) return;
    const txt = i18n[wikiLang] || i18n['id'];
    
    // Konfirmasi dulu
    _closeModalAction('bookmark-modal', 'bookmark-sheet');
    
    setTimeout(() => {
        showDialog("Hapus Catatan", txt.deleteNoteConfirm, "trash-2", [
            { text: txt.cancel, primary: false },
            { text: txt.delete, primary: true, danger: true, action: `executeDeleteAnnot()` }
        ]);
    }, 300);
}

window.executeDeleteAnnot = async function() {
    let annots = await localforage.getItem('baca_annotations') || {};
    if (annots[activeBookId]) {
        annots[activeBookId] = annots[activeBookId].filter(a => a.id !== editingAnnotId);
        await localforage.setItem('baca_annotations', annots);
    }
    _closeModalAction('custom-dialog', 'custom-dialog-sheet');
    updateStats();
    if(activePanel === DOM.bookmarkPanel) renderBookmarkPanel();
}

window.renderBookmarkPanel = async function() {
    if (!activeBookId) return;
    const list = document.getElementById('bookmark-list');
    const empty = document.getElementById('bookmark-empty');
    list.innerHTML = '';
    
    let annots = await localforage.getItem('baca_annotations') || {};
    let myAnnots = annots[activeBookId] || [];
    
    if (myAnnots.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    
    empty.classList.add('hidden');
    
    // Sort dari yang paling baru
    myAnnots.sort((a,b) => new Date(b.date) - new Date(a.date));

    // Ambil keyword search jika ada
    const kw = document.getElementById('bookmark-search-input').value.toLowerCase();

    myAnnots.forEach(an => {
        if(kw && !an.title.toLowerCase().includes(kw) && !an.note.toLowerCase().includes(kw)) return;

        let colorHex = '#EAB308'; // yellow
        if (an.color === 'green') colorHex = '#22C55E';
        if (an.color === 'pink') colorHex = '#EC4899';

        const btn = document.createElement('div');
        btn.className = 'w-full text-left p-4 bg-m3-surface rounded-2xl mb-2 flex flex-col gap-2 relative group';
        
        btn.innerHTML = `
            <div class="flex items-center gap-2 mb-1">
                <div class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${colorHex}"></div>
                <h4 class="font-bold text-sm text-m3-onSurface truncate flex-1">${an.title}</h4>
            </div>
            <p class="text-xs text-m3-onSurfaceVariant opacity-80 line-clamp-3 italic font-medium leading-relaxed">"${an.textRef || an.note}"</p>
            ${an.textRef && an.note !== an.textRef ? `<p class="text-xs text-m3-onSurface font-bold mt-1 line-clamp-2">Catatan: ${an.note}</p>` : ''}
            
            <button onclick='openBookmarkModal("${an.color}", true, ${JSON.stringify(an).replace(/'/g, "&apos;")})' class="absolute top-2 right-2 w-8 h-8 rounded-full bg-m3-surfaceVariant flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity btn-morph">
                <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
            </button>
        `;
        list.appendChild(btn);
    });
    lucide.createIcons();
}

window.filterBookmarkPanel = function(val) {
    renderBookmarkPanel();
}

// Helper DOM 
function getTextNodes(node) {
    let textNodes = [];
    if (node.nodeType == 3) {
        if(node.nodeValue.trim() !== "") textNodes.push(node);
    } else {
        for (let i = 0, len = node.childNodes.length; i < len; ++i) {
            textNodes.push.apply(textNodes, getTextNodes(node.childNodes[i]));
        }
    }
    return textNodes;
}

// 9. SISTEM BACKUP & RESTORE DATA (JSON & ZIP)
window.generateJsonBackup = async function() {
    let data = await localforage.getItem('baca_library') || [];
    let notes = await localforage.getItem('baca_annotations') || {};
    let config = { theme: currentThemeKey, isDark, isAmoled, wikiLang };
    
    // Hapus konten besar biar JSON jadi ringan (progress & list doang)
    let lightweightBooks = data.map(b => ({
        ...b,
        cover_image: null,
        book_content: null
    }));

    return {
        version: window.APP_VERSION,
        date: new Date().toISOString(),
        type: 'json',
        books: lightweightBooks,
        annotations: notes,
        config: config
    };
}

window.generateZipBackup = async function() {
    let data = await localforage.getItem('baca_library') || [];
    let notes = await localforage.getItem('baca_annotations') || {};
    let config = { theme: currentThemeKey, isDark, isAmoled, wikiLang };
    
    const zip = new JSZip();
    
    // 1. Buat file core data (tanpa konten)
    let coreBooks = data.map(b => ({
        ...b,
        cover_image: b.cover_image ? b.id + '.img' : null,
        book_content: b.book_content ? b.id + '.txt' : null
    }));

    let exportData = {
        version: window.APP_VERSION,
        date: new Date().toISOString(),
        type: 'zip',
        books: coreBooks,
        annotations: notes,
        config: config
    };
    
    zip.file("core_data.json", JSON.stringify(exportData));
    
    // 2. Folder file berat
    const booksFolder = zip.folder("books");
    const coversFolder = zip.folder("covers");
    
    for(let b of data) {
        if(b.book_content) booksFolder.file(b.id+'.txt', b.book_content);
        if(b.cover_image) coversFolder.file(b.id+'.img', b.cover_image); 
    }
    
    // 3. Generate file (pake STORE atau compression level 1 biar kenceng di HP)
    const zipBlob = await zip.generateAsync({type: "blob", compression: "DEFLATE", compressionOptions: {level: 1}});
    return zipBlob;
}

window.executeBackup = async function(type) {
    // 1. Langsung tutup Modal Pilihan Backup seketika
    _closeModalAction('backup-type-modal', 'backup-type-sheet');
    
    // 2. Tunggu dikit biar animasi nutup mulus
    setTimeout(async () => {
        const txt = i18n[wikiLang] || i18n['id'];
        const title = txt.bakLoadingTitle;
        const desc = type === 'zip' ? txt.bakZipLoading : txt.bakJsonLoading;
        
        // 3. Tampilkan Loading Dialog (tombol kosong = ga bisa di-close sembarangan)
        showDialog(title, `
            <div class="flex flex-col items-center justify-center gap-4 py-4">
                <div class="w-8 h-8 border-4 border-m3-primary border-t-transparent rounded-full animate-spin"></div>
                <p class="text-xs font-bold text-center opacity-80 leading-relaxed">${desc}</p>
            </div>
        `, "info", []);

        try {
            if (type === 'zip') {
                const zipBlob = await generateZipBackup();
                downloadFile(zipBlob, `Baca_Full_Backup_${new Date().toISOString().split('T')[0]}.zip`, 'application/zip');
            } else {
                const jsonObj = await generateJsonBackup();
                downloadFile(JSON.stringify(jsonObj), `Baca_Progress_Backup_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
            }

            // 4. Tutup loading
            _closeModalAction('custom-dialog', 'custom-dialog-sheet');
            
            // 5. Munculin konfirmasi sukses
            setTimeout(() => {
                const successTitle = txt.bakSuccessTitle || "Backup Sukses";
                const successDesc = type === 'zip' ? txt.bakSuccessZip : txt.bakSuccessJson;
                showDialog(successTitle, successDesc, "check-circle", [{text: txt.btnClose || "Tutup", primary: true}]);
            }, 400);

        } catch (e) {
            console.error("Backup gagal", e);
            _closeModalAction('custom-dialog', 'custom-dialog-sheet');
            setTimeout(() => {
                showDialog("Error", `Gagal memproses backup: ${e.message}`, "alert-triangle", [{text: "Tutup", primary: true}]);
            }, 400);
        }
    }, 300);
}

function downloadFile(content, fileName, mimeType) {
    // Fallback sistem download file di web/browser/webview
    const a = document.createElement("a");
    if (mimeType === 'application/zip') {
        const url = URL.createObjectURL(content); // content is Blob
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
    } else {
        const file = new Blob([content], {type: mimeType});
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(a.href); }, 100);
    }
}

// Restore & Import LOGIC (Multi-Format)
window.openRestoreOptions = function() {
    const txt = i18n[wikiLang] || i18n['id'];
    showDialog(txt.rawResTitle, txt.rawResDesc, "download-cloud", [
        { text: txt.rawResClose, primary: false },
        { text: txt.rawResFile, primary: true, action: "document.getElementById('import-upload').click(); _closeModalAction('custom-dialog', 'custom-dialog-sheet');" }
    ]);
}

window.importDataFile = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const txt = i18n[wikiLang] || i18n['id'];
    const isZip = file.name.toLowerCase().endsWith('.zip');
    
    showDialog("Memproses Data", `<div class="flex items-center gap-3"><div class="w-5 h-5 border-2 border-m3-primary border-t-transparent rounded-full animate-spin"></div><p>${isZip ? txt.zipExtract : "Membaca JSON..."}</p></div>`, "info", []);

    if (isZip) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const zip = await JSZip.loadAsync(e.target.result);
                
                // 1. Baca Core JSON
                const coreFile = zip.file("core_data.json");
                if(!coreFile) throw new Error("Format ZIP tidak valid. core_data.json tidak ditemukan.");
                const coreText = await coreFile.async("string");
                const data = JSON.parse(coreText);
                
                // 2. Tanya konfirmasi sebelum nge-timpa
                _closeModalAction('custom-dialog', 'custom-dialog-sheet');
                setTimeout(() => {
                    const confirmMsg = txt.zipRestoreConfirm.replace('{n}', data.books.length);
                    showDialog("Konfirmasi Restore", confirmMsg, "alert-circle", [
                        { text: txt.cancel, primary: false },
                        { text: "Restore Sekarang", primary: true, action: `processZipRestoreData(${JSON.stringify(data)}, zip)` }
                    ]);
                    // Kita simpan object ZIP ke memori global sementara biar bisa diakses eksekutor
                    window.tempZipObject = zip;
                }, 400);

            } catch (err) {
                _closeModalAction('custom-dialog', 'custom-dialog-sheet');
                showDialog("Error ZIP", err.message, "alert-triangle", [{text: "Tutup", primary: true}]);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                _closeModalAction('custom-dialog', 'custom-dialog-sheet');
                processRestoreData(data);
            } catch (err) {
                _closeModalAction('custom-dialog', 'custom-dialog-sheet');
                showDialog("Error JSON", "Format file tidak valid.", "alert-triangle", [{text: "Tutup", primary: true}]);
            }
        };
        reader.readAsText(file);
    }
    event.target.value = '';
}

window.processZipRestoreData = async function(coreData, zipInput) {
    const zip = window.tempZipObject || zipInput;
    _closeModalAction('custom-dialog', 'custom-dialog-sheet');
    
    setTimeout(async () => {
        showDialog("Memulihkan...", `<div class="flex items-center gap-3"><div class="w-5 h-5 border-2 border-m3-primary border-t-transparent rounded-full animate-spin"></div><p>Merakit kembali buku-buku lu...</p></div>`, "info", []);
        
        try {
            // Gabungin file teks dan gambar dari folder ZIP balik ke objek books
            for(let i=0; i<coreData.books.length; i++) {
                let b = coreData.books[i];
                if(b.book_content && typeof b.book_content === 'string') { // itu berarti string nama file, e.g. "id.txt"
                    const txtFile = zip.file("books/" + b.book_content);
                    if(txtFile) b.book_content = await txtFile.async("string");
                }
                if(b.cover_image && typeof b.cover_image === 'string') {
                    const imgFile = zip.file("covers/" + b.cover_image);
                    if(imgFile) b.cover_image = await imgFile.async("base64"); // convert balik ke base64 string
                    // pastikan format base64 bener (data:image/jpeg;base64,.....)
                    if(b.cover_image && !b.cover_image.startsWith("data:image")) {
                        b.cover_image = "data:image/jpeg;base64," + b.cover_image; // asumsi jpeg untuk kemudahan
                    }
                }
            }
            
            // Lanjut ke proses restore standar
            await finishRestore(coreData);
            window.tempZipObject = null; // bersihkan memori
        } catch(e) {
            _closeModalAction('custom-dialog', 'custom-dialog-sheet');
            showDialog("Error Ekstrak", e.message, "alert-triangle", [{text: "Tutup", primary: true}]);
        }
    }, 400);
}

window.processRestoreData = async function(data) {
    if (!data.books || !data.version) {
        showDialog("Error", "Format data tidak valid untuk Baca versi ini.", "alert-triangle", [{text: "Tutup", primary: true}]);
        return;
    }
    await finishRestore(data);
}

async function finishRestore(data) {
    // Gabung atau timpa data (saat ini timpa total library + config)
    library = data.books;
    await localforage.setItem('baca_library', library);
    
    if (data.annotations) {
        await localforage.setItem('baca_annotations', data.annotations);
    }

    if (data.config) {
        if(data.config.theme) setTheme(data.config.theme);
        isDark = !!data.config.isDark;
        isAmoled = !!data.config.isAmoled;
        if(data.config.wikiLang) setWikiLang(data.config.wikiLang);
        
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        localStorage.setItem('amoled', isAmoled.toString());
        applyTheme();
    }

    renderLibrary(document.getElementById('global-search').value.toLowerCase());
    updateStats();
    
    const txt = i18n[wikiLang] || i18n['id'];
    _closeModalAction('custom-dialog', 'custom-dialog-sheet');
    
    setTimeout(() => {
        showDialog("Berhasil", "Semua data sukses dipulihkan. Halaman akan dimuat ulang untuk sinkronisasi.", "check-circle", [{text: "OK", primary: true, action: "location.reload()"}]);
    }, 400);
}

// (Raw Backup Logic untuk Android/PWA ketat - Jika Download blob di-blok)
window.copyRawBackup = function() {
    const text = document.getElementById('raw-backup-textarea');
    text.select();
    document.execCommand('copy');
    showDialog("Sukses", "Teks backup berhasil disalin. Simpan di tempat aman!", "check-circle", [{text: "Tutup", primary: true}]);
}
window.processRawRestore = function() {
    const text = document.getElementById('raw-restore-textarea').value.trim();
    if(!text) return;
    try {
        const data = JSON.parse(text);
        _closeModalAction('raw-restore-modal', 'raw-restore-sheet');
        processRestoreData(data);
    } catch(e) {
        showDialog("Error", "Teks JSON tidak valid / rusak.", "alert-triangle", [{text: "Tutup", primary: true}]);
    }
}

// 10. MODAL / DIALOG SYSTEM ENGINE
window.openModal = function(modalId, sheetId, pushHistory = false) {
    const m = document.getElementById(modalId);
    const s = document.getElementById(sheetId);
    m.classList.remove('hidden');
    
    // Matikan scroll background
    document.body.style.overflow = 'hidden';
    
    setTimeout(() => {
        m.classList.remove('opacity-0');
        if (s.classList.contains('translate-y-full')) {
            s.classList.remove('translate-y-full');
        }
        if (s.classList.contains('scale-75')) {
            s.classList.remove('scale-75', 'translate-y-12');
        }
        if (pushHistory) {
            history.pushState({modal: modalId}, '', '#' + modalId);
        }
    }, 10);
}

window._closeModalAction = function(modalId, sheetId, isFromBtn = false) {
    const m = document.getElementById(modalId);
    const s = document.getElementById(sheetId);
    
    if(!m || !s) return;

    m.classList.add('opacity-0');
    if (s.id === 'global-settings-sheet' || s.id === 'b-opt-sheet' || s.id === 'ai-sheet') {
        s.classList.add('translate-y-full');
    } else {
        s.classList.add('scale-75', 'translate-y-12');
    }
    
    setTimeout(() => { 
        m.classList.add('hidden'); 
        
        // Cek kalau gada panel/reader yg kebuka, kembalikan scroll
        if(DOM.readView.classList.contains('translate-y-full') && !activePanel) {
            document.body.style.overflow = '';
        }

        if(isFromBtn && (window.history.state !== null || window.location.hash !== '')) {
            history.back(); // bersih-bersih hash url
        }
    }, 300);
}

window.closeWelcome = function() {
    _closeModalAction('welcome-modal', 'welcome-sheet', true);
}

window.showDialog = function(title, message, iconStr, buttons) {
    const dTitle = document.getElementById('dialog-title');
    const dMsg = document.getElementById('dialog-message');
    const dIcon = document.getElementById('dialog-icon');
    const dActions = document.getElementById('dialog-actions');

    dTitle.innerText = title;
    dMsg.innerHTML = message; // support HTML like bold/br/loading
    dIcon.setAttribute('data-lucide', iconStr);
    
    dActions.innerHTML = '';
    
    buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.innerText = b.text;
        
        if (b.primary) {
            if (b.danger) {
                btn.className = "px-6 py-2.5 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 font-bold rounded-full btn-morph text-sm";
            } else {
                btn.className = "px-6 py-2.5 bg-m3-primary text-m3-onPrimary font-bold rounded-full btn-morph text-sm shadow-sm";
            }
        } else {
            btn.className = "px-4 py-2.5 bg-transparent text-m3-onSurface font-bold rounded-full btn-morph text-sm opacity-80 hover:opacity-100";
        }
        
        btn.onclick = () => {
            if (b.action) {
                // Eksekusi action string sebagai fungsi
                new Function(b.action)();
            } else {
                _closeModalAction('custom-dialog', 'custom-dialog-sheet', true);
            }
        };
        dActions.appendChild(btn);
    });

    lucide.createIcons();
    openModal('custom-dialog', 'custom-dialog-sheet', true);
}

// 11. GESTURE SWIPE-TO-DISMISS MODALS
function initGestureDismiss() {
    let startY = 0, currentY = 0;
    const sheets = ['global-settings-sheet', 'b-opt-sheet', 'edit-sheet', 'bookmark-sheet', 'ai-sheet', 'welcome-sheet', 'custom-dialog-sheet', 'raw-backup-sheet', 'raw-restore-sheet', 'backup-type-sheet'];

    sheets.forEach(id => {
        const sheet = document.getElementById(id);
        if (!sheet) return;
        
        sheet.addEventListener('touchstart', (e) => {
            // DETEKSI SCROLLING: Cek kalau user lagi neken area yang bisa di-scroll
            let target = e.target;
            let isScrollableArea = false;
            
            while (target && target !== sheet && target !== document.body) {
                const style = window.getComputedStyle(target);
                const overflowY = style.overflowY;
                
                if (overflowY === 'auto' || overflowY === 'scroll') {
                    // Kalau area bisa di-scroll dan posisi scroll gak di paling atas, MATIKAN swipe-to-dismiss!
                    if (target.scrollTop > 0) {
                        isScrollableArea = true;
                        break;
                    }
                }
                target = target.parentNode;
            }

            if (isScrollableArea) {
                sheet.dataset.preventSwipe = "true";
            } else {
                sheet.dataset.preventSwipe = "false";
            }

            startY = e.touches[0].clientY;
            sheet.style.transition = 'none';
        }, { passive: true });

        sheet.addEventListener('touchmove', (e) => {
            if (sheet.dataset.preventSwipe === "true") return;

            currentY = e.touches[0].clientY;
            let diffY = currentY - startY;
            
            // Cuma nge-drag kalau tarik ke BAWAH
            if (diffY > 0) {
                if (id === 'global-settings-sheet' || id === 'b-opt-sheet' || id === 'ai-sheet') {
                    sheet.style.transform = `translateY(${diffY}px)`;
                } else {
                    sheet.style.transform = `scale(0.75) translateY(${12 + (diffY * 0.5)}px)`;
                }
            }
        }, { passive: true });

        sheet.addEventListener('touchend', () => {
            if (sheet.dataset.preventSwipe === "true") return;

            sheet.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
            let diffY = currentY - startY;
            
            if (diffY > 120) {
                // Swipe sukses, tutup modal via history.back biar rapi state urutannya
                history.back();
                setTimeout(() => { sheet.style.transform = ''; }, 100);
            } else { 
                // Snap back ke posisi awal kalau nanggung
                if (id === 'global-settings-sheet' || id === 'b-opt-sheet' || id === 'ai-sheet') {
                    sheet.style.transform = 'translateY(0)';
                } else {
                    sheet.style.transform = ''; 
                }
            }
        });
    });

    // Sidebar swipe dismiss
    const sidePanels = [DOM.tocPanel, DOM.setPanel, DOM.bookmarkPanel];
    sidePanels.forEach(panel => {
        panel.addEventListener('touchstart', e => { startY = e.touches[0].clientX; panel.style.transition = 'none'; }, {passive:true});
        panel.addEventListener('touchmove', e => {
            currentY = e.touches[0].clientX;
            let diffX = currentY - startY;
            if(diffX > 0) panel.style.transform = `translateX(${diffX}px)`;
        }, {passive:true});
        panel.addEventListener('touchend', () => {
            panel.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
            let diffX = currentY - startY;
            if (diffX > 100) {
                history.back(); 
                setTimeout(() => { panel.style.transform = ''; }, 100);
            } else { 
                panel.style.transform = 'translateX(0)';
            }
        });
    });
}

// 12. PWA & CAPACITOR SETUP (SW / Update Handler)
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
    self.addEventListener('fetch', (e) => { e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
    `;
    const blob = new Blob([swCode], {type: 'application/javascript'});
    navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(err => console.log("SW Error:", err));
}

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if (window.Capacitor && window.Capacitor.Plugins) {
            const capApp = window.Capacitor.Plugins.App;
            const statusBar = window.Capacitor.Plugins.StatusBar;
            
            if (statusBar) {
                statusBar.setOverlaysWebView({ overlay: true }).catch(()=>{});
            }

            // Integrasi Native Hardware Back Button (Kalo Android)
            capApp.addListener('backButton', () => {
                if(window.history.state !== null || window.location.hash !== '') {
                    window.history.back();
                } else if (!DOM.readView.classList.contains('translate-y-full')) {
                    closeReader();
                } else {
                    capApp.exitApp();
                }
            });
        }
    }, 1000);
});

// AUTO UPDATE CHECKER
window.checkForUpdate = async function() {
    const btnIcon = document.getElementById('icon-update-app');
    const txt = i18n[wikiLang] || i18n['id'];

    if(btnIcon) btnIcon.classList.add('animate-spin');
    
    try {
        const response = await fetch(window.UPDATE_URL + "?t=" + new Date().getTime());
        if(!response.ok) throw new Error("Gagal mengambil data dari Github Repo.");
        
        const data = await response.json();
        const latestVer = data.version;
        const currVer = window.APP_VERSION;
        
        if(btnIcon) btnIcon.classList.remove('animate-spin');

        if(latestVer !== currVer) {
            showDialog(txt.updateAvailableTitle, txt.updateAvailableDesc, "download-cloud", [
                { text: txt.btnClose, primary: false },
                { text: txt.btnDownload, primary: true, action: `window.open('${window.RELEASES_URL}', '_system'); _closeModalAction('custom-dialog', 'custom-dialog-sheet');` }
            ]);
        } else {
            showDialog(txt.updateLatestTitle, txt.updateLatestDesc, "check-circle", [
                { text: "OK", primary: true }
            ]);
        }
    } catch(err) {
        console.error(err);
        if(btnIcon) btnIcon.classList.remove('animate-spin');
        showDialog("Update Gagal", txt.updateError, "alert-triangle", [
            { text: "Tutup", primary: true }
        ]);
    }
}
