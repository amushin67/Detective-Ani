// ==UserScript==
// @name         🔎Detective Ani
// @namespace    https://github.com/amushin67
// @version      1,0
// @description  Grok posts Finder.
// @author       amu必
// @match        *://*/*
// @icon         https://raw.githubusercontent.com/amushin67/Medias/refs/heads/main/Magnifyingglass_Ani.png
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @connect      grok.com
// @connect      assets.grok.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.__detectiveAniCombinedLoaded) return;
    window.__detectiveAniCombinedLoaded = true;

    // =====================================================================
    // 0. HOST DETECTION
    // =====================================================================
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    const isGrok    = host === 'grok.com' || host.endsWith('.grok.com');
    const isX       = host === 'x.com' || host === 'twitter.com' ||
                      host.endsWith('.x.com') || host.endsWith('.twitter.com');
    const isReddit  = host === 'reddit.com' || host.endsWith('.reddit.com');
    const isRedgifs = host === 'redgifs.com' || host.endsWith('.redgifs.com');

    if (isRedgifs) return;

    // =====================================================================
    // 1. GLOBAL CONSTANTS & CACHES
    // =====================================================================
    const ICON_URL = 'https://raw.githubusercontent.com/amushin67/Medias/refs/heads/main/Magnifyingglass_Ani.png';
    const THUMB_SIZE = 64;
    const FAB_THUMB_SIZE = 50;
    const BTN_SIZE = 70;
    const BATCH_SIZE = 6;
    const CONCURRENCY = 3;
    const THONK_CONCURRENCY = 50; // load many thumbs in parallel
    const DELAY_BETWEEN_BATCHES = 900;
    const BATCH_DELAY = 80;
    const BYTES_TO_FETCH = 65536;
    const MAX_PARENT_DEPTH = 4;
    const MARKER = 'titlex$';

    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const UUID_STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    const MAKE_IMAGINE_LINK = uuid => `https://grok.com/imagine/post/${uuid}`;
    const MAKE_THUMB_LINK  = uuid => `https://grok.com/imagine/post/${uuid}/image`;

    const thumbCache = new Map();
    const metaCache  = new Map();
    const assetCache = new Map();

    let iconsVisible = true;
    let userHidden = false; // F4 session hide for FAB

    // Lupa panel state
    let lupaFixedPos = null;
    let lastLupaUuid = null;

    // FAB state (Thonk)
    let fabPos = null;
    let panelOpen = false;
    let onFabClick = null;

    // Script-generated selectors — Thonk must NOT scan these for UUIDs
    const SCRIPT_UI_SELECTORS = [
        '#grok-uuid-fab', '#grok-uuid-strip', '#lupa-detail-panel',
        '#grok-uuid-badge', '#grok-uuid-tip',
        '.grok-batch-thumbs', '.grok-thumbs-below', '.grok-ext-thumbs',
        '.grok-batch-thumb', '.grok-thumb-item', '.grok-ext-icon',
        '.titlex-ani', '.grok-strip-thumb', '.grok-strip-section',
        '.grok-strip-header', '.grok-strip-row', '.fab-icon'
    ].join(', ');

    function isScriptGeneratedEl(el) {
        if (!el || el.nodeType !== 1) return false;
        return !!(el.closest && el.closest(SCRIPT_UI_SELECTORS));
    }

    // =====================================================================
    // 2. SHARED STYLES
    // =====================================================================
    GM_addStyle(`
        /* ---- Batch / below-media thumbs (Detective) ---- */
        .grok-batch-thumbs, .grok-thumbs-below, .grok-ext-thumbs {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 6px !important;
            margin: 8px 0 4px !important;
            padding: 0 4px 0 8px !important;
            max-width: 100% !important;
            clear: both !important;
        }
        .grok-batch-thumbs.hidden, .grok-thumbs-below.hidden, .grok-ext-thumbs.hidden {
            display: none !important;
        }
        .grok-batch-thumb, .grok-thumb-item {
            width: ${THUMB_SIZE}px !important;
            height: ${THUMB_SIZE}px !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            cursor: pointer !important;
            position: relative !important;
            flex-shrink: 0 !important;
            border: 1px solid rgba(255,255,255,.12) !important;
            background: #1a1a22 !important;
            transition: transform .15s ease, border-color .15s ease !important;
            touch-action: manipulation !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        .grok-batch-thumb:hover, .grok-thumb-item:hover {
            transform: scale(1.06) !important;
            border-color: rgba(100,200,255,.65) !important;
        }
        .grok-batch-thumb img, .grok-thumb-item img {
            width: 100% !important; height: 100% !important;
            object-fit: cover !important; display: block !important;
        }
        .grok-batch-thumb.loading {
            font-size: 10px !important; color: rgba(255,255,255,.45) !important;
        }
        .grok-batch-thumb.placeholder, .grok-thumb-item.placeholder {
            background: linear-gradient(135deg,#1a1a22 0%,#2a2a35 100%) !important;
            border-color: rgba(100,180,255,.35) !important;
        }
        .grok-batch-thumb.missing-thumb {
            flex-direction: column !important; gap: 2px !important;
            border-color: rgba(251,191,36,.45) !important;
        }
        .grok-batch-thumb.missing-thumb .ph-missing {
            font-size: 10px !important; font-weight: 700 !important;
            line-height: 1.15 !important; text-align: center !important;
            color: rgba(251,191,36,.95) !important; white-space: pre-line !important;
            pointer-events: none !important; padding: 0 4px !important;
        }
        .grok-batch-thumb .badge, .grok-thumb-item .badge {
            position: absolute !important; bottom: 3px !important; right: 3px !important;
            background: rgba(0,0,0,0.75) !important; color: #fff !important;
            font-size: 10px !important; padding: 1px 4px !important;
            border-radius: 4px !important; pointer-events: none !important;
        }
        .grok-thumb-item .ph-icon { font-size: 22px !important; opacity: 0.85 !important; }
        .grok-thumb-item .ph-label {
            position: absolute !important; bottom: 3px !important; left: 3px !important; right: 3px !important;
            font-size: 8px !important; color: rgba(255,255,255,0.7) !important;
            text-align: center !important; white-space: nowrap !important;
            overflow: hidden !important; text-overflow: ellipsis !important; pointer-events: none !important;
        }

        /* Overlay icon (Lupa / external) */
        .grok-ext-icon, .titlex-ani {
            position: absolute !important; bottom: 4px !important; right: 4px !important;
            z-index: 2147483646 !important; width: 22px !important; height: 22px !important;
            font-size: 16px !important; line-height: 22px !important; text-align: center !important;
            cursor: pointer !important; transition: transform .15s ease, opacity .15s ease !important;
            user-select: none !important; pointer-events: auto !important; opacity: .9 !important;
            filter: drop-shadow(0 0 2px rgba(0,0,0,.85));
            background: rgba(0,0,0,.55) !important; border-radius: 6px !important;
            touch-action: manipulation !important;
        }
        .grok-ext-icon:hover, .titlex-ani:hover { transform: scale(1.25) !important; opacity: 1 !important; }
        .grok-ext-icon.hidden, .titlex-ani.hidden { display: none !important; }

        @media (max-width: 767px) {
            .grok-batch-thumb, .grok-thumb-item { width: 72px !important; height: 72px !important; }
            .grok-ext-icon, .titlex-ani {
                width: 28px !important; height: 28px !important; font-size: 18px !important;
                line-height: 28px !important; bottom: 6px !important; right: 6px !important;
            }
        }

        /* ---- FAB (Thonk) ---- */
        #grok-uuid-fab {
            position: fixed !important; bottom: 20px !important; right: 20px !important;
            width: ${BTN_SIZE}px !important; height: ${BTN_SIZE}px !important;
            z-index: 2147483646 !important; cursor: grab !important; border: none !important;
            background: transparent !important; box-shadow: none !important; padding: 0 !important;
            margin: 0 !important; overflow: visible !important; touch-action: none !important;
            user-select: none !important; display: none !important;
        }
        #grok-uuid-fab.visible { display: block !important; }
        #grok-uuid-fab:active { cursor: grabbing !important; }
        #grok-uuid-fab.dragging { opacity: .9 !important; }
        #grok-uuid-fab img.fab-icon {
            width: 100% !important; height: 100% !important; object-fit: contain !important;
            display: block !important; pointer-events: none !important; border: none !important;
            border-radius: 0 !important; background: transparent !important;
            filter: drop-shadow(0 2px 6px rgba(0,0,0,.45)) !important;
        }
        #grok-uuid-badge {
            position: absolute !important; top: -4px !important; right: -4px !important;
            min-width: 22px !important; height: 22px !important; padding: 0 6px !important;
            border-radius: 11px !important; background: #299fff !important; color: #fff !important;
            font: 700 12px/22px system-ui, -apple-system, sans-serif !important;
            text-align: center !important; box-shadow: 0 2px 6px rgba(0,0,0,.4) !important;
            pointer-events: none !important; display: none !important;
        }
        #grok-uuid-badge.visible { display: block !important; }
        #grok-uuid-tip {
            position: absolute !important; left: 50% !important; top: calc(100% + 4px) !important;
            transform: translateX(-50%) !important; white-space: nowrap !important;
            padding: 3px 6px !important; border-radius: 4px !important;
            background: rgba(16,15,14,.95) !important; border: 1px solid rgba(255,255,255,.14) !important;
            color: rgba(255,255,255,.75) !important;
            font: 600 10px/1.2 system-ui, -apple-system, sans-serif !important;
            pointer-events: none !important; opacity: 0 !important; transition: opacity .12s ease !important;
            z-index: 1 !important;
        }
        #grok-uuid-fab:hover #grok-uuid-tip { opacity: 1 !important; }

        #grok-uuid-strip {
            position: fixed !important; z-index: 2147483646 !important; display: none !important;
            flex-direction: column-reverse !important; gap: 8px !important; padding: 8px !important;
            border-radius: 12px !important; background: rgba(16,15,14,.97) !important;
            border: 1px solid rgba(255,255,255,.14) !important;
            box-shadow: 0 12px 40px rgba(0,0,0,.55) !important;
            width: max-content !important; max-width: min(480px, calc(100vw - 24px)) !important;
            max-height: min(420px, calc(100vh - 100px)) !important;
            overflow-y: auto !important; overflow-x: hidden !important;
            -webkit-overflow-scrolling: touch !important;
        }
        #grok-uuid-strip.open { display: flex !important; }
        .grok-strip-section { display: flex !important; flex-direction: column !important; gap: 6px !important; }
        .grok-strip-header {
            font: 700 11px/1.2 system-ui, -apple-system, sans-serif !important;
            color: rgba(255,255,255,.55) !important; text-transform: uppercase !important;
            letter-spacing: .06em !important; padding: 2px 2px 0 !important; user-select: none !important;
        }
        .grok-strip-row {
            display: flex !important; flex-wrap: wrap !important; gap: 6px !important; justify-content: center !important;
        }
        .grok-strip-thumb {
            width: ${FAB_THUMB_SIZE}px !important; height: ${FAB_THUMB_SIZE}px !important;
            border-radius: 8px !important; overflow: hidden !important; cursor: pointer !important;
            position: relative !important; flex-shrink: 0 !important;
            border: 1px solid rgba(255,255,255,.12) !important; background: #1a1a22 !important;
            transition: transform .12s ease, border-color .12s ease !important;
            touch-action: manipulation !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
        }
        .grok-strip-thumb:hover { transform: scale(1.08) !important; border-color: rgba(100,200,255,.65) !important; }
        .grok-strip-thumb img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block !important; }
        .grok-strip-thumb.missing {
            flex-direction: column !important; border-color: rgba(251,191,36,.45) !important;
            font-size: 9px !important; font-weight: 700 !important; color: rgba(251,191,36,.95) !important;
            text-align: center !important; line-height: 1.15 !important; padding: 2px !important;
        }

        /* ---- Lupa detail panel ---- */
        #lupa-detail-panel {
            position: fixed !important; z-index: 2147483647 !important;
            display: none !important; flex-direction: column !important;
            width: 340px !important; height: 640px !important;
            max-width: calc(100vw - 16px) !important; max-height: calc(100vh - 16px) !important;
            overflow: hidden !important; padding: 0 !important; border-radius: 14px !important;
            background: rgba(16,15,14,.98) !important;
            border: 1px solid rgba(255,255,255,.14) !important;
            box-shadow: 0 16px 48px rgba(0,0,0,.65) !important;
            color: #f0ebe6 !important; font-size: 12px !important; line-height: 1.45 !important;
            font-family: system-ui, -apple-system, sans-serif !important;
            -webkit-overflow-scrolling: touch !important; box-sizing: border-box !important;
        }
        #lupa-detail-panel.open { display: flex !important; }
        #lupa-detail-panel .dp-head {
            display: flex !important; align-items: center !important; justify-content: space-between !important;
            padding: 10px 12px 8px !important; border-bottom: 1px solid rgba(255,255,255,.08) !important; flex-shrink: 0 !important;
        }
        #lupa-detail-panel .dp-title { font-size: 13px !important; font-weight: 600 !important; opacity: .9 !important; }
        #lupa-detail-panel .dp-close {
            width: 28px !important; height: 28px !important; border: none !important; border-radius: 8px !important;
            background: rgba(255,255,255,.08) !important; color: #fff !important; font-size: 16px !important;
            cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important;
            padding: 0 !important; touch-action: manipulation !important;
        }
        #lupa-detail-panel .dp-close:hover { background: rgba(255,255,255,.16) !important; }
        #lupa-detail-panel .dp-body { overflow-y: auto !important; padding: 12px !important; flex: 1 !important; min-height: 0 !important; }
        #lupa-detail-panel .dp-thumb-wrap {
            display: flex !important; justify-content: center !important; margin-bottom: 12px !important;
            border-radius: 10px !important; overflow: hidden !important; background: #1a1918 !important; flex-shrink: 0 !important;
        }
        #lupa-detail-panel .dp-thumb {
            height: 200px !important; width: auto !important; max-width: 100% !important;
            object-fit: contain !important; display: block !important; background: #1a1918 !important;
        }
        #lupa-detail-panel .dp-row { margin-bottom: 8px !important; font-size: 12px !important; line-height: 1.45 !important; flex-shrink: 0 !important; }
        #lupa-detail-panel .dp-label {
            display: block !important; opacity: .5 !important; font-weight: 600 !important; font-size: 10px !important;
            text-transform: uppercase !important; letter-spacing: .04em !important; margin-bottom: 2px !important;
        }
        #lupa-detail-panel .dp-value { word-break: break-word !important; }
        #lupa-detail-panel .dp-uuid { font-family: ui-monospace, monospace !important; font-size: 11px !important; word-break: break-all !important; opacity: .9 !important; }
        #lupa-detail-panel .dp-prompt-box {
            margin-top: 4px !important; padding: 10px !important; background: rgba(255,255,255,.04) !important;
            border: 1px solid rgba(255,255,255,.08) !important; border-radius: 8px !important;
            white-space: pre-wrap !important; word-break: break-word !important;
            max-height: calc(1.5em * 6 + 20px) !important; overflow-y: auto !important;
            font-size: 12px !important; line-height: 1.5 !important; -webkit-overflow-scrolling: touch !important;
        }
        #lupa-detail-panel .dp-prompt-empty { opacity: .5 !important; font-style: italic !important; }
        #lupa-detail-panel .dp-actions {
            display: flex !important; flex-wrap: wrap !important; gap: 8px !important;
            padding: 10px 12px 12px !important; border-top: 1px solid rgba(255,255,255,.08) !important; flex-shrink: 0 !important;
        }
        #lupa-detail-panel .dp-btn {
            display: inline-flex !important; align-items: center !important; justify-content: center !important;
            gap: 6px !important; padding: 8px 12px !important; border-radius: 8px !important; border: none !important;
            font-size: 12px !important; font-weight: 600 !important; cursor: pointer !important;
            touch-action: manipulation !important; text-decoration: none !important; color: #fff !important;
            transition: background .12s, transform .12s !important;
        }
        #lupa-detail-panel .dp-btn:active { transform: scale(.97) !important; }
        #lupa-detail-panel .dp-btn-open { background: #299fff !important; }
        #lupa-detail-panel .dp-btn-open:hover { background: #1a8ee6 !important; }
        #lupa-detail-panel .dp-btn-copy {
            background: rgba(255,255,255,.1) !important; border: 1px solid rgba(255,255,255,.14) !important;
        }
        #lupa-detail-panel .dp-btn-copy:hover { background: rgba(255,255,255,.18) !important; }
        #lupa-detail-panel .dp-btn-copy.copied { background: #16a34a !important; border-color: transparent !important; }
        #lupa-detail-panel .dp-loading { opacity: .6 !important; font-style: italic !important; padding: 8px 0 !important; }
    `);

    // =====================================================================
    // 3. SHARED VALIDATION
    // =====================================================================
    function isRealAsset(uuid) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://grok.com/rest/assets/' + encodeURIComponent(uuid),
                headers: { Accept: 'application/json' },
                timeout: 9000,
                onload(res) {
                    if (res.status === 404 || res.status < 200 || res.status >= 300) {
                        resolve(false);
                        return;
                    }
                    try {
                        const data = JSON.parse(res.responseText);
                        const asset = data?.asset ?? data;
                        if (asset && typeof asset === 'object' &&
                            !asset.code && asset.message !== 'Asset not found' &&
                            (asset.assetId || asset.id || asset.mimeType || asset.mime_type ||
                             asset.mediaGenInput || asset.ownerUserId || asset.key || asset.auxKeys)) {
                            resolve(true);
                            return;
                        }
                    } catch {}
                    resolve(false);
                },
                onerror() { resolve(false); },
                ontimeout() { resolve(false); }
            });
        });
    }

    function checkImage(uuid) {
        const key = String(uuid).toLowerCase();
        if (thumbCache.has(key)) return Promise.resolve(thumbCache.get(key));

        return new Promise(resolve => {
            const failToAssetCheck = () => {
                isRealAsset(key).then(real => {
                    const result = real
                        ? { ok: true, thumb: null, missingThumb: true, kind: 'Image' }
                        : null;
                    thumbCache.set(key, result);
                    resolve(result);
                });
            };

            GM_xmlhttpRequest({
                method: 'GET',
                url: MAKE_THUMB_LINK(key),
                responseType: 'blob',
                timeout: 7000,
                onload(res) {
                    if (res.status < 200 || res.status >= 300 || !res.response) return failToAssetCheck();
                    const blob = res.response;
                    const type = (blob.type || '').toLowerCase();
                    if (type.startsWith('image/') && blob.size > 1500) {
                        const url = URL.createObjectURL(blob);
                        const result = { ok: true, thumb: url, missingThumb: false, kind: 'Image' };
                        thumbCache.set(key, result);
                        resolve(result);
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                        const t = (reader.result || '').toLowerCase();
                        if (t.includes('not found') || t.includes('media post not found') ||
                            t.includes('post not found') || t.includes('<!doctype') ||
                            t.includes('<html') || blob.size < 2000) {
                            return failToAssetCheck();
                        }
                        const url = URL.createObjectURL(blob);
                        const result = { ok: true, thumb: url, missingThumb: false, kind: 'Image' };
                        thumbCache.set(key, result);
                        resolve(result);
                    };
                    reader.onerror = failToAssetCheck;
                    reader.readAsText(blob.slice(0, 2500));
                },
                onerror: failToAssetCheck,
                ontimeout: failToAssetCheck
            });
        });
    }

    // =====================================================================
    // 4. SHARED META / PROMPT
    // =====================================================================
    function extractPromptFromAsset(data) {
        if (!data) return '';
        const mgi = data.mediaGenInput;
        if (mgi && typeof mgi === 'object') {
            const KINDS = ['textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'referenceToVideo', 'videoExtension'];
            for (const k of KINDS) {
                const block = mgi[k];
                if (block && typeof block === 'object' && block.prompt) return String(block.prompt).trim();
            }
            for (const value of Object.values(mgi)) {
                if (value && typeof value === 'object' && value.prompt) return String(value.prompt).trim();
            }
        }
        return String(data.summary || data.prompt || data.originalPrompt || '').trim();
    }

    function extractMetaFromAsset(data) {
        if (!data) return { kind: '', ext: '', created: '' };
        const mime = String(data.mimeType || data.mime_type || '').toLowerCase();
        let kind = '', ext = '';
        if (mime.startsWith('video/') || /video/i.test(mime)) {
            kind = 'Video';
            if (mime.includes('webm')) ext = '.webm';
            else if (mime.includes('mov') || mime.includes('quicktime')) ext = '.mov';
            else ext = '.mp4';
        } else if (mime.startsWith('image/') || mime) {
            kind = 'Image';
            if (mime.includes('png')) ext = '.png';
            else if (mime.includes('webp')) ext = '.webp';
            else if (mime.includes('gif')) ext = '.gif';
            else ext = '.jpg';
        } else {
            const keys = data.mediaGenInput ? Object.keys(data.mediaGenInput).join(' ').toLowerCase() : '';
            if (/video/.test(keys)) { kind = 'Video'; ext = '.mp4'; }
            else { kind = 'Image'; ext = '.jpg'; }
        }
        let created = '';
        const raw = data.createTime || data.createdAt || data.create_time || data.created_at || '';
        if (raw) {
            const d = new Date(raw);
            created = !Number.isNaN(d.getTime())
                ? d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : String(raw);
        }
        return { kind, ext, created };
    }

    function fetchGrokAssetMeta(uuid) {
        const key = String(uuid).toLowerCase();
        if (metaCache.has(key)) return Promise.resolve(metaCache.get(key));
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://grok.com/rest/assets/' + encodeURIComponent(key),
                headers: { Accept: 'application/json' },
                timeout: 9000,
                onload(res) {
                    if (res.status < 200 || res.status >= 300) {
                        metaCache.set(key, null);
                        resolve(null);
                        return;
                    }
                    try {
                        const data = JSON.parse(res.responseText);
                        const asset = data?.asset ?? data;
                        metaCache.set(key, asset);
                        resolve(asset);
                    } catch {
                        metaCache.set(key, null);
                        resolve(null);
                    }
                },
                onerror() { metaCache.set(key, null); resolve(null); },
                ontimeout() { metaCache.set(key, null); resolve(null); }
            });
        });
    }

    // =====================================================================
    // 5. SHARED LUPA DETAIL PANEL
    // =====================================================================
    function getLupaPanel() {
        let panel = document.getElementById('lupa-detail-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'lupa-detail-panel';
            document.body.appendChild(panel);
        }
        return panel;
    }

    function hideLupaPanel() {
        const panel = document.getElementById('lupa-detail-panel');
        if (panel) panel.classList.remove('open');
        lastLupaUuid = null;
    }

    function positionLupaPanel(anchorEl) {
        const panel = getLupaPanel();
        if (lupaFixedPos) {
            panel.style.left = lupaFixedPos.left + 'px';
            panel.style.top = lupaFixedPos.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.width = '340px';
            panel.style.height = '640px';
            return;
        }
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const r = (anchorEl || document.body).getBoundingClientRect();
        const pw = 340, ph = 640;
        let left = r.right + 12;
        if (left + pw > winW - 8) left = Math.max(8, r.left - pw - 12);
        if (left < 8) left = 8;
        let top = r.top;
        if (top + ph > winH - 8) top = Math.max(8, winH - ph - 8);
        if (top < 8) top = 8;
        left = Math.round(left);
        top = Math.round(top);
        lupaFixedPos = { left, top };
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.width = '340px';
        panel.style.height = '640px';
    }

    function buildLupaPanelContent(panel, info) {
        panel.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'dp-head';
        const title = document.createElement('div');
        title.className = 'dp-title';
        title.textContent = info.title || 'Grok reference';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'dp-close';
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); hideLupaPanel(); };
        head.appendChild(title);
        head.appendChild(closeBtn);
        panel.appendChild(head);

        const body = document.createElement('div');
        body.className = 'dp-body';

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'dp-thumb-wrap';
        const big = document.createElement('img');
        big.className = 'dp-thumb';
        big.alt = '';
        big.loading = 'lazy';
        if (info.thumb) {
            big.src = info.thumb;
        } else if (info.thumbs && info.thumbs.length) {
            let idx = 0;
            big.src = info.thumbs[0];
            big.onerror = () => {
                idx++;
                if (idx < info.thumbs.length) big.src = info.thumbs[idx];
                else big.style.display = 'none';
            };
        } else {
            big.src = MAKE_THUMB_LINK(info.uuid);
            big.onerror = () => { big.style.display = 'none'; };
        }
        thumbWrap.appendChild(big);
        body.appendChild(thumbWrap);

        if (info.kind || info.ext) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">File Type</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = info.kind && info.ext ? `${info.kind}${info.ext}` : (info.kind || info.ext || '—');
            row.appendChild(val);
            body.appendChild(row);
        }
        if (info.created) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Created</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = info.created;
            row.appendChild(val);
            body.appendChild(row);
        }
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">UUID</span>';
            const val = document.createElement('div');
            val.className = 'dp-value dp-uuid';
            val.textContent = info.uuid;
            row.appendChild(val);
            body.appendChild(row);
        }
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Prompt</span>';
            const box = document.createElement('div');
            box.className = 'dp-prompt-box';
            const text = (info.prompt || '').trim();
            if (text) box.textContent = text;
            else { box.classList.add('dp-prompt-empty'); box.textContent = '(not available)'; }
            row.appendChild(box);
            body.appendChild(row);
        }
        panel.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'dp-actions';
        const openLink = document.createElement('a');
        openLink.className = 'dp-btn dp-btn-open';
        openLink.href = MAKE_IMAGINE_LINK(info.uuid);
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open on Imagine';
        openLink.onclick = e => e.stopPropagation();
        actions.appendChild(openLink);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'dp-btn dp-btn-copy';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy prompt';
        copyBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const text = (info.prompt || '').trim();
            if (!text) return;
            const done = () => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy prompt';
                    copyBtn.classList.remove('copied');
                }, 1600);
            };
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;left:-9999px;';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); } catch {}
                    ta.remove();
                    done();
                });
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch {}
                ta.remove();
                done();
            }
        };
        actions.appendChild(copyBtn);
        panel.appendChild(actions);
    }

    async function showLupaDetailPanel(anchorEl, uuid, opts = {}) {
        const u = String(uuid).toLowerCase();
        if (lastLupaUuid === u) {
            hideLupaPanel();
            return;
        }
        lastLupaUuid = u;

        const panel = getLupaPanel();
        buildLupaPanelContent(panel, {
            title: opts.title || 'Grok reference',
            uuid: u,
            thumb: opts.thumb || null,
            thumbs: opts.thumbs || null,
            kind: opts.isVideo ? 'Video' : (opts.kind || ''),
            ext: opts.ext || '',
            created: opts.created || '',
            prompt: opts.prompt || ''
        });
        const promptBox = panel.querySelector('.dp-prompt-box');
        if (promptBox && !opts.prompt) {
            promptBox.classList.add('dp-loading');
            promptBox.textContent = 'Loading…';
        }
        panel.classList.add('open');
        requestAnimationFrame(() => positionLupaPanel(anchorEl));

        let thumb = opts.thumb || null;
        if (!thumb && !(opts.thumbs && opts.thumbs.length)) {
            try {
                const vr = await checkImage(u);
                if (vr && vr.thumb) thumb = vr.thumb;
            } catch {}
        }
        let asset = null;
        try { asset = await fetchGrokAssetMeta(u); } catch {}
        const meta = extractMetaFromAsset(asset);
        const prompt = opts.prompt || extractPromptFromAsset(asset);
        if (opts.isVideo && !meta.kind) {
            meta.kind = 'Video';
            meta.ext = meta.ext || '.mp4';
        }

        buildLupaPanelContent(panel, {
            title: opts.title || 'Grok reference',
            uuid: u,
            thumb: thumb || null,
            thumbs: opts.thumbs || null,
            kind: meta.kind || opts.kind || '',
            ext: meta.ext || opts.ext || '',
            created: meta.created || opts.created || '',
            prompt
        });
        requestAnimationFrame(() => positionLupaPanel(anchorEl));
    }

    function showDetailFromInfo(anchorEl, info) {
        showLupaDetailPanel(anchorEl, info.uuid, {
            title: info.title,
            thumb: info.thumb,
            thumbs: info.thumbs,
            kind: info.kind,
            ext: info.ext,
            created: info.created,
            prompt: info.prompt
        });
    }

    // Close Lupa on outside click
    document.addEventListener('click', e => {
        const panel = document.getElementById('lupa-detail-panel');
        if (panel && panel.classList.contains('open') &&
            !panel.contains(e.target) &&
            !e.target.closest('.grok-batch-thumb') &&
            !e.target.closest('.grok-thumb-item') &&
            !e.target.closest('.grok-ext-icon') &&
            !e.target.closest('.titlex-ani') &&
            !e.target.closest('.grok-strip-thumb') &&
            !e.target.closest('#grok-uuid-fab')) {
            hideLupaPanel();
            lupaFixedPos = null;
        }
    }, true);

    // F4: toggle icons + FAB visibility
    document.addEventListener('keydown', e => {
        if (e.key !== 'F4' && e.code !== 'F4') return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();

        iconsVisible = !iconsVisible;
        userHidden = !iconsVisible;

        document.querySelectorAll('.grok-batch-thumbs, .grok-thumbs-below, .grok-ext-thumbs').forEach(c => {
            c.classList.toggle('hidden', !iconsVisible);
        });
        document.querySelectorAll('.grok-ext-icon, .titlex-ani').forEach(i => {
            i.classList.toggle('hidden', !iconsVisible);
        });

        window.dispatchEvent(new CustomEvent('grok-uuid-f4', { detail: { hidden: userHidden } }));
    }, true);

    // =====================================================================
    // 6. SHARED THUMB BUILDER
    // =====================================================================
    function createThumbItem(uuid, opts = {}) {
        const { thumb = null, missingThumb = false, isVideo = false, conf = '' } = opts;
        const item = document.createElement('div');
        item.className = 'grok-batch-thumb' +
            (thumb ? '' : (missingThumb ? ' placeholder missing-thumb' : ' placeholder'));
        item.title = `Click for details\n${uuid}`;

        if (thumb) {
            const img = document.createElement('img');
            img.src = thumb;
            img.loading = 'lazy';
            img.alt = '';
            item.appendChild(img);
        } else if (missingThumb) {
            const span = document.createElement('span');
            span.className = 'ph-missing';
            span.textContent = 'No preview';
            item.appendChild(span);
        } else {
            const icon = document.createElement('span');
            icon.className = 'ph-icon';
            icon.textContent = '🔍';
            item.appendChild(icon);
            if (conf) {
                const label = document.createElement('span');
                label.className = 'ph-label';
                label.textContent = conf === 'high' ? 'Grok' : 'UUID';
                item.appendChild(label);
            }
        }

        if (isVideo) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = '▶';
            item.appendChild(badge);
        }

        item.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showLupaDetailPanel(item, uuid, { thumb, isVideo });
        });

        return item;
    }

    // =====================================================================
    // 7. SHARED FAB UI (Thonk)
    // =====================================================================
    function removeUI() {
        document.getElementById('grok-uuid-fab')?.remove();
        document.getElementById('grok-uuid-strip')?.remove();
        hideLupaPanel();
        panelOpen = false;
    }

    function ensureUI() {
        let fab = document.getElementById('grok-uuid-fab');
        let strip = document.getElementById('grok-uuid-strip');
        document.querySelectorAll('#grok-uuid-fab').forEach((el, i) => { if (i > 0) el.remove(); });
        document.querySelectorAll('#grok-uuid-strip').forEach((el, i) => { if (i > 0) el.remove(); });
        if (fab && strip) {
            if (fabPos) {
                fab.style.left = fabPos.left + 'px';
                fab.style.top = fabPos.top + 'px';
                fab.style.right = 'auto';
                fab.style.bottom = 'auto';
            }
            return;
        }
        removeUI();

        fab = document.createElement('div');
        fab.id = 'grok-uuid-fab';
        const img = document.createElement('img');
        img.className = 'fab-icon';
        img.src = ICON_URL;
        img.alt = 'lupa';
        fab.appendChild(img);
        const badge = document.createElement('div');
        badge.id = 'grok-uuid-badge';
        badge.textContent = '0';
        fab.appendChild(badge);
        const tip = document.createElement('div');
        tip.id = 'grok-uuid-tip';
        tip.textContent = 'Press F4 to Hide';
        fab.appendChild(tip);
        strip = document.createElement('div');
        strip.id = 'grok-uuid-strip';

        if (fabPos) {
            fab.style.left = fabPos.left + 'px';
            fab.style.top = fabPos.top + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        }

        let isDragging = false, dragMoved = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
        function onPointerDown(e) {
            if (e.button !== undefined && e.button !== 0) return;
            isDragging = true; dragMoved = false;
            fab.classList.add('dragging');
            const rect = fab.getBoundingClientRect();
            startX = e.clientX ?? e.touches?.[0]?.clientX;
            startY = e.clientY ?? e.touches?.[0]?.clientY;
            origLeft = rect.left; origTop = rect.top;
            fab.style.left = origLeft + 'px';
            fab.style.top = origTop + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
            e.preventDefault();
        }
        function onPointerMove(e) {
            if (!isDragging) return;
            const cx = e.clientX ?? e.touches?.[0]?.clientX;
            const cy = e.clientY ?? e.touches?.[0]?.clientY;
            const dx = cx - startX, dy = cy - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
            let left = Math.max(0, Math.min(window.innerWidth - BTN_SIZE, origLeft + dx));
            let top = Math.max(0, Math.min(window.innerHeight - BTN_SIZE, origTop + dy));
            fab.style.left = left + 'px';
            fab.style.top = top + 'px';
            fabPos = { left, top };
            if (panelOpen) positionStripNearFab();
        }
        function onPointerUp() {
            if (!isDragging) return;
            isDragging = false;
            fab.classList.remove('dragging');
            if (!dragMoved && typeof onFabClick === 'function') onFabClick();
        }
        fab.addEventListener('mousedown', onPointerDown);
        fab.addEventListener('touchstart', onPointerDown, { passive: false });
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('touchmove', onPointerMove, { passive: false });
        window.addEventListener('mouseup', onPointerUp);
        window.addEventListener('touchend', onPointerUp);

        document.body.appendChild(fab);
        document.body.appendChild(strip);
    }

    function positionStripNearFab() {
        const fab = document.getElementById('grok-uuid-fab');
        const strip = document.getElementById('grok-uuid-strip');
        if (!fab || !strip || !strip.classList.contains('open')) return;
        const fr = fab.getBoundingClientRect();
        strip.style.visibility = 'hidden';
        strip.style.display = 'flex';
        const sw = strip.offsetWidth || 120;
        const sh = strip.offsetHeight || 80;
        strip.style.visibility = '';
        let left = fr.left + fr.width / 2 - sw / 2;
        left = Math.max(8, Math.min(window.innerWidth - sw - 8, left));
        if (fr.top - sh - 8 < 8) {
            strip.style.top = (fr.bottom + 8) + 'px';
            strip.style.bottom = 'auto';
        } else {
            strip.style.bottom = (window.innerHeight - fr.top + 8) + 'px';
            strip.style.top = 'auto';
        }
        strip.style.left = left + 'px';
        strip.style.right = 'auto';
    }

    function setFabVisible(show, count) {
        ensureUI();
        const fab = document.getElementById('grok-uuid-fab');
        const badge = document.getElementById('grok-uuid-badge');
        if (!fab || !badge) return;
        if (show && !userHidden && count > 0) {
            fab.classList.add('visible');
            badge.textContent = count > 999 ? '999+' : String(count);
            badge.classList.add('visible');
        } else {
            fab.classList.remove('visible');
            badge.classList.remove('visible');
            if (panelOpen) {
                panelOpen = false;
                const strip = document.getElementById('grok-uuid-strip');
                if (strip) strip.classList.remove('open');
                hideLupaPanel();
            }
        }
    }

    // =====================================================================
    // 8. MODE A: GROK.COM — Parent references (Thonk)
    // =====================================================================
    if (isGrok) {
        let parents = [];

        function getPostUuid() {
            const m = location.pathname.match(/^\/imagine\/post\/([0-9a-f-]{36})/i);
            return m ? m[1].toLowerCase() : null;
        }

        async function fetchAsset(uuid) {
            if (assetCache.has(uuid)) return assetCache.get(uuid);
            try {
                const res = await fetch('/rest/assets/' + uuid, { credentials: 'include' });
                if (!res.ok) return null;
                const data = await res.json();
                const asset = data?.asset ?? data;
                assetCache.set(uuid, asset);
                return asset;
            } catch {
                return null;
            }
        }

        function lastUuid(str) {
            if (!str) return null;
            const m = String(str).match(UUID_GLOBAL);
            return m ? m[m.length - 1].toLowerCase() : null;
        }

        function extractRefs(data, exclude) {
            const found = new Set();
            const mgi = data?.mediaGenInput;
            if (mgi && typeof mgi === 'object') {
                for (const key of Object.keys(mgi)) {
                    const block = mgi[key];
                    if (Array.isArray(block?.inputAssets)) {
                        for (const id of block.inputAssets) {
                            if (typeof id === 'string' && id.length > 30) found.add(id.toLowerCase());
                        }
                    }
                }
            }
            try {
                let raw = data?.auxKeys?.image_references;
                if (raw) {
                    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (Array.isArray(arr)) {
                        for (const url of arr) {
                            const u = lastUuid(url);
                            if (u) found.add(u);
                        }
                    }
                }
            } catch {}
            if (exclude) found.delete(exclude);
            return [...found];
        }

        function buildThumbCandidates(uuid, owner, data) {
            const list = [];
            try {
                let raw = data?.auxKeys?.image_references;
                if (raw) {
                    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (Array.isArray(arr)) {
                        for (const u of arr) if (typeof u === 'string' && u.startsWith('http')) list.push(u);
                    }
                }
            } catch {}
            const preview = data?.auxKeys?.['preview-image'];
            if (preview) list.push('https://assets.grok.com/' + preview + '?cache=1');
            if (owner) {
                list.push(`https://assets.grok.com/users/${owner}/generated/${uuid}/image.jpg?cache=1`);
                list.push(`https://assets.grok.com/users/${owner}/${uuid}/content?cache=1`);
                list.push(`https://assets.grok.com/users/${owner}/generated/${uuid}/content?cache=1`);
            }
            list.push(`https://assets.grok.com/generated/${uuid}/image.jpg?cache=1`);
            list.push(`https://assets.grok.com/generated/${uuid}/content?cache=1`);
            list.push(MAKE_THUMB_LINK(uuid));
            return [...new Set(list)];
        }

        async function collectParents(root) {
            const ordered = [];
            const seen = new Set([root]);
            let frontier = [root];
            let depth = 0;
            while (frontier.length && depth < MAX_PARENT_DEPTH) {
                depth++;
                const next = [];
                for (const id of frontier) {
                    const data = await fetchAsset(id);
                    if (!data) continue;
                    for (const ref of extractRefs(data, root)) {
                        if (seen.has(ref)) continue;
                        seen.add(ref);
                        const refData = await fetchAsset(ref);
                        const owner = (refData && refData.ownerUserId) || data.ownerUserId || null;
                        const isComposer = !(refData && refData.mediaGenInput);
                        const prompt = extractPromptFromAsset(refData) || extractPromptFromAsset(data) || '';
                        const meta = extractMetaFromAsset(refData);
                        ordered.push({
                            uuid: ref,
                            depth,
                            ownerUserId: owner,
                            isComposer,
                            thumbs: buildThumbCandidates(ref, owner, refData),
                            prompt,
                            kind: meta.kind,
                            ext: meta.ext,
                            created: meta.created
                        });
                        next.push(ref);
                    }
                }
                frontier = next;
            }
            ordered.sort((a, b) => {
                if (a.isComposer && !b.isComposer) return -1;
                if (!a.isComposer && b.isComposer) return 1;
                return a.depth - b.depth;
            });
            return ordered;
        }

        function rebuildParentStrip() {
            const strip = document.getElementById('grok-uuid-strip');
            if (!strip) return;
            strip.innerHTML = '';
            if (!parents.length) return;

            const sec = document.createElement('div');
            sec.className = 'grok-strip-section';
            const h = document.createElement('div');
            h.className = 'grok-strip-header';
            h.textContent = `Parents (${parents.length})`;
            sec.appendChild(h);
            const row = document.createElement('div');
            row.className = 'grok-strip-row';

            for (const p of parents) {
                const item = document.createElement('div');
                item.className = 'grok-strip-thumb';
                item.title = p.uuid;
                const img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                const candidates = p.thumbs || [];
                let idx = 0;
                img.src = candidates[0] || MAKE_THUMB_LINK(p.uuid);
                img.onerror = () => {
                    idx++;
                    if (idx < candidates.length) img.src = candidates[idx];
                    else {
                        item.classList.add('missing');
                        item.textContent = 'No\npreview';
                    }
                };
                item.appendChild(img);
                item.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    showDetailFromInfo(item, {
                        title: 'Parent reference',
                        uuid: p.uuid,
                        thumbs: p.thumbs,
                        thumb: null,
                        kind: p.kind,
                        ext: p.ext,
                        created: p.created,
                        prompt: p.prompt
                    });
                });
                row.appendChild(item);
            }
            sec.appendChild(row);
            strip.appendChild(sec);
            requestAnimationFrame(() => positionStripNearFab());
        }

        function toggleStrip() {
            panelOpen = !panelOpen;
            const strip = document.getElementById('grok-uuid-strip');
            if (!strip) return;
            if (panelOpen) {
                rebuildParentStrip();
                strip.classList.add('open');
                requestAnimationFrame(() => positionStripNearFab());
            } else {
                strip.classList.remove('open');
                hideLupaPanel();
                lupaFixedPos = null;
            }
        }

        onFabClick = toggleStrip;

        window.addEventListener('grok-uuid-f4', () => {
            setFabVisible(true, parents.length);
            scheduleMediaPos();
        });

        let posRaf = 0;
        let userDraggedOnGrok = false;

        function findMainMedia() {
            const candidates = [];
            document.querySelectorAll('video, img').forEach(el => {
                if (!el.isConnected) return;
                if (isScriptGeneratedEl(el)) return;
                if (el.classList.contains('fab-icon')) return;
                const r = el.getBoundingClientRect();
                const area = r.width * r.height;
                if (r.width < 120 || r.height < 120) return;
                if (r.bottom < 40 || r.top > window.innerHeight - 40) return;
                if (area < 20000) return;
                candidates.push({ el, area, r });
            });
            if (!candidates.length) return null;
            candidates.sort((a, b) => b.area - a.area);
            return candidates[0];
        }

        function updateMediaPos() {
            const fab = document.getElementById('grok-uuid-fab');
            if (!fab || !fab.classList.contains('visible')) return;
            if (userDraggedOnGrok && fabPos) {
                fab.style.left = fabPos.left + 'px';
                fab.style.top = fabPos.top + 'px';
                fab.style.right = 'auto';
                fab.style.bottom = 'auto';
                if (panelOpen) positionStripNearFab();
                return;
            }

            const btnSize = BTN_SIZE;
            const margin = 10;
            let left, top;
            const media = findMainMedia();
            if (media) {
                const r = media.r;
                left = Math.round(r.right - btnSize - margin);
                top = Math.round(r.top + margin);
                if (left < 8) left = 8;
                if (left + btnSize > window.innerWidth - 8) left = window.innerWidth - btnSize - 8;
                if (top < 8) top = 8;
                if (top + btnSize > window.innerHeight - 8) top = window.innerHeight - btnSize - 8;
            } else {
                left = window.innerWidth - btnSize - 16;
                top = 16;
            }

            fab.style.left = left + 'px';
            fab.style.top = top + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
            if (panelOpen) positionStripNearFab();
        }

        function scheduleMediaPos() {
            if (posRaf) cancelAnimationFrame(posRaf);
            posRaf = requestAnimationFrame(() => {
                posRaf = 0;
                updateMediaPos();
            });
        }

        async function runGrok() {
            const uuid = getPostUuid();
            if (!uuid) {
                parents = [];
                setFabVisible(false, 0);
                return;
            }
            userDraggedOnGrok = false;
            fabPos = null;
            ensureUI();
            const fab = document.getElementById('grok-uuid-fab');
            if (fab && !fab.dataset.grokMediaHooked) {
                fab.dataset.grokMediaHooked = '1';
                let dragStart = null;
                fab.addEventListener('mousedown', e => {
                    dragStart = { x: e.clientX, y: e.clientY };
                });
                fab.addEventListener('mouseup', e => {
                    if (dragStart && (Math.abs(e.clientX - dragStart.x) > 6 || Math.abs(e.clientY - dragStart.y) > 6)) {
                        userDraggedOnGrok = true;
                    }
                    dragStart = null;
                });
            }
            parents = await collectParents(uuid);
            setFabVisible(true, parents.length);
            scheduleMediaPos();
            if (panelOpen) rebuildParentStrip();
        }

        function startGrok() {
            runGrok();

            const obs = new MutationObserver(() => scheduleMediaPos());
            obs.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });
            window.addEventListener('resize', scheduleMediaPos);
            window.addEventListener('scroll', scheduleMediaPos, { passive: true });
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', scheduleMediaPos);
                window.visualViewport.addEventListener('scroll', scheduleMediaPos);
            }
            window.addEventListener('orientationchange', () => setTimeout(scheduleMediaPos, 150));

            const push = history.pushState;
            const replace = history.replaceState;
            history.pushState = function () {
                push.apply(this, arguments);
                userDraggedOnGrok = false;
                fabPos = null;
                setTimeout(runGrok, 250);
            };
            history.replaceState = function () {
                replace.apply(this, arguments);
                userDraggedOnGrok = false;
                fabPos = null;
                setTimeout(runGrok, 250);
            };
            window.addEventListener('popstate', () => {
                userDraggedOnGrok = false;
                fabPos = null;
                setTimeout(runGrok, 250);
            });
            let last = location.href;
            setInterval(() => {
                if (location.href !== last) {
                    last = location.href;
                    userDraggedOnGrok = false;
                    fabPos = null;
                    setTimeout(runGrok, 300);
                } else {
                    scheduleMediaPos();
                }
            }, 700);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startGrok);
        } else {
            startGrok();
        }

        console.log('%c[Detective Ani] Grok parents mode (Thonk) active', 'color:#299fff;font-weight:bold');
        return; // don't run other modes on grok.com
    }

    // =====================================================================
    // 9. REDDIT MODULE (Detective)
    // =====================================================================
    if (isReddit) {
        const processed = new Set();
        let queue = [];
        let active = 0;
        let running = false;

        function isListing() {
            return /^\/r\/[^/]+\/?(?:hot|new|top|rising|controversial|best)?\/?$/.test(location.pathname);
        }

        function decodeEntities(s) {
            return String(s || '')
                .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/');
        }

        function expandEncodings(text) {
            const parts = [decodeEntities(text)];
            try { parts.push(decodeURIComponent(parts[0].replace(/\+/g, ' '))); } catch {}
            try { parts.push(decodeURIComponent(parts[parts.length - 1])); } catch {}
            return parts.join('\n');
        }

        function extractUUIDs(text) {
            const decoded = expandEncodings(text);
            const uuids = new Set();
            const patterns = [
                /(?:https?:\/\/)?(?:www\.)?grok\.com\/imagine\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /(?:https?:\/\/)?(?:www\.)?grok\.com\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /(?:https?:\/\/)?(?:www\.)?assets\.grok\.com\/[^\s"'<>]*?(?:post|imagine)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /out\.reddit\.com\/[^\s"'<>]*?grok\.com\/(?:imagine\/)?post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
            ];
            patterns.forEach(re => {
                let m;
                re.lastIndex = 0;
                while ((m = re.exec(decoded)) !== null) {
                    if (m[1] && UUID_RE.test(m[1])) uuids.add(m[1].toLowerCase());
                }
            });
            return [...uuids];
        }

        function Reddit_Thumbs(uuids) {
            if (!uuids.length) return null;
            const box = document.createElement('div');
            box.className = 'grok-batch-thumbs' + (iconsVisible ? '' : ' hidden');

            uuids.forEach(uuid => {
                const item = document.createElement('div');
                item.className = 'grok-batch-thumb loading';
                item.textContent = '…';
                item.title = `Click for details\n${uuid}`;
                let thumbUrl = null;

                item.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    showLupaDetailPanel(item, uuid, { thumb: thumbUrl });
                });

                checkImage(uuid).then(result => {
                    if (!result || !result.ok) { item.remove(); return; }
                    item.textContent = '';
                    if (result.thumb) {
                        thumbUrl = result.thumb;
                        item.className = 'grok-batch-thumb';
                        const img = document.createElement('img');
                        img.src = result.thumb;
                        img.alt = '';
                        img.loading = 'lazy';
                        item.appendChild(img);
                    } else {
                        item.className = 'grok-batch-thumb placeholder missing-thumb';
                        const span = document.createElement('span');
                        span.className = 'ph-missing';
                        span.textContent = 'No preview';
                        item.appendChild(span);
                    }
                });
                box.appendChild(item);
            });
            return box;
        }

        function insertThumbsNearPost(postEl, container) {
            if (!postEl || !container || !postEl.parentElement) return;
            const pid = container.dataset.for || '';
            if (pid) {
                postEl.parentElement.querySelectorAll(`.grok-batch-thumbs[data-for="${pid}"]`).forEach(el => el.remove());
            }
            postEl.querySelectorAll('.grok-batch-thumbs').forEach(el => el.remove());
            container.style.margin = '8px 0 12px 0';
            container.style.paddingLeft = '8px';
            if (postEl.nextSibling) {
                postEl.parentElement.insertBefore(container, postEl.nextSibling);
            } else {
                postEl.parentElement.appendChild(container);
            }
        }

        function getPostElements() {
            const list = [...document.querySelectorAll('shreddit-post, [data-testid="post-container"], article[id^="t3_"]')];
            return list.length ? list : [...document.querySelectorAll('#siteTable .thing.link, .linklisting .thing.link')];
        }

        function getCommentsUrl(el) {
            const a = el.querySelector('a[slot="full-post-link"], a[href*="/comments/"], a[data-click-id="body"]');
            if (a?.href && /\/comments\//.test(a.href)) return a.href;
            const perm = el.getAttribute('permalink') || el.getAttribute('content-href');
            if (perm && /\/comments\//.test(perm)) {
                try { return new URL(perm, location.origin).href; } catch {}
            }
            const oldA = el.querySelector('a.comments, a.bylink.comments');
            if (oldA) return oldA.href;
            const dataPerm = el.getAttribute('data-permalink');
            return dataPerm ? location.origin + dataPerm : null;
        }

        function getPostId(url) {
            try {
                const parts = new URL(url).pathname.split('/').filter(Boolean);
                const i = parts.indexOf('comments');
                return i !== -1 && parts[i + 1] ? parts[i + 1].toLowerCase() : url;
            } catch { return url; }
        }

        async function fetchCommentsText(commentsUrl) {
            const jsonUrl = commentsUrl.replace(/\/+$/, '') + '.json?limit=150&raw_json=1';
            try {
                const res = await fetch(jsonUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                if (res.ok) return decodeEntities(await res.text());
            } catch {}
            try {
                const res = await fetch(commentsUrl, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
                if (res.ok) return decodeEntities(await res.text());
            } catch {}
            return '';
        }

        async function processOne(el) {
            const commentsUrl = getCommentsUrl(el);
            if (!commentsUrl || !commentsUrl.includes('/comments/')) return;
            const id = getPostId(commentsUrl);
            if (processed.has(id)) return;
            processed.add(id);

            let surfaceText = '';
            try { surfaceText = el.outerHTML || ''; } catch {}
            const surfaceUuids = extractUUIDs(surfaceText);
            const commentsText = await fetchCommentsText(commentsUrl);
            const all = [...new Set([...surfaceUuids, ...extractUUIDs(commentsText)])];
            if (!all.length) return;

            const thumbs = Reddit_Thumbs(all);
            if (thumbs && el.isConnected) {
                thumbs.dataset.for = id;
                insertThumbsNearPost(el, thumbs);
            }
        }

        function pump() {
            while (active < CONCURRENCY && queue.length) {
                const el = queue.shift();
                if (!el?.isConnected) continue;
                active++;
                processOne(el).finally(() => {
                    active--;
                    if (queue.length) setTimeout(pump, 200);
                    else if (active === 0) setTimeout(scanAndEnqueue, DELAY_BETWEEN_BATCHES);
                });
            }
        }

        function scanAndEnqueue() {
            if (!isListing()) return;
            const posts = getPostElements();
            let added = 0;
            for (const el of posts) {
                if (added >= BATCH_SIZE) break;
                const url = getCommentsUrl(el);
                if (!url) continue;
                const id = getPostId(url);
                if (processed.has(id)) continue;
                if (el.parentElement?.querySelector(`.grok-batch-thumbs[data-for="${id}"]`)) continue;
                queue.push(el);
                added++;
            }
            if (queue.length) pump();
        }

        function Reddit_Finder() {
            if (running) return;
            running = true;

            scanAndEnqueue();

            const obs = new MutationObserver(() => {
                clearTimeout(window.__grokBatchTimer);
                window.__grokBatchTimer = setTimeout(scanAndEnqueue, 800);
            });
            obs.observe(document.body, { childList: true, subtree: true });

            let scrollT = null;
            window.addEventListener('scroll', () => {
                clearTimeout(scrollT);
                scrollT = setTimeout(scanAndEnqueue, 600);
            }, { passive: true });

            let last = location.href;
            setInterval(() => {
                if (location.href !== last) {
                    last = location.href;
                    processed.clear();
                    queue = [];
                    active = 0;
                    hideLupaPanel();
                    lupaFixedPos = null;
                    setTimeout(scanAndEnqueue, 600);
                    setTimeout(scanAndEnqueue, 2000);
                }
            }, 700);

            setTimeout(scanAndEnqueue, 1500);
            setTimeout(scanAndEnqueue, 4000);
            setTimeout(scanAndEnqueue, 8000);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', Reddit_Finder);
        } else {
            Reddit_Finder();
        }

        console.log('%c[Detective Ani] Reddit module active', 'color:#ff4500;font-weight:bold');
    }

    // =====================================================================
    // 10. TWITTER / X MODULE (Detective)
    // =====================================================================
    if (isX) {
        const processed = new WeakSet();
        let scanning = false;
        let scheduleTimer = null;

        function extractMediaObjects(article) {
            const results = [];
            const seen = new Set();

            function add(uuid, isVideo, source, conf) {
                if (!uuid) return;
                const u = String(uuid).toLowerCase();
                if (!UUID_STRICT.test(u) || seen.has(u)) return;
                seen.add(u);
                results.push({ uuid: u, isVideo: !!isVideo, source, conf });
            }

            const startEls = [article];
            article.querySelectorAll(
                '[data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"], ' +
                'img[src*="pbs.twimg.com"], img[src*="twimg.com/media"], video'
            ).forEach(el => startEls.push(el));

            for (const el of startEls) {
                let key;
                try {
                    key = Object.keys(el).find(k =>
                        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
                    );
                } catch { continue; }
                if (!key) continue;

                let fiber = el[key];
                let depth = 0;
                while (fiber && depth < 45) {
                    try {
                        if (fiber.memoizedProps) {
                            const str = JSON.stringify(fiber.memoizedProps);

                            const rePost = /"grok_post_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;
                            let m;
                            while ((m = rePost.exec(str))) {
                                const chunk = str.slice(Math.max(0, m.index - 400), Math.min(str.length, m.index + 600));
                                const type = (chunk.match(/"type"\s*:\s*"([^"]+)"/) || [])[1] || '';
                                const mediaKey = (chunk.match(/"media_key"\s*:\s*"([^"]+)"/) || [])[1] || '';
                                const expanded = (chunk.match(/"expanded_url"\s*:\s*"([^"]+)"/) || [])[1] || '';
                                const isVideo = type === 'video' ||
                                                mediaKey.startsWith('13_') ||
                                                expanded.includes('/video/') ||
                                                chunk.includes('amplify_video') ||
                                                chunk.includes('"video_info"');
                                add(m[1], isVideo, 'fiber-grok_post_id', 'high');
                            }

                            const reAny = /"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;
                            let m2;
                            while ((m2 = reAny.exec(str))) {
                                const around = str.slice(Math.max(0, m2.index - 80), Math.min(str.length, m2.index + 80)).toLowerCase();
                                // Stronger Grok context — avoid random UUIDs near media_key/expanded_url
                                if (around.includes('grok_post_id') ||
                                    around.includes('grok.com/imagine') ||
                                    (around.includes('grok') && around.includes('media_key')) ||
                                    (around.includes('imagine') && (around.includes('media_key') || around.includes('expanded_url')))) {
                                    const isVid = around.includes('video') || around.includes('13_');
                                    add(m2[1], isVid, 'fiber-context', 'med');
                                }
                            }
                        }
                    } catch {}
                    fiber = fiber.return;
                    depth++;
                }
            }

            const DIY_RE = /faça\s*voc[eê]\s*mesmo|make\s*your\s*own|try\s*it\s*yourself|try\s*grok|remix|criar\s*o\s*seu|hazlo\s*t[uú]\s*mismo|create\s*your\s*own/i;

            article.querySelectorAll('a[href], button, [role="link"], [role="button"]').forEach(el => {
                try {
                    const href = (el.getAttribute('href') || el.href || '').toString();
                    const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();

                    if (/grok\.com\/imagine/i.test(href)) {
                        const m = href.match(UUID_RE);
                        if (m) add(m[0], false, 'direct-link', 'high');
                    }

                    if (DIY_RE.test(text)) {
                        if (href) {
                            const m = href.match(UUID_RE);
                            if (m) add(m[0], false, 'diy-href', 'med');
                        }
                        for (const attr of el.attributes || []) {
                            const m = String(attr.value).match(UUID_RE);
                            if (m) add(m[0], false, 'diy-attr', 'med');
                        }
                    }
                } catch {}
            });

            article.querySelectorAll('img[src*="pbs.twimg.com"], img[src*="twimg.com/media"], video').forEach(media => {
                const urls = [];
                if (media.src) urls.push(media.src);
                if (media.currentSrc) urls.push(media.currentSrc);
                if (media.srcset) {
                    media.srcset.split(',').forEach(p => {
                        const u = p.trim().split(/\s+/)[0];
                        if (u) urls.push(u);
                    });
                }
                if (media.tagName === 'VIDEO') {
                    media.querySelectorAll('source').forEach(s => s.src && urls.push(s.src));
                }
                for (const u of urls) {
                    try {
                        const filename = decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
                        const generated = filename.match(/_generated_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                        if (generated) {
                            add(generated[1], media.tagName === 'VIDEO', 'filename-generated', 'med');
                            continue;
                        }
                        if (/grok/i.test(filename)) {
                            const m = filename.match(UUID_RE);
                            if (m) add(m[0], media.tagName === 'VIDEO', 'filename', 'low');
                        }
                    } catch {}
                }
            });

            return results;
        }

        function findActionBar(article) {
            const groups = article.querySelectorAll('[role="group"]');
            for (const g of groups) {
                if (g.querySelector('[data-testid="reply"], [data-testid="retweet"], [data-testid="like"], a[href*="/analytics"]')) {
                    return g;
                }
            }
            return null;
        }

        function findMediaBlock(article) {
            const mediaEls = [
                ...article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"]')
            ];
            if (!mediaEls.length) {
                const img = article.querySelector('img[src*="pbs.twimg.com/media"], img[src*="twimg.com/media"], video');
                if (img) mediaEls.push(img);
            }
            if (!mediaEls.length) return null;

            let block = mediaEls[0];
            for (let i = 0; i < 8 && block && block !== article; i++) {
                const parent = block.parentElement;
                if (!parent || parent === article) break;
                if (mediaEls.every(m => parent.contains(m))) block = parent;
                else break;
            }
            return block;
        }

        function addThumbsBelowMedia(article, items) {
            const existing = article.querySelector('.grok-thumbs-below, .grok-batch-thumbs');
            if (existing) {
                if (existing.querySelectorAll('.grok-batch-thumb, .grok-thumb-item').length >= items.length) return;
                existing.remove();
            }

            const wrap = document.createElement('div');
            wrap.className = 'grok-thumbs-below grok-batch-thumbs' + (iconsVisible ? '' : ' hidden');

            for (const it of items) {
                wrap.appendChild(createThumbItem(it.uuid, {
                    thumb: it.thumb,
                    missingThumb: it.missingThumb,
                    isVideo: it.isVideo,
                    conf: it.conf
                }));
            }

            const actionBar = findActionBar(article);
            if (actionBar?.parentNode) {
                actionBar.parentNode.insertBefore(wrap, actionBar);
                return;
            }
            const mediaBlock = findMediaBlock(article);
            if (mediaBlock?.parentNode) {
                mediaBlock.parentNode.insertBefore(wrap, mediaBlock.nextSibling);
                return;
            }
            article.appendChild(wrap);
        }

        async function processTweet(article) {
            if (processed.has(article) && article.querySelector('.grok-thumbs-below, .grok-batch-thumbs')) return;

            const hasMedia = article.querySelector(
                '[data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"], img[src*="pbs.twimg.com/media"]'
            );
            const hasHint = /faça\s*voc|make\s*your\s*own|try\s*it\s*yourself|try\s*grok|remix|grok\.com\/imagine|create\s*your\s*own/i.test(
                article.textContent || ''
            );
            if (!hasMedia && !hasHint) return;

            const objs = extractMediaObjects(article);
            if (!objs.length) return;

            processed.add(article);

            const checks = await Promise.all(objs.map(async o => {
                try {
                    const result = await checkImage(o.uuid);
                    if (result && result.ok) {
                        return {
                            uuid: o.uuid,
                            isVideo: o.isVideo,
                            thumb: result.thumb || null,
                            missingThumb: !!result.missingThumb,
                            conf: o.conf
                        };
                    }
                    // Only high-confidence (grok_post_id / direct link) + real asset → "No preview"
                    if (o.conf === 'high') {
                        const real = await isRealAsset(o.uuid);
                        if (real) {
                            return {
                                uuid: o.uuid,
                                isVideo: o.isVideo,
                                thumb: null,
                                missingThumb: true,
                                conf: o.conf
                            };
                        }
                    }
                    return null;
                } catch {
                    return null;
                }
            }));

            const seen = new Set();
            const valid = [];
            for (const item of checks) {
                if (!item?.uuid) continue;
                const u = item.uuid.toLowerCase();
                if (seen.has(u)) continue;
                seen.add(u);
                valid.push(item);
            }

            if (valid.length) addThumbsBelowMedia(article, valid);
        }

        function scanX() {
            if (scanning) return;
            scanning = true;
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const vh = window.innerHeight;
            const tasks = [];
            for (const article of articles) {
                if (processed.has(article) && article.querySelector('.grok-thumbs-below, .grok-batch-thumbs')) continue;
                const rect = article.getBoundingClientRect();
                if (rect.bottom < -vh * 0.5 || rect.top > vh * 1.8) continue;
                tasks.push(processTweet(article));
            }
            Promise.allSettled(tasks).finally(() => { scanning = false; });
        }

        function schedule() {
            if (scheduleTimer) return;
            scheduleTimer = setTimeout(() => {
                scheduleTimer = null;
                if (window.requestIdleCallback) {
                    requestIdleCallback(() => scanX(), { timeout: 400 });
                } else {
                    scanX();
                }
            }, 180);
        }

        new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type !== 'childList') continue;
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.matches?.('article[data-testid="tweet"]') || n.querySelector?.('article[data-testid="tweet"]')) {
                        schedule();
                        return;
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });

        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule, { passive: true });

        setTimeout(scanX, 400);
        setTimeout(scanX, 1200);
        setInterval(() => {
            if (thumbCache.size > 150) {
                const keys = [...thumbCache.keys()].slice(0, 50);
                keys.forEach(k => {
                    const v = thumbCache.get(k);
                    if (v && v.thumb) URL.revokeObjectURL(v.thumb);
                    thumbCache.delete(k);
                });
            }
            scanX();
        }, 4000);

        console.log('%c[Detective Ani] X/Twitter module active', 'color:#1da1f2;font-weight:bold');
    }

    // =====================================================================
    // 11. EXTERNAL — Lupa media icons (aligned with working standalone Lupa.js)
    //     EXIF / filename / buffer only. Excludes Grok / X / Redgifs.
    //     Reddit allowed (Detective handles listings; Lupa still helps on media).
    // =====================================================================
    if (!isGrok && !isX && !isRedgifs) {
        const checkedUrls = new Set();
        const mediaState = new WeakMap();

        function isRedgifsUrl(url) {
            return url && /redgifs\.com/i.test(String(url));
        }
        function isInsideRedgifs(el) {
            let n = el;
            while (n) {
                if (n.tagName === 'IFRAME') {
                    const src = n.src || n.getAttribute('src') || '';
                    if (isRedgifsUrl(src)) return true;
                }
                if (n.tagName === 'SHREDDIT-EMBED' || n.classList?.contains('redgifs')) return true;
                n = n.parentElement;
            }
            return false;
        }

        function extractUuidFromExif(buffer) {
            try {
                const view = new DataView(buffer);
                if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;
                let offset = 2;
                while (offset < view.byteLength - 4) {
                    if (view.getUint8(offset) !== 0xFF) break;
                    const marker = view.getUint8(offset + 1);
                    if (marker === 0xDA) break;
                    const size = view.getUint16(offset + 2);
                    if (marker === 0xE1 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
                        const tiff = offset + 10;
                        const little = view.getUint16(tiff) === 0x4949;
                        const r16 = o => view.getUint16(o, little);
                        const r32 = o => view.getUint32(o, little);
                        const ifd0 = tiff + r32(tiff + 4);
                        if (ifd0 >= view.byteLength) return null;
                        const entries = r16(ifd0);
                        for (let i = 0; i < entries; i++) {
                            const entry = ifd0 + 2 + i * 12;
                            if (entry + 12 > view.byteLength) break;
                            if (r16(entry) === 0x013B) {
                                const count = r32(entry + 4);
                                let vo = entry + 8;
                                if (count > 4) vo = tiff + r32(entry + 8);
                                if (vo + count > view.byteLength) return null;
                                let str = '';
                                for (let j = 0; j < count; j++) {
                                    const c = view.getUint8(vo + j);
                                    if (c === 0) break;
                                    str += String.fromCharCode(c);
                                }
                                const m = str.match(UUID_RE);
                                if (m) return m[0].toLowerCase();
                            }
                        }
                    }
                    offset += 2 + size;
                }
            } catch {}
            return null;
        }

        function extractUuidFromFilename(url, isVideo = false) {
            if (!url) return null;
            let filename = '', fn = null;
            try {
                const u = new URL(url);
                filename = decodeURIComponent(u.pathname.split('/').pop() || '');
                fn = u.searchParams.get('fn');
                if (fn) {
                    fn = decodeURIComponent(fn);
                    filename += ' ' + fn;
                }
            } catch {
                filename = url;
            }

            const gen = filename.match(/_generated_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (gen) return gen[1].toLowerCase();

            if (isVideo) {
                if (fn) {
                    const m = fn.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[a-z0-9]+)?$/i);
                    if (m) return m[1].toLowerCase();
                }
                const m2 = filename.match(/(?:^|[\s\/])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[a-z0-9]+)?(?:$|[\s?&#])/i);
                if (m2) return m2[1].toLowerCase();
            }
            if (/grok/i.test(filename)) {
                const m = filename.match(UUID_RE);
                if (m) return m[0].toLowerCase();
            }
            return null;
        }

        function findUUIDInBuffer(buf) {
            try {
                const text = new TextDecoder('latin1').decode(buf);
                const idx = text.indexOf(MARKER);
                if (idx === -1) return null;
                const after = text.slice(idx + MARKER.length, idx + MARKER.length + 60);
                const m = after.match(UUID_RE);
                return m ? m[0].toLowerCase() : null;
            } catch {
                return null;
            }
        }

        function ensureRelative(el) {
            if (!el) return null;
            try {
                if (getComputedStyle(el).position === 'static') {
                    if (el.parentElement) {
                        const w = document.createElement('span');
                        w.style.cssText = 'position:relative;display:inline-block;max-width:100%;line-height:0;';
                        el.parentElement.insertBefore(w, el);
                        w.appendChild(el);
                        return w;
                    }
                    el.style.position = 'relative';
                }
            } catch {}
            return el;
        }

        function addIconOnMedia(media, uuid, isVideo) {
            if (!uuid || !media) return;
            const u = String(uuid).toLowerCase();
            if (media.dataset.grokExtUuid === u) return;
            media.dataset.grokExtUuid = u;
            try {
                media.parentElement?.querySelectorAll('.grok-ext-icon, .titlex-ani').forEach(e => e.remove());
            } catch {}

            const container = ensureRelative(media.parentElement) || media.parentElement;
            if (!container) return;

            const icon = document.createElement('span');
            icon.className = 'grok-ext-icon titlex-ani' + (iconsVisible ? '' : ' hidden');
            icon.textContent = '🔍';
            icon.title = `Click for details\n${u}\nF4 to show/hide`;
            icon.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                showLupaDetailPanel(icon, u, { isVideo: !!isVideo });
            });
            container.appendChild(icon);
        }

        async function handleFoundUuid(media, uuid, isVideo) {
            if (!uuid || !media || !UUID_STRICT.test(uuid)) return;
            const u = uuid.toLowerCase();
            // Validate like standalone Lupa (thumb must resolve), then place icon
            try {
                const result = await checkImage(u);
                if (!result || !result.ok) return;
                addIconOnMedia(media, u, isVideo);
            } catch {}
        }

        function checkUrl(url, media) {
            if (!url || isRedgifsUrl(url) || (media && isInsideRedgifs(media))) return;
            const clean = String(url).split(/["'\s<>]/)[0];
            if (!clean || isRedgifsUrl(clean)) return;

            const isImg = media?.tagName === 'IMG' || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(clean);
            const isVid = media?.tagName === 'VIDEO' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(clean);
            if (!isImg && !isVid) return;

            const fromName = extractUuidFromFilename(clean, isVid);
            if (fromName && media) handleFoundUuid(media, fromName, isVid);

            if (checkedUrls.has(clean)) return;
            checkedUrls.add(clean);

            GM_xmlhttpRequest({
                method: 'GET',
                url: clean,
                headers: { Range: `bytes=0-${BYTES_TO_FETCH - 1}` },
                responseType: 'arraybuffer',
                timeout: 10000,
                onload(res) {
                    if (res.status !== 200 && res.status !== 206) return;
                    let uuid = null;
                    if (isVid) uuid = findUUIDInBuffer(res.response);
                    else if (isImg) uuid = extractUuidFromExif(res.response);
                    if (uuid && media) handleFoundUuid(media, uuid, isVid);
                }
            });
        }

        function processMedia(media) {
            if (!media) return;
            if (media.dataset.grokExtUuid) return;
            if (isScriptGeneratedEl(media)) return;
            if (isInsideRedgifs(media) || isRedgifsUrl(media.src) || isRedgifsUrl(media.currentSrc)) return;

            const state = mediaState.get(media) || { tries: 0, lastSrc: '' };
            const src = media.currentSrc || media.src || media.getAttribute('src') || '';
            if (src && src !== state.lastSrc) {
                state.tries = 0;
                state.lastSrc = src;
            }
            state.tries++;
            mediaState.set(media, state);
            if (state.tries > 10) return;

            const urls = new Set();
            if (media.src) urls.add(media.src);
            if (media.currentSrc) urls.add(media.currentSrc);
            if (media.tagName === 'VIDEO') {
                media.querySelectorAll('source').forEach(s => { if (s.src) urls.add(s.src); });
            }
            ['data-src', 'data-original', 'data-lazy-src', 'data-url'].forEach(a => {
                const v = media.getAttribute(a);
                if (v) urls.add(v);
            });
            if (media.tagName === 'IMG' && media.srcset) {
                media.srcset.split(',').forEach(p => {
                    const u = p.trim().split(/\s+/)[0];
                    if (u) urls.add(u);
                });
            }
            urls.forEach(u => checkUrl(u, media));
        }

        function scanLupa() {
            try {
                document.querySelectorAll('video, img').forEach(processMedia);
            } catch {}
            try {
                document.querySelectorAll('iframe').forEach(iframe => {
                    try {
                        const src = (iframe.src || iframe.getAttribute('src') || '').toLowerCase();
                        if (src.includes('redgifs.com')) return;
                        if (iframe.closest('shreddit-embed') || iframe.closest('[class*="redgifs"]')) return;
                        const doc = iframe.contentDocument;
                        if (doc) doc.querySelectorAll('video, img').forEach(processMedia);
                    } catch {}
                });
            } catch {}
        }

        new MutationObserver(muts => {
            let need = false;
            for (const m of muts) {
                if (m.type === 'childList') {
                    for (const n of m.addedNodes) {
                        if (n.nodeType !== 1) continue;
                        if (isScriptGeneratedEl(n)) continue;
                        if (n.tagName === 'IFRAME' && isRedgifsUrl(n.src || n.getAttribute('src'))) continue;
                        if (n.querySelector?.('iframe[src*="redgifs"]')) continue;
                        need = true;
                        break;
                    }
                } else if (m.type === 'attributes' && (m.target.tagName === 'VIDEO' || m.target.tagName === 'IMG')) {
                    if (!isInsideRedgifs(m.target) && !isRedgifsUrl(m.target.src) && !isScriptGeneratedEl(m.target)) {
                        processMedia(m.target);
                    }
                }
                if (need) break;
            }
            if (need) scanLupa();
        }).observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'srcset', 'data-src', 'data-original']
        });

        ['loadstart', 'loadedmetadata', 'load', 'canplay'].forEach(evt => {
            document.addEventListener(evt, e => {
                if ((e.target.tagName === 'VIDEO' || e.target.tagName === 'IMG') &&
                    !isInsideRedgifs(e.target) && !isRedgifsUrl(e.target.src || e.target.currentSrc) &&
                    !isScriptGeneratedEl(e.target)) {
                    processMedia(e.target);
                }
            }, true);
        });

        scanLupa();
        [600, 1500, 3000, 6000, 10000].forEach(t => setTimeout(scanLupa, t));
        let ticks = 0;
        const keep = setInterval(() => {
            scanLupa();
            if (++ticks > 5) clearInterval(keep);
        }, 5000);

        console.log('%c[Detective Ani] Lupa EXIF/filename/buffer active (standalone-aligned)', 'color:#00ff88;font-weight:bold');
    }

    // =====================================================================
    // 12. EXTERNAL — Thonk FAB UUID detector (page-wide text/link scan)
    //     Does NOT scan script-generated links/UI
    //     Allowed: non-Grok, non-X, non-Redgifs; on Reddit only comment pages
    // =====================================================================
    function isAllowedThonkExternalPage() {
        if (isGrok || isX || isRedgifs) return false;
        if (isReddit) return /^\/r\/[^/]+\/comments\//i.test(location.pathname);
        return true;
    }

    if (isAllowedThonkExternalPage() || isReddit) {
        // Always define Thonk external mode logic; it self-gates via isAllowedThonkExternalPage()

        const found = new Map();
        const thonkThumbCache = thumbCache; // share
        const thonkMetaCache = metaCache;
        const queue = [];
        const inFlight = new Set();
        let active = 0;
        let scanTimer = null;
        let lastScanTextLen = 0;
        const currentPageKey = { value: '' };

        function decodeEntities(s) {
            return String(s || '')
                .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/');
        }

        function expandEncodings(text) {
            const parts = [decodeEntities(text)];
            try { parts.push(decodeURIComponent(parts[0].replace(/\+/g, ' '))); } catch {}
            try { parts.push(decodeURIComponent(parts[parts.length - 1])); } catch {}
            return parts.join('\n');
        }

        // Pass 1: UUIDs tied to Grok (URLs + grok…UUID filenames/labels)
        function extractGrokUUIDs(text) {
            const decoded = expandEncodings(text);
            const uuids = new Set();
            const patterns = [
                /(?:https?:\/\/)?(?:www\.)?grok\.com\/imagine\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /(?:https?:\/\/)?(?:www\.)?grok\.com\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /(?:https?:\/\/)?(?:www\.)?assets\.grok\.com\/[^\s"'<>]*?(?:post|imagine)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /out\.reddit\.com\/[^\s"'<>]*?grok\.com\/(?:imagine\/)?post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /grok[-_.\s]?(?:video|image|img|post|media|gen|generated)?[-_.\s]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /(?:^|[\s\/\\"'<>(])grok[^\s"'<>]{0,48}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
            ];
            patterns.forEach(re => {
                let m; re.lastIndex = 0;
                while ((m = re.exec(decoded)) !== null) if (m[1]) uuids.add(m[1].toLowerCase());
            });
            return [...uuids];
        }

        // Pass 2: bare UUIDs in surface text (filenames, tokens) — after grok pass
        // Only full strict UUIDs; validation (checkImage + isRealAsset) filters noise.
        function extractBareUUIDs(text) {
            const decoded = expandEncodings(text);
            const uuids = new Set();
            let m;
            UUID_GLOBAL.lastIndex = 0;
            while ((m = UUID_GLOBAL.exec(decoded)) !== null) {
                const u = m[0].toLowerCase();
                if (UUID_STRICT.test(u)) uuids.add(u);
            }
            return [...uuids];
        }

        async function showExternalDetail(anchorEl, uuid, opts = {}) {
            await showLupaDetailPanel(anchorEl, uuid, {
                thumb: opts.thumb || null,
                kind: opts.kind || '',
                ext: opts.ext || ''
            });
        }

        function makeThumbEl(uuid, result) {
            const item = document.createElement('div');
            item.className = 'grok-strip-thumb' + ((!result.thumb || result.missingThumb) ? ' missing' : '');
            item.title = uuid;
            if (result.thumb) {
                const img = document.createElement('img');
                img.src = result.thumb; img.alt = ''; img.loading = 'lazy';
                item.appendChild(img);
            } else {
                item.textContent = result.pending ? '…' : 'No\npreview';
            }
            item.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                showExternalDetail(item, uuid, { thumb: result.thumb || null, kind: result.kind || '' });
            });
            return item;
        }

        function rebuildExternalStrip() {
            const strip = document.getElementById('grok-uuid-strip');
            if (!strip) return;
            strip.innerHTML = '';
            const images = [], videos = [];
            for (const [uuid, result] of found) {
                if ((result.kind || '').toLowerCase() === 'video') videos.push([uuid, result]);
                else images.push([uuid, result]);
            }
            if (videos.length) {
                const sec = document.createElement('div');
                sec.className = 'grok-strip-section';
                const h = document.createElement('div');
                h.className = 'grok-strip-header';
                h.textContent = `Videos (${videos.length})`;
                sec.appendChild(h);
                const row = document.createElement('div');
                row.className = 'grok-strip-row';
                for (const [uuid, result] of videos) row.appendChild(makeThumbEl(uuid, result));
                sec.appendChild(row);
                strip.appendChild(sec);
            }
            if (images.length) {
                const sec = document.createElement('div');
                sec.className = 'grok-strip-section';
                const h = document.createElement('div');
                h.className = 'grok-strip-header';
                h.textContent = `Images (${images.length})`;
                sec.appendChild(h);
                const row = document.createElement('div');
                row.className = 'grok-strip-row';
                for (const [uuid, result] of images) row.appendChild(makeThumbEl(uuid, result));
                sec.appendChild(row);
                strip.appendChild(sec);
            }
            requestAnimationFrame(() => positionStripNearFab());
        }

        function toggleExternalStrip() {
            panelOpen = !panelOpen;
            const strip = document.getElementById('grok-uuid-strip');
            if (!strip) return;
            if (panelOpen) {
                rebuildExternalStrip();
                strip.classList.add('open');
                requestAnimationFrame(() => positionStripNearFab());
            } else {
                strip.classList.remove('open');
                hideLupaPanel();
                lupaFixedPos = null;
            }
        }

        // Only wire FAB click for Thonk external when not already on Grok (Grok returns early)
        if (!isGrok) {
            onFabClick = toggleExternalStrip;
        }

        function updateExternalBadge() {
            if (!isAllowedThonkExternalPage()) {
                setFabVisible(false, 0);
                return;
            }
            setFabVisible(true, found.size);
        }

        window.addEventListener('grok-uuid-f4', updateExternalBadge);

        // INSTANT: register UUID right away (from visible Grok URL), show FAB.
        // Thumb validation runs in background; invalid assets are dropped.
        function acceptUUID(uuid) {
            const u = uuid.toLowerCase();
            if (found.has(u) || inFlight.has(u)) return;

            if (thonkThumbCache.has(u)) {
                const cached = thonkThumbCache.get(u);
                if (cached && cached.ok) {
                    found.set(u, cached);
                    updateExternalBadge();
                    if (panelOpen) rebuildExternalStrip();
                }
                return;
            }

            // Show immediately with pending placeholder
            found.set(u, { ok: true, thumb: null, missingThumb: true, pending: true, kind: 'Image' });
            updateExternalBadge();
            if (panelOpen) rebuildExternalStrip();

            inFlight.add(u);
            queue.push(u);
            pump();
        }

        // Debounce strip rebuild so parallel thumb arrivals don't thrash the DOM
        let stripRaf = 0;
        function scheduleStripUpdate() {
            updateExternalBadge();
            if (!panelOpen) return;
            if (stripRaf) return;
            stripRaf = requestAnimationFrame(() => {
                stripRaf = 0;
                rebuildExternalStrip();
            });
        }

        function enrichMeta(uuid) {
            fetchGrokAssetMeta(uuid).then(asset => {
                if (!asset || !found.has(uuid)) return;
                const meta = extractMetaFromAsset(asset);
                if (meta.kind) {
                    const cur = found.get(uuid);
                    cur.kind = meta.kind;
                    found.set(uuid, cur);
                    scheduleStripUpdate();
                }
            }).catch(() => {});
        }

        // Fire all queued checks in parallel (up to THONK_CONCURRENCY at once, no inter-batch delay)
        // Same 2-step validation as X/Reddit: checkImage (thumb) → if fail, isRealAsset
        function pump() {
            while (active < THONK_CONCURRENCY && queue.length) {
                const uuid = queue.shift();
                active++;
                checkImage(uuid).then(async result => {
                    inFlight.delete(uuid);
                    // 1st pass: thumb resolved (or missingThumb already confirmed via isRealAsset inside checkImage)
                    if (result && result.ok) {
                        found.set(uuid, result);
                        scheduleStripUpdate();
                        enrichMeta(uuid);
                        return;
                    }
                    // 2nd pass (parity with X high-conf / Reddit): explicit isRealAsset when thumb failed
                    try {
                        const real = await isRealAsset(uuid);
                        if (real) {
                            const entry = { ok: true, thumb: null, missingThumb: true, pending: false, kind: 'Image' };
                            found.set(uuid, entry);
                            thonkThumbCache.set(uuid, entry);
                            scheduleStripUpdate();
                            enrichMeta(uuid);
                            return;
                        }
                    } catch {}
                    // Both failed — drop
                    found.delete(uuid);
                    thonkThumbCache.set(uuid, null);
                    scheduleStripUpdate();
                }).catch(async () => {
                    inFlight.delete(uuid);
                    // Network error on thumb — still try isRealAsset
                    try {
                        const real = await isRealAsset(uuid);
                        if (real) {
                            const entry = { ok: true, thumb: null, missingThumb: true, pending: false, kind: 'Image' };
                            found.set(uuid, entry);
                            thonkThumbCache.set(uuid, entry);
                            scheduleStripUpdate();
                            enrichMeta(uuid);
                            return;
                        }
                    } catch {}
                    found.delete(uuid);
                    thonkThumbCache.set(uuid, null);
                    scheduleStripUpdate();
                }).finally(() => {
                    active--;
                    if (queue.length) pump();
                });
            }
        }

        /**
         * Surface text collection — light, no body.innerText dump.
         * requireGrok=true  → only nodes that mention "grok" (pass 1)
         * requireGrok=false → same containers, any text (pass 2 bare UUIDs)
         */
        function collectAllText(requireGrok = true) {
            const parts = [];
            const hasGrok = /grok/i;
            try {
                document.querySelectorAll('a[href]').forEach(a => {
                    if (isScriptGeneratedEl(a)) return;
                    try {
                        const h = (a.href || '').toString();
                        if (!requireGrok || hasGrok.test(h)) parts.push(h);
                        const t = (a.textContent || '').trim();
                        if (t && (!requireGrok || hasGrok.test(t))) parts.push(t);
                    } catch {}
                });
            } catch {}
            try {
                const sel = [
                    'p', 'pre', 'code', 'blockquote', 'li', 'td', 'th', 'span',
                    '[data-testid*="comment"]', '[data-testid*="post"]',
                    '.comment', '.md', '.usertext', '.RichTextJSON-root',
                    'article', '[role="article"]', '[title]'
                ].join(',');
                document.querySelectorAll(sel).forEach(el => {
                    if (isScriptGeneratedEl(el)) return;
                    try {
                        const title = el.getAttribute?.('title') || '';
                        if (title && title.length <= 500 && (!requireGrok || hasGrok.test(title))) {
                            parts.push(title);
                        }
                    } catch {}
                    let t = '';
                    try { t = el.innerText || el.textContent || ''; } catch { return; }
                    if (t.length < 8 || t.length > 4000) return;
                    if (requireGrok && !hasGrok.test(t)) return;
                    // Bare pass: only keep chunks that look like they might hold a UUID
                    if (!requireGrok && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)) return;
                    parts.push(t);
                });
            } catch {}
            return parts.join('\n');
        }

        function pageKey() {
            return location.origin + location.pathname + location.search;
        }

        function resetForNewPage() {
            found.clear();
            queue.length = 0;
            inFlight.clear();
            active = 0;
            lastScanTextLen = 0;
            panelOpen = false;
            lupaFixedPos = null;
            lastLupaUuid = null;
            const strip = document.getElementById('grok-uuid-strip');
            if (strip) strip.classList.remove('open');
            hideLupaPanel();
            updateExternalBadge();
        }

        function scanThonk() {
            if (!isAllowedThonkExternalPage()) {
                removeUI();
                found.clear();
                return;
            }
            const key = pageKey();
            if (key !== currentPageKey.value) {
                currentPageKey.value = key;
                resetForNewPage();
            }
            ensureUI();

            // Pass 1 — Grok context first (links + grok…UUID text) — instant priority
            const grokText = collectAllText(true);
            lastScanTextLen = grokText.length;
            for (const u of extractGrokUUIDs(grokText)) acceptUUID(u);

            // Pass 2 — bare UUIDs on surface (after grok). Still validated via checkImage + isRealAsset.
            const bareText = collectAllText(false);
            for (const u of extractBareUUIDs(bareText)) acceptUUID(u);

            updateExternalBadge();
        }

        function scheduleScan() {
            clearTimeout(scanTimer);
            scanTimer = setTimeout(scanThonk, 400);
        }

        function onNavigate() {
            lastScanTextLen = 0;
            // Immediate scan on navigate — no multi-second delays
            scanThonk();
            setTimeout(scanThonk, 800);
        }

        function bootThonk() {
            currentPageKey.value = pageKey();
            // Instant first scan
            if (isAllowedThonkExternalPage()) scanThonk();

            const obs = new MutationObserver(muts => {
                let relevant = false;
                for (const m of muts) {
                    if (m.type !== 'childList') continue;
                    for (const n of m.addedNodes) {
                        if (n.nodeType === 1 && !isScriptGeneratedEl(n)) {
                            // Fast path: if added node is/has an anchor with grok.com, scan now
                            try {
                                if (n.matches?.('a[href]') && /grok\.com/i.test(n.href || '')) {
                                    relevant = true;
                                    break;
                                }
                                if (n.querySelector?.('a[href*="grok.com"]')) {
                                    relevant = true;
                                    break;
                                }
                            } catch {}
                            relevant = true;
                            break;
                        }
                    }
                    if (relevant) break;
                }
                if (relevant) scheduleScan();
            });
            obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
            window.addEventListener('popstate', onNavigate);
            window.addEventListener('hashchange', onNavigate);

            const wrap = (fn) => function (...args) {
                const ret = fn.apply(this, args);
                onNavigate();
                return ret;
            };
            try {
                history.pushState = wrap(history.pushState.bind(history));
                history.replaceState = wrap(history.replaceState.bind(history));
            } catch {}

            let lastHref = location.href;
            setInterval(() => {
                if (location.href !== lastHref) {
                    lastHref = location.href;
                    onNavigate();
                }
            }, 1500);

            // One light follow-up for late-loaded content
            setTimeout(scanThonk, 1200);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootThonk);
        } else {
            bootThonk();
        }

        console.log('%c[Detective Ani] Thonk FAB active (grok-first + bare UUID, instant)', 'color:#a855f7;font-weight:bold');
    }

    // =====================================================================
    // 13. BOOT MESSAGE
    // =====================================================================
    console.log(
        '%c[Detective Ani + Thonk + Lupa ✨] v3.9 – Grok parents | Reddit | X | Lupa EXIF | Thonk grok+bare UUID',
        'color:#00ff88;font-weight:bold;font-size:13px'
    );
})();