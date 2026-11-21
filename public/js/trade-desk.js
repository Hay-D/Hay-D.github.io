import {storage, number, escapeHTML as e, normalize, parseQuantity, downloadFile} from './core.js';
import {icon} from './icons.js';
import {itemsAtLevel, priceLabel, readLegacyBackup} from './editor-core.js';
import {
  MAX_EXCHANGES, MAX_SIDE_ITEMS, checkExchanges, exchangeText, formatPostItems, importPost,
  readDiscount, upsertDeal, dealValue, dealStats
} from './trade-posts.js';

const $ = id => document.getElementById(id);
const modeName = {sell: 'Selling', buy: 'Buying', trade: 'Trading'};
const dateFormat = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short', year: 'numeric'});

export function postCount(post) {
  if (post.mode !== 'trade') return post.items.length + (post.items.length === 1 ? ' item' : ' items');
  const count = post.swaps?.length || 0;
  return count + (count === 1 ? ' exchange' : ' exchanges');
}

const art = (item, attributes = '') => `<img crossorigin="anonymous" decoding="async" referrerpolicy="no-referrer" src="${e(item.image)}" alt="" ${attributes}>`;

export function exchangeCards(exchanges, byId, names) {
  function side(label, rows) {
    return `<span class="exchange-side" aria-label="${label}"><strong>${label}</strong><span class="exchange-items">${rows.map(row => {
      const item = byId.get(row.id);
      return `<span class="exchange-tile" aria-label="${e(row.quantity + ' ' + item.name)}">${art(item, 'loading="lazy"')}<span>${names ? '<small>' + e(item.name) + '</small>' : ''}<strong>${number(row.quantity)}</strong></span></span>`;
    }).join('')}</span></span>`;
  }
  return exchanges.map(({have, want, ratio, terms}, index) => `<button class="exchange-card" data-exchange="${index}" aria-label="Edit exchange ${index + 1}">${side('Have', have)}<span class="exchange-arrow">${icon('arrow-right')}${ratio ? '<strong>' + e(ratio) + '</strong>' : ''}</span>${side('Want', want)}${terms ? '<span class="exchange-terms">' + e(terms) + '</span>' : ''}</button>`).join('');
}

export function createTradeDesk({modal, closeModal, toast, current, checkPost, loadPost, catalog, byId, farm, openFarm, openLists, openImport, openGuide, saveExchanges, readPostImage}) {
  const entries = () => {
    const rows = storage.get('trade-ledger', []);
    return Array.isArray(rows) ? rows : [];
  };
  const showError = error => toast(error.message || String(error));
  const guideURL = new URL('../HayDex-Guide.pdf', import.meta.url).href;
  const menuRow = (id, glyph, label, detail) => `<button id="${id}"><span class="menu-icon">${icon(glyph)}</span><span><strong>${label}</strong><small>${detail}</small></span>${icon('chevron-right')}</button>`;

  function profile() {
    const settings = farm();
    const count = entries().filter(entry => !entry.completedAt).length;
    modal('Farm desk', `
      <div class="farm-card"><span class="farm-card-icon">${icon('wheat')}</span><div><strong>${e(settings.farm || 'Your farm')}</strong>
      <small>${settings.level ? 'Level ' + number(settings.level) : 'Farm level not set'}</small></div><button class="button quiet" id="farm-details">Edit farm</button></div>
      <div class="settings-menu farm-menu">
        ${menuRow('desk-posts', 'bookmark', 'Trade posts', 'Saved posts')}
        ${menuRow('desk-deals', 'swap', 'Deals', count ? count + ' open' : 'Plan a deal')}
        ${menuRow('desk-history', 'history', 'History', 'Completed deals')}
        ${menuRow('desk-stats', 'stats', 'Stats', 'Coins and items traded')}
        ${menuRow('desk-import', 'import', 'Import an old post', 'Text, screenshots or files')}
        ${menuRow('desk-guide', 'help', 'Guide', 'How to use HayDex')}
      </div>`);
    $('farm-details').onclick = openFarm;
    $('desk-posts').onclick = openLists;
    $('desk-deals').onclick = () => ledger();
    $('desk-history').onclick = () => ledger('history');
    $('desk-stats').onclick = () => ledger('stats');
    $('desk-import').onclick = () => oldPost();
    $('desk-guide').onclick = openGuide;
  }

  function editExchange(index = -1) {
    const exchanges = current().swaps, existing = exchanges[index];
    if (!existing && exchanges.length >= MAX_EXCHANGES) return toast('This post already has ' + MAX_EXCHANGES + ' exchanges.');
    const next = structuredClone(existing || {have: [], want: []});
    const field = (key, label) => `
      <section class="exchange-editor-side">
        <h3>${label}</h3>
        <div class="search-wrap">${icon('search')}<input id="swap-${key}-search" type="search" placeholder="Find an item" aria-label="Find ${label.toLowerCase()} item" autocomplete="off"></div>
        <div class="exchange-options" id="swap-${key}-options"></div>
        <div class="exchange-selected" id="swap-${key}-rows"></div>
      </section>`;
    modal(existing ? 'Edit exchange' : 'New exchange', `
      <div class="exchange-editor">${field('have', 'Have')}${field('want', 'Want')}</div>
      <div class="exchange-terms-fields">
        <label class="field-label">Ratio <small>Have to Want</small><input id="exchange-ratio" value="${e(next.ratio || '')}" placeholder="1:85" maxlength="15" autocomplete="off"></label>
        <label class="field-label">Terms <small>Optional</small><input id="exchange-terms" value="${e(next.terms || '')}" placeholder="Any mix is fine" maxlength="120"></label>
      </div>
      <p class="editor-error" role="alert" id="exchange-error"></p>
      <div class="dialog-actions">${existing ? '<button class="button quiet danger-text" id="remove-exchange">Remove</button>' : ''}<button class="button primary" id="save-exchange">Save exchange</button></div>`, {wide: true});

    for (const side of ['have', 'want']) {
      const search = $('swap-' + side + '-search'), options = $('swap-' + side + '-options'), rows = $('swap-' + side + '-rows');
      const showOptions = () => {
        const query = normalize(search.value);
        const matches = query ? itemsAtLevel(catalog(), farm().level).filter(item => normalize(item.name).includes(query) || normalize(item.id).includes(query)).slice(0, 12) : [];
        options.innerHTML = matches.map(item => `<button data-exchange-item="${e(item.id)}">${art(item)}<span>${e(item.name)}</span>${icon('plus')}</button>`).join('') ||
          (query ? '<p class="helper">No matching items</p>' : '');
      };
      const showRows = () => {
        rows.innerHTML = next[side].map(({id, quantity}, i) => {
          const item = byId().get(id), name = e(item.name);
          return `<div class="exchange-picked">${art(item)}<span>${name}</span><input value="${quantity}" inputmode="numeric" data-exchange-qty="${i}" aria-label="${name} quantity"><button class="icon-button" data-exchange-remove="${i}" aria-label="Remove ${name}">${icon('close')}</button></div>`;
        }).join('');
      };
      showRows();
      search.oninput = showOptions;
      search.onkeydown = event => {
        if (event.key === 'Enter' && options.querySelector('button')) {
          event.preventDefault();
          options.querySelector('button').click();
        }
      };
      options.onclick = event => {
        const id = event.target.closest('[data-exchange-item]')?.dataset.exchangeItem;
        if (!id) return;
        const row = next[side].find(row => row.id === id);
        if (!row && next[side].length >= MAX_SIDE_ITEMS) return toast('Use up to ' + MAX_SIDE_ITEMS + ' items per side.');
        if (row) {
          try {row.quantity = parseQuantity(row.quantity + 1);} catch (error) {return showError(error);}
        } else next[side].push({id, quantity: 1});
        search.value = '';
        showOptions();
        showRows();
        rows.querySelector('input[data-exchange-qty="' + next[side].findIndex(row => row.id === id) + '"]')?.focus();
      };
      rows.onchange = event => {
        const index = event.target.dataset.exchangeQty;
        if (index === undefined) return;
        const row = next[side][index];
        try {
          row.quantity = parseQuantity(event.target.value);
          $('exchange-error').textContent = '';
        } catch (error) {
          $('exchange-error').textContent = error.message;
        }
        event.target.value = row.quantity;
      };
      rows.onclick = event => {
        const index = event.target.closest('[data-exchange-remove]')?.dataset.exchangeRemove;
        if (index === undefined) return;
        next[side].splice(Number(index), 1);
        showRows();
        search.focus();
      };
    }

    $('save-exchange').onclick = () => {
      try {
        const [checked] = checkExchanges([{...next, ratio: $('exchange-ratio').value, terms: $('exchange-terms').value}], catalog());
        saveExchanges(existing ? exchanges.map((value, i) => i === index ? checked : value) : [...exchanges, checked]);
        closeModal();
      } catch (error) {
        $('exchange-error').textContent = error.message;
      }
    };
    if (existing) $('remove-exchange').onclick = () => {
      saveExchanges(exchanges.filter((_, i) => i !== index));
      closeModal();
    };
  }

  function oldPost(value = '') {
    modal('Import an old post', `
      <label class="field-label">Discord post or list<textarea class="export-text" id="old-post-text" rows="5" placeholder="SELLING&#10;20 Beeswax @ 3k">${e(value)}</textarea></label>
      <div class="desk-actions"><label class="button secondary file-button">${icon('scan')}Scan post<input type="file" id="old-post-file" accept=".txt,.json,image/png,image/jpeg,image/webp" aria-label="Scan post"></label><button class="button secondary" id="old-post-preview">Preview</button></div>
      <p class="post-scan-hint">Works best with HayDex Buy, Sell or Trade images.</p>
      <p class="editor-error" id="old-post-error" role="alert"></p><div id="old-post-result" aria-live="polite"></div>
      <div class="dialog-actions"><button class="text-button" id="old-post-list">Import list</button><button class="button primary" id="old-post-load" disabled>Load post</button></div>`, {back: profile});
    const input = $('old-post-text'), output = $('old-post-result'), load = $('old-post-load'), error = $('old-post-error');
    let candidate = null, revision = 0;
    const reset = () => {
      revision++;
      candidate = null;
      output.replaceChildren();
      error.textContent = '';
      load.disabled = true;
    };
    function preview(post, skipped, visualScan = false) {
      const draft = current();
      candidate = checkPost({
        ...post,
        image: {...draft.image, captionText: '', ...post.image},
        items: post.items || [],
        swaps: post.swaps || []
      });
      if (!(candidate.mode === 'trade' ? candidate.swaps.length : candidate.items.length)) throw new Error('This post has no items.');
      const list = rows => `<ul>${rows.map(row => `<li>${number(row.quantity)} ${e(byId().get(row.id).name)}${row.price === undefined || row.unpriced ? '' : ' · ' + e(priceLabel(row))}</li>`).join('')}</ul>`;
      const items = candidate.mode === 'trade' ? candidate.swaps.map(({have, want, ratio, terms}) => `<section class="imported-exchange">
        <div><strong>Have</strong>${list(have)}</div><div><strong>Want</strong>${list(want)}</div>
        ${ratio ? '<small>Ratio ' + e(ratio) + '</small>' : ''}${terms ? '<small>' + e(terms) + '</small>' : ''}</section>`).join('') : list(candidate.items);
      const chooseMode = visualScan && candidate.mode !== 'trade';
      output.innerHTML = `<div class="desk-import-preview"><strong>${e(candidate.name)}</strong><small>${modeName[candidate.mode]} · ${postCount(candidate)}</small>
        ${visualScan ? '<p class="helper">' + (candidate.mode === 'trade' ? 'Check both sides and quantities.' : 'Check quantities and add prices after loading.') + '</p>' : ''}
        ${chooseMode ? '<label class="settings-row">Post type<select id="old-post-mode"><option value="sell">Selling</option><option value="buy">Buying</option></select></label>' : ''}
        <div class="post-scan-items">${items}</div>
        ${skipped.length ? `<details class="advanced" ${visualScan ? 'open' : ''}><summary>${visualScan ? 'Review notes' : skipped.length + ' lines left out'}</summary><ul>${skipped.slice(0, 20).map(line => '<li>' + e(line) + '</li>').join('')}</ul></details>` : ''}
        ${candidate.discount && candidate.mode === 'sell' ? '<small>' + e(candidate.discount.name) + ' · ' + number(candidate.discount.percent) + '% off</small>' : ''}
        </div>`;
      if (chooseMode) {
        const mode = $('old-post-mode');
        mode.value = candidate.mode;
        mode.onchange = () => {candidate.mode = mode.value;};
      }
      load.disabled = false;
    }
    function previewText() {
      reset();
      try {
        const legacy = input.value.includes('SPECIAL_TYPE') ? readLegacyBackup(input.value, catalog()) : null;
        const {post, skipped} = legacy ? {post: legacy.active.draft, skipped: []} : importPost(input.value, catalog(), current().mode);
        preview(post, skipped);
      } catch (failure) {
        error.textContent = failure.message;
      }
    }
    input.oninput = reset;
    $('old-post-preview').onclick = previewText;
    $('old-post-list').onclick = () => openImport(input.value);
    load.onclick = () => {if (candidate) loadPost(candidate, 'Post loaded');};
    $('old-post-file').onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;
      event.target.value = '';
      reset();
      const request = revision;
      try {
        if (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)) {
          output.textContent = 'Reading the item grid…';
          const post = await readPostImage(file);
          if (!output.isConnected || request !== revision) return;
          const mode = post.mode || (current().mode === 'buy' ? 'buy' : 'sell');
          preview({...post, mode}, post.warnings, !post.exact);
          input.value = mode === 'trade' ? exchangeText(candidate.swaps, byId()) :
            formatPostItems(candidate.items, byId(), row => row.unpriced ? '' : priceLabel(row));
        } else {
          if (file.size > 500000) throw new Error('Use a text or JSON file under 500 KB.');
          const text = await file.text();
          if (!output.isConnected || request !== revision) return;
          input.value = text;
          previewText();
        }
      } catch (failure) {
        if (output.isConnected && request === revision) {
          output.replaceChildren();
          error.textContent = failure.message;
        }
      }
    };
  }

  function dealCard(entry, history) {
    const {post, id, partner, completedAt, createdAt} = entry, value = dealValue(post, byId());
    const meta = [modeName[post.mode], postCount(post), post.mode === 'trade' ? '' : number(value.coins) + ' coins'].filter(Boolean).join(' · ');
    return `<article class="desk-deal">
      <div class="desk-deal-head"><div><strong>${e(post.name)}</strong><p>${meta}</p></div><time datetime="${e(completedAt || createdAt)}">${e(dateFormat.format(new Date(completedAt || createdAt)))}</time></div>
      ${partner ? '<p class="desk-partner">' + e(partner) + '</p>' : ''}
      <div class="desk-actions">
        <button class="button quiet" data-deal-open="${id}">Open post</button>
        ${history ? `<button class="button secondary" data-deal-reopen="${id}">Reopen</button>` :
          `<button class="button quiet" data-deal-edit="${id}">Edit</button><button class="button primary" data-deal-complete="${id}">Complete</button>`}
      </div>
    </article>`;
  }
  function write(next) {
    if (!storage.set('trade-ledger', next)) throw new Error('Device storage is full. Download a backup in Settings.');
  }
  function ledger(active = 'deals') {
    const records = entries();
    const live = current();
    const hasPost = live.mode === 'trade' ? live.swaps.length > 0 : live.items.length > 0;
    const history = active === 'history';
    const displayed = records.filter(entry => !!entry.completedAt === history)
      .sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
    modal(active === 'stats' ? 'Stats' : history ? 'History' : 'Deals', `
      <div class="tabs desk-tabs" aria-label="Deal views">${['deals', 'history', 'stats'].map(tab => `<button data-ledger-tab="${tab}" aria-pressed="${tab === active}" class="${tab === active ? 'active' : ''}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}</div>
      ${active === 'stats' ? '<label class="desk-period">Period<select id="stats-period"><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label><div id="stats-content"></div>' :
        `${history ? '' : `<div class="desk-actions desk-add"><button class="button primary" id="new-deal">${icon('plus')}New deal</button>${hasPost ? '<button class="button secondary" id="deal-from-post">From this post</button>' : ''}</div>`}
        <div class="desk-list">${displayed.map(entry => dealCard(entry, history)).join('') ||
          '<p class="empty-note">' + (history ? 'Completed deals appear here.' : 'Add a deal to keep it open while you trade.') + '</p>'}</div>`}
    `, {back: profile});

    if (!history && active === 'deals') {
      $('new-deal').onclick = () => editDeal();
      if (hasPost) $('deal-from-post').onclick = () => editDeal(null, live);
    }
    if (active === 'stats') {
      $('stats-period').onchange = () => stats(records);
      stats(records);
    }
    $('modal-content').onclick = event => {
      const tab = event.target.closest('[data-ledger-tab]');
      if (tab) return ledger(tab.dataset.ledgerTab);
      const button = event.target.closest('[data-deal-open], [data-deal-edit], [data-deal-complete], [data-deal-reopen]');
      if (!button) return;
      const {dealOpen, dealEdit, dealComplete, dealReopen} = button.dataset;
      const entry = entries().find(row => row.id === (dealOpen || dealEdit || dealComplete || dealReopen));
      if (!entry) return ledger(active);
      try {
        if (dealOpen) return loadPost(entry.post, 'Post opened');
        if (dealEdit) return editDeal(entry);
        write(upsertDeal(entries(), {...entry, completedAt: dealComplete ? new Date().toISOString() : null}));
        toast(dealComplete ? 'Deal added to History' : 'Deal reopened');
        ledger(active);
      } catch (error) {showError(error);}
    };
  }

  function stats(records) {
    const days = Number($('stats-period').value);
    const data = dealStats(records, byId(), days ? Date.now() - days * 86400000 : 0);
    if (!data.count) {
      $('stats-content').innerHTML = '<p class="empty-note">No completed deals in this period.</p>';
      return;
    }
    const metric = (value, label, detail) => `<div><span>${label}</span><strong>${number(value)}</strong><small>${detail}</small></div>`;
    const ranks = (label, rows, name) => !rows.length ? '' : `<section class="desk-ranking"><h3>${label}</h3><ol>${rows.map(([id, count]) =>
      `<li><div><span>${e(name(id))}</span><strong>${number(count)}</strong></div><meter min="0" max="${rows[0][1]}" value="${count}" aria-label="${e(name(id))}">${count}</meter></li>`
    ).join('')}</ol></section>`;
    $('stats-content').innerHTML = `<div class="desk-metrics">
      ${metric(data.earned, 'Coins earned', number(data.sold) + ' sold')}
      ${metric(data.spent, 'Coins spent', number(data.bought) + ' bought')}
      ${metric(data.count, 'Completed deals', number(data.traded) + ' units exchanged')}
    </div>${ranks('Most sold', data.sales, id => byId().get(id).name)}${ranks('Trading partners', data.partners, name => name)}`;
  }

  function editDeal(entry, source) {
    const post = entry?.post || source;
    const text = post?.mode === 'trade' ? exchangeText(post.swaps, byId()) : post ? formatPostItems(post.items, byId(), priceLabel) : '';
    modal(entry ? 'Edit deal' : 'New deal', `
      <div class="desk-form">
        <label class="field-label">Deal name<input id="deal-name" maxlength="50" value="${e(post?.name || '')}" placeholder="Example: Barn tools"></label>
        <label class="field-label">Partner <small>Optional</small><input id="deal-partner" maxlength="60" value="${e(entry?.partner || '')}"></label>
        <label class="field-label">Type<select id="deal-mode">${Object.entries(modeName).map(([key, label]) => `<option value="${key}" ${key === (post?.mode || 'sell') ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <fieldset class="deal-rebate" id="deal-rebate"><legend>Discount</legend><label class="field-label">Name<input id="deal-discount-name" maxlength="50" value="${e(post?.discount?.name || '')}" placeholder="Bundle deal"></label><label class="field-label">Percent<input id="deal-discount-percent" type="number" min="0" max="100" step=".01" value="${post?.discount?.percent || ''}"></label></fieldset>
      </div>
      <label class="field-label">Items<textarea class="export-text" rows="5" id="deal-items">${e(text)}</textarea></label>
      <label class="field-label">Notes <small>Optional</small><textarea id="deal-notes" maxlength="200" rows="2">${e(post?.notes || '')}</textarea></label>
      <p id="deal-error" class="editor-error" role="alert"></p>
      <div class="dialog-actions">${entry ? '<button class="button quiet danger-text" id="delete-deal">Remove</button>' : ''}<button class="button primary" id="save-deal">Save deal</button></div>
    `, {back: () => ledger()});
    const mode = $('deal-mode'), items = $('deal-items');
    const syncMode = () => {
      $('deal-rebate').hidden = mode.value !== 'sell';
      items.placeholder = mode.value === 'trade' ? 'Have\n20 Plank\nWant\n10 Bolt' : '20 Beeswax @ 3k';
    };
    mode.onchange = syncMode;
    syncMode();
    $('save-deal').onclick = () => {
      try {
        const type = mode.value, text = items.value.trim();
        const parsed = importPost(text, catalog(), type);
        if (parsed.skipped.length) throw new Error('Check this line: ' + parsed.skipped[0]);
        if (type === 'trade' ? !parsed.post.swaps?.length : parsed.post.mode === 'trade') throw new Error(type === 'trade' ? 'Enter Have and Want with at least one item each.' : 'Choose Trading for a Have/Want deal.');
        const discount = type === 'sell' ? readDiscount({percent: $('deal-discount-percent').value, name: $('deal-discount-name').value}) : null;
        const checked = checkPost({
          ...post, ...parsed.post, mode: type, discount,
          image: post?.image || parsed.post.image,
          partials: post?.partials ?? parsed.post.partials,
          name: $('deal-name').value.trim() || 'Untitled deal',
          notes: $('deal-notes').value.trim(),
          items: parsed.post.items || [], swaps: parsed.post.swaps || []
        });
        const deal = {
          id: entry?.id || crypto.randomUUID(), post: checked,
          partner: $('deal-partner').value.trim(), createdAt: entry?.createdAt || new Date().toISOString(),
          completedAt: null
        };
        write(upsertDeal(entries(), deal));
        toast('Deal saved');
        ledger();
      } catch (error) {
        $('deal-error').textContent = error.message;
      }
    };
    if (entry) $('delete-deal').onclick = () => {
      modal('Remove deal', `<p class="helper">Remove “${e(entry.post.name)}” from Deals?</p><div class="dialog-actions"><button class="button quiet" id="keep-deal">Keep</button><button class="button primary" id="confirm-deal-delete">Remove</button></div>`);
      $('keep-deal').onclick = () => editDeal(entry);
      $('confirm-deal-delete').onclick = () => {
        try {
          write(entries().filter(deal => deal.id !== entry.id));
          ledger();
        } catch (error) {showError(error);}
      };
    };
  }

  return {
    profile, editExchange, oldPost, ledger,
    downloadPost(post) {
      downloadFile('haydex-post.json', JSON.stringify({type: 'haydex-post', version: 1, post}, null, 2));
    },
    guideURL
  };
}
