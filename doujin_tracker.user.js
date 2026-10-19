// ==UserScript==
// @name         Doujin Read Tracker (Doujin-TH + Miku-Doujin)
// @namespace    local.doujin.read.tracker
// @version      1.8.0
// @author       Community-maintained
// @homepageURL  https://github.com/sniertough/doujin-tracker
// @supportURL   https://github.com/sniertough/doujin-tracker/issues
// @updateURL    https://raw.githubusercontent.com/sniertough/doujin-tracker/main/doujin_tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/sniertough/doujin-tracker/main/doujin_tracker.user.js
// @license      MIT
// @description  Track READ and LAST on Doujin-TH/Miku, scan up to 5 pages at a time, and use a compact touch-friendly mobile panel.
// @match        https://doujin-th.com/*
// @match        https://www.doujin-th.com/*
// @match        https://miku-doujin.com/*
// @match        https://www.miku-doujin.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const STORE_READ = 'drt_read_v1';
    const STORE_LAST = 'drt_last_v1';
    const STORE_FOCUS = 'drt_focus_v1';
    const STORE_COLLAPSED = 'drt_collapsed_v1';
    const STORE_SEARCH = 'drt_search_v1';
    const STORE_LAST_META = 'drt_last_meta_v1';
    const STORE_NAV_CONTEXT = 'drt_nav_context_v1';
    const MAX_SCAN_PAGES = 200;
    const BATCH_SIZE = 5;
    const BATCH_PAUSE_MS = 400; // small pause between 5-page batches to reduce site load

    const host = location.hostname.replace(/^www\./, '');
    const site = host === 'doujin-th.com' ? 'doujin' : host === 'miku-doujin.com' ? 'miku' : null;
    if (!site) return;

    // Always read tracker state fresh from Tampermonkey storage.
    // Mobile Back/Forward Cache can restore an old page without rerunning this script.
    function getReadMap() {
        return GM_getValue(STORE_READ, {}) || {};
    }

    function getLastMap() {
        return GM_getValue(STORE_LAST, {}) || {};
    }

    function getLastMetaMap() {
        return GM_getValue(STORE_LAST_META, {}) || {};
    }

    function getLastMeta() {
        const metaMap = getLastMetaMap();
        const meta = metaMap[site] || null;
        const last = getLast();
        return meta && meta.key === last ? meta : null;
    }

    function saveLastMeta(meta) {
        if (!meta || !meta.key) return;
        const metaMap = getLastMetaMap();
        metaMap[site] = { ...meta, site, updatedAt: Date.now() };
        GM_setValue(STORE_LAST_META, metaMap);
    }

    function clearLastMetaForSite() {
        const metaMap = getLastMetaMap();
        delete metaMap[site];
        GM_setValue(STORE_LAST_META, metaMap);
    }

    function keyFromUrl(rawUrl, baseUrl = location.href) {
        let url;
        try {
            url = new URL(rawUrl, baseUrl);
        } catch (_) {
            return null;
        }

        if (url.hostname.replace(/^www\./, '') !== host) return null;

        if (site === 'doujin') {
            const match = url.href.match(/[?&]topic=(\d+)/i);
            return match ? `d:${match[1]}` : null;
        }

        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length !== 1) return null;

        const slug = parts[0].toLowerCase();
        const reserved = new Set([
            'genre', 'page', 'search', 'favorite', 'favorites', 'favourite', 'favourites',
            'contact', 'login', 'logout', 'register', 'privacy', 'about', 'author', 'artist',
            'character', 'language', 'category', 'tag', 'tags', 'random', 'feed'
        ]);
        if (reserved.has(slug)) return null;

        return `m:${parts[0]}`;
    }

    function currentStoryKey() {
        return keyFromUrl(location.href);
    }

    function isRead(key) {
        if (!key) return false;
        const readMap = getReadMap();
        return Boolean(readMap[key]);
    }

    function markRead(key) {
        if (!key) return;
        const readMap = getReadMap();
        if (readMap[key]) return;
        readMap[key] = Date.now();
        GM_setValue(STORE_READ, readMap);
    }

    function setLast(key) {
        if (!key) return;

        const lastMap = getLastMap();
        lastMap[site] = key;
        GM_setValue(STORE_LAST, lastMap);
        markRead(key);

        let pageInfo = null;
        const current = currentStoryKey();
        if (current === key) {
            const nav = GM_getValue(STORE_NAV_CONTEXT, null);
            if (nav && nav.site === site && nav.key === key && Date.now() - Number(nav.at || 0) < 24 * 60 * 60 * 1000) {
                pageInfo = nav.pageInfo || null;
            }
        } else {
            pageInfo = getCurrentPageInfo();
        }

        if (pageInfo && Number(pageInfo.page) >= 1) {
            saveLastMeta({ key, ...pageInfo, savedAt: Date.now() });
        } else {
            const oldMeta = getLastMetaMap()[site];
            if (!oldMeta || oldMeta.key !== key) clearLastMetaForSite();
        }

        decorateLinks(true);
        toast(pageInfo?.page ? `ตั้งเป็น LAST แล้ว · จำหน้า ${pageInfo.page}` : 'ตั้งเป็น LAST แล้ว');
    }

    function getLast() {
        const lastMap = getLastMap();
        return lastMap[site] || null;
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .drt-badge {
                display: inline-block !important;
                margin-left: 6px !important;
                padding: 2px 6px !important;
                border-radius: 999px !important;
                font: 700 11px/1.4 system-ui, sans-serif !important;
                vertical-align: middle !important;
                text-decoration: none !important;
                white-space: nowrap !important;
            }
            .drt-read-badge { background: #2e7d32 !important; color: #fff !important; }
            .drt-last-badge { background: #ef6c00 !important; color: #fff !important; }
            .drt-pin {
                display: inline-block !important;
                margin-left: 4px !important;
                padding: 2px 6px !important;
                border: 1px solid rgba(127,127,127,.45) !important;
                border-radius: 999px !important;
                background: rgba(127,127,127,.12) !important;
                color: inherit !important;
                font: 700 11px/1.4 system-ui, sans-serif !important;
                cursor: pointer !important;
                vertical-align: middle !important;
                min-width: 36px !important;
                min-height: 36px !important;
                touch-action: manipulation !important;
            }
            .drt-read-link { opacity: .55 !important; }
            .drt-focus {
                outline: 4px solid #ff9800 !important;
                outline-offset: 4px !important;
                border-radius: 4px !important;
            }
            #drt-panel {
                position: fixed !important;
                z-index: 2147483647 !important;
                right: max(10px, env(safe-area-inset-right, 0px)) !important;
                bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;
                display: flex !important;
                flex-wrap: wrap !important;
                gap: 6px !important;
                max-width: min(calc(100vw - 20px), 430px) !important;
                max-height: min(65vh, 420px) !important;
                box-sizing: border-box !important;
                overflow-y: auto !important;
                overscroll-behavior: contain !important;
                padding: 8px !important;
                border-radius: 14px !important;
                background: rgba(20,20,20,.92) !important;
                box-shadow: 0 4px 18px rgba(0,0,0,.35) !important;
                font-family: system-ui, sans-serif !important;
            }
            #drt-panel button {
                border: 0 !important;
                border-radius: 10px !important;
                padding: 8px 10px !important;
                background: #fff !important;
                color: #111 !important;
                font: 700 12px/1.2 system-ui, sans-serif !important;
                cursor: pointer !important;
                min-width: 44px !important;
                min-height: 44px !important;
                touch-action: manipulation !important;
                user-select: none !important;
            }
            #drt-panel.drt-collapsed {
                padding: 5px !important;
                border-radius: 999px !important;
                max-width: none !important;
                max-height: none !important;
                overflow: visible !important;
            }

            #drt-panel.drt-collapsed > button:not(.drt-toggle) {
                display: none !important;
            }

            #drt-panel .drt-toggle {
                min-width: 44px !important;
                min-height: 44px !important;
                padding: 7px !important;
                border-radius: 999px !important;
                font-size: 16px !important;
            }

            #drt-toast {
                position: fixed !important;
                z-index: 2147483647 !important;
                left: 50% !important;
                bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;
                transform: translateX(-50%) !important;
                padding: 9px 13px !important;
                border-radius: 10px !important;
                background: rgba(0,0,0,.88) !important;
                color: #fff !important;
                font: 600 13px/1.3 system-ui, sans-serif !important;
                pointer-events: none !important;
            }
            [data-drt-hidden="1"] { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    function toast(message) {
        document.getElementById('drt-toast')?.remove();
        const el = document.createElement('div');
        el.id = 'drt-toast';
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1800);
    }

    function candidateAnchors(root = document, baseUrl = location.href) {
        return [...root.querySelectorAll('a[href]')].filter(a => {
            if (!keyFromUrl(a.getAttribute('href'), baseUrl)) return false;
            const text = (a.textContent || '').trim();
            return text.length > 1 || Boolean(a.querySelector('img'));
        });
    }

    function smallestItemContainer(anchor) {
        if (site === 'doujin') {
            return anchor.closest('tr') || anchor.closest('li') || anchor.parentElement || anchor;
        }

        let node = anchor;
        let best = anchor.parentElement || anchor;
        for (let i = 0; i < 5; i++) {
            node = node.parentElement;
            if (!node || /^(BODY|HTML|MAIN)$/i.test(node.tagName)) break;

            const count = [...node.querySelectorAll('a[href]')]
                .filter(a => keyFromUrl(a.href)).length;

            if (count === 1) best = node;
            if (count > 1) break;
        }
        return best;
    }

    function clearDecorations() {
        document.querySelectorAll('.drt-badge,.drt-pin').forEach(el => el.remove());
        document.querySelectorAll('.drt-read-link').forEach(el => el.classList.remove('drt-read-link'));
        document.querySelectorAll('[data-drt-hidden]').forEach(el => el.removeAttribute('data-drt-hidden'));
    }

    let hideRead = false;

    function decorateLinks(force = false) {
        if (force) clearDecorations();
        const last = getLast();

        for (const a of candidateAnchors()) {
            if (a.dataset.drtDone === '1' && !force) continue;
            a.dataset.drtDone = '1';

            const key = keyFromUrl(a.href);
            if (!key) continue;

            if (isRead(key)) {
                a.classList.add('drt-read-link');
                const badge = document.createElement('span');
                badge.className = 'drt-badge drt-read-badge';
                badge.textContent = '✓ READ';
                a.insertAdjacentElement('afterend', badge);
            }

            if (key === last) {
                const badge = document.createElement('span');
                badge.className = 'drt-badge drt-last-badge';
                badge.textContent = '📍 LAST';
                a.insertAdjacentElement('afterend', badge);
            } else {
                const pin = document.createElement('button');
                pin.type = 'button';
                pin.className = 'drt-pin';
                pin.textContent = '📍';
                pin.title = 'ตั้งเรื่องนี้เป็น LAST';
                pin.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    setLast(key);
                });
                a.insertAdjacentElement('afterend', pin);
            }

            if (hideRead && isRead(key) && key !== last) {
                smallestItemContainer(a).dataset.drtHidden = '1';
            }
        }
    }

    function toggleHideRead(button) {
        hideRead = !hideRead;
        clearDecorations();
        document.querySelectorAll('a[data-drt-done]').forEach(a => delete a.dataset.drtDone);
        decorateLinks();
        button.textContent = hideRead ? '👁 แสดง READ' : '🙈 ซ่อน READ';
    }

    function olderUrlFromDoc(doc, baseUrl) {
        const links = [...doc.querySelectorAll('a[href]')];
        const older = links.find(a => /older|เก่ากว่า|ก่อนหน้า/i.test((a.textContent || '').trim()));
        if (older) {
            try { return new URL(older.getAttribute('href'), baseUrl).href; } catch (_) {}
        }

        const relNext = doc.querySelector('a[rel="next"][href]');
        if (relNext) {
            try { return new URL(relNext.getAttribute('href'), baseUrl).href; } catch (_) {}
        }
        return null;
    }

    function defaultListUrl() {
        return site === 'doujin'
            ? 'https://doujin-th.com/forum/index.php/board,1.0.html'
            : 'https://miku-doujin.com/';
    }

    function findOlderControl() {
        const controls = [...document.querySelectorAll('button, a[href], input[type="button"], input[type="submit"]')];
        return controls.find(el => {
            const label = (el.textContent || el.value || '').trim();
            return /older|เก่ากว่า|หน้าถัดไป|ถัดไป/i.test(label);
        }) || null;
    }

    function findPageSelect(root = document) {
        const selects = [...root.querySelectorAll('select')];
        return selects.find(select => {
            const pages = [...select.options]
                .map(option => Number(((option.textContent || '').match(/\d+/) || [])[0]))
                .filter(Number.isFinite);
            return pages.length >= 3 && pages.includes(1);
        }) || null;
    }

    function optionPageNumber(option) {
        if (!option) return null;
        const match = (option.textContent || '').match(/\d+/);
        const page = match ? Number(match[0]) : NaN;
        return Number.isFinite(page) && page >= 1 ? page : null;
    }

    function inferDoujinPageSize(root = document, baseUrl = location.href) {
        const counts = new Map();
        for (const a of root.querySelectorAll('a[href]')) {
            const label = Number((a.textContent || '').trim());
            if (!Number.isInteger(label) || label < 2) continue;

            let href;
            try { href = new URL(a.getAttribute('href'), baseUrl).href; } catch (_) { continue; }
            const match = href.match(/board(?:,|%2C)1\.(\d+)\.html/i);
            if (!match) continue;

            const offset = Number(match[1]);
            const size = offset / (label - 1);
            if (!Number.isInteger(size) || size < 1 || size > 200) continue;
            counts.set(size, (counts.get(size) || 0) + 1);
        }

        let best = null;
        let bestCount = 0;
        for (const [size, count] of counts) {
            if (count > bestCount) {
                best = size;
                bestCount = count;
            }
        }
        return best;
    }

    function doujinPageInfoFrom(root = document, url = location.href) {
        const match = String(url).match(/board(?:,|%2C)1\.(\d+)\.html/i);
        if (!match) return null;

        const offset = Number(match[1]);
        const pageSize = inferDoujinPageSize(root, url);
        const page = pageSize ? Math.floor(offset / pageSize) + 1 : null;

        return {
            page,
            pageUrl: String(url),
            pageSize: pageSize || null
        };
    }

    function mikuPageInfoFrom(root = document, url = location.href) {
        const select = findPageSelect(root);
        if (!select) return null;

        const selected = select.selectedOptions?.[0] || select.options?.[select.selectedIndex] || null;
        const page = optionPageNumber(selected);
        if (!page) return null;

        return {
            page,
            pageUrl: String(url),
            selectValue: selected?.value ?? null
        };
    }

    function getCurrentPageInfo() {
        return site === 'doujin'
            ? doujinPageInfoFrom(document, location.href)
            : mikuPageInfoFrom(document, location.href);
    }

    function currentPageLabel() {
        const info = getCurrentPageInfo();
        return info?.page ? String(info.page) : null;
    }

    function updateLastPageHint(pageInfo) {
        const last = getLast();
        if (!last || !pageInfo || !Number(pageInfo.page)) return;

        const old = getLastMeta();
        if (old && Number(old.page) === Number(pageInfo.page) &&
            String(old.pageUrl || '') === String(pageInfo.pageUrl || '') &&
            String(old.selectValue ?? '') === String(pageInfo.selectValue ?? '')) {
            return;
        }

        saveLastMeta({ key: last, ...pageInfo, foundAt: Date.now() });
    }

    function rememberListContextForStory(key) {
        if (!key) return;
        const pageInfo = getCurrentPageInfo();
        if (!pageInfo || !Number(pageInfo.page)) return;
        GM_setValue(STORE_NAV_CONTEXT, {
            site,
            key,
            pageInfo,
            at: Date.now()
        });
    }

    function learnLastPageIfVisible() {
        const last = getLast();
        if (!last) return;

        const target = candidateAnchors().find(a => keyFromUrl(a.href) === last);
        if (!target) return;

        const pageInfo = getCurrentPageInfo();
        if (pageInfo?.page) updateLastPageHint(pageInfo);
    }

    function clearSearchState() {
        GM_setValue(STORE_SEARCH, null);
    }

    function clearMikuJumpHint() {
        document.getElementById('drt-miku-jump-hint')?.remove();
        const select = findPageSelect(document);
        if (select) {
            select.style.removeProperty('outline');
            select.style.removeProperty('outline-offset');
            select.style.removeProperty('box-shadow');
        }
    }

    function showMikuManualJump(targetPage) {
        const select = findPageSelect(document);
        if (!select || !targetPage) return false;

        clearMikuJumpHint();

        select.style.setProperty('outline', '4px solid #ff9800', 'important');
        select.style.setProperty('outline-offset', '4px', 'important');
        select.style.setProperty('box-shadow', '0 0 0 5px rgba(255,152,0,.25)', 'important');

        try {
            select.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_) {}

        const hint = document.createElement('button');
        hint.id = 'drt-miku-jump-hint';
        hint.type = 'button';
        hint.textContent = `⚡ เลือกหน้า ${targetPage}`;
        hint.title = `Miku ไม่ยอมให้สคริปต์เปลี่ยนหน้าอัตโนมัติ ให้เลือกหน้า ${targetPage} จากช่องเลขหน้าครั้งเดียว`;
        hint.style.cssText = [
            'position:fixed',
            'z-index:2147483647',
            'left:50%',
            'bottom:90px',
            'transform:translateX(-50%)',
            'padding:12px 16px',
            'border:0',
            'border-radius:999px',
            'background:#ff9800',
            'color:#111',
            'font:700 14px/1.2 system-ui,sans-serif',
            'box-shadow:0 4px 18px rgba(0,0,0,.35)'
        ].join(' !important;') + ' !important;';

        hint.addEventListener('click', () => {
            try {
                select.focus({ preventScroll: true });
                if (typeof select.showPicker === 'function') {
                    select.showPicker();
                }
            } catch (_) {
                try { select.focus(); } catch (_) {}
            }
            toast(`เลือกหน้า ${targetPage} จากช่องเลขหน้า แล้วระบบจะหาต่อเอง`);
        });

        document.body.appendChild(hint);
        toast(`ข้ามการไล่หน้า 1 → ${targetPage}: เลือกหน้า ${targetPage} ครั้งเดียว`);
        return true;
    }

    function navigateFromSelectForm(select, option) {
        const form = select.form || select.closest('form');
        if (!form) return false;

        select.selectedIndex = option.index;
        const method = String(form.method || 'get').toLowerCase();

        if (method === 'get') {
            try {
                const action = new URL(form.action || location.href, location.href);
                const fd = new FormData(form);
                if (select.name) fd.set(select.name, option.value);
                action.search = new URLSearchParams(fd).toString();
                if (action.href !== location.href) {
                    location.href = action.href;
                    return true;
                }
            } catch (_) {}
        }

        try {
            if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
            } else {
                HTMLFormElement.prototype.submit.call(form);
            }
            return true;
        } catch (_) {}

        return false;
    }

    function tryJumpMikuToSavedPage(state) {
        const targetPage = Number(state.targetPage || 0);
        if (targetPage < 2) return false;

        const select = findPageSelect(document);
        if (!select) return false;

        const options = [...select.options];
        let option = null;

        if (state.selectValue != null) {
            option = options.find(o => String(o.value) === String(state.selectValue)) || null;
        }
        if (!option) {
            option = options.find(o => optionPageNumber(o) === targetPage) || null;
        }
        if (!option) return false;

        const rawCandidates = [
            option.getAttribute('data-url'),
            option.getAttribute('data-href'),
            option.dataset?.url,
            option.dataset?.href,
            option.value
        ].filter(Boolean).map(v => String(v).trim());

        // If the option itself contains a route/URL, use it directly.
        for (const value of rawCandidates) {
            if (!value || /^\d+$/.test(value)) continue;
            try {
                const url = new URL(value, location.href);
                if (url.origin === location.origin && url.href !== location.href) {
                    location.href = url.href;
                    return true;
                }
            } catch (_) {}
        }

        // Some pagers are plain GET/POST forms. Submitting the form is more reliable
        // than fabricating an untrusted change event on mobile Firefox.
        if (navigateFromSelectForm(select, option)) {
            return true;
        }

        select.selectedIndex = option.index;
        select.value = option.value;

        // Execute the site's own handler in page context where possible.
        try {
            if (typeof select.onchange === 'function') {
                select.onchange.call(select, new Event('change', { bubbles: true }));
            }
        } catch (_) {}

        try { select.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch (_) {}
        try { select.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}

        return true;
    }

    function continueMikuFindLast() {
        if (site !== 'miku') return;

        const state = GM_getValue(STORE_SEARCH, null);
        if (!state || !state.active || state.site !== 'miku') return;

        const last = getLast();
        if (!last || state.key !== last) {
            clearSearchState();
            return;
        }

        const pageInfo = getCurrentPageInfo();
        const currentPage = Number(pageInfo?.page || 0);
        const targetPage = Number(state.targetPage || 0);

        if (targetPage > 1 && currentPage > 0 && currentPage < targetPage && !state.jumpAttempted) {
            GM_setValue(STORE_SEARCH, { ...state, jumpAttempted: true, updatedAt: Date.now() });
            const jumped = tryJumpMikuToSavedPage(state);
            if (jumped) {
                setTimeout(continueMikuFindLast, 1200);
                return;
            }
        }

        if (targetPage > 1 && currentPage > 0 && currentPage < targetPage) {
            // Do NOT crawl 1 -> targetPage. That defeats the whole point of storing the page hint.
            // If Miku rejected the synthetic jump, ask for one manual page selection instead.
            const freshState = GM_getValue(STORE_SEARCH, null) || state;
            if (!freshState.awaitingManualJump) {
                GM_setValue(STORE_SEARCH, {
                    ...freshState,
                    awaitingManualJump: true,
                    updatedAt: Date.now()
                });
                showMikuManualJump(targetPage);
            }
            const panelFind = [...document.querySelectorAll('#drt-panel button')]
                .find(b => /หา LAST|กำลังหา|ไปหน้า|เลือกหน้า/i.test(b.textContent || ''));
            if (panelFind) panelFind.textContent = `⚡ เลือกหน้า ${targetPage}`;
            return;
        }

        const target = candidateAnchors().find(a => keyFromUrl(a.href) === last);
        if (target) {
            clearSearchState();
            if (pageInfo?.page) updateLastPageHint(pageInfo);
            const container = smallestItemContainer(target);
            container.classList.add('drt-focus');
            setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
            setTimeout(() => container.classList.remove('drt-focus'), 6000);
            toast(`เจอ LAST แล้ว${pageInfo?.page ? ` (หน้า ${pageInfo.page})` : ''}`);
            return;
        }

        const scanned = Number(state.scanned || 0) + 1;
        if (scanned >= MAX_SCAN_PAGES) {
            clearSearchState();
            toast(`หา LAST ไม่เจอ หลังไล่จริง ${scanned} หน้า`);
            return;
        }

        const older = findOlderControl();
        if (!older || older.disabled || older.getAttribute('aria-disabled') === 'true') {
            clearSearchState();
            toast(`สุดหน้าที่เว็บมีแล้ว (ไล่จริง ${scanned} หน้า) แต่ไม่เจอ LAST`);
            return;
        }

        GM_setValue(STORE_SEARCH, { ...state, scanned, updatedAt: Date.now() });
        const panelFind = [...document.querySelectorAll('#drt-panel button')]
            .find(b => /หา LAST|กำลังหา|ไปหน้า/i.test(b.textContent || ''));
        if (panelFind) panelFind.textContent = `🔎 หา... ${scanned}`;
        setTimeout(() => older.click(), 350);
    }



    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function pageNumbersFromSelect(select) {
        if (!select) return [];
        return [...select.options]
            .map(optionPageNumber)
            .filter(page => Number.isInteger(page) && page >= 1);
    }

    function sameOriginUrl(value, baseUrl) {
        if (!value) return null;
        const raw = String(value).trim();
        if (!raw || /^\d+$/.test(raw)) return null;
        try {
            const url = new URL(raw, baseUrl);
            return url.origin === location.origin ? url.href : null;
        } catch (_) {
            return null;
        }
    }

    function serializeFormParams(form, targetSelect, targetOption) {
        const params = new URLSearchParams();
        const controls = [...form.querySelectorAll('input[name], select[name], textarea[name]')];

        for (const el of controls) {
            if (el.disabled || !el.name) continue;
            const type = String(el.type || '').toLowerCase();
            if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
            if (type === 'submit' || type === 'button' || type === 'file' || type === 'reset') continue;

            if (el === targetSelect) {
                params.set(el.name, targetOption.value);
                continue;
            }

            if (el.tagName === 'SELECT' && el.multiple) {
                for (const option of el.selectedOptions) params.append(el.name, option.value);
            } else {
                params.append(el.name, el.value ?? '');
            }
        }

        if (targetSelect.name && !params.has(targetSelect.name)) {
            params.set(targetSelect.name, targetOption.value);
        }
        return params;
    }

    function mikuRequestForPage(root, baseUrl, page) {
        const select = findPageSelect(root);
        if (!select) return null;
        const option = [...select.options].find(o => optionPageNumber(o) === Number(page));
        if (!option) return null;

        const rawCandidates = [
            option.getAttribute('data-url'),
            option.getAttribute('data-href'),
            option.dataset?.url,
            option.dataset?.href,
            option.value
        ];

        for (const raw of rawCandidates) {
            const directUrl = sameOriginUrl(raw, baseUrl);
            if (directUrl) {
                return {
                    page: Number(page),
                    method: 'GET',
                    url: directUrl,
                    body: null,
                    selectValue: option.value
                };
            }
        }

        const form = select.form || select.closest('form');
        if (form && select.name) {
            try {
                const method = String(form.method || 'get').toUpperCase();
                const action = new URL(form.action || baseUrl, baseUrl);
                if (action.origin !== location.origin) return null;
                const params = serializeFormParams(form, select, option);

                if (method === 'GET') {
                    for (const [key, value] of params) action.searchParams.set(key, value);
                    return {
                        page: Number(page),
                        method: 'GET',
                        url: action.href,
                        body: null,
                        selectValue: option.value
                    };
                }

                if (method === 'POST') {
                    return {
                        page: Number(page),
                        method: 'POST',
                        url: action.href,
                        body: params,
                        selectValue: option.value
                    };
                }
            } catch (_) {}
        }

        // Handle simple inline onchange patterns such as:
        // location.href = '/page/' + this.value
        const onchange = select.getAttribute('onchange') || '';
        const match = onchange.match(/(?:window\.)?location(?:\.href)?\s*=\s*['\"]([^'\"]*)['\"]\s*\+\s*this\.value(?:\s*\+\s*['\"]([^'\"]*)['\"])?/i);
        if (match) {
            const directUrl = sameOriginUrl(`${match[1]}${option.value}${match[2] || ''}`, baseUrl);
            if (directUrl) {
                return {
                    page: Number(page),
                    method: 'GET',
                    url: directUrl,
                    body: null,
                    selectValue: option.value
                };
            }
        }

        return null;
    }

    async function fetchTextRequest(request) {
        if (!request) return null;
        const init = {
            method: request.method || 'GET',
            credentials: 'include',
            cache: 'no-store'
        };
        if (request.method === 'POST' && request.body) {
            init.headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
            init.body = request.body.toString();
        }
        const response = await fetch(request.url, init);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    }

    async function scanMikuPageByFetch(pagerDoc, pagerBaseUrl, page, rootHtml = null) {
        try {
            if (Number(page) === 1 && rootHtml != null) {
                const doc = new DOMParser().parseFromString(rootHtml, 'text/html');
                return { page: 1, doc, request: { page: 1, method: 'GET', url: pagerBaseUrl } };
            }
            const request = mikuRequestForPage(pagerDoc, pagerBaseUrl, page);
            if (!request) return null;
            const html = await fetchTextRequest(request);
            const doc = new DOMParser().parseFromString(html, 'text/html');
            // Some sites return page 1 for every fabricated URL; never count it as page N.
            const actual = mikuPageInfoFrom(doc, request.url);
            if (Number(page) > 1 && Number(actual?.page) !== Number(page)) return null;
            return { page: Number(page), doc, request };
        } catch (error) {
            console.warn('[Doujin Read Tracker] Miku batch fetch failed for page', page, error);
            return null;
        }
    }

    function iframeLoad(iframe, timeoutMs = 9000) {
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                iframe.removeEventListener('load', onload);
                fn(value);
            };
            const onload = () => finish(resolve, true);
            const timer = setTimeout(() => finish(reject, new Error('iframe timeout')), timeoutMs);
            iframe.addEventListener('load', onload, { once: true });
        });
    }

    async function scanMikuPageByIframe(page, lastKey) {
        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed!important;width:1px!important;height:1px!important;left:-10000px!important;top:-10000px!important;opacity:0!important;pointer-events:none!important;';
        try {
            const firstLoad = iframeLoad(iframe);
            iframe.src = defaultListUrl();
            document.body.appendChild(iframe);
            await firstLoad;

            const win = iframe.contentWindow;
            const doc = iframe.contentDocument;
            if (!win || !doc) return null;

            if (Number(page) !== 1) {
                const select = findPageSelect(doc);
                if (!select) return null;
                const option = [...select.options].find(o => optionPageNumber(o) === Number(page));
                if (!option) return null;

                const request = mikuRequestForPage(doc, win.location.href, page);
                if (request?.method === 'GET') {
                    const nextLoad = iframeLoad(iframe);
                    win.location.href = request.url;
                    await nextLoad;
                } else {
                    let navigated = false;
                    const form = select.form || select.closest('form');
                    if (form) {
                        select.selectedIndex = option.index;
                        try {
                            const nextLoad = iframeLoad(iframe);
                            if (typeof form.requestSubmit === 'function') form.requestSubmit();
                            else form.submit();
                            await nextLoad;
                            navigated = true;
                        } catch (_) {}
                    }

                    if (!navigated) {
                        select.selectedIndex = option.index;
                        select.value = option.value;
                        const before = win.location.href;
                        try { select.dispatchEvent(new win.Event('input', { bubbles: true })); } catch (_) {}
                        try { select.dispatchEvent(new win.Event('change', { bubbles: true })); } catch (_) {}
                        await sleep(1200);
                        if (win.location.href !== before) {
                            await sleep(350);
                        }
                    }
                }
            }

            const finalDoc = iframe.contentDocument;
            if (!finalDoc) return null;
            const actual = mikuPageInfoFrom(finalDoc, iframe.contentWindow?.location?.href || defaultListUrl());
            if (Number(page) > 1 && Number(actual?.page) !== Number(page)) return null;
            const found = candidateAnchors(finalDoc, iframe.contentWindow?.location?.href || defaultListUrl())
                .some(a => keyFromUrl(a.getAttribute('href'), iframe.contentWindow?.location?.href || defaultListUrl()) === lastKey);

            return {
                page: Number(page),
                found,
                url: iframe.contentWindow?.location?.href || null
            };
        } catch (error) {
            console.warn('[Doujin Read Tracker] Miku iframe scan failed for page', page, error);
            return null;
        } finally {
            iframe.remove();
        }
    }

    async function navigateToMikuFoundPage(found, pagerDoc, pagerBaseUrl) {
        GM_setValue(STORE_FOCUS, { site, key: getLast(), at: Date.now() });
        const request = found?.request || mikuRequestForPage(pagerDoc, pagerBaseUrl, found.page);

        if (request?.method === 'GET' && request.url) {
            location.href = request.url;
            return true;
        }

        const state = {
            targetPage: Number(found.page),
            selectValue: request?.selectValue ?? null
        };

        if (findPageSelect(document) && tryJumpMikuToSavedPage(state)) return true;

        GM_setValue(STORE_SEARCH, {
            active: true,
            site: 'miku',
            key: getLast(),
            scanned: 0,
            targetPage: Number(found.page),
            selectValue: request?.selectValue ?? null,
            jumpAttempted: false,
            awaitingManualJump: false,
            startedAt: Date.now(),
            updatedAt: Date.now()
        });
        location.href = defaultListUrl();
        return true;
    }

    async function findLastMikuBatch(button, last, meta) {
        const originalText = button.textContent;
        let rootHtml;
        let rootDoc;
        const rootUrl = defaultListUrl();

        try {
            button.textContent = '⚡ เตรียมกวาด 5 หน้า...';
            const response = await fetch(rootUrl, { credentials: 'include', cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            rootHtml = await response.text();
            rootDoc = new DOMParser().parseFromString(rootHtml, 'text/html');

            const pageSelect = findPageSelect(rootDoc);
            const availablePages = pageNumbersFromSelect(pageSelect);
            const maxPage = availablePages.length ? Math.max(...availablePages) : MAX_SCAN_PAGES;
            let startPage = Math.min(maxPage, Math.max(1, Number(meta?.page || 1)));
            let scanned = 0;
            let unreadable = 0;

            if (!availablePages.length) {
                throw new Error('Miku page selector was not found; batch scan would be unreliable');
            }

            for (let batchStart = startPage; batchStart <= maxPage && scanned < MAX_SCAN_PAGES; batchStart += BATCH_SIZE) {
                const pages = [];
                for (let i = 0; i < BATCH_SIZE; i++) {
                    const page = batchStart + i;
                    if (page <= maxPage && scanned + pages.length < MAX_SCAN_PAGES) pages.push(page);
                }
                if (!pages.length) break;

                button.textContent = `⚡ กวาด ${pages[0]}–${pages[pages.length - 1]}`;

                const fetched = await Promise.all(
                    pages.map(page => scanMikuPageByFetch(rootDoc, rootUrl, page, rootHtml))
                );

                // Mobile memory guard: check missing pages with at most two hidden iframes
                // at a time. Fetch-based scans still run five pages in parallel.
                const missingPages = pages.filter((_, i) => !fetched[i]);
                const fallback = new Map();
                for (let i = 0; i < missingPages.length; i += 2) {
                    const portion = missingPages.slice(i, i + 2);
                    const foundViaIframe = await Promise.all(
                        portion.map(page => scanMikuPageByIframe(page, last))
                    );
                    foundViaIframe.forEach((result, index) => fallback.set(portion[index], result));
                }
                scanned += pages.length;

                for (let i = 0; i < pages.length; i++) {
                    const result = fetched[i];
                    const iframeResult = fallback.get(pages[i]);

                    if (result?.doc) {
                        const base = result.request?.url || rootUrl;
                        const found = candidateAnchors(result.doc, base)
                            .some(a => keyFromUrl(a.getAttribute('href'), base) === last);
                        if (found) {
                            saveLastMeta({
                                key: last, page: result.page,
                                pageUrl: result.request?.method === 'GET' ? result.request.url : rootUrl,
                                selectValue: result.request?.selectValue ?? null,
                                foundAt: Date.now()
                            });
                            toast(`เจอ LAST หน้า ${result.page}`);
                            await navigateToMikuFoundPage(result, rootDoc, rootUrl);
                            return;
                        }
                    } else if (iframeResult?.found) {
                        saveLastMeta({
                            key: last, page: iframeResult.page,
                            pageUrl: iframeResult.url || rootUrl,
                            foundAt: Date.now()
                        });
                        toast(`เจอ LAST หน้า ${iframeResult.page}`);
                        await navigateToMikuFoundPage({ page: iframeResult.page }, rootDoc, rootUrl);
                        return;
                    } else if (!iframeResult) {
                        unreadable++;
                    }
                }

                await sleep(BATCH_PAUSE_MS);
            }

            toast(unreadable
                ? `ค้น ${scanned} หน้า แต่ตรวจไม่ได้ ${unreadable} หน้า (ลองใหม่)`
                : `หา LAST ไม่เจอ (กวาด ${scanned} หน้า)`);
        } catch (error) {
            console.error('[Doujin Read Tracker] Miku batch search failed', error);
            toast('Batch search ของ Miku ไม่สำเร็จ');
        } finally {
            button.textContent = originalText;
        }
    }

    function buildDoujinPageUrl(page, pageSize) {
        const offset = Math.max(0, (Number(page) - 1) * Number(pageSize));
        return `https://doujin-th.com/forum/index.php/board,1.${offset}.html`;
    }

    async function findLastDoujinBatch(button, last, meta) {
        const originalText = button.textContent;
        const rootUrl = defaultListUrl();
        let scanned = 0;

        try {
            button.textContent = '⚡ เตรียมกวาด 5 หน้า...';
            const rootResponse = await fetch(rootUrl, { credentials: 'include', cache: 'no-store' });
            if (!rootResponse.ok) throw new Error(`HTTP ${rootResponse.status}`);
            const rootHtml = await rootResponse.text();
            const rootDoc = new DOMParser().parseFromString(rootHtml, 'text/html');
            const pageSize = Number(meta?.pageSize || inferDoujinPageSize(rootDoc, rootUrl) || 24);
            const startPage = Math.max(1, Number(meta?.page || 1));

            for (let batchStart = startPage; scanned < MAX_SCAN_PAGES; batchStart += BATCH_SIZE) {
                const pages = Array.from({ length: BATCH_SIZE }, (_, i) => batchStart + i)
                    .filter((_, i) => scanned + i < MAX_SCAN_PAGES);
                button.textContent = `⚡ กวาด ${pages[0]}–${pages[pages.length - 1]}`;

                const results = await Promise.all(pages.map(async page => {
                    const url = buildDoujinPageUrl(page, pageSize);
                    try {
                        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
                        if (!response.ok) return null;
                        const html = await response.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        return { page, url, doc };
                    } catch (_) {
                        return null;
                    }
                }));

                scanned += pages.length;
                for (const result of results) {
                    if (!result?.doc) continue;
                    const found = candidateAnchors(result.doc, result.url)
                        .some(a => keyFromUrl(a.getAttribute('href'), result.url) === last);
                    if (found) {
                        saveLastMeta({ key: last, page: result.page, pageUrl: result.url, pageSize, foundAt: Date.now() });
                        GM_setValue(STORE_FOCUS, { site, key: last, at: Date.now() });
                        toast(`เจอ LAST หน้า ${result.page}`);
                        location.href = result.url;
                        return;
                    }
                }

                // Stop when a whole batch no longer returns real list pages.
                if (results.every(result => !result)) break;
                await sleep(BATCH_PAUSE_MS);
            }

            toast(`หา LAST ไม่เจอ (กวาด background ${scanned} หน้า)`);
        } catch (error) {
            console.error('[Doujin Read Tracker] Doujin batch search failed', error);
            toast('Batch search ของ Doujin-TH ไม่สำเร็จ');
        } finally {
            button.textContent = originalText;
        }
    }

    async function findLast(button) {
        const last = getLast();
        if (!last) {
            toast('ยังไม่ได้ตั้ง LAST');
            return;
        }

        const meta = getLastMeta();
        if (site === 'miku') {
            await findLastMikuBatch(button, last, meta);
            return;
        }

        await findLastDoujinBatch(button, last, meta);
    }

    function focusSavedLastIfNeeded() {
        const focus = GM_getValue(STORE_FOCUS, null);
        if (!focus || focus.site !== site || focus.key !== getLast()) return;
        if (Date.now() - focus.at > 120000) return;

        const target = candidateAnchors().find(a => keyFromUrl(a.href) === focus.key);
        if (!target) return;

        GM_setValue(STORE_FOCUS, null);
        const pageInfo = getCurrentPageInfo();
        if (pageInfo?.page) updateLastPageHint(pageInfo);
        const container = smallestItemContainer(target);
        container.classList.add('drt-focus');
        setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        setTimeout(() => container.classList.remove('drt-focus'), 6000);
    }

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'drt-panel';

        // First-time phone users see a small bubble; existing preferences win.
        const mobileDefault = window.matchMedia?.('(max-width: 700px)')?.matches || false;
        let collapsed = GM_getValue(STORE_COLLAPSED, mobileDefault);

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'drt-toggle';

        function updateCollapsed() {
            panel.classList.toggle('drt-collapsed', collapsed);

            toggleButton.textContent = collapsed
                ? '📚'
                : '−';

            toggleButton.title = collapsed
                ? 'เปิด Doujin Tracker'
                : 'ย่อ Doujin Tracker';
        }

        toggleButton.addEventListener('click', () => {
            collapsed = !collapsed;
            GM_setValue(STORE_COLLAPSED, collapsed);
            updateCollapsed();
        });

        panel.appendChild(toggleButton);

        const hideButton = document.createElement('button');

        hideButton.type = 'button';
        hideButton.textContent = '🙈 ซ่อน READ';

        hideButton.addEventListener(
            'click',
            () => toggleHideRead(hideButton)
        );

        panel.appendChild(hideButton);

        const findButton = document.createElement('button');

        findButton.type = 'button';
        findButton.textContent = '🔎 หา LAST';

        findButton.addEventListener('click', async () => {
            if (findButton.disabled) return;
            findButton.disabled = true;
            try {
                await findLast(findButton);
            } finally {
                findButton.disabled = false;
            }
        });

        panel.appendChild(findButton);

        const current = currentStoryKey();

        if (current) {
            const lastButton = document.createElement('button');

            lastButton.type = 'button';

            lastButton.textContent =
                current === getLast()
                    ? '📍 เรื่องนี้คือ LAST'
                    : '📍 ตั้งเรื่องนี้ LAST';

            lastButton.addEventListener(
                'click',
                () => {
                    setLast(current);

                    lastButton.textContent =
                        '📍 เรื่องนี้คือ LAST';
                }
            );

            panel.appendChild(lastButton);
        }

        document.body.appendChild(panel);
        updateCollapsed();
    }

    injectStyles();

    function rememberStoryTap(event) {
        const anchor = event.target?.closest?.('a[href]');
        if (!anchor) return;
        const key = keyFromUrl(anchor.getAttribute('href'));
        if (!key) return;
        // Capture list page metadata before SPA link handlers navigate (Android taps included).
        rememberListContextForStory(key);
        // Opening a link, not merely touching it, is treated as READ.
        if (event.type === 'click') markRead(key);
    }
    document.addEventListener('pointerup', rememberStoryTap, { capture: true, passive: true });
    document.addEventListener('click', rememberStoryTap, true);

    const current = currentStoryKey();
    if (current) markRead(current);

    decorateLinks();
    buildPanel();
    learnLastPageIfVisible();
    focusSavedLastIfNeeded();

    // When mobile restores a page from BFCache, refresh state/badges from Tampermonkey storage.
    window.addEventListener('pageshow', () => {
        clearDecorations();
        document.querySelectorAll('a[data-drt-done]').forEach(a => delete a.dataset.drtDone);
        decorateLinks();
        learnLastPageIfVisible();
        focusSavedLastIfNeeded();
    });

    // Continue an in-progress Miku LAST search after the site moves to an older page.
    setTimeout(continueMikuFindLast, 600);

    // Some pages render/update content after load. Re-scan lightly without changing saved data.
    const observer = new MutationObserver(() => {
        decorateLinks();
        learnLastPageIfVisible();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
