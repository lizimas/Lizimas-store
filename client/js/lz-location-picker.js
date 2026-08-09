/*
 * client/js/lz-location-picker.js
 * Lizimas Store — delivery location picker.
 *
 * Primary path: one search box. Typing 'ntinda' returns
 * "Ntinda — Nakawa Division, Kampala"; picking it fills every level at once.
 *
 * Fallback path: Region -> District -> Division -> Area cascade, hidden
 * behind a link for anyone who does not know their parish name.
 *
 * Hidden inputs the rest of checkout.js reads:
 *   #location-id      deepest selected id
 *   #district-select  district NAME (kept for backwards compatibility)
 *   #area-text        typed area, required when no parish was selected
 *
 * Usage:
 *   <div id="location-picker"></div>
 *   <script src="/js/lz-location-picker.js?v=1"></script>
 *   const picker = LzLocationPicker.init('#location-picker', {
 *     apiGet, onChange: calculateDeliveryFee
 *   });
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'lz-lp-styles';
    var CSS = [
        '.lz-lp{display:flex;flex-direction:column;gap:10px}',
        '.lz-lp__field{position:relative}',
        '.lz-lp__label{display:block;font-size:13px;color:#5a6a83;margin-bottom:4px}',
        '.lz-lp__label .req{color:#c0392b}',
        '.lz-lp__control{width:100%;box-sizing:border-box;min-height:46px;padding:10px 12px;',
        'border:1px solid #c9cfda;border-radius:8px;font:inherit;font-size:16px;background:#fff;color:#12233d}',
        '.lz-lp__control:focus{outline:0;border-color:#0b2545;box-shadow:0 0 0 3px rgba(11,37,69,.12)}',
        '.lz-lp__control:disabled{background:#f2f4f8;color:#9aa6b8}',
        '.lz-lp__menu{position:absolute;z-index:40;left:0;right:0;top:calc(100% + 4px);background:#fff;',
        'border:1px solid #c9cfda;border-radius:8px;box-shadow:0 10px 28px rgba(11,37,69,.16);',
        'max-height:260px;overflow-y:auto;display:none;-webkit-overflow-scrolling:touch}',
        '.lz-lp__menu.is-open{display:block}',
        '.lz-lp__opt{padding:11px 13px;cursor:pointer;font-size:15px;border-bottom:1px solid #f0f3f8}',
        '.lz-lp__opt:last-child{border-bottom:0}',
        '.lz-lp__opt:hover{background:#f2f6fc}',
        '.lz-lp__opt strong{font-weight:600}',
        '.lz-lp__opt small{display:block;color:#6b7a90;font-size:12px;margin-top:2px}',
        '.lz-lp__badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;',
        'background:#eef2f8;color:#5a6a83;font-size:11px;vertical-align:middle}',
        '.lz-lp__empty{padding:14px 13px;color:#6b7a90;font-size:14px}',
        '.lz-lp__chosen{display:flex;align-items:flex-start;gap:10px;padding:12px 13px;',
        'border:1px solid #b7c8a8;border-radius:8px;background:#f4f8f0}',
        '.lz-lp__chosen-body{flex:1 1 auto;min-width:0}',
        '.lz-lp__chosen-name{font-weight:600;color:#12233d;font-size:15px}',
        '.lz-lp__chosen-path{color:#5a6a83;font-size:13px;margin-top:2px}',
        '.lz-lp__link{background:0;border:0;padding:0;font:inherit;font-size:13px;color:#0b2545;',
        'text-decoration:underline;cursor:pointer}',
        '.lz-lp__toggle{align-self:flex-start;margin-top:2px}',
        '.lz-lp__cascade{display:none;flex-direction:column;gap:10px;padding-top:8px;',
        'border-top:1px dashed #d7dde7;margin-top:4px}',
        '.lz-lp__cascade.is-open{display:flex}',
        '.lz-lp__hint{font-size:12px;color:#6b7a90;margin:4px 0 14px}',
        '.lz-lp__hint.is-error{color:#c0392b}'
    ].join('');

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) { return; }
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function defaultApiGet(path) {
        return fetch('/api' + path).then(function (r) {
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            return r.json();
        });
    }

    function init(target, opts) {
        injectStyles();
        opts = opts || {};

        var host = typeof target === 'string' ? document.querySelector(target) : target;
        if (!host) { throw new Error('LzLocationPicker: target not found'); }

        var apiGet = opts.apiGet || defaultApiGet;
        var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

        var state = {
            region: null, district: null, division: null, area: null,
            areaText: '', districts: []
        };
        var searchSeq = 0;
        var searchTimer = null;

        host.innerHTML =
            '<div class="lz-lp">' +

              '<div class="lz-lp__field" data-role="search">' +
                '<label class="lz-lp__label" for="lz-lp-search">Delivery area <span class="req">*</span></label>' +
                '<input class="lz-lp__control" id="lz-lp-search" type="text" autocomplete="off" ' +
                  'placeholder="Type your area, e.g. Ntinda">' +
                '<div class="lz-lp__menu" data-menu="search"></div>' +
              '</div>' +

              '<div class="lz-lp__chosen" style="display:none">' +
                '<div class="lz-lp__chosen-body">' +
                  '<div class="lz-lp__chosen-name"></div>' +
                  '<div class="lz-lp__chosen-path"></div>' +
                '</div>' +
                '<button type="button" class="lz-lp__link" data-act="clear">Change</button>' +
              '</div>' +

              '<button type="button" class="lz-lp__link lz-lp__toggle">' +
                'Can\u2019t find it? Choose step by step</button>' +

              '<div class="lz-lp__cascade">' +
                '<div class="lz-lp__field">' +
                  '<label class="lz-lp__label" for="lz-lp-region">Region</label>' +
                  '<select class="lz-lp__control" id="lz-lp-region">' +
                    '<option value="">All regions</option></select>' +
                '</div>' +
                '<div class="lz-lp__field">' +
                  '<label class="lz-lp__label" for="lz-lp-district">District / City <span class="req">*</span></label>' +
                  '<input class="lz-lp__control" id="lz-lp-district" type="text" autocomplete="off" ' +
                    'placeholder="Type your district\u2026">' +
                  '<div class="lz-lp__menu" data-menu="district"></div>' +
                '</div>' +
                '<div class="lz-lp__field">' +
                  '<label class="lz-lp__label" for="lz-lp-division">Division / Sub-county <span class="req">*</span></label>' +
                  '<select class="lz-lp__control" id="lz-lp-division" disabled>' +
                    '<option value="">Select a district first</option></select>' +
                '</div>' +
                '<div class="lz-lp__field">' +
                  '<label class="lz-lp__label" for="lz-lp-area">Parish / Area</label>' +
                  '<select class="lz-lp__control" id="lz-lp-area" disabled>' +
                    '<option value="">Select a division first</option></select>' +
                '</div>' +
              '</div>' +

              '<div class="lz-lp__field" data-role="areatext" style="display:none">' +
                '<label class="lz-lp__label" for="lz-lp-area-text">Which area? <span class="req">*</span></label>' +
                '<input class="lz-lp__control" id="lz-lp-area-text" type="text" ' +
                  'placeholder="e.g. Naalya, near the shopping centre">' +
              '</div>' +

              '<p class="lz-lp__hint"></p>' +
            '</div>' +

            '<input type="hidden" id="location-id">' +
            '<input type="hidden" id="district-select">' +
            '<input type="hidden" id="area-text">';

        var searchEl      = host.querySelector('#lz-lp-search');
        var searchMenu    = host.querySelector('[data-menu="search"]');
        var searchField   = host.querySelector('[data-role="search"]');
        var chosenEl      = host.querySelector('.lz-lp__chosen');
        var chosenName    = host.querySelector('.lz-lp__chosen-name');
        var chosenPath    = host.querySelector('.lz-lp__chosen-path');
        var toggleBtn     = host.querySelector('.lz-lp__toggle');
        var cascadeEl     = host.querySelector('.lz-lp__cascade');
        var regionEl      = host.querySelector('#lz-lp-region');
        var districtEl    = host.querySelector('#lz-lp-district');
        var districtMenu  = host.querySelector('[data-menu="district"]');
        var divisionEl    = host.querySelector('#lz-lp-division');
        var areaEl        = host.querySelector('#lz-lp-area');
        var areaTextField = host.querySelector('[data-role="areatext"]');
        var areaTextEl    = host.querySelector('#lz-lp-area-text');
        var hintEl        = host.querySelector('.lz-lp__hint');

        var hidId   = host.querySelector('#location-id');
        var hidName = host.querySelector('#district-select');
        var hidArea = host.querySelector('#area-text');

        function anchor() {
            if (state.area)     { return { id: state.area.id, level: 5 }; }
            if (state.division) { return { id: state.division.id, level: 4 }; }
            if (state.district) { return { id: state.district.id, level: 2 }; }
            return null;
        }

        function value() {
            var a = anchor();
            return {
                locationId: a ? a.id : null,
                level: a ? a.level : null,
                region: state.region ? state.region.name : null,
                district: state.district ? state.district.name : null,
                division: state.division ? state.division.name : null,
                area: state.area ? state.area.name : null,
                areaText: state.areaText.trim()
            };
        }

        function isValid() {
            var a = anchor();
            if (!a) { return false; }
            return a.level >= 5 || !!state.areaText.trim();
        }

        function pathLine() {
            return [
                (state.division && state.area) ? state.division.name : null,
                state.district ? state.district.name : null,
                state.region ? state.region.name + ' Region' : null
            ].filter(Boolean).join(', ');
        }

        function paint() {
            var a = anchor();

            if (a) {
                chosenEl.style.display = 'flex';
                searchField.style.display = 'none';
                chosenName.textContent = state.area
                    ? state.area.name
                    : (state.division ? state.division.name : state.district.name);
                chosenPath.textContent = pathLine();
            } else {
                chosenEl.style.display = 'none';
                searchField.style.display = 'block';
            }

            var needsText = !!a && a.level < 5;
            areaTextField.style.display = needsText ? 'block' : 'none';
            if (!needsText && state.areaText) {
                state.areaText = '';
                areaTextEl.value = '';
            }

            var msg = '';
            if (needsText && !state.areaText.trim()) {
                msg = 'Tell us the area so the rider can find you.';
            }
            hintEl.textContent = msg;
            hintEl.classList.toggle('is-error', !!msg);
        }

        function sync() {
            var a = anchor();
            hidId.value = a ? a.id : '';
            hidName.value = state.district ? state.district.name : '';
            hidArea.value = state.areaText.trim();
            paint();
            onChange(value());
        }

        function fill(select, rows, placeholder) {
            var html = '<option value="">' + esc(placeholder) + '</option>';
            rows.forEach(function (r) {
                html += '<option value="' + r.id + '">' + esc(r.name) + '</option>';
            });
            select.innerHTML = html;
            select.disabled = rows.length === 0;
        }

        function resetFrom(level) {
            if (level <= 2) {
                state.division = null;
                divisionEl.innerHTML = '<option value="">Select a district first</option>';
                divisionEl.disabled = true;
            }
            if (level <= 4) {
                state.area = null;
                state.areaText = '';
                areaEl.innerHTML = '<option value="">Select a division first</option>';
                areaEl.disabled = true;
                areaTextEl.value = '';
            }
        }

        // =================================================================
        // One-box search
        // =================================================================
        function renderSearch(rows, q) {
            if (!rows.length) {
                searchMenu.innerHTML =
                    '<div class="lz-lp__empty">Nothing found for \u201c' + esc(q) + '\u201d. ' +
                    'Try a nearby area, or choose step by step below.</div>';
            } else {
                searchMenu.innerHTML = rows.map(function (r) {
                    var parts = [];
                    if (r.division_name && r.division_name !== r.name) { parts.push(r.division_name); }
                    if (r.district_name) { parts.push(r.district_name); }
                    return '<div class="lz-lp__opt" data-id="' + r.id + '">' +
                        '<strong>' + esc(r.name) + '</strong>' +
                        '<span class="lz-lp__badge">' + esc(r.unit) + '</span>' +
                        (r.matched_alias
                            ? '<span class="lz-lp__badge">also ' + esc(r.matched_alias) + '</span>'
                            : '') +
                        '<small>' + esc(parts.join(', ')) + '</small>' +
                    '</div>';
                }).join('');
            }
            searchMenu.classList.add('is-open');
        }

        searchEl.addEventListener('input', function () {
            var q = searchEl.value.trim();
            clearTimeout(searchTimer);

            if (q.length < 2) { searchMenu.classList.remove('is-open'); return; }

            searchTimer = setTimeout(function () {
                var seq = ++searchSeq;
                searchMenu.innerHTML = '<div class="lz-lp__empty">Searching\u2026</div>';
                searchMenu.classList.add('is-open');

                apiGet('/locations/search?q=' + encodeURIComponent(q)).then(function (res) {
                    if (seq !== searchSeq) { return; }
                    renderSearch(res.results || [], q);
                }).catch(function () {
                    if (seq !== searchSeq) { return; }
                    searchMenu.innerHTML = '<div class="lz-lp__empty">Search failed. ' +
                        'Please choose step by step below.</div>';
                });
            }, 250);
        });

        searchMenu.addEventListener('click', function (e) {
            var opt = e.target.closest('.lz-lp__opt');
            if (!opt) { return; }
            searchMenu.classList.remove('is-open');
            applyLocation(parseInt(opt.dataset.id, 10));
        });

        function applyLocation(id) {
            return apiGet('/locations/' + id).then(function (res) {
                var L = res.location;

                state.region   = L.region_id ? { id: L.region_id, name: L.region_name } : null;
                state.district = L.district_id ? { id: L.district_id, name: L.district_name } : null;

                if (L.level === 4) {
                    state.division = { id: L.id, name: L.name };
                    state.area = null;
                } else {
                    state.division = L.subcounty_id
                        ? { id: L.subcounty_id, name: L.division_name }
                        : null;
                    state.area = L.level === 5 ? { id: L.id, name: L.name } : null;
                }

                if (state.region) { regionEl.value = String(state.region.id); }
                if (state.district) { districtEl.value = state.district.name; }

                sync();

                if (!state.district) { return; }

                apiGet('/locations/divisions?district_id=' + state.district.id)
                    .then(function (r) {
                        fill(divisionEl, r.divisions || [], 'Select division / sub-county');
                        if (!state.division) { return null; }
                        divisionEl.value = String(state.division.id);
                        return apiGet('/locations/parishes?division_id=' + state.division.id);
                    })
                    .then(function (r) {
                        if (!r) { return; }
                        fill(areaEl, r.parishes || [], 'Select parish / area');
                        if (state.area) { areaEl.value = String(state.area.id); }
                    })
                    .catch(function () {});
            }).catch(function () {
                hintEl.textContent = 'Could not load that location. Please try again.';
                hintEl.classList.add('is-error');
            });
        }

        host.querySelector('[data-act="clear"]').addEventListener('click', function () {
            state.region = null;
            state.district = null;
            resetFrom(2);
            searchEl.value = '';
            districtEl.value = '';
            regionEl.value = '';
            sync();
            searchEl.focus();
        });

        toggleBtn.addEventListener('click', function () {
            var open = cascadeEl.classList.toggle('is-open');
            toggleBtn.textContent = open
                ? 'Hide step-by-step'
                : 'Can\u2019t find it? Choose step by step';
        });

        // =================================================================
        // Cascade fallback
        // =================================================================
        apiGet('/locations/regions').then(function (res) {
            var html = '<option value="">All regions</option>';
            (res.regions || []).forEach(function (r) {
                html += '<option value="' + r.id + '">' + esc(r.name) + '</option>';
            });
            regionEl.innerHTML = html;
        }).catch(function () {});

        regionEl.addEventListener('change', function () {
            var id = parseInt(regionEl.value, 10);
            state.region = id
                ? { id: id, name: regionEl.options[regionEl.selectedIndex].text }
                : null;
            state.district = null;
            state.districts = [];
            districtEl.value = '';
            resetFrom(2);
            sync();
        });

        function loadDistricts() {
            var path = state.region
                ? '/locations/districts?region_id=' + state.region.id
                : '/locations/districts';
            return apiGet(path).then(function (res) {
                state.districts = res.districts || [];
                return state.districts;
            });
        }

        function renderDistricts(q) {
            q = (q || '').trim().toLowerCase();
            var starts = [], contains = [];
            state.districts.forEach(function (d) {
                var i = d.name.toLowerCase().indexOf(q);
                if (i === 0) { starts.push(d); } else if (i > 0) { contains.push(d); }
            });
            var rows = q ? starts.concat(contains) : state.districts;

            districtMenu.innerHTML = rows.length
                ? rows.slice(0, 40).map(function (d) {
                    return '<div class="lz-lp__opt" data-id="' + d.id + '" data-name="' +
                        esc(d.name) + '"><strong>' + esc(d.name) + '</strong>' +
                        (d.region_name ? '<small>' + esc(d.region_name) + ' Region</small>' : '') +
                    '</div>';
                  }).join('')
                : '<div class="lz-lp__empty">No district matches that.</div>';
            districtMenu.classList.add('is-open');
        }

        function openDistricts() {
            if (state.districts.length) { renderDistricts(districtEl.value); return; }
            districtMenu.innerHTML = '<div class="lz-lp__empty">Loading districts\u2026</div>';
            districtMenu.classList.add('is-open');
            loadDistricts()
                .then(function () { renderDistricts(districtEl.value); })
                .catch(function () {
                    districtMenu.innerHTML = '<div class="lz-lp__empty">Could not load districts.</div>';
                });
        }

        districtEl.addEventListener('focus', openDistricts);
        districtEl.addEventListener('input', openDistricts);

        districtMenu.addEventListener('click', function (e) {
            var opt = e.target.closest('.lz-lp__opt');
            if (!opt) { return; }

            state.district = { id: parseInt(opt.dataset.id, 10), name: opt.dataset.name };
            districtEl.value = state.district.name;
            districtMenu.classList.remove('is-open');
            resetFrom(2);

            var picked = state.districts.filter(function (d) {
                return d.id === state.district.id;
            })[0];
            if (picked && picked.region_id) {
                regionEl.value = String(picked.region_id);
                state.region = { id: picked.region_id, name: picked.region_name };
            }

            divisionEl.innerHTML = '<option value="">Loading\u2026</option>';
            apiGet('/locations/divisions?district_id=' + state.district.id).then(function (res) {
                fill(divisionEl, res.divisions || [], 'Select division / sub-county');
            }).catch(function () {
                divisionEl.innerHTML = '<option value="">Could not load divisions</option>';
            });

            sync();
        });

        divisionEl.addEventListener('change', function () {
            var id = parseInt(divisionEl.value, 10);
            resetFrom(4);
            state.division = id
                ? { id: id, name: divisionEl.options[divisionEl.selectedIndex].text }
                : null;

            if (state.division) {
                areaEl.innerHTML = '<option value="">Loading\u2026</option>';
                apiGet('/locations/parishes?division_id=' + state.division.id).then(function (res) {
                    fill(areaEl, res.parishes || [], 'Select parish / area');
                }).catch(function () {
                    areaEl.innerHTML = '<option value="">Could not load areas</option>';
                });
            }
            sync();
        });

        areaEl.addEventListener('change', function () {
            var id = parseInt(areaEl.value, 10);
            state.area = id
                ? { id: id, name: areaEl.options[areaEl.selectedIndex].text }
                : null;
            sync();
        });

        areaTextEl.addEventListener('input', function () {
            state.areaText = areaTextEl.value;
            hidArea.value = state.areaText.trim();
            var msg = state.areaText.trim() ? '' : 'Tell us the area so the rider can find you.';
            hintEl.textContent = msg;
            hintEl.classList.toggle('is-error', !!msg);
            onChange(value());
        });

        document.addEventListener('click', function (e) {
            if (!host.contains(e.target)) {
                searchMenu.classList.remove('is-open');
                districtMenu.classList.remove('is-open');
            }
        });

        return {
            value: value,
            isValid: isValid,
            setLocation: applyLocation,
            reset: function () {
                state.region = null;
                state.district = null;
                resetFrom(2);
                searchEl.value = '';
                districtEl.value = '';
                regionEl.value = '';
                sync();
            },
            element: host
        };
    }

    global.LzLocationPicker = { init: init };
})(window);
