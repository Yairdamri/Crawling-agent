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

        function open(modalId, trigger) {
            var modal = root.querySelector('#' + cssEscape(modalId));
            if (!modal) return;
            close();
            modal.removeAttribute('hidden');
            modal.classList.add('is-open');
            document.body.classList.add('ainfp-no-scroll');
            openModal = modal;
            lastTrigger = trigger || null;
            var closeBtn = modal.querySelector('.ainfp-modal-close');
            if (closeBtn) closeBtn.focus();
        }

        function close() {
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

        cards.forEach(function (card) {
            var modalId = card.getAttribute('data-modal-id');
            if (!modalId) return;
            card.addEventListener('click', function (e) {
                if (e.target.closest('a, button')) return;
                open(modalId, card);
            });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    open(modalId, card);
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
