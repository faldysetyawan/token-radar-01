// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a live-token view set apart from it, the value model with its calibration table and
// a what-if sandbox, and a per-protocol detail drawer with the model's parts and the farm plan.
// No network: every byte it shows is in data.js, and every number it shows is recomputed here from
// the snapshot figures, so the page and board.json are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', watchOnly: false,
    tab: 'board', sort: 'implied', dir: -1, selected: null,
    gw: M.growth_weight, mr: M.maturity_range
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0') + 'x'; }

  // The model in one function: a row's implied value from the snapshot figures and the stated
  // constants. The sandbox sliders change the two weights; at the stated constants this returns
  // exactly the number board.json carries for the row.
  function impliedOf(row, gw, mr) {
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var growth = 1 + (row.model.growth_pct / 100) * gw;
    var maturity = (1 - mr) + mr * (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days);
    return Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple * growth * maturity));
  }
  function sandboxOn() { return state.gw !== M.growth_weight || state.mr !== M.maturity_range; }
  function shownValue(row) { return sandboxOn() ? impliedOf(row, state.gw, state.mr) : row.implied_value_usd; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'mult') { av = a.model.peer_multiple; bv = b.model.peer_multiple; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = shownValue(a); bv = shownValue(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Launch Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, DATA.board_size + ' protocols that record no token, ranked by ', el('em', { text: 'implied launch value' })),
        el('p', { text: 'Every protocol on the watchlist is here, and so is every early protocol below its $' + Math.round(DATA.floor_usd / 1e6) + 'M floor that passes the same screen: no token on record, and not a wrapped, staked or bridged product of one that trades. Each implied value is priced from what the market already pays for a dollar of TVL in the same category. An implied value is this board\u2019s own claim, not a price and not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Board rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Market median, value per $1 TVL' }), el('b', { text: '$' + DATA.global_multiple.toFixed(3) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });
    function tab(name, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label, onclick: function () { state.tab = name; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field check' }, watch, el('label', { for: 'watch', text: 'Watchlist only' })),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }),
        el('div', { class: 'tabs' }, tab('board', 'Pre-token board'), tab('live', 'Live tokens'), tab('model', 'The model'))),
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.peers.length + ' calibrated categories' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { class: 'sub', text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(shownValue)) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.model.peer_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shownValue(r) / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shownValue(r)) })
        )),
        el('td', null, el('span', { class: 'tag' + (r.on_watchlist ? ' watch' : ''), text: r.on_watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    var caption = sandboxOn()
      ? 'Sandbox on: values and order use your weights, not the board\u2019s. Select a row for its stated model and farm plan.'
      : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.';
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: caption }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('mult', 'Peer \u00d7'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Signal' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'tag live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.tvl_multiple) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are never ranked with the pre-token board; their prices are what calibrate it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Value per TVL' }))),
          tbody
        )
      )
    );
  }

  function modelView() {
    var m = M;
    var peerBody = el('tbody');
    var maxMult = Math.max.apply(null, DATA.peers.map(function (p) { return p.median_multiple; })) || 1;
    DATA.peers.forEach(function (p) {
      peerBody.appendChild(el('tr', null,
        el('td', { text: p.category }),
        el('td', { class: 'num', text: String(p.peers) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((p.median_multiple / maxMult) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtMult(p.median_multiple) })))
      ));
    });
    function slider(label, min, max, step, value, fmt, oninput) {
      var out = el('b', { class: 'num', text: fmt(value) });
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () { oninput(parseFloat(input.value)); out.textContent = fmt(parseFloat(input.value)); render(); });
      return el('div', { class: 'slider-row' }, el('span', { text: label }), input, out);
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every protocol, from the snapshot\u2019s own figures alone. No protocol name is special-cased and no row is hand-picked; change the snapshot and the board changes.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl \u00d7 peer_multiple \u00d7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight + ') \u00d7 (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' \u00d7 ' + m.maturity_range + ') )' }),
      el('div', { class: 'model-grid' },
        el('div', null,
          el('h3', { text: 'The calibration: what a dollar of TVL is worth' }),
          el('p', { class: 'sub', text: 'peer_multiple is the median market-cap-to-TVL ratio of the snapshot\u2019s own live-token protocols in the same category: the price the market already pays for TVL there. A category with fewer than ' + m.min_peers + ' live peers falls back to the whole market\u2019s median, $' + DATA.global_multiple.toFixed(3) + ' per $1 of TVL.' }),
          el('table', { class: 'peers' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Median multiple' }))),
            peerBody
          )
        ),
        el('div', null,
          el('h3', { text: 'The screen' }),
          el('p', { class: 'sub', text: 'A protocol is ranked when it records no token and is not a product of one that trades: its category is not a bridge, liquid staking, restaking or exchange category, its name carries no whole word wrapped, staked or staking, no version marker and no exchange\u2019s name. On this snapshot that screen keeps ' + DATA.board_size + ' of the pre-token protocols and sets ' + DATA.screened_out + ' wrapped, staked, bridged and exchange products aside; the live-token protocols are on the Live tokens view.' }),
          el('h3', { text: 'What-if sandbox' }),
          el('p', { class: 'sub', text: 'Move the two weights and the board re-ranks live, so a reader can test how much of a rank is TVL and calibration and how much is the growth and maturity judgement. board.json always carries the stated constants.' }),
          el('div', { class: 'sliders' },
            slider('Growth weight', 0, 1, 0.05, state.gw, function (v) { return v.toFixed(2); }, function (v) { state.gw = v; }),
            slider('Maturity range', 0, 0.6, 0.02, state.mr, function (v) { return v.toFixed(2); }, function (v) { state.mr = v; })
          ),
          sandboxOn() ? el('p', { class: 'note', text: 'Sandbox weights differ from the model\u2019s stated constants (growth ' + M.growth_weight + ', maturity range ' + M.maturity_range + '). The board tab now shows sandbox values.' }) : null
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function stepParts(s) {
    var at = s.indexOf(' Cost: ');
    if (at < 0) return { action: s, chips: [] };
    var action = s.slice(0, at);
    var tail = s.slice(at + 7);
    var chips = [];
    var tAt = tail.indexOf(' Time: ');
    if (tAt >= 0) {
      chips.push(['Cost', tail.slice(0, tAt).replace(/\.$/, '')]);
      chips.push(['Time', tail.slice(tAt + 7).replace(/\.$/, '')]);
    } else {
      chips.push(['Cost', tail.replace(/\.$/, '')]);
    }
    return { action: action, chips: chips };
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var check = impliedOf(row, M.growth_weight, M.maturity_range);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'tag' + (row.on_watchlist ? ' watch' : ''), text: row.on_watchlist ? 'Watchlist \u00b7 rank ' + row.rank : 'Early \u00b7 rank ' + row.rank }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' \u00b7 records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var parts = [
      ['Base: TVL \u00d7 peer multiple', row.model.base_usd],
      ['Implied value', row.implied_value_usd]
    ];
    var decompScale = Math.max(row.model.base_usd, row.implied_value_usd) || 1;
    var decomp = el('div', { class: 'decomp' }, parts.map(function (p) {
      return el('div', { class: 'row' },
        el('span', { text: p[0] }),
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((p[1] / decompScale) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(p[1]) })
      );
    }));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, from the snapshot figures' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple' }), el('b', { class: 'num', text: fmtMult(row.model.peer_multiple) })),
        el('div', null, el('span', { text: '7d growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth \u00d7' }), el('b', { class: 'num', text: row.model.growth_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Maturity \u00d7' }), el('b', { class: 'num', text: row.model.maturity_multiplier.toFixed(3) }))
      ),
      decomp,
      el('p', { class: 'sub', text: 'Priced with the ' + row.model.peer_scope + ' multiple: the median of ' + row.model.peer_count + ' live peers. The page recomputes this row as ' + fmtUsd(check) + (check === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An implied value is what a launch would be worth if the protocol\u2019s record stayed as it is; it is not a prediction that a token will be issued.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var parts2 = stepParts(s);
        return el('li', null,
          el('b', { text: parts2.action }),
          el('span', { class: 'chips' }, parts2.chips.map(function (c) {
            return el('span', { class: 'chip' }, c[0] + ': ', el('b', { text: c[1] }));
          }))
        );
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(modelView());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
