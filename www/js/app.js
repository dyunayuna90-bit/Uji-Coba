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
        file: document.getElementById('doc-upload'), 
        backBtn: document.getElementById('btn-back'),
        tocBtn: document.getElementById('btn-toc'), 
        setBtn: document.getElementById('settings-btn'),
        inner: document.getElementById('reader-inner'), 
        title: document.getElementById('reader-title'), 
        count: document.getElementById('library-count'),
        tocPanel: document.getElementById('toc-panel'), 
        tocList: document.getElementById('toc-list'),
        setPanel: document.getElementById('settings-panel'),
        bookmarkPanel: document.getElementById('bookmark-panel'),
        bookmarkList: document.getElementById('bookmark-list'),
        readContent: document.getElementById('reader-content'), 
        progBar: document.getElementById('reading-progress-bar'), 
        progTxt: document.getElementById('reader-progress-text'),
        searchInput: document.getElementById('inbook-search-input'), 
        searchRes: document.getElementById('search-results-panel'),
        globalSearch: document.getElementById('global-search')
    });

    setupScrollListeners();
    setupSearchListeners();
    syncWikiLangUI();
    applyLanguage();
    applyTypo();
    applyThemeToDOM();
    loadLibrary();
    setupSwipeToDismiss(); // Nyalain Gestur Aman

    if (!localStorage.getItem('first_time_seen_v5')) {
        setTimeout(() => { openModal('welcome-modal', 'welcome-sheet', true); }, 500);
    }
    
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey && document.getElementById('gemini-api-key')) document.getElementById('gemini-api-key').value = savedKey;
    const savedModel = localStorage.getItem('gemini_model');
    if(savedModel && document.getElementById('gemini-model-select')) document.getElementById('gemini-model-select').value = savedModel;

    // Update versi app di layar pengaturan
    const verDisplay = document.getElementById('app-version-display');
    if (verDisplay && window.APP_VERSION) verDisplay.textContent = `v${window.APP_VERSION}`;
});

// Update UI Statistik
window.updateStatistics = function() {
    let totalBooks = library.length;
    let readingBooks = 0;
    let completedBooks = 0;
    let totalNotes = 0;

    library.forEach(book => {
        let pct = parseInt(book.progressPct) || 0;
        
        if (pct > 0 && pct < 100) readingBooks++;
        else if (pct === 100) completedBooks++;
        
        if (book.annotations && Array.isArray(book.annotations)) {
            totalNotes += book.annotations.length;
        }
    });

    const valTotal = document.getElementById('stat-val-total');
    const valReading = document.getElementById('stat-val-reading');
    const valCompleted = document.getElementById('stat-val-completed');
    const valNotes = document.getElementById('stat-val-notes');
    
    if(valTotal) valTotal.textContent = totalBooks;
    if(valReading) valReading.textContent = readingBooks;
    if(valCompleted) valCompleted.textContent = completedBooks;
    if(valNotes) valNotes.textContent = totalNotes;
};

// 2. SCROLL & NAVIGATION LISTENERS
function setupScrollListeners() {
    const libScroll = document.getElementById('library-content-scroll');
    if(libScroll && DOM.mainHeader) {
        libScroll.addEventListener('scroll', () => {
            if (libScroll.scrollTop > 5) { DOM.mainHeader.classList.add('shadow-[0_2px_10px_rgba(0,0,0,0.05)]'); } 
            else { DOM.mainHeader.classList.remove('shadow-[0_2px_10px_rgba(0,0,0,0.05)]'); }
        });
    }

    let lastScrollTop = 0;
    if(DOM.readContent) {
        DOM.readContent.addEventListener('scroll', () => {
            const bottomBar = document.getElementById('reader-bottom-bar');
            if (bottomBar && bottomBar.classList.contains('hidden')) return;

            const currentScroll = DOM.readContent.scrollTop;
            const header = document.getElementById('reader-floating-header');
            
            if (currentScroll > lastScrollTop && currentScroll > 50) {
                header.classList.add('-translate-y-[150%]', 'opacity-0');
                header.classList.remove('translate-y-0', 'opacity-100');
            } else {
                header.classList.remove('-translate-y-[150%]', 'opacity-0');
                header.classList.add('translate-y-0', 'opacity-100');
            }
            lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;
        }, { passive: true });
    }
}

function updateBottomNavUI(activeId) {
    const btns = ['btn-toc', 'btn-bookmarks', 'btn-settings'];
    btns.forEach(id => {
        const b = document.getElementById(id);
        if(b) {
            b.classList.remove('bg-m3-primary', 'text-m3-onPrimary', 'nav-active');
            b.classList.add('text-m3-onSurfaceVariant');
        }
    });
    if(activeId) {
        const act = document.getElementById(activeId);
        if(act) {
            act.classList.add('bg-m3-primary', 'text-m3-onPrimary', 'nav-active');
            act.classList.remove('text-m3-onSurfaceVariant');
        }
    }
}

// 3. HARDWARE BACK BUTTON & HISTORY ROUTING
window.addEventListener('popstate', (e) => {
    if (!document.getElementById('raw-backup-modal').classList.contains('opacity-0')) { _closeModalAction('raw-backup-modal', 'raw-backup-sheet', true, true); }
    else if (!document.getElementById('raw-restore-modal').classList.contains('opacity-0')) { _closeModalAction('raw-restore-modal', 'raw-restore-sheet', true, true); }
    else if (!document.getElementById('zip-restore-modal').classList.contains('opacity-0')) { _closeModalAction('zip-restore-modal', 'zip-restore-sheet', true, true); }
    else if (!document.getElementById('custom-dialog').classList.contains('opacity-0')) { window.closeDialog(true); }
    else if (!document.getElementById('ai-modal').classList.contains('opacity-0')) { closeAiModal(true); }
    else if (!document.getElementById('bookmark-modal').classList.contains('opacity-0')) { _closeModalAction('bookmark-modal', 'bookmark-sheet', true, true); }
    else if (!document.getElementById('b-opt-modal').classList.contains('opacity-0')) { _closeModalAction('b-opt-modal', 'b-opt-sheet', false, true); }
    else if (!document.getElementById('edit-modal').classList.contains('opacity-0')) { _closeModalAction('edit-modal', 'edit-sheet', true, true); }
    else if (!document.getElementById('global-settings-modal').classList.contains('opacity-0')) { _closeModalAction('global-settings-modal', 'global-settings-sheet', false, true); }
    else if (!document.getElementById('welcome-modal').classList.contains('opacity-0')) { closeWelcome(true); }
    else if (isBatchDeleteMode) { window.toggleBatchDelete(true); }
    else if (activePanel) { _closeSidePanelsAction(true); } 
    else if (document.getElementById('search-area').classList.contains('search-active')) { closeSearch(true); }
    else if (document.getElementById('reader-bottom-bar') && document.getElementById('reader-bottom-bar').classList.contains('hidden')) { window.toggleFullscreenReading(true); }
    else if (DOM.readView && !DOM.readView.classList.contains('translate-y-full')) { _closeReaderAction(true); }
});

function pushAppHistory(stateName) { history.pushState({ state: stateName }, '', `#${stateName}`); }

// 4. SEARCH & I18N
function setupSearchListeners() {
    const searchArea = document.getElementById('search-area');
    const searchCapsule = document.querySelector('.search-capsule');
    
    document.addEventListener('click', (e) => {
        if (searchArea && searchArea.classList.contains('search-active') && !searchArea.contains(e.target)) {
            window.closeSearch(false);
        }
    });

    if(DOM.globalSearch) {
        DOM.globalSearch.addEventListener('focus', () => {
            if (!searchArea.classList.contains('search-active')) {
                searchArea.classList.add('search-active');
                if (window.location.hash !== '#search') pushAppHistory('search');
            }
        });
        DOM.globalSearch.addEventListener('input', (e) => {
            // Auto-hide statistik saat search
            const statSection = document.getElementById('statistics-section');
            if(statSection) {
                if(e.target.value.trim().length > 0) {
                    statSection.style.height = '0px';
                    statSection.style.opacity = '0';
                    statSection.style.marginBottom = '0px';
                } else {
                    statSection.style.height = '';
                    statSection.style.opacity = '1';
                    statSection.style.marginBottom = '';
                }
            }
            renderLibrary(e.target.value);
        });
    }

    if(searchCapsule) {
        searchCapsule.addEventListener('click', (e) => {
            if (searchArea.classList.contains('search-active')) {
                if (e.target !== DOM.globalSearch) { window.closeSearch(false); }
            } else { DOM.globalSearch.focus(); }
        });
    }
}

window.closeSearch = function(fromHistory = false) {
    const searchArea = document.getElementById('search-area');
    const statSection = document.getElementById('statistics-section');

    if (searchArea && searchArea.classList.contains('search-active')) {
        searchArea.classList.remove('search-active');
        DOM.globalSearch.blur(); DOM.globalSearch.value = ''; 
        
        if(statSection) {
             statSection.style.height = '';
             statSection.style.opacity = '1';
             statSection.style.marginBottom = '';
        }

        renderLibrary();
        if (!fromHistory && window.location.hash === '#search') history.back();
    }
};

const setElementText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };

function applyLanguage() {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    if (!Object.keys(d).length) return;

    setElementText('str-lib-empty', d.libEmpty); setElementText('str-continue-reading', d.continueReading);
    setElementText('str-book-collection', d.bookCollection); setElementText('loading-text', d.loadingDocs);
    setElementText('btn-batch-cancel', d.cancel); setElementText('btn-batch-exec', d.delete);
    setElementText('str-opt-select', d.optSelect); setElementText('str-opt-edit', d.optEdit);
    setElementText('str-opt-delete', d.optDelete); setElementText('str-opt-cancel', d.optCancel);
    
    setElementText('str-pinned-books', d.pinnedBooks);
    setElementText('str-nav-bookmark', d.navBookmark);
    if (document.getElementById('str-bookmark-title')) { document.getElementById('str-bookmark-title').innerHTML = `<i data-lucide="bookmark"></i> ${d.bookmarkTitle}`; }
    setElementText('str-bookmark-empty', d.bookmarkEmpty);
    
    setElementText('str-bookmark-cancel', d.bookmarkCancel); setElementText('str-bookmark-save', d.bookmarkSave);
    if (document.getElementById('str-bookmark-modal-title')) { document.getElementById('str-bookmark-modal-title').innerHTML = `<i data-lucide="bookmark" class="w-5 h-5"></i> ${d.bookmarkModalTitle}`; }
    if (document.getElementById('bookmark-input-title')) document.getElementById('bookmark-input-title').placeholder = d.bookmarkTitlePlaceholder;
    if (document.getElementById('bookmark-input-text')) document.getElementById('bookmark-input-text').placeholder = d.bookmarkNotePlaceholder;
    
    setElementText('str-wel-title', d.welcomeTitle); setElementText('str-wel-desc', d.welcomeDesc);
    setElementText('str-wel-backup', d.welBackup); 
    if(document.getElementById('str-wel-backup-desc')) document.getElementById('str-wel-backup-desc').innerHTML = d.welBackupDesc;
    setElementText('str-wel-format', d.welFormat); 
    if(document.getElementById('str-wel-format-desc')) document.getElementById('str-wel-format-desc').innerHTML = d.welFormatDesc;
    setElementText('str-wel-privacy', d.welPrivacy); setElementText('str-wel-privacy-desc', d.welPrivacyDesc);
    setElementText('str-wel-btn', d.welBtn);
    
    setElementText('str-set-main-title', d.setMainTitle); setElementText('str-set-palette', d.setPalette);
    setElementText('str-set-lang', d.setLang); setElementText('str-set-info', d.setInfo);
    setElementText('str-set-data', d.setData); setElementText('str-btn-backup', d.btnBackup); setElementText('str-btn-restore', d.btnRestore);
    setElementText('str-btn-info', d.btnInfo); setElementText('str-btn-donate', d.btnDonate);
    setElementText('str-btn-close', d.btnClose);
    
    setElementText('str-set-ai-config', d.setAiConfig);
    if(document.getElementById('gemini-api-key')) document.getElementById('gemini-api-key').placeholder = d.geminiPlaceholder;
    setElementText('gemini-desc', d.geminiDesc);
    
    setElementText('str-btn-update', d.btnUpdate);
    setElementText('str-btn-clear-covers', d.btnClearCovers);

    setElementText('str-nav-back', d.navBack); setElementText('str-nav-toc', d.navToc);
    setElementText('str-nav-text', d.navText); setElementText('str-nav-full', d.navFull);
    setElementText('str-set-search', d.navSearch);
    
    setElementText('str-reader-loading', d.readerLoading); setElementText('str-toc-title', d.tocTitle);
    setElementText('str-set-title', d.setTitle); setElementText('str-set-theme', d.setTheme);
    setElementText('str-set-size', d.setSize); setElementText('str-set-align', d.setAlign);
    setElementText('str-set-font', d.setFont);
    
    setElementText('str-ai-title', d.aiTitle); setElementText('str-ai-loading', d.aiLoading);
    
    setElementText('str-edit-title', d.editTitle); setElementText('str-edit-book-title', d.editBookTitle);
    setElementText('str-edit-book-cover', d.editBookCover); setElementText('str-edit-book-shape', d.editBookShape);
    setElementText('str-edit-cancel', d.editCancel); setElementText('str-edit-save', d.editSave);
    setElementText('str-amoled-label', d.amoledLabel);
    
    setElementText('shape-default', d.shapeDyn);
    setElementText('shape-rounded', d.shapeRound);
    setElementText('shape-square', d.shapeSquare);
   
    setElementText('str-raw-bak-title', d.rawBakTitle); setElementText('str-raw-bak-desc', d.rawBakDesc);
    setElementText('str-raw-bak-btn-close', d.rawBakClose); setElementText('str-raw-bak-btn-copy', d.rawBakCopy);
    setElementText('str-raw-res-title', d.rawResTitle); setElementText('str-raw-res-desc', d.rawResDesc);
    setElementText('str-raw-res-btn-file', d.rawResFile); setElementText('str-raw-res-btn-process', d.rawResProcess);
    setElementText('str-raw-res-btn-close', d.rawResClose);

    if(DOM.globalSearch) DOM.globalSearch.placeholder = d.searchBooks;
    if(DOM.searchInput) DOM.searchInput.placeholder = d.searchPlaceholder;
    if(DOM.count) DOM.count.textContent = `${(library.length)} ${d.booksCount}`;
    
    const themeLabel = document.getElementById('theme-label-text');
    if (themeLabel) themeLabel.textContent = isDark ? d.themeDark : d.themeLight;

    updateBatchSelectionUI();

    setElementText('str-stat-title', d.statTitle || "Statistik");
    setElementText('str-stat-total', d.statTotal || "Koleksi");
    setElementText('str-stat-reading', d.statReading || "Dibaca");
    setElementText('str-stat-completed', d.statCompleted || "Selesai");
    setElementText('str-stat-notes', d.statNotes || "Catatan");
}

window.setWikiLang = function(lang) {
    wikiLang = lang; localStorage.setItem('wiki_lang', lang); syncWikiLangUI(); applyLanguage();
    if(activeBookId) renderBookmarkPanel(); 
};

window.saveGeminiModel = function() {
    const model = document.getElementById('gemini-model-select').value;
    localStorage.setItem('gemini_model', model);
};

window.saveGeminiKey = function() {
    const key = document.getElementById('gemini-api-key').value.trim();
    localStorage.setItem('gemini_api_key', key);
    const d = i18n[wikiLang] || i18n['id'];
    showDialog('Info', d.keySaved || "API Key berhasil disimpan.", 'check-circle', [{text: 'Oke', primary: true}]);
};

function syncWikiLangUI() {
    const wid = document.getElementById('wiki-lang-id');
    const wen = document.getElementById('wiki-lang-en');
    const wes = document.getElementById('wiki-lang-es');
    if(wid && wen) {
        [wid, wen, wes].forEach(el => { 
            if(el) {
                el.classList.remove('bg-m3-primary', 'text-m3-onPrimary'); 
                el.classList.add('text-m3-onSurfaceVariant'); 
            }
        });
        if (wikiLang === 'id') { wid.classList.add('bg-m3-primary', 'text-m3-onPrimary'); wid.classList.remove('text-m3-onSurfaceVariant'); }
        else if (wikiLang === 'es') { if (wes) { wes.classList.add('bg-m3-primary', 'text-m3-onPrimary'); wes.classList.remove('text-m3-onSurfaceVariant'); } }
        else { wen.classList.add('bg-m3-primary', 'text-m3-onPrimary'); wen.classList.remove('text-m3-onSurfaceVariant'); }
    }
}

// 5. CUSTOM DIALOG & MODALS
window.showDialog = function(title, message, iconStr, buttons) {
    pushAppHistory('custom-dialog');
    const m = document.getElementById('custom-dialog');
    const s = document.getElementById('custom-dialog-sheet');
    
    document.getElementById('dialog-title').innerText = title;
    document.getElementById('dialog-message').innerText = message;
    
    const iconContainer = document.getElementById('dialog-icon-container');
    if(iconContainer) iconContainer.classList.remove('animate-spin');

    const iconEl = document.getElementById('dialog-icon');
    if(iconEl) iconEl.setAttribute('data-lucide', iconStr);
    
    const actionsContainer = document.getElementById('dialog-actions');
    actionsContainer.innerHTML = '';
    
    buttons.forEach(btn => {
        const b = document.createElement('button');
        b.innerText = btn.text;
        if (btn.primary) {
            b.className = "px-6 py-2 bg-m3-primary text-m3-onPrimary font-bold rounded-full btn-morph tracking-wide";
        } else {
            b.className = "px-4 py-2 bg-transparent text-m3-onSurfaceVariant font-bold rounded-full btn-morph tracking-wide";
        }
        b.onclick = () => {
            if(btn.action) btn.action();
            else window.closeDialog();
        };
        actionsContainer.appendChild(b);
    });
    
    if(window.lucide) window.lucide.createIcons();

    m.classList.remove('hidden');
    requestAnimationFrame(() => {
        m.classList.remove('opacity-0');
        s.classList.remove('scale-75');
    });
};

window.closeDialog = function(isFromHistory = false) {
    if (!isFromHistory) { history.back(); return; }
    const m = document.getElementById('custom-dialog');
    const s = document.getElementById('custom-dialog-sheet');
    
    s.classList.add('scale-75');
    m.classList.add('opacity-0');
    setTimeout(() => m.classList.add('hidden'), 300);
};

window.openModal = function(modalId, sheetId, isScale = false) {
    pushAppHistory(`modal-${modalId}`);
    const m = document.getElementById(modalId); const s = document.getElementById(sheetId);
    if(m && s) {
        m.classList.remove('hidden'); 
        requestAnimationFrame(() => { 
            m.classList.remove('opacity-0'); 
            if(isScale) { s.classList.remove('scale-75', 'translate-y-12'); } 
            else { s.classList.remove('translate-y-full'); } 
        });
    }
}

window._closeModalAction = function(modalId, sheetId, isScale = false, isFromHistory = false) {
    if (!isFromHistory) { history.back(); return; }
    const m = document.getElementById(modalId); const s = document.getElementById(sheetId);
    if(m && s) {
        if(isScale) { s.classList.add('scale-75', 'translate-y-12'); } 
        else { s.classList.add('translate-y-full'); }
        m.classList.add('opacity-0'); setTimeout(() => m.classList.add('hidden'), 300);
    }
}

window.closeWelcome = function(isFromHistory = false) {
    _closeModalAction('welcome-modal', 'welcome-sheet', true, isFromHistory || (window.location.hash !== '#modal-welcome'));
    localStorage.setItem('first_time_seen_v5', 'true');
};

// 6. LOGIKA CEK PEMBARUAN & HAPUS SAMPUL
function compareVersions(v1, v2) {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const num1 = p1[i] || 0;
        const num2 = p2[i] || 0;
        if (num1 > num2) return 1; 
        if (num1 < num2) return -1; 
    }
    return 0; 
}

window.checkForUpdate = async function() {
    const icon = document.getElementById('icon-update-app');
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    
    if(!window.UPDATE_URL) return;
    if(icon) icon.classList.add('animate-spin');
    
    try {
        const res = await fetch(window.UPDATE_URL + '?t=' + new Date().getTime());
        if (!res.ok) throw new Error("Gagal terhubung ke GitHub");
        
        const data = await res.json();
        const latestVersion = data.version;
        const currentVersion = window.APP_VERSION;

        if(icon) icon.classList.remove('animate-spin');

        if (compareVersions(latestVersion, currentVersion) > 0) {
            showDialog(
                d.updateAvailableTitle || "Update Tersedia!",
                (d.updateAvailableDesc || "Versi {v} udah rilis nih. Mau buka halaman download sekarang?").replace('{v}', latestVersion),
                "arrow-up-circle",
                [
                    { text: d.cancel || "Batal", primary: false },
                    { text: d.btnDownload || "Download", primary: true, action: () => {
                        window.closeDialog();
                        if(window.RELEASES_URL) window.open(window.RELEASES_URL, '_blank');
                    }}
                ]
            );
        } else {
            showDialog(
                d.updateLatestTitle || "Sudah Versi Terbaru",
                d.updateLatestDesc || `Aplikasi lu udah pakai versi paling baru (v${currentVersion}).`,
                "check-circle",
                [{ text: "Oke", primary: true }]
            );
        }
    } catch (err) {
        console.error("Cek update gagal:", err);
        if(icon) icon.classList.remove('animate-spin');
        showDialog("Error", d.updateError || "Gagal ngecek update. Pastiin internet lu nyala.", "wifi-off", [{ text: "Tutup", primary: true }]);
    }
};

window.clearAllCoversConfirm = function() {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    if (!library || library.length === 0) {
        showDialog("Info", d.libEmpty || "Perpustakaan kosong.", "info", [{ text: "Oke", primary: true }]);
        return;
    }

    showDialog(
        d.clearCoversTitle || "Hapus Semua Sampul?",
        d.clearCoversDesc || "Semua gambar sampul akan dihapus permanen untuk menghemat memori. Buku dan progres bacaan tetap aman 100%. Lanjutkan?",
        "image-off",
        [
            { text: d.cancel || "Batal", primary: false },
            { text: d.delete || "Hapus", primary: true, action: async () => {
                window.closeDialog();
                
                for (let book of library) {
                    await localforage.removeItem('cover_' + book.id);
                }
                
                renderLibrary(DOM.globalSearch ? DOM.globalSearch.value : "");
                
                setTimeout(() => {
                    showDialog("Sukses", d.clearCoversSuccess || "Semua sampul berhasil dihapus! Aplikasi sekarang jauh lebih ringan.", "check-circle", [{ text: "Mantap", primary: true }]);
                }, 400);
            }}
        ]
    );
};

// 7. BACKUP & RESTORE DATA (OPTIMASI STREAMING APPEND + NO COVER BACKUP + ZIP SUPPORT)

// ─── HELPER: Siapkan array progress-only (no nodes, no cover) ─────────────────
function _buildProgressOnlyArray() {
    return library.map(b => {
        let stripped = { ...b };
        delete stripped.nodes;
        delete stripped.coverBase64;
        return stripped;
    });
}

// ─── BACKUP JSON (Native Streaming / Fallback Raw Text) ───────────────────────
window.exportData = async function() {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    try {
        if (!library || library.length === 0) {
            showDialog("Info", d.backupEmpty || "Ga ada buku untuk di-backup.", "info", [{ text: "Oke", primary: true }]);
            return;
        }

        showDialog(
            d.backupProcessingTitle || "Memproses Backup",
            d.backupProcessingDesc || "Mohon tunggu sebentar, menyiapkan file lu...",
            "loader", 
            []
        );
        
        const iconContainer = document.getElementById('dialog-icon-container');
        if(iconContainer) iconContainer.classList.add('animate-spin');

        setTimeout(async () => {
            try {
                // KALO NATIVE APP (CAPACITOR ADA) -> PAKE APPEND FILE (Anti Force Close)
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                    const dt = new Date();
                    const fileName = `Baca_Progress_${dt.getFullYear()}${('0'+(dt.getMonth()+1)).slice(-2)}${('0'+dt.getDate()).slice(-2)}_${dt.getTime()}.json`;
                    let displayFileName = fileName.length > 30 ? fileName.substring(0, 20) + "..." + fileName.slice(-10) : fileName;
                    
                    try {
                        // Tulis Kurung Kotak Awal
                        await window.Capacitor.Plugins.Filesystem.writeFile({
                            path: fileName, data: '[\n', directory: 'DOCUMENTS', encoding: 'utf8'
                        });

                        // Tulis data per buku (Streaming Output — anti force close)
                        for (let i = 0; i < library.length; i++) {
                            let strippedBook = { ...library[i] };
                            
                            // PASTIKAN COVER & NODES GA IKUT DIBACKUP.
                            // Ini BUKAN backup isi buku — hanya progress & catatan.
                            delete strippedBook.coverBase64;
                            delete strippedBook.nodes;

                            let chunk = JSON.stringify(strippedBook);
                            if (i < library.length - 1) chunk += ',\n';

                            // Append ke file yg udah ada
                            await window.Capacitor.Plugins.Filesystem.appendFile({
                                path: fileName, data: chunk, directory: 'DOCUMENTS', encoding: 'utf8'
                            });

                            // Yield ke Event Loop (Biar CPU/RAM HP bisa nafas)
                            await new Promise(r => setTimeout(r, 20));
                        }

                        // Tutup Kurung Kotak
                        await window.Capacitor.Plugins.Filesystem.appendFile({
                            path: fileName, data: '\n]', directory: 'DOCUMENTS', encoding: 'utf8'
                        });
                        
                        showDialog(
                            d.backupSuccessTitle || "Backup Sukses",
                            (d.backupSuccessDesc || "File backup progress berhasil disimpan di folder Documents HP lu.\nNama file: {f}\n\n⚠️ Ingat: backup ini hanya menyimpan progress & catatan, BUKAN isi buku. Saat restore, kamu perlu upload ulang file bukunya terlebih dahulu.").replace('{f}', displayFileName),
                            "check-circle", 
                            [{ text: d.backupSuccessBtn || "Mantap", primary: true }]
                        );
                        return; 
                    } catch (fsError) {
                        console.log("Capacitor write gagal, beralih ke teks raw.", fsError);
                    }
                }
                
                // FALLBACK JIKA BUKAN APK / CAPACITOR GAGAL (Raw Backup)
                let rawData = _buildProgressOnlyArray();
                const rawStr = JSON.stringify(rawData);
                document.getElementById('raw-backup-textarea').value = rawStr;
                
                window.closeDialog(true);
                setTimeout(() => {
                    openModal('raw-backup-modal', 'raw-backup-sheet', true);
                    setTimeout(() => {
                        showDialog(
                            d.backupFallbackTitle || "Info Backup Mentah",
                            d.backupFallbackDesc || "Simpan ke file native gagal. Salin teks JSON ini dan simpan di Notes/WhatsApp/file teks.\n\n⚠️ Ingat: ini hanya backup progress & catatan, BUKAN isi buku. Saat restore, upload ulang bukunya dulu.",
                            "info",
                            [{ text: d.backupFallbackBtn || "Mengerti", primary: true }]
                        );
                    }, 400);
                }, 350);
                
            } catch (err) {
                console.error("Backup failed:", err);
                showDialog("Error", "Backup gagal: " + err.message, "alert-triangle", [{ text: "Tutup", primary: true }]);
            }
        }, 150);

    } catch (err) {
        console.error("Backup failed:", err);
        showDialog("Error", "Backup gagal: " + err.message, "alert-triangle", [{ text: "Tutup", primary: true }]);
    }
};

// ─── BACKUP ZIP (KOMPLIT: nodes + progress + catatan + cover, streaming per-buku) ──
window.exportDataZip = async function() {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    try {
        if (!library || library.length === 0) {
            showDialog("Info", d.backupEmpty || "Ga ada buku untuk di-backup.", "info", [{ text: "Oke", primary: true }]);
            return;
        }
        if (typeof JSZip === 'undefined') {
            showDialog("Error", d.zipLibMissing || "Library JSZip tidak ditemukan. Pastikan jszip.min.js sudah ter-load.", "alert-triangle", [{ text: "Tutup", primary: true }]);
            return;
        }

        showDialog(
            d.backupZipProcessingTitle || "Membuat Backup ZIP Komplit",
            d.backupZipProcessingDesc || "Mengemas seluruh isi buku, progress & catatan ke dalam ZIP... Proses ini bisa memakan waktu beberapa menit tergantung jumlah buku. Mohon jangan tutup aplikasi.",
            "loader",
            []
        );
        const iconContainer = document.getElementById('dialog-icon-container');
        if(iconContainer) iconContainer.classList.add('animate-spin');

        // Beri waktu UI render dulu sebelum kerja berat
        await new Promise(r => setTimeout(r, 200));

        try {
            const zip = new JSZip();
            const manifest = []; // Index buku yang masuk ZIP

            // Proses per-buku: ambil nodes dari localforage, masukkan ke ZIP satu per satu
            for (let i = 0; i < library.length; i++) {
                const book = library[i];

                // Ambil nodes (isi teks parsed) dari localforage — ini data terbesarnya
                const nodes = await localforage.getItem('content_' + book.id) || book.nodes || [];

                // Ambil cover jika ada
                const cover = await localforage.getItem('cover_' + book.id) || null;

                // Susun objek buku komplit
                const fullBook = {
                    ...book,
                    nodes: nodes,
                    coverBase64: cover || undefined
                };
                // Hapus field undefined supaya JSON bersih
                if (!fullBook.coverBase64) delete fullBook.coverBase64;

                // Masukkan setiap buku sebagai file JSON tersendiri di dalam ZIP
                // Format: books/buku-0.json, books/buku-1.json, dst.
                // Ini supaya ZIP ga perlu parse satu JSON raksasa sekaligus saat restore
                zip.file(`books/book_${i}.json`, JSON.stringify(fullBook));

                // Tambahkan ke manifest (ringan, cuma metadata)
                manifest.push({ index: i, id: book.id, title: book.title, type: book.type || '' });

                // Yield ke event loop tiap buku — anti force close
                await new Promise(r => setTimeout(r, 30));
            }

            // Tambahkan manifest sebagai index utama di ZIP
            zip.file('manifest.json', JSON.stringify({ version: window.APP_VERSION || '2.0.5', totalBooks: library.length, books: manifest }));

            const dt = new Date();
            const zipFileName = `Baca_Full_${dt.getFullYear()}${('0'+(dt.getMonth()+1)).slice(-2)}${('0'+dt.getDate()).slice(-2)}_${dt.getTime()}.zip`;

            // Generate ZIP (DEFLATE level 6 — balance speed vs size)
            // Teks sangat compressible, ukuran akhir bisa 60-80% lebih kecil dari JSON mentah
            const zipBlob = await zip.generateAsync(
                { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
                (metadata) => {
                    // Update dialog progress jika bisa
                    const pct = Math.round(metadata.percent);
                    const iconEl = document.getElementById('dialog-message');
                    if (iconEl) iconEl.innerText = (d.backupZipCompressing || "Mengompresi... {p}%").replace('{p}', pct);
                }
            );

            // KALO NATIVE APP (CAPACITOR ADA) → tulis langsung ke Documents
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                try {
                    const base64Data = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.onerror = reject;
                        reader.readAsDataURL(zipBlob);
                    });

                    await window.Capacitor.Plugins.Filesystem.writeFile({
                        path: zipFileName, data: base64Data, directory: 'DOCUMENTS'
                    });

                    let displayFileName = zipFileName.length > 30 ? zipFileName.substring(0, 20) + "..." + zipFileName.slice(-8) : zipFileName;
                    const sizeMB = (zipBlob.size / (1024 * 1024)).toFixed(1);

                    showDialog(
                        d.backupZipSuccessTitle || "Backup ZIP Komplit Sukses!",
                        (d.backupZipSuccessDesc || "File ZIP ({s} MB) berhasil disimpan di folder Documents HP lu.\nNama file: {f}\n\n✅ ZIP ini menyimpan SELURUH isi buku + progress + catatan. Restore ZIP = langsung bisa baca, tanpa upload ulang.").replace('{f}', displayFileName).replace('{s}', sizeMB),
                        "check-circle",
                        [{ text: d.backupSuccessBtn || "Mantap", primary: true }]
                    );
                    return;
                } catch (fsError) {
                    console.log("Capacitor ZIP write gagal, fallback ke download browser.", fsError);
                }
            }

            // FALLBACK: Download via browser (PWA / Web)
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);

            const sizeMB = (zipBlob.size / (1024 * 1024)).toFixed(1);
            showDialog(
                d.backupZipSuccessTitle || "Backup ZIP Komplit Sukses!",
                (d.backupZipSuccessDescWeb || "File ZIP ({s} MB) berhasil diunduh.\n\n✅ ZIP ini menyimpan SELURUH isi buku + progress + catatan. Restore ZIP = langsung bisa baca, tanpa upload ulang.").replace('{s}', sizeMB),
                "check-circle",
                [{ text: d.backupSuccessBtn || "Mantap", primary: true }]
            );

        } catch (err) {
            console.error("Backup ZIP failed:", err);
            showDialog("Error", (d.backupZipError || "Backup ZIP gagal: ") + err.message, "alert-triangle", [{ text: "Tutup", primary: true }]);
        }

    } catch (err) {
        console.error("Backup ZIP failed:", err);
        showDialog("Error", (d.backupZipError || "Backup ZIP gagal: ") + err.message, "alert-triangle", [{ text: "Tutup", primary: true }]);
    }
};

// ─── COPY RAW BACKUP ──────────────────────────────────────────────────────────
window.copyRawBackup = function() {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    const textarea = document.getElementById('raw-backup-textarea');
    textarea.select();
    textarea.setSelectionRange(0, 9999999); 
    
    try {
        document.execCommand('copy');
        const btnSpan = document.getElementById('str-raw-bak-btn-copy');
        const originalText = btnSpan.innerText;
        btnSpan.innerText = d.copiedConfirm || "Berhasil Disalin!";
        setTimeout(() => { btnSpan.innerText = originalText; }, 2000);
    } catch (err) {
        showDialog("Error", "Gagal menyalin otomatis. Silakan blok semua teks secara manual dan salin.", "alert-circle", [{ text: "Tutup", primary: true }]);
    }
};

// ─── BUKA OPSI RESTORE (JSON) ─────────────────────────────────────────────────
window.openRestoreOptions = function() {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    // Tampilkan dialog pilih metode restore dulu
    showDialog(
        d.restoreChooseTitle || "Pulihkan Data",
        d.restoreChooseDesc || "File backup Baca hanya menyimpan progress & catatan — BUKAN isi buku.\n\nSetelah restore, buku yang belum ada di library harus diupload ulang filenya supaya bisa dibaca lagi. Pilih format backup kamu:",
        "download-cloud",
        [
            { text: d.restoreChooseZip || "File ZIP", primary: false, action: () => {
                window.closeDialog();
                setTimeout(() => { document.getElementById('import-upload-zip').click(); }, 300);
            }},
            { text: d.restoreChooseJson || "File / Teks JSON", primary: true, action: () => {
                window.closeDialog();
                setTimeout(() => {
                    document.getElementById('raw-restore-textarea').value = '';
                    openModal('raw-restore-modal', 'raw-restore-sheet', true);
                }, 300);
            }}
        ]
    );
};

// ─── PROSES RESTORE JSON (dari textarea) ─────────────────────────────────────
window.processRawRestore = function() {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    const val = document.getElementById('raw-restore-textarea').value.trim();
    if(!val) {
        showDialog("Info", d.restoreEmptyBox || "Kotak teks masih kosong.", "info", [{ text: "Oke", primary: true }]);
        return;
    }
    // Tutup modal restore dulu sebelum proses agar dialog konfirmasi tidak tertindih
    _closeModalAction('raw-restore-modal', 'raw-restore-sheet', true, true);
    history.back();
    setTimeout(() => { executeRestoreLogic(val); }, 350);
};

// ─── IMPORT FILE JSON ─────────────────────────────────────────────────────────
window.importDataFile = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        // Tutup modal restore jika masih terbuka
        const restoreModal = document.getElementById('raw-restore-modal');
        if (restoreModal && !restoreModal.classList.contains('hidden')) {
            _closeModalAction('raw-restore-modal', 'raw-restore-sheet', true, true);
            history.back();
            setTimeout(() => { executeRestoreLogic(e.target.result); }, 350);
        } else {
            executeRestoreLogic(e.target.result);
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
};

// ─── IMPORT FILE ZIP (RESTORE KOMPLIT) ───────────────────────────────────────
window.importDataZip = async function(event) {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    if (typeof JSZip === 'undefined') {
        showDialog("Error", d.zipLibMissing || "Library JSZip tidak ditemukan.", "alert-triangle", [{ text: "Tutup", primary: true }]);
        return;
    }

    showDialog(
        d.zipRestoreProcessingTitle || "Membaca File ZIP...",
        d.zipRestoreProcessingDesc || "Sedang membuka arsip ZIP, mohon tunggu...",
        "loader",
        []
    );
    const iconContainer = document.getElementById('dialog-icon-container');
    if(iconContainer) iconContainer.classList.add('animate-spin');

    await new Promise(r => setTimeout(r, 200));

    try {
        const zip = await JSZip.loadAsync(file);

        // ── Cek apakah ini format ZIP baru (ada manifest.json) atau format lama ──
        const manifestFile = zip.file('manifest.json');

        if (manifestFile) {
            // ── FORMAT ZIP BARU (multi-file per buku) ─────────────────────────
            const manifestStr = await manifestFile.async('string');
            const manifest = JSON.parse(manifestStr);

            if (!manifest.books || !Array.isArray(manifest.books)) {
                showDialog("Error", d.zipNoJsonFound || "File ZIP tidak mengandung data backup yang valid.", "alert-circle", [{ text: "Tutup", primary: true }]);
                return;
            }

            const totalBooks = manifest.totalBooks || manifest.books.length;

            // Konfirmasi dulu ke user sebelum proses berat
            window.closeDialog(true);
            await new Promise(r => setTimeout(r, 200));

            const confirmMsg = wikiLang === 'id'
                ? `ZIP ini berisi ${totalBooks} buku (backup komplit: isi buku + progress + catatan).\n\nSemua buku akan dipulihkan penuh — langsung bisa dibaca tanpa upload ulang. Lanjutkan?`
                : wikiLang === 'es'
                ? `Este ZIP contiene ${totalBooks} libro(s) (copia completa: contenido + progreso + notas).\n\nTodos los libros se restaurarán completamente — podrás leerlos de inmediato sin volver a subir nada. ¿Continuar?`
                : `This ZIP contains ${totalBooks} book(s) (full backup: content + progress + notes).\n\nAll books will be fully restored — ready to read immediately, no re-upload needed. Continue?`;

            showDialog(
                d.restoreConfirmTitle || "Konfirmasi Restore ZIP",
                confirmMsg,
                "archive",
                [
                    { text: d.cancel || "Batal", primary: false },
                    { text: d.restoreConfirmBtn || "Lanjut Restore", primary: true, action: async () => {
                        window.closeDialog();

                        showDialog(
                            d.zipRestoreProgressTitle || "Memulihkan...",
                            d.zipRestoreProgressDesc || "Sedang memulihkan buku satu per satu, mohon tunggu...",
                            "loader",
                            []
                        );
                        const ic2 = document.getElementById('dialog-icon-container');
                        if(ic2) ic2.classList.add('animate-spin');

                        await new Promise(r => setTimeout(r, 200));

                        try {
                            let mergedLibrary = [...library];
                            let restoredCount = 0;

                            for (let i = 0; i < totalBooks; i++) {
                                const bookFile = zip.file(`books/book_${i}.json`);
                                if (!bookFile) continue;

                                const bookStr = await bookFile.async('string');
                                const fullBook = JSON.parse(bookStr);

                                if (!fullBook.id || !fullBook.title) continue;

                                // Simpan nodes ke localforage (DB konten terpisah)
                                if (fullBook.nodes && fullBook.nodes.length > 0) {
                                    await localforage.setItem('content_' + fullBook.id, fullBook.nodes);
                                }

                                // Simpan cover ke localforage jika ada
                                if (fullBook.coverBase64 && fullBook.coverBase64.length > 50) {
                                    await localforage.setItem('cover_' + fullBook.id, fullBook.coverBase64);
                                }

                                // Metadata yang masuk library (tanpa nodes & cover — sudah di DB terpisah)
                                let meta = { ...fullBook };
                                delete meta.nodes;
                                delete meta.coverBase64;

                                const existingIndex = mergedLibrary.findIndex(lib => lib.id === fullBook.id);
                                if (existingIndex > -1) {
                                    // Buku sudah ada: timpa semua data termasuk progress & konten
                                    mergedLibrary[existingIndex] = {
                                        ...mergedLibrary[existingIndex],
                                        ...meta
                                    };
                                } else {
                                    // Buku baru: masuk library langsung siap baca
                                    mergedLibrary.push(meta);
                                }

                                restoredCount++;

                                // Update pesan progress di dialog
                                const msgEl = document.getElementById('dialog-message');
                                if (msgEl) msgEl.innerText = (d.zipRestoreProgress || "Memulihkan buku {n} dari {t}...").replace('{n}', restoredCount).replace('{t}', totalBooks);

                                // Yield per buku — anti force close
                                await new Promise(r => setTimeout(r, 30));
                            }

                            await localforage.setItem('pdf_epub_master', mergedLibrary);
                            library = mergedLibrary;
                            renderLibrary(DOM.globalSearch.value);

                            // Tutup modal settings jika masih terbuka
                            setTimeout(() => {
                                if (!document.getElementById('global-settings-modal').classList.contains('hidden')) history.back();
                            }, 300);

                            setTimeout(() => {
                                const msg = wikiLang === 'id'
                                    ? `${restoredCount} buku berhasil dipulihkan penuh. Semua buku langsung bisa dibaca — tidak perlu upload ulang apapun.`
                                    : wikiLang === 'es'
                                    ? `${restoredCount} libro(s) restaurado(s) completamente. Todos listos para leer de inmediato.`
                                    : `${restoredCount} book(s) fully restored. All books are ready to read immediately.`;
                                showDialog(
                                    d.restoreSuccessTitle || "Restore ZIP Berhasil!",
                                    msg,
                                    "check-circle",
                                    [{ text: "Oke", primary: true }]
                                );
                            }, 700);

                        } catch (err) {
                            console.error("ZIP restore (full) failed:", err);
                            showDialog("Error", (d.zipRestoreError || "Gagal memulihkan dari ZIP: ") + err.message, "alert-circle", [{ text: "Tutup", primary: true }]);
                        }
                    }}
                ]
            );

        } else {
            // ── FORMAT ZIP LAMA (satu file JSON di dalam ZIP) — backward compat ──
            const targetFile = zip.file("baca_progress.json") || zip.file(/\.json$/i)[0];
            if (!targetFile) {
                showDialog("Error", d.zipNoJsonFound || "File ZIP tidak mengandung data backup JSON yang valid.", "alert-circle", [{ text: "Tutup", primary: true }]);
                return;
            }
            window.closeDialog(true);
            await new Promise(r => setTimeout(r, 200));
            const jsonContent = await targetFile.async("string");
            executeRestoreLogic(jsonContent, false);
        }

    } catch (err) {
        console.error("ZIP restore failed:", err);
        showDialog("Error", (d.zipRestoreError || "Gagal membaca file ZIP: ") + err.message, "alert-circle", [{ text: "Tutup", primary: true }]);
    }
};

// ─── INTI LOGIC RESTORE JSON (progress + catatan saja, tanpa nodes) ───────────
// isFullZip = false selalu di sini; ZIP komplit punya handler sendiri (importDataZip)
async function executeRestoreLogic(jsonString, isFullZip = false) {
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    try {
        const parsedData = JSON.parse(jsonString);
        if (!Array.isArray(parsedData)) throw new Error(d.restoreInvalidFormat || "Format file/teks tidak valid.");

        const isValid = parsedData.every(b => b.id && b.title);
        if (!isValid) throw new Error(d.restoreCorrupted || "Data backup rusak atau tidak kompatibel.");

        // Deteksi apakah ini backup lama yang mengandung nodes (format jadul)
        const hasNodes = parsedData.some(b => b.nodes && b.nodes.length > 0);

        // Hitung match: buku yg ID-nya udah ada di library (langsung bisa baca setelah restore)
        const existingIds = new Set(library.map(b => b.id));
        const matchCount = parsedData.filter(b => existingIds.has(b.id)).length;
        const newCount = parsedData.length - matchCount;

        // Pesan konfirmasi berbeda tergantung apakah backup lama (ada nodes) atau baru (progress only)
        let confirmMsg;
        if (hasNodes) {
            // Backup lama format jadul — ada nodes di dalamnya, jadi bisa restore penuh
            confirmMsg = wikiLang === 'id'
                ? `Terdeteksi format backup lama (versi lama Baca) yang mengandung isi buku.\n\nDitemukan ${parsedData.length} buku — semua akan dipulihkan penuh termasuk isi teksnya. Lanjutkan?`
                : wikiLang === 'es'
                ? `Se detectó un formato de copia de seguridad antiguo que contiene el contenido del libro.\n\nSe encontraron ${parsedData.length} libros — todos se restaurarán completamente. ¿Continuar?`
                : `Old backup format detected (contains book content).\n\nFound ${parsedData.length} books — all will be fully restored including text content. Continue?`;
        } else {
            // Backup JSON modern — progress & catatan saja
            confirmMsg = wikiLang === 'id'
                ? `Ditemukan ${matchCount} buku yang ada di library kamu (progress & catatan akan dipulihkan langsung ✓) dan ${newCount} buku yang tidak ada di library (akan muncul sebagai entri kosong — kamu perlu upload ulang file bukunya supaya bisa dibaca).\n\n⚠️ Backup JSON hanya menyimpan progress & catatan, BUKAN isi buku. Kalau mau backup + restore isi buku sekaligus, gunakan Backup ZIP.`
                : wikiLang === 'es'
                ? `Se encontraron ${matchCount} libro(s) en tu biblioteca (progreso y notas restaurados ✓) y ${newCount} libro(s) nuevo(s) (aparecerán vacíos — necesitas volver a subir el archivo para leerlos).\n\n⚠️ El JSON solo guarda el progreso y las notas, NO el contenido. Para restaurar también el contenido, usa Backup ZIP.`
                : `Found ${matchCount} book(s) in your library (progress & notes restored ✓) and ${newCount} new book(s) (will appear empty — re-upload the book file to read them).\n\n⚠️ JSON backup only stores progress & notes, NOT book content. To restore everything including content, use ZIP Backup.`;
        }

        showDialog(
            d.restoreConfirmTitle || "Konfirmasi Restore",
            confirmMsg,
            "alert-triangle",
            [
                { text: d.cancel || "Batal", primary: false },
                { text: d.restoreConfirmBtn || "Lanjut Restore", primary: true, action: async () => {
                    window.closeDialog();

                    // [MERGE CERDAS]: Buku yang sudah ada → update progress + annotations saja
                    // Buku baru dari backup → masuk sebagai entri kosong, tunggu import ulang file asli
                    let mergedLibrary = [...library];

                    for (let b of parsedData) {
                        // Kalo ada nodes di file backup (format backup lama), balikin ke DB terpisah
                        if (b.nodes && b.nodes.length > 0) {
                            await localforage.setItem('content_' + b.id, b.nodes);
                        }

                        let meta = {...b};
                        delete meta.nodes;
                        delete meta.coverBase64;

                        const existingIndex = mergedLibrary.findIndex(lib => lib.id === b.id);
                        if (existingIndex > -1) {
                            // Buku cocok — pertahankan konten lokal, timpa hanya progress + annotations
                            mergedLibrary[existingIndex] = {
                                ...mergedLibrary[existingIndex],
                                progressPct: meta.progressPct,
                                lastReadId: meta.lastReadId,
                                annotations: meta.annotations || [],
                                isPinned: meta.isPinned,
                                title: meta.title,
                            };
                        } else {
                            // Buku baru dari backup — masuk library, konten kosong sampai di-import ulang
                            mergedLibrary.push(meta);
                        }
                    }

                    await localforage.setItem('pdf_epub_master', mergedLibrary);
                    library = mergedLibrary;
                    renderLibrary(DOM.globalSearch.value);

                    // Tutup modal settings jika masih terbuka
                    setTimeout(() => {
                        if (!document.getElementById('global-settings-modal').classList.contains('hidden')) history.back();
                    }, 300);

                    setTimeout(() => {
                        let successMsg;
                        if (hasNodes) {
                            // Backup lama dengan nodes — restore penuh
                            successMsg = wikiLang === 'id'
                                ? `${parsedData.length} buku dipulihkan penuh dari backup lama. Semua langsung bisa dibaca.`
                                : wikiLang === 'es'
                                ? `${parsedData.length} libro(s) restaurado(s) completamente desde el respaldo antiguo.`
                                : `${parsedData.length} book(s) fully restored from old backup. All ready to read.`;
                        } else {
                            // Progress-only JSON
                            const matchedMsg = wikiLang === 'id'
                                ? (matchCount > 0 ? `${matchCount} buku langsung terpulihkan progress & catatannya. ` : '')
                                : wikiLang === 'es'
                                ? (matchCount > 0 ? `${matchCount} libro(s) con progreso restaurado. ` : '')
                                : (matchCount > 0 ? `${matchCount} book(s) had progress & notes restored. ` : '');

                            const uploadMsg = wikiLang === 'id'
                                ? (newCount > 0 ? `${newCount} buku perlu upload ulang file aslinya supaya bisa dibaca — ketuk buku tersebut untuk upload.` : '')
                                : wikiLang === 'es'
                                ? (newCount > 0 ? `${newCount} libro(s) necesitan que vuelvas a subir el archivo original.` : '')
                                : (newCount > 0 ? `${newCount} book(s) need the original file re-uploaded to be readable.` : '');

                            successMsg = (matchedMsg + uploadMsg).trim() || (d.restoreDone || "Restore selesai.");
                        }

                        showDialog(
                            d.restoreSuccessTitle || "Restore Berhasil!",
                            successMsg,
                            "check-circle",
                            [{ text: "Oke", primary: true }]
                        );
                    }, 700);
                }}
            ]
        );
    } catch (err) {
        console.error("Restore failed:", err);
        showDialog("Error", (d.restoreFailedPrefix || "Gagal memulihkan: ") + err.message, "alert-circle", [{ text: "Tutup", primary: true }]);
    }
}

// 8. LIBRARY & BOOK MANAGEMENT (AUTO-MIGRASI MEMORY EKSTREM)
async function loadLibrary() { 
    try { 
        library = await localforage.getItem('pdf_epub_master') || []; 
        let needsMigration = false;

        // [OPTIMASI DEWA]: Auto-Migrasi. Bersihin Nodes & Cover dari RAM UI
        for (let i = 0; i < library.length; i++) {
            let changed = false;
            
            // Pindahin teks buku
            if (library[i].nodes && library[i].nodes.length > 0) {
                await localforage.setItem('content_' + library[i].id, library[i].nodes);
                delete library[i].nodes; 
                changed = true;
            }
            
            // Pindahin gambar sampul
            if (library[i].coverBase64 && library[i].coverBase64.length > 50) {
                await localforage.setItem('cover_' + library[i].id, library[i].coverBase64);
                delete library[i].coverBase64; 
                changed = true;
            }
            
            if(changed) needsMigration = true;
        }

        if (needsMigration) {
            await localforage.setItem('pdf_epub_master', library);
            console.log("Database Node & Cover dipisah biar RAM ga jebol. Mantap!");
        }

        renderLibrary(); 
    } catch (e) { console.error(e); } 
}

function renderLibrary(filterText = "") {
    if(!DOM.grid || !DOM.topSlider) return;
    
    DOM.grid.innerHTML = ''; 
    DOM.topSlider.innerHTML = '';
    const pinnedGrid = document.getElementById('pinned-book-grid');
    if(pinnedGrid) pinnedGrid.innerHTML = '';
    
    let filteredLib = library;
    if(filterText) filteredLib = library.filter(b => b.title.toLowerCase().includes(filterText.toLowerCase()));
    
    const d = i18n[wikiLang] || i18n['id'];
    if(DOM.count) DOM.count.textContent = `${filteredLib.length} ${d.booksCount}`;
    
    const pinnedBooks = filteredLib.filter(b => b.isPinned);
    const regularBooks = filteredLib.filter(b => !b.isPinned);

    let topBooks = [];
    if (!filterText) { topBooks = library.filter(b => b.progressPct > 0).sort((a,b) => b.progressPct - a.progressPct).slice(0, 4); }
    if (topBooks.length > 0) {
        DOM.topSection.classList.remove('hidden');
        topBooks.forEach((book, idx) => { DOM.topSlider.appendChild(createBookCard(book, true, idx)); });
        const spacer = document.createElement('div'); spacer.className = "w-2 shrink-0 snap-align-none"; DOM.topSlider.appendChild(spacer);
    } else { DOM.topSection.classList.add('hidden'); }
    
    const pinnedSection = document.getElementById('pinned-books-section');
    if (pinnedBooks.length > 0) {
        if(pinnedSection) pinnedSection.classList.remove('hidden');
        pinnedBooks.forEach((book, idx) => { if(pinnedGrid) pinnedGrid.appendChild(createBookCard(book, false, idx)); });
    } else {
        if(pinnedSection) pinnedSection.classList.add('hidden');
    }

    if (regularBooks.length === 0) { 
        DOM.empty.classList.remove('hidden'); DOM.grid.classList.add('hidden'); 
        if(document.getElementById('collection-heading')) document.getElementById('collection-heading').classList.add('hidden');
    } else {
        DOM.empty.classList.add('hidden'); DOM.grid.classList.remove('hidden');
        if(document.getElementById('collection-heading')) document.getElementById('collection-heading').classList.remove('hidden');
        regularBooks.forEach((book, index) => { DOM.grid.appendChild(createBookCard(book, false, index)); });
    }

    updateStatistics(); 
    if(window.lucide) window.lucide.createIcons();
    window.updateBatchSelectionUI();
}

// [OPTIMASI UI]: Render Cover Secara Async
function createBookCard(book, isSlider = false, index = 0) {
    const progress = book.progressPct || 0; 
    const card = document.createElement('div');
    
    let shapeClass = book.shape === 'rounded' ? 'rounded-[24px]' : (book.shape === 'square' ? 'rounded-xl' : (index % 2 === 0 ? 'rounded-tl-[32px] rounded-br-[32px] rounded-tr-lg rounded-bl-lg' : 'rounded-tr-[32px] rounded-bl-[32px] rounded-tl-lg rounded-br-lg'));

    const colors = [
        'bg-m3-primaryContainer text-m3-onPrimaryContainer', 
        'bg-m3-secondaryContainer text-m3-onSecondaryContainer', 
        'bg-m3-tertiaryContainer text-m3-onTertiaryContainer',
        'bg-m3-surfaceVariant text-m3-onSurfaceVariant'
    ];
    let baseClass = colors[index % colors.length];
    const dimensionClass = isSlider ? "w-64 h-40 shrink-0 snap-start" : "aspect-[3/4.5] w-full shadow-md hover:shadow-xl transition-shadow";

    card.className = `${baseClass} ${shapeClass} ${dimensionClass} p-4 relative cursor-pointer card-morph flex flex-col justify-between overflow-hidden border-none outline-none ring-0`;

    let batchOverlayHTML = !isSlider ? `
        <div class="batch-overlay absolute inset-0 z-20 transition-all duration-300 pointer-events-none rounded-inherit" data-book-id="${book.id}" style="display: none; opacity: 0; background-color: transparent;">
            <div class="batch-icon-box absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center transition-colors"></div>
        </div>
    ` : '';

    // Render HTML Dasar (Tanpa Cover)
    card.innerHTML = `
        ${batchOverlayHTML}
        <div class="absolute inset-x-0 bottom-0 h-[80%] bg-gradient-to-t from-black via-black/40 to-transparent pointer-events-none z-0 rounded-b-inherit border-none outline-none hidden" id="overlay-${book.id}"></div>
        
        <div class="relative z-10 flex flex-col h-full justify-between pointer-events-none border-none">
            <div class="flex ${isSlider ? 'justify-between items-start' : 'justify-end gap-1'} w-full drop-shadow-md" id="top-icons-${book.id}">
                ${isSlider ? `<span class="inline-block text-[0.65rem] font-bold px-2 py-0.5 bg-black/40 rounded-full text-white uppercase tracking-widest">${book.type}</span>` : (book.isPinned ? `<i data-lucide="pin" class="w-3.5 h-3.5 opacity-90 fill-current"></i>` : '')}
            </div>
            <div class="mt-auto flex flex-col border-none">
                ${!isSlider ? `<i data-lucide="book" class="w-6 h-6 mb-2 opacity-80" id="book-icon-${book.id}"></i>` : ''}
                <h3 class="font-bold ${isSlider ? 'text-sm line-clamp-2' : 'text-sm mt-1 line-clamp-3'} leading-tight drop-shadow-md" id="title-${book.id}">${book.title}</h3>
                ${!isSlider ? `<span class="inline-block mt-2 mb-2 text-[0.6rem] font-bold px-2 py-0.5 bg-black/40 rounded-full text-white uppercase tracking-widest self-start">${book.type}</span>` : ''}
                <div class="w-full ${isSlider ? 'mt-2' : ''} border-none">
                    <div class="flex justify-between text-[${isSlider ? '0.65rem' : '0.6rem'}] font-bold opacity-90 mb-1" id="pct-${book.id}"><span>${progress}%</span></div>
                    <div class="h-1.5 w-full bg-black/20 dark:bg-white/20 rounded-full overflow-hidden border-none">
                        <div class="h-full bg-m3-primary dark:bg-m3-primaryContainer rounded-full border-none" style="width: ${progress}%" id="bar-${book.id}"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Load Cover di Background
    localforage.getItem('cover_' + book.id).then(coverData => {
        if (coverData && coverData.length > 50) {
            card.style.backgroundImage = `url('${coverData}')`;
            card.style.backgroundSize = 'cover';
            card.style.backgroundPosition = 'top center';
            
            // Terapin efek teks putih & shadow karena ada background gelap
            card.classList.remove(...baseClass.split(' '));
            card.classList.add('text-white', 'shadow-lg');
            
            const overlay = document.getElementById(`overlay-${book.id}`);
            if(overlay) overlay.classList.remove('hidden');
            
            ['title-', 'top-icons-', 'pct-'].forEach(prefix => {
                const el = document.getElementById(prefix + book.id);
                if(el) el.classList.add('text-white');
            });
            
            const bar = document.getElementById(`bar-${book.id}`);
            if(bar) { bar.classList.remove('bg-m3-primary', 'dark:bg-m3-primaryContainer'); bar.classList.add('bg-white'); }
            
            const icon = document.getElementById(`book-icon-${book.id}`);
            if(icon) icon.classList.add('hidden');
        }
    });

    let pressTimer = null; let isPressing = false; let hasLongPressed = false;
    const handleStart = (e) => {
        if (isBatchDeleteMode) return;
        isPressing = true; hasLongPressed = false;
        pressTimer = setTimeout(() => { if (isPressing) { hasLongPressed = true; window.openBookOptions(book.id); } }, 400);
    };
    const handleEnd = () => { isPressing = false; clearTimeout(pressTimer); };
    const handleMove = () => { isPressing = false; clearTimeout(pressTimer); };

    card.addEventListener('mousedown', handleStart); card.addEventListener('touchstart', handleStart, {passive: true});
    card.addEventListener('mouseup', handleEnd); card.addEventListener('touchend', handleEnd);
    card.addEventListener('mouseleave', handleMove); card.addEventListener('touchmove', handleMove, {passive: true});
    
    card.addEventListener('click', (e) => { 
        if (hasLongPressed) { e.preventDefault(); e.stopPropagation(); return; } 
        if (isBatchDeleteMode && !isSlider) {
            e.preventDefault(); e.stopPropagation();
            const strId = String(book.id);
            const idx = selectedForDelete.findIndex(id => String(id) === strId);
            if (idx > -1) {
                selectedForDelete.splice(idx, 1);
            } else {
                selectedForDelete.push(strId);
            }
            window.updateBatchSelectionUI();
            return;
        }
        window.openBook(book); 
    });

    return card;
}

window.openBookOptions = function(id) {
    activeOptsId = id; const book = library.find(b => b.id === id);
    document.getElementById('opt-title').textContent = book.title;

    const d = i18n[wikiLang] || i18n['id'];
    const pinIcon = document.getElementById('icon-opt-pin');
    const pinText = document.getElementById('str-opt-pin');

    if(book.isPinned) {
        pinText.textContent = d.optUnpin || 'Lepas Sematan';
        pinIcon.setAttribute('data-lucide', 'pin-off');
    } else {
        pinText.textContent = d.optPin || 'Sematkan Buku';
        pinIcon.setAttribute('data-lucide', 'pin');
    }

    if(window.lucide) window.lucide.createIcons();
    openModal('b-opt-modal', 'b-opt-sheet', false); 
}

window.togglePinBook = async function() {
    if(!activeOptsId) return;
    const bookIndex = library.findIndex(b => b.id === activeOptsId);
    if(bookIndex > -1) {
        library[bookIndex].isPinned = !library[bookIndex].isPinned;
        await localforage.setItem('pdf_epub_master', library);
        history.back(); 
        setTimeout(() => renderLibrary(DOM.globalSearch ? DOM.globalSearch.value : ""), 300);
    }
}

window.triggerSelectMode = function() {
    if(!activeOptsId) return;
    const targetId = activeOptsId;
    history.back(); 
    setTimeout(() => { window.toggleBatchDelete(false, targetId); }, 350); 
}

window.toggleBatchDelete = function(isFromHistory = false, initialSelectId = null) {
    if(library.length === 0 && !isBatchDeleteMode) return;
    isBatchDeleteMode = !isBatchDeleteMode;
    
    if (!isBatchDeleteMode) { selectedForDelete = []; } 
    else {
        selectedForDelete = [];
        if (initialSelectId) selectedForDelete.push(String(initialSelectId));
    }
    
    const bar = document.getElementById('batch-delete-bar');
    const fab = document.getElementById('fab-container');
    
    if (isBatchDeleteMode) {
        if(!isFromHistory) pushAppHistory('batch-delete');
        bar.classList.remove('translate-y-32');
        fab.classList.add('translate-y-32', 'opacity-0');
    } else {
        if(!isFromHistory && window.location.hash === '#batch-delete') history.back();
        bar.classList.add('translate-y-32');
        fab.classList.remove('translate-y-32', 'opacity-0');
    }
    
    window.updateBatchSelectionUI();
};

window.updateBatchSelectionUI = function() {
    const countEl = document.getElementById('batch-delete-count');
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    if(countEl) countEl.textContent = `${selectedForDelete.length} ${d.selected || 'Selected'}`;

    document.querySelectorAll('.batch-overlay').forEach(el => {
        const id = String(el.dataset.bookId);
        const idx = selectedForDelete.findIndex(selId => String(selId) === id);
        const icBox = el.querySelector('.batch-icon-box');
        
        if (isBatchDeleteMode) {
            el.style.display = 'block';
            if (idx > -1) {
                el.style.opacity = '1';
                el.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
                icBox.className = 'batch-icon-box absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-m3-primary text-m3-onPrimary font-bold text-xs shadow-md border-none';
                icBox.innerHTML = (idx + 1);
            } else {
                el.style.opacity = '1';
                el.style.backgroundColor = 'transparent';
                icBox.className = 'batch-icon-box absolute top-3 left-3 w-7 h-7 rounded-full border-2 border-white/50 flex items-center justify-center transition-colors bg-black/20 shadow-sm font-bold text-xs text-transparent';
                icBox.innerHTML = '';
            }
        } else {
            el.style.opacity = '0';
            setTimeout(() => el.style.display = 'none', 300);
        }
    });
};

window.executeBatchDelete = async function() {
    if(selectedForDelete.length === 0) return;
    const d = i18n[wikiLang] || i18n['id'];
    
    showDialog("Hapus Buku", d.deleteConfirm, "trash-2", [
        { text: "Batal", primary: false },
        { text: "Hapus", primary: true, action: async () => {
            window.closeDialog();
            const toDeleteSet = new Set(selectedForDelete.map(String));
            
            // Bersihin DB Pecahan
            for(let id of selectedForDelete) {
                await localforage.removeItem('content_' + id);
                await localforage.removeItem('cover_' + id);
            }

            library = library.filter(b => !toDeleteSet.has(String(b.id)));
            await localforage.setItem('pdf_epub_master', library);
            window.toggleBatchDelete(); 
            renderLibrary(DOM.globalSearch ? DOM.globalSearch.value : ""); 
        }}
    ]);
};

window.triggerDeleteView = async function() {
    if(!activeOptsId) return;
    const d = i18n[wikiLang] || i18n['id'];
    showDialog("Hapus Permanen", d.deleteConfirm, "trash-2", [
        { text: "Batal", primary: false },
        { text: "Hapus", primary: true, action: async () => {
            window.closeDialog();
            
            await localforage.removeItem('content_' + activeOptsId);
            await localforage.removeItem('cover_' + activeOptsId);

            library = library.filter(b => !selectedForDelete.includes(b.id) && b.id !== activeOptsId); 
            await localforage.setItem('pdf_epub_master', library); 
            history.back(); setTimeout(() => renderLibrary(DOM.globalSearch ? DOM.globalSearch.value : ""), 350);
        }}
    ]);
};

window.triggerEditView = function() {
    if(!activeOptsId) return;
    const book = library.find(b => b.id === activeOptsId);
    document.getElementById('edit-book-id').value = activeOptsId; 
    document.getElementById('edit-book-title').value = book.title; 
    document.getElementById('edit-book-cover').value = '';
    
    window.selectShape(book.shape || 'square');
    history.back(); setTimeout(() => { openModal('edit-modal', 'edit-sheet', true); }, 400); 
}

window.selectShape = function(shape) {
    document.getElementById('edit-book-shape').value = shape;
    const btns = document.querySelectorAll('#edit-sheet .btn-morph');
    btns.forEach(b => {
        if(b.id && b.id.startsWith('shape-')) {
            b.classList.remove('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
            b.classList.add('bg-m3-surfaceVariant', 'text-m3-onSurfaceVariant');
        }
    });
    const sel = document.getElementById('shape-' + shape);
    if(sel) {
        sel.classList.remove('bg-m3-surfaceVariant', 'text-m3-onSurfaceVariant');
        sel.classList.add('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
    }
}

window.closeEditModal = function() { history.back(); }

window.saveBookEdit = async function() {
    const id = document.getElementById('edit-book-id').value; 
    const newTitle = document.getElementById('edit-book-title').value; 
    const coverFile = document.getElementById('edit-book-cover').files[0];
    const newShape = document.getElementById('edit-book-shape').value;
    const bookIndex = library.findIndex(b => b.id === id);
    
    if(bookIndex > -1) {
        library[bookIndex].title = newTitle; library[bookIndex].shape = newShape;
        if (coverFile) { 
            const reader = new FileReader(); 
            reader.onload = async function(e) { 
                await localforage.setItem('cover_' + id, e.target.result); // Save langsung ke DB pecahan
                await localforage.setItem('pdf_epub_master', library); 
                history.back(); renderLibrary(); 
            }; 
            reader.readAsDataURL(coverFile); 
        } else { await localforage.setItem('pdf_epub_master', library); history.back(); renderLibrary(); }
    }
}

// 9. TEMA & TIPOGRAFI
function applyThemeToDOM() {
    document.documentElement.classList.toggle('dark', isDark);
    
    if(typeof M3_PALETTES !== 'undefined') {
        let rootVars = M3_PALETTES[currentThemeKey][isDark ? 'dark' : 'light'];
        if (isDark && isAmoled) {
            rootVars += `--md-sys-color-background:#000000;--md-sys-color-surface:#000000;`;
        }
        const dynamicTheme = document.getElementById('dynamic-theme');
        if(dynamicTheme) dynamicTheme.innerHTML = `:root { ${rootVars} }`;
    }
    
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if(metaTheme) {
        if(isDark && isAmoled) metaTheme.setAttribute("content", "#000000");
        else if (isDark) metaTheme.setAttribute("content", "#0B0314");
        else metaTheme.setAttribute("content", "#FAF5FF");
    }

    const bg = document.getElementById('theme-switch-bg');
    const knob = document.getElementById('theme-switch-knob');
    const icon = document.getElementById('theme-switch-icon');
    const dLabel = document.getElementById('theme-label-text');
    const d = typeof i18n !== 'undefined' ? (i18n[wikiLang] || i18n['id']) : {};
    
    if (bg && knob && icon && dLabel) {
        dLabel.textContent = isDark ? d.themeDark : d.themeLight;
        if (isDark) {
            bg.classList.replace('bg-m3-onSurfaceVariant/20', 'bg-m3-primary');
            knob.classList.add('translate-x-[32px]');
            icon.setAttribute('data-lucide', 'moon');
            icon.classList.replace('text-m3-onSurface', 'text-m3-primary');
        } else {
            bg.classList.replace('bg-m3-primary', 'bg-m3-onSurfaceVariant/20');
            knob.classList.remove('translate-x-[32px]');
            icon.setAttribute('data-lucide', 'sun');
            icon.classList.replace('text-m3-primary', 'text-m3-onSurface');
        }
    }

    const amoContainer = document.getElementById('amoled-toggle-container');
    const amoBg = document.getElementById('amoled-switch-bg');
    const amoKnob = document.getElementById('amoled-switch-knob');
    if (isDark) {
        if (amoContainer) amoContainer.classList.remove('hidden');
        if (isAmoled && amoBg && amoKnob) {
            amoBg.classList.add('bg-m3-primary');
            amoKnob.classList.add('translate-x-[32px]');
            amoKnob.classList.replace('bg-m3-onSurface', 'bg-m3-onPrimary');
        } else if (amoBg && amoKnob) {
            amoBg.classList.remove('bg-m3-primary');
            amoKnob.classList.remove('translate-x-[32px]');
            amoKnob.classList.replace('bg-m3-onPrimary', 'bg-m3-onSurface');
        }
    } else {
        if (amoContainer) amoContainer.classList.add('hidden');
    }

    const tl = document.getElementById('theme-btn-light');
    const td = document.getElementById('theme-btn-dark');
    const ta = document.getElementById('theme-btn-amoled');
    if (tl && td && ta) {
        [tl, td, ta].forEach(el => {
            el.classList.remove('bg-m3-primary', 'text-m3-onPrimary');
            el.classList.add('text-m3-onSurfaceVariant');
        });
        if (!isDark) { tl.classList.add('bg-m3-primary', 'text-m3-onPrimary'); tl.classList.remove('text-m3-onSurfaceVariant'); }
        else if (isDark && !isAmoled) { td.classList.add('bg-m3-primary', 'text-m3-onPrimary'); td.classList.remove('text-m3-onSurfaceVariant'); }
        else if (isDark && isAmoled) { ta.classList.add('bg-m3-primary', 'text-m3-onPrimary'); ta.classList.remove('text-m3-onSurfaceVariant'); }
    }

    if(window.lucide) window.lucide.createIcons();
    localStorage.setItem('theme', isDark ? 'dark' : 'light'); 
    localStorage.setItem('m3-key', currentThemeKey);
    localStorage.setItem('amoled', isAmoled);
}

window.setTheme = function(key) { currentThemeKey = key; applyThemeToDOM(); };
window.toggleThemeState = function() { isDark = !isDark; applyThemeToDOM(); };
window.toggleAmoled = function() { isAmoled = !isAmoled; applyThemeToDOM(); };
window.setReaderTheme = function(mode) {
    if (mode === 'light') { isDark = false; isAmoled = false; }
    else if (mode === 'dark') { isDark = true; isAmoled = false; }
    else if (mode === 'amoled') { isDark = true; isAmoled = true; }
    applyThemeToDOM();
};

let typoPrefs = JSON.parse(localStorage.getItem('typo_prefs')) || { size: '1.2rem', align: 'left', font: 'Lora' };
function applyTypo() {
    document.documentElement.style.setProperty('--reader-size', typoPrefs.size);
    document.documentElement.style.setProperty('--reader-align', typoPrefs.align);
    
    let fontCss = 'serif';
    if(typoPrefs.font === 'Merriweather') fontCss = "'Merriweather', serif";
    else if(typoPrefs.font === 'Playfair Display') fontCss = "'Playfair Display', serif";
    else if(typoPrefs.font === 'Space Mono') fontCss = "'Space Mono', monospace";
    else if(typoPrefs.font === 'Inter') fontCss = "'Inter', sans-serif";
    else if(typoPrefs.font === 'Google Sans Flex') fontCss = "'Google Sans Flex', sans-serif";
    else fontCss = "'Lora', serif";

    document.documentElement.style.setProperty('--reader-font', fontCss);
    localStorage.setItem('typo_prefs', JSON.stringify(typoPrefs)); syncTypoUI();
}
function syncTypoUI() {
    const maps = { size: { '1rem': 'typo-sz-sm', '1.2rem': 'typo-sz-md', '1.5rem': 'typo-sz-lg' }, align: { 'left': 'typo-al-left', 'center': 'typo-al-center', 'justify': 'typo-al-justify' }, font: { 'Lora': 'typo-fn-lora','Merriweather':'typo-fn-merri','Playfair Display':'typo-fn-playfair', 'Inter': 'typo-fn-inter', 'Space Mono': 'typo-fn-mono', 'Google Sans Flex': 'typo-fn-google' } };
    
    Object.values(maps.size).forEach(id => { const el = document.getElementById(id); if(el){ el.classList.remove('bg-m3-primary', 'text-m3-onPrimary'); el.classList.add('text-m3-onSurfaceVariant'); }});
    Object.values(maps.align).forEach(id => { const el = document.getElementById(id); if(el){ el.classList.remove('bg-m3-primary', 'text-m3-onPrimary'); el.classList.add('text-m3-onSurfaceVariant'); }});
    Object.values(maps.font).forEach(id => { const el = document.getElementById(id); if(el){ el.classList.remove('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer'); }});
    
    if(document.getElementById(maps.size[typoPrefs.size])) {
        document.getElementById(maps.size[typoPrefs.size]).classList.add('bg-m3-primary', 'text-m3-onPrimary');
        document.getElementById(maps.size[typoPrefs.size]).classList.remove('text-m3-onSurfaceVariant');
    }
    if(document.getElementById(maps.align[typoPrefs.align])) {
        document.getElementById(maps.align[typoPrefs.align]).classList.add('bg-m3-primary', 'text-m3-onPrimary');
        document.getElementById(maps.align[typoPrefs.align]).classList.remove('text-m3-onSurfaceVariant');
    }
    if(document.getElementById(maps.font[typoPrefs.font])) {
        document.getElementById(maps.font[typoPrefs.font]).classList.add('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer');
    }
}
window.changeTypo = function(type, value) { typoPrefs[type] = value; applyTypo(); }


// 10. READER INTERACTIONS
window.openBook = async function(book) {
    activeBookId = book.id; pushAppHistory(`reader-${book.id}`);
    DOM.libView.style.transform = 'scale(0.95)'; DOM.readView.classList.remove('translate-y-full');
    DOM.title.textContent = book.title; 
    
    const loader = document.getElementById('reader-loading-overlay');
    loader.classList.remove('hidden'); requestAnimationFrame(() => loader.classList.remove('opacity-0'));
    
    DOM.inner.innerHTML = ''; DOM.tocList.innerHTML = '';
    if (observer) observer.disconnect();

    DOM.progBar.style.width = `${book.progressPct || 0}%`; DOM.progTxt.textContent = `${book.progressPct || 0}%`;

    // Fetch nodes dari storage independen
    if (!book.nodes) {
        const savedNodes = await localforage.getItem('content_' + book.id);
        if(savedNodes) {
            book.nodes = savedNodes;
        } else {
            book.nodes = [{tag: 'p', text: 'Error: Konten teks gagal dimuat atau korup.'}];
        }
    }

    setTimeout(() => {
        let hCounter = 0; const fragment = document.createDocumentFragment(); let currentHeadingId = null;

        book.nodes.forEach((node, i) => {
            let el; const annots = (book.annotations || []).filter(a => a.nodeIdx === i);

            if (node.tag === 'img') {
                el = document.createElement('img'); el.src = node.src; el.id = `node-${i}`;
                el.className = "w-full max-w-lg mx-auto rounded-2xl my-8 object-contain shadow-sm"; el.loading = "lazy";
            } else {
                el = document.createElement(node.tag); 
                el.innerHTML = window.renderNodeText ? window.renderNodeText(node.text, annots) : node.text; 
                el.id = `node-${i}`;
                if (node.tag === 'h1' || node.tag === 'h2') {
                    hCounter++; currentHeadingId = el.id; 
                    el.className = node.tag === 'h1' ? "text-3xl font-bold tracking-tight mt-12 mb-6 text-m3-primary leading-snug break-words" : "text-xl font-bold mt-10 mb-4 text-m3-onSurfaceVariant border-b border-m3-surfaceVariant pb-2 break-words";
                    const tocItem = document.createElement('button'); tocItem.id = `toc-btn-${el.id}`;
                    tocItem.className = `text-left text-sm p-3 rounded-2xl hover:bg-m3-surface transition-all duration-300 ${node.tag==='h1'?'font-bold text-m3-primary':'ml-4 opacity-80'}`;
                    tocItem.textContent = node.text;
                    tocItem.onclick = () => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.back(); };
                    DOM.tocList.appendChild(tocItem);
                } else { el.className = "text-m3-onSurface opacity-90 mb-5 tracking-wide"; }
            }
            el.dataset.headingId = currentHeadingId; fragment.appendChild(el);
        });
        DOM.inner.appendChild(fragment);
        
        if(hCounter === 0) DOM.tocList.innerHTML = "<p class='text-sm opacity-50 block p-3'>No Table of Contents.</p>";
        DOM.searchRes.classList.add('hidden'); DOM.searchInput.value = '';

        const header = document.getElementById('reader-floating-header');
        header.classList.remove('-translate-y-[150%]', 'opacity-0');
        header.classList.add('translate-y-0', 'opacity-100');

        renderBookmarkPanel(); 

        requestAnimationFrame(() => {
            
            if (book.lastReadId) { 
                const target = document.getElementById(book.lastReadId); 
                const container = DOM.readContent;
                if (target && container) {
                    const cRect = container.getBoundingClientRect();
                    const tRect = target.getBoundingClientRect();
                    const offset = tRect.top - cRect.top + container.scrollTop - (cRect.height / 2) + (tRect.height / 2);
                    container.scrollTo({ top: offset, behavior: 'auto' });
                } 
            } else { 
                DOM.readContent.scrollTo({ top: 0, behavior: 'auto' }); 
            }
            
            setTimeout(() => {
                loader.classList.add('opacity-0'); 
                setTimeout(() => loader.classList.add('hidden'), 300);
                window.setupIntersectionObserver(); 
            }, 150);
            
        });

    }, 300); 
}

window._closeReaderAction = function(isFromHistory = false) {
    if (!isFromHistory) { history.back(); return; }
    DOM.readView.classList.add('translate-y-full'); DOM.libView.style.transform = 'scale(1)';
    if(observer) observer.disconnect(); 
    
    // Bebasin RAM pas buku ditutup
    if (activeBookId) {
        let bIdx = library.findIndex(b => b.id === activeBookId);
        if (bIdx > -1 && library[bIdx].nodes) {
            delete library[bIdx].nodes;
        }
    }

    renderLibrary(DOM.globalSearch.value); activeBookId = null;
    window.getSelection().removeAllRanges();
    const menu = document.getElementById('selection-menu');
    if(menu) { menu.classList.add('opacity-0', 'scale-75'); setTimeout(() => menu.classList.add('hidden'), 200); }
    updateBottomNavUI(null);
}

if(document.getElementById('btn-back')) {
    document.getElementById('btn-back').addEventListener('click', () => history.back());
}

window._closeSidePanelsAction = function(isFromHistory = false) { 
    if (!isFromHistory) { history.back(); return; }
    if(DOM.tocPanel) DOM.tocPanel.classList.add('translate-x-full', 'opacity-0'); 
    if(DOM.setPanel) DOM.setPanel.classList.add('translate-x-full', 'opacity-0'); 
    if(DOM.bookmarkPanel) DOM.bookmarkPanel.classList.add('translate-x-full', 'opacity-0');
    const overlay = document.getElementById('side-panel-overlay'); if(overlay) overlay.classList.add('hidden');
    activePanel = null;
    updateBottomNavUI(null);
}

window.togglePanel = function(panelEl, name, btnId) { 
    if(activePanel === name) { history.back(); return; } 
    if(activePanel) { 
        _closeSidePanelsAction(true); 
        history.replaceState({ state: `panel-${name}` }, '', `#panel-${name}`); 
    } else { 
        pushAppHistory(`panel-${name}`); 
    }
    panelEl.classList.remove('translate-x-full', 'opacity-0'); 
    const overlay = document.getElementById('side-panel-overlay'); if(overlay) overlay.classList.remove('hidden');
    activePanel = name; 
    updateBottomNavUI(btnId);

    if (name === 'toc' && DOM.tocList) {
        setTimeout(() => {
            const activeTocItem = DOM.tocList.querySelector('.bg-m3-primaryContainer');
            if (activeTocItem) {
                const offset = activeTocItem.offsetTop - (DOM.tocList.clientHeight / 2) + (activeTocItem.clientHeight / 2);
                DOM.tocList.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
            }
        }, 250);
    }
}

if(document.getElementById('btn-toc')) document.getElementById('btn-toc').onclick = () => togglePanel(DOM.tocPanel, 'toc', 'btn-toc'); 
if(document.getElementById('btn-settings')) document.getElementById('btn-settings').onclick = () => togglePanel(DOM.setPanel, 'set', 'btn-settings');

window.toggleFullscreenReading = function(isFromHistory = false) {
    const bottomBar = document.getElementById('reader-bottom-bar');
    const progContainer = document.getElementById('progress-container');
    const floatHeader = document.getElementById('reader-floating-header');
    
    if (bottomBar.classList.contains('hidden')) {
        if (!isFromHistory && window.location.hash === '#immersive') { history.back(); }
        bottomBar.classList.remove('hidden'); 
        progContainer.classList.remove('hidden');
        floatHeader.classList.remove('-translate-y-[150%]', 'opacity-0');
        floatHeader.classList.add('translate-y-0', 'opacity-100');
    } else {
        if (!isFromHistory) { pushAppHistory('immersive'); }
        bottomBar.classList.add('hidden'); 
        floatHeader.classList.add('-translate-y-[150%]', 'opacity-0');
        floatHeader.classList.remove('translate-y-0', 'opacity-100');
        progContainer.classList.add('hidden');
        updateBottomNavUI(null);
        if(activePanel) { _closeSidePanelsAction(); } 
    }
};

window.setupIntersectionObserver = function() {
    if (observer) observer.disconnect(); const totalNodes = DOM.inner.children.length;
    observer = new IntersectionObserver((entries) => {
        let visibleEntry = entries.find(e => e.isIntersecting);
        if (visibleEntry) {
            const el = visibleEntry.target; const id = el.id; const index = parseInt(id.split('-')[1]);
            const pct = Math.round(((index + 1) / totalNodes) * 100);
            DOM.progBar.style.width = `${pct}%`; DOM.progTxt.textContent = `${pct}%`;

            const activeHeadingId = el.dataset.headingId;
            Array.from(DOM.tocList.children).forEach(btn => { btn.classList.remove('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer', 'font-bold', 'translate-x-2', '!opacity-100', '!text-m3-onPrimaryContainer'); });
            if(activeHeadingId) { 
                const tocActiveBtn = document.getElementById(`toc-btn-${activeHeadingId}`); 
                if (tocActiveBtn) { tocActiveBtn.classList.add('bg-m3-primaryContainer', '!text-m3-onPrimaryContainer', 'font-bold', 'translate-x-2', '!opacity-100'); }
            }
            updateBookProgress(activeBookId, id, pct);
        }
    }, { root: DOM.readContent, rootMargin: '-45% 0px -45% 0px', threshold: 0 }); 
    Array.from(DOM.inner.children).forEach(el => observer.observe(el));
}

let progressSaveTimeout = null;
async function updateBookProgress(bookId, lastNodeId, pct) {
    let bookIndex = library.findIndex(b => b.id === bookId);
    if(bookIndex > -1) { 
        library[bookIndex].lastReadId = lastNodeId; library[bookIndex].progressPct = pct; 
        if (progressSaveTimeout) clearTimeout(progressSaveTimeout);
        progressSaveTimeout = setTimeout(() => { localforage.setItem('pdf_epub_master', library); updateStatistics(); }, 1500);
    }
}

// 11. ANNOTATIONS & IN-BOOK BOOKMARK LOGIC

function getAbsoluteOffsets(element) {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return { start: 0, end: 0 };
    const range = sel.getRangeAt(0);
    
    function getTextOffset(node, offset) {
        let len = 0;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let n;
        while ((n = walker.nextNode())) {
            if (n === node) { len += offset; break; }
            len += n.nodeValue.length;
        }
        return len;
    }

    let start = getTextOffset(range.startContainer, range.startOffset);
    let end = getTextOffset(range.endContainer, range.endOffset);
    
    if (start > end) { let t = start; start = end; end = t; }
    return { start, end };
}

window.renderNodeText = function(text, annots) {
    if (!text) return "";
    let html = text;
    
    if (annots && annots.length > 0) {
        let validAnnots = [...annots].filter(a => typeof a.startOff !== 'undefined').sort((a,b) => b.startOff - a.startOff);
        
        validAnnots.forEach(a => {
            const s = Math.min(a.startOff, html.length);
            const e = Math.min(a.endOff, html.length);
            const before = html.substring(0, s);
            const middle = html.substring(s, e);
            const after = html.substring(e);
            html = before + `|||ST_${a.id}|||` + middle + `|||EN_${a.id}|||` + after;
        });

        let legacyAnnots = [...annots].filter(a => typeof a.startOff === 'undefined').sort((a,b) => b.text.length - a.text.length);
        legacyAnnots.forEach(a => {
            const esc = a.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            html = html.replace(new RegExp(esc, ''), `|||ST_${a.id}|||${a.text}|||EN_${a.id}|||`);
        });
    }

    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/"([^"]+)"/g, '<i class="italic font-serif opacity-90">"$1"</i>');

    if (annots && annots.length > 0) {
        annots.forEach(a => {
            let colorClass = "";
            if(a.color === 'yellow') colorClass = "text-yellow-600 bg-yellow-400/20 dark:text-yellow-400 dark:bg-yellow-400/20";
            else if(a.color === 'green') colorClass = "text-green-600 bg-green-500/20 dark:text-green-400 dark:bg-green-400/20";
            else if(a.color === 'pink') colorClass = "text-pink-600 bg-pink-500/20 dark:text-pink-400 dark:bg-pink-400/20";
            else colorClass = "text-m3-primary bg-m3-primary/10";

            let markHtml = `<mark class="annot-hl ${colorClass} font-medium cursor-pointer transition-all hover:opacity-80 px-1 mx-0.5 rounded-md" data-id="${a.id}" onclick="window.showAnnotationDetails('${a.id}')">`;
            html = html.replace(`|||ST_${a.id}|||`, markHtml).replace(`|||EN_${a.id}|||`, '</mark>');
        });
    }
    return html;
}

let _selChangeDebounce = null;
let _isTouchDragging = false;

document.addEventListener('touchstart', () => { _isTouchDragging = true; }, { passive: true });
document.addEventListener('touchend', () => {
    _isTouchDragging = false;
    if (activeBookId) {
        clearTimeout(_selChangeDebounce);
        _selChangeDebounce = setTimeout(_handleSelectionChange, 80);
    }
}, { passive: true });

function _handleSelectionChange() {
    if(!activeBookId) return;
    const sel = window.getSelection(); const text = sel.toString().trim(); const menu = document.getElementById('selection-menu');

    if (text.length > 0 && sel.rangeCount > 0 && DOM.inner) {
        const range = sel.getRangeAt(0);
        if (!DOM.inner.contains(range.commonAncestorContainer)) return;

        let curr = range.commonAncestorContainer;
        if (curr.nodeType === 3) curr = curr.parentNode;
        const nodeEl = curr.closest('[id^="node-"]'); if (!nodeEl) return;

        const nodeIdx = parseInt(nodeEl.id.split('-')[1]);
        const offsets = getAbsoluteOffsets(nodeEl);
        currentSelection = { text: text, nodeIdx: nodeIdx, startOff: offsets.start, endOff: offsets.end };

        menu.classList.remove('hidden');
        const rect = range.getBoundingClientRect(); const menuWidth = menu.offsetWidth || 220; const padding = 16;
        let targetLeft = rect.left + (rect.width / 2) - (menuWidth / 2);
        if (targetLeft < padding) targetLeft = padding;
        if (targetLeft + menuWidth > window.innerWidth - padding) targetLeft = window.innerWidth - menuWidth - padding;
        let targetTop = rect.top - 55;
        if (targetTop < 80) targetTop = rect.bottom + 15;

        menu.style.top = `${targetTop}px`; menu.style.left = `${targetLeft}px`;
        requestAnimationFrame(() => { menu.classList.remove('opacity-0', 'scale-75'); });
    } else {
        if (!_isTouchDragging) window.hideSelectionMenu();
    }
}

document.addEventListener('selectionchange', () => {
    if(!activeBookId) return;
    clearTimeout(_selChangeDebounce);
    _selChangeDebounce = setTimeout(_handleSelectionChange, _isTouchDragging ? 300 : 50);
});

if(document.getElementById('reader-content')) {
    document.getElementById('reader-content').addEventListener('mousedown', (e) => { 
        const menu = document.getElementById('selection-menu');
        if(menu && !menu.classList.contains('hidden') && menu.contains(e.target)) return;
        if(!window.getSelection().toString().trim()) { window.hideSelectionMenu(); } 
    });
}

window.hideSelectionMenu = function() {
    const menu = document.getElementById('selection-menu');
    if (menu) { menu.classList.add('opacity-0', 'scale-75'); setTimeout(() => menu.classList.add('hidden'), 200); }
}

function showToast(msg) {
    let t = document.getElementById('copy-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'copy-toast';
        t.className = 'fixed bottom-28 left-1/2 -translate-x-1/2 z-[999] px-5 py-2.5 rounded-full bg-m3-onSurface text-m3-surface text-xs font-bold shadow-lg transition-all duration-300 opacity-0';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.remove('opacity-0');
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.add('opacity-0'), 1500);
}

window.copySelection = function() {
    const text = currentSelection.text;
    if (!text) return;
    window.hideSelectionMenu();
    window.getSelection().removeAllRanges();
    showToast(wikiLang === 'id' ? 'Tersalin!' : 'Copied!');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.s
