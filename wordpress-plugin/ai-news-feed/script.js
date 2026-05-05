(function () {
    'use strict';

    function init() {
        var pages = document.querySelectorAll('.ainfp-page');
        pages.forEach(setupPage);
    }

    function setupPage(page) {
        var grid = page.querySelector('.ainfp-grid');
        if (!grid) return;
        var cards = Array.prototype.slice.call(grid.querySelectorAll('.ainfp-grid-card'));
        var originalOrder = cards.slice();
        var pills = page.querySelectorAll('.ainfp-pill');
        var search = page.querySelector('.ainfp-search-input');
        var sortSelect = page.querySelector('.ainfp-sort-select');

        setupModals(page, cards);

        var state = { filter: '', search: '', sort: 'score' };

        pills.forEach(function (pill) {
            pill.addEventListener('click', function () {
                pills.forEach(function (p) { p.classList.remove('is-active'); });
                pill.classList.add('is-active');
                state.filter = pill.getAttribute('data-filter') || '';
                applyAll();
            });
        });

        if (search) {
            search.addEventListener('input', function () {
                state.search = search.value.trim().toLowerCase();
                applyAll();
            });
        }

        if (sortSelect) {
            sortSelect.addEventListener('change', function () {
                state.sort = sortSelect.value;
                applyAll();
            });
        }

        function applyAll() {
            cards.forEach(function (card) {
                var cat = card.getAttribute('data-category') || '';
                var blob = card.getAttribute('data-search') || '';
                var matchCat = state.filter === '' || cat === state.filter;
                var matchSearch = state.search === '' || blob.indexOf(state.search) !== -1;
                card.classList.toggle('is-hidden', !(matchCat && matchSearch));
            });

            var sorted;
            if (state.sort === 'score') {
                sorted = cards.slice().sort(function (a, b) {
                    var sa = parseInt(a.getAttribute('data-score') || '0', 10);
                    var sb = parseInt(b.getAttribute('data-score') || '0', 10);
                    if (sb !== sa) return sb - sa;
                    return cmpDate(b, a);
                });
            } else if (state.sort === 'date') {
                sorted = cards.slice().sort(function (a, b) { return cmpDate(b, a); });
            } else {
                sorted = originalOrder;
            }

            var frag = document.createDocumentFragment();
            sorted.forEach(function (card) { frag.appendChild(card); });
            grid.appendChild(frag);
        }

        function cmpDate(a, b) {
            var da = Date.parse(a.getAttribute('data-date') || '') || 0;
            var db = Date.parse(b.getAttribute('data-date') || '') || 0;
            return da - db;
        }
    }

    function setupModals(page, cards) {
        var root = page.parentNode || page;
        var openModal = null;
        var lastTrigger = null;
        var newsBaseUrl = page.getAttribute('data-news-base-url') || '';
        var newsBasePath = '';
        if (newsBaseUrl) {
            try { newsBasePath = new URL(newsBaseUrl, window.location.origin).pathname; }
            catch (e) { newsBasePath = newsBaseUrl; }
            if (newsBasePath && newsBasePath.charAt(newsBasePath.length - 1) !== '/') newsBasePath += '/';
        }
        // The original (pre-modal) URL we should restore to on close. Captured
        // once at init so it's stable even after pushState.
        var landingUrl = window.location.pathname + window.location.search + window.location.hash;

        function findModalByHash(hash) {
            if (!hash) return null;
            return root.querySelector('.ainfp-modal[data-content-hash="' + cssEscape(hash) + '"]');
        }

        function findCardBySlug(slug) {
            if (!slug) return null;
            return root.querySelector('.ainfp-grid-card[data-slug="' + cssEscape(slug) + '"]');
        }

        function findCardByHash(hash) {
            if (!hash) return null;
            return root.querySelector('.ainfp-grid-card[data-content-hash="' + cssEscape(hash) + '"]');
        }

        function slugFromCurrentPath() {
            if (!newsBasePath) return '';
            var p = window.location.pathname;
            if (p.indexOf(newsBasePath) !== 0) return '';
            var rest = p.slice(newsBasePath.length).replace(/\/+$/, '');
            // Only treat as a slug if it's a single segment.
            return rest.indexOf('/') === -1 ? rest : '';
        }

        function pushArticleUrl(slug) {
            if (!newsBaseUrl || !slug) return;
            var url = newsBaseUrl + slug + '/' + window.location.hash;
            window.history.pushState({ articleSlug: slug }, '', url);
        }

        // Restore the URL the visitor actually arrived on (strips slug or
        // legacy ?article= param). Used when closing a modal opened during
        // this visit but NOT from a deep-link landing.
        function restoreLandingUrl(replace) {
            if (replace) window.history.replaceState({}, '', landingUrl);
            else window.history.pushState({}, '', landingUrl);
        }

        function open(hash, trigger, opts) {
            opts = opts || {};
            var modal = findModalByHash(hash);
            if (!modal) return false;
            closeVisual();
            modal.removeAttribute('hidden');
            modal.classList.add('is-open');
            document.body.classList.add('ainfp-no-scroll');
            openModal = modal;
            lastTrigger = trigger || null;
            if (!opts.skipHistory) {
                var slug = modal.getAttribute('data-slug');
                if (slug) pushArticleUrl(slug);
            }
            var closeBtn = modal.querySelector('.ainfp-modal-close');
            if (closeBtn) closeBtn.focus();
            return true;
        }

        function closeVisual() {
            if (!openModal) return;
            openModal.setAttribute('hidden', '');
            openModal.classList.remove('is-open');
            document.body.classList.remove('ainfp-no-scroll');
            openModal = null;
            if (lastTrigger && typeof lastTrigger.focus === 'function') {
                lastTrigger.focus();
            }
            lastTrigger = null;
        }

        function close() {
            if (!openModal) return;
            // Walk back if we ourselves pushed history during this visit. If
            // the user landed on a deep link, history.back() would exit the
            // site — so we replaceState to the landing URL instead.
            var st = window.history.state;
            if (st && (st.articleSlug || st.article)) {
                window.history.back();
            } else {
                restoreLandingUrl(true);
                closeVisual();
            }
        }

        cards.forEach(function (card) {
            var hash = card.getAttribute('data-content-hash');
            if (!hash) return;
            card.addEventListener('click', function (e) {
                if (e.target.closest('a, button')) return;
                open(hash, card);
            });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    open(hash, card);
                }
            });
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && openModal) close();
        });

        var modals = root.querySelectorAll('.ainfp-modal');
        modals.forEach(function (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target.closest('[data-modal-close]')) {
                    e.preventDefault();
                    close();
                }
            });
        });

        // Sync modal state with URL on back/forward navigation.
        window.addEventListener('popstate', function () {
            var slug = slugFromCurrentPath();
            if (slug) {
                var card = findCardBySlug(slug);
                if (card) {
                    var hash = card.getAttribute('data-content-hash');
                    open(hash, card, { skipHistory: true });
                    return;
                }
            }
            // Legacy fallback: ?article=<hash> may still appear in history.
            var legacyHash = new URLSearchParams(window.location.search).get('article');
            if (legacyHash) {
                var card2 = findCardByHash(legacyHash);
                open(legacyHash, card2, { skipHistory: true });
            } else {
                closeVisual();
            }
        });

        // Direct landing — server passes the slug via data-initial-article-slug
        // (rendered from the rewrite's ainf_slug query var). Falls back to the
        // legacy ?article=<hash> param so links shared before this change still
        // resolve.
        var initialSlug = page.getAttribute('data-initial-article-slug') || '';
        if (initialSlug) {
            var card = findCardBySlug(initialSlug);
            if (card) {
                var hash = card.getAttribute('data-content-hash');
                open(hash, card, { skipHistory: true });
            }
            // If unknown/aged-out, leave the URL alone — server already
            // returned the page; only the modal silently fails to open.
        } else {
            var legacyInitialHash = new URLSearchParams(window.location.search).get('article');
            if (legacyInitialHash) {
                var legacyCard = findCardByHash(legacyInitialHash);
                var opened = open(legacyInitialHash, legacyCard, { skipHistory: true });
                if (!opened) {
                    // Aged-out — strip the dangling param.
                    var params = new URLSearchParams(window.location.search);
                    params.delete('article');
                    var qs = params.toString();
                    var url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
                    window.history.replaceState({}, '', url);
                }
            }
        }
    }

    function cssEscape(id) {
        if (window.CSS && CSS.escape) return CSS.escape(id);
        return String(id).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
