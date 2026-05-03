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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
