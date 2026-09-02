// PromoBot Pro Frontend Logic

let currentExtractedDeal = null;
let currentBannerBlobUrl = null;
let categoryPresets = [];

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initQuickPost();
  initChannels();
  initSettings();
  initHunter();
  initLogs();
  initAnalytics();

  // Carrega status e dados iniciais
  fetchStatus();
  fetchCategories();
  fetchChannels();
  fetchSettings();
  fetchHistory();
  fetchAnalytics();

  // Intervalo de atualização de status (15s)
  setInterval(fetchStatus, 15000);
});

// ==========================================
// 1. NAVEGAÇÃO ENTRE ABAS
// ==========================================
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      navButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(t => t.classList.remove('active'));

      btn.classList.add('active');
      const targetContent = document.getElementById(`tab-${targetTab}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      // Dispara ações ao trocar de aba
      if (targetTab === 'analytics') fetchAnalytics();
      if (targetTab === 'channels') fetchChannels();
      if (targetTab === 'hunter') loadHunterDeals();
      if (targetTab === 'history') fetchHistory();
      if (targetTab === 'logs') fetchLogs();
    });
  });
}

// ==========================================
// 2. STATUS & ESTATÍSTICAS
// ==========================================
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.success) {
      if (document.getElementById('stat-clicks-total')) {
        document.getElementById('stat-clicks-total').textContent = data.stats.totalClicks || 0;
      }
      if (document.getElementById('stat-clicks-today')) {
        document.getElementById('stat-clicks-today').textContent = data.stats.clicksToday || 0;
      }
      document.getElementById('stat-channels').textContent = data.stats.activeChannels || 0;
      document.getElementById('stat-shopee').textContent = data.stats.shopeeCount || 0;
      document.getElementById('stat-ml').textContent = data.stats.mercadoLivreCount || 0;

      // Status do Piloto Automático
      const pill = document.getElementById('autopilot-status-pill');
      const statusText = document.getElementById('autopilot-text-status');

      if (data.autopilot.enabled) {
        pill.classList.remove('paused');
        statusText.innerHTML = `<span style="color: #34d399">ATIVO 24/7</span> (${data.autopilot.intervalMinutes}m)`;
      } else {
        pill.classList.add('paused');
        statusText.innerHTML = `<span style="color: #fbbf24">PAUSADO</span>`;
      }
    }
  } catch (err) {
    console.error('Erro ao consultar status:', err);
  }
}

// ==========================================
// 2.1 ANALYTICS DE CLIQUES & CONVERSÃO
// ==========================================
function initAnalytics() {
  const btnRefresh = document.getElementById('btn-refresh-analytics');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchAnalytics();
      showToast('Métricas de cliques atualizadas!', 'success');
    });
  }
}

async function fetchAnalytics() {
  const tbody = document.getElementById('analytics-top-deals-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/analytics/clicks');
    const data = await res.json();

    if (data.success) {
      if (document.getElementById('analytics-clicks-today')) {
        document.getElementById('analytics-clicks-today').textContent = data.stats.clicksToday || 0;
      }
      if (document.getElementById('analytics-clicks-7d')) {
        document.getElementById('analytics-clicks-7d').textContent = data.stats.clicksLast7Days || 0;
      }
      if (document.getElementById('analytics-clicks-total')) {
        document.getElementById('analytics-clicks-total').textContent = data.stats.totalClicks || 0;
      }

      if (!data.topDeals || data.topDeals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 24px; color: var(--text-muted);">Nenhum clique registrado ainda. Os cliques aparecerão aqui assim que seus membros clicarem nas ofertas postadas!</td></tr>`;
        return;
      }

      tbody.innerHTML = '';
      data.topDeals.forEach((deal, idx) => {
        const tr = document.createElement('tr');
        const posBadge = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`));
        const storeBadge = deal.store === 'shopee' ? '<span class="badge shopee">Shopee</span>' : '<span class="badge mercadolivre">Mercado Livre</span>';
        const price = deal.currentPrice ? deal.currentPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';
        const lastClick = deal.lastClickedAt ? new Date(deal.lastClickedAt).toLocaleString('pt-BR') : '-';

        tr.innerHTML = `
          <td style="font-weight: 800; font-size: 1.1rem; text-align: center;">${posBadge}</td>
          <td><img src="${deal.imageUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}" class="table-thumb" alt="thumb"></td>
          <td style="max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(deal.title)}">
            <b>${escapeHtml(deal.title)}</b>
          </td>
          <td>${storeBadge}</td>
          <td style="color: var(--accent-emerald); font-weight: bold;">${price}</td>
          <td style="text-align: center;">
            <span style="display: inline-block; padding: 4px 12px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 20px; font-weight: 800;">
              🔥 ${deal.clicks} clique(s)
            </span>
          </td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${lastClick}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error('Erro ao buscar analytics:', err);
  }
}

// ==========================================
// 3. CATEGORIAS & NICHOS
// ==========================================
async function fetchCategories() {
  try {
    const res = await fetch('/api/categories');
    const data = await res.json();
    if (data.success) {
      categoryPresets = data.categories;
    }
  } catch (err) {
    console.error('Erro ao buscar categorias:', err);
  }
}

// ==========================================
// 4. GERENCIADOR DE CANAIS & NICHOS
// ==========================================
function initChannels() {
  const formBox = document.getElementById('channel-form-box');
  const btnOpen = document.getElementById('btn-open-add-channel-modal');
  const btnCancel = document.getElementById('btn-cancel-channel-form');
  const form = document.getElementById('channel-create-form');

  btnOpen.addEventListener('click', () => {
    document.getElementById('channel-form-title').textContent = 'Cadastrar Novo Canal / Grupo';
    document.getElementById('channel-form-id').value = '';
    form.reset();
    formBox.classList.remove('hidden');
    formBox.scrollIntoView({ behavior: 'smooth' });
  });

  btnCancel.addEventListener('click', () => {
    formBox.classList.add('hidden');
    form.reset();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('channel-form-id').value;
    const name = document.getElementById('channel-input-name').value.trim();
    const chatId = document.getElementById('channel-input-chatid').value.trim();
    const category = document.getElementById('channel-input-category').value;
    const keywords = document.getElementById('channel-input-keywords').value.trim();
    const minDiscountPercent = parseFloat(document.getElementById('channel-input-min-discount').value);
    const customBotToken = document.getElementById('channel-input-token').value.trim();

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id || undefined,
          name,
          chatId,
          category,
          keywords: keywords ? keywords.split(',').map(k => k.trim()) : [],
          minDiscountPercent,
          customBotToken: customBotToken || undefined
        })
      });

      const data = await res.json();
      if (data.success) {
        showToast('✅ Canal salvo com sucesso!', 'success');
        formBox.classList.add('hidden');
        form.reset();
        fetchChannels();
        fetchStatus();
      } else {
        showToast(data.error || 'Erro ao salvar canal', 'error');
      }
    } catch (err) {
      showToast('Erro ao comunicar com o servidor', 'error');
    }
  });
}

async function fetchChannels() {
  const grid = document.getElementById('channels-list-grid');
  const quickPostSelect = document.getElementById('quick-post-channel-select');

  try {
    const res = await fetch('/api/channels');
    const data = await res.json();

    if (data.success) {
      const channels = data.channels || [];

      // Atualiza dropdown da Postagem Rápida
      quickPostSelect.innerHTML = `<option value="default">Canal Principal / Padrão</option>`;
      channels.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.textContent = `${ch.name} (${ch.chatId}) - [${getCategoryLabel(ch.category)}]`;
        quickPostSelect.appendChild(opt);
      });

      // Renderiza os cards de canais
      if (channels.length === 0) {
        grid.innerHTML = `
          <div class="glass-card" style="grid-column: 1/-1; text-align: center; padding: 40px;">
            <p style="color: var(--text-secondary); margin-bottom: 16px;">Nenhum canal específico cadastrado ainda. O bot usará o Canal Principal das configurações gerais.</p>
            <button class="btn-primary btn-small" onclick="document.getElementById('btn-open-add-channel-modal').click()">
              ➕ Cadastrar Meu Primeiro Canal por Nicho (Ex: Suplementos & Esportes)
            </button>
          </div>
        `;
        return;
      }

      grid.innerHTML = '';
      channels.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'channel-card';

        const catPreset = categoryPresets.find(p => p.key === ch.category);
        const emoji = catPreset?.emoji || '🎯';
        const catName = catPreset?.name || ch.category;

        card.innerHTML = `
          <div class="channel-card-header">
            <div>
              <h4>${escapeHtml(ch.name)}</h4>
              <span class="channel-chatid-tag">${escapeHtml(ch.chatId)}</span>
            </div>
            <span class="tag-status">${ch.isActive ? 'Ativo' : 'Pausado'}</span>
          </div>

          <div class="channel-niche-badge">
            <span>${emoji}</span>
            <span>${catName}</span>
          </div>

          <div style="font-size: 0.85rem; color: var(--text-secondary);">
            <div>⚡ Desconto Mínimo: <b>${ch.minDiscountPercent}% OFF</b></div>
            ${ch.keywords && ch.keywords.length > 0 ? `<div style="margin-top: 4px; font-size: 0.8rem; color: var(--text-muted);">Tags: ${escapeHtml(ch.keywords.join(', '))}</div>` : ''}
          </div>

          <div class="channel-card-actions">
            <button class="btn-secondary btn-small btn-test-ch" data-id="${ch.id}">
              🧪 Testar
            </button>
            <button class="btn-secondary btn-small btn-edit-ch" data-id="${ch.id}">
              ✏️ Editar
            </button>
            <button class="btn-secondary btn-small btn-del-ch" data-id="${ch.id}" style="color: var(--accent-rose);">
              🗑️ Excluir
            </button>
          </div>
        `;

        card.querySelector('.btn-test-ch').addEventListener('click', async () => {
          showToast(`Testando envio para ${ch.name}...`, 'info');
          const testRes = await fetch(`/api/channels/${ch.id}/test`, { method: 'POST' });
          const testData = await testRes.json();
          if (testData.success) {
            showToast(`✅ Teste enviado com sucesso para ${ch.name}!`, 'success');
          } else {
            showToast(`❌ ${testData.error}`, 'error');
          }
        });

        card.querySelector('.btn-edit-ch').addEventListener('click', () => {
          document.getElementById('channel-form-title').textContent = 'Editar Canal';
          document.getElementById('channel-form-id').value = ch.id;
          document.getElementById('channel-input-name').value = ch.name;
          document.getElementById('channel-input-chatid').value = ch.chatId;
          document.getElementById('channel-input-category').value = ch.category;
          document.getElementById('channel-input-keywords').value = ch.keywords ? ch.keywords.join(', ') : '';
          document.getElementById('channel-input-min-discount').value = ch.minDiscountPercent;
          document.getElementById('channel-input-token').value = ch.customBotToken || '';

          document.getElementById('channel-form-box').classList.remove('hidden');
          document.getElementById('channel-form-box').scrollIntoView({ behavior: 'smooth' });
        });

        card.querySelector('.btn-del-ch').addEventListener('click', async () => {
          if (confirm(`Deseja realmente remover o canal "${ch.name}"?`)) {
            await fetch(`/api/channels/${ch.id}`, { method: 'DELETE' });
            showToast('Canal removido.', 'info');
            fetchChannels();
            fetchStatus();
          }
        });

        grid.appendChild(card);
      });
    }
  } catch (err) {
    console.error('Erro ao buscar canais:', err);
  }
}

function getCategoryLabel(key) {
  const cat = categoryPresets.find(p => p.key === key);
  return cat ? `${cat.emoji} ${cat.name}` : key;
}

// ==========================================
// 5. POSTAGEM RÁPIDA (QUICK POST)
// ==========================================
function initQuickPost() {
  const form = document.getElementById('quick-post-form');
  const urlInput = document.getElementById('product-url-input');
  const btnExtract = document.getElementById('btn-extract');
  const btnText = btnExtract.querySelector('.btn-text');
  const btnLoader = btnExtract.querySelector('.btn-loader');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    btnExtract.disabled = true;
    btnText.textContent = 'Extraindo dados e gerando arte...';
    btnLoader.classList.remove('hidden');

    try {
      const res = await fetch('/api/quick-post/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();

      if (!data.success) {
        showToast(data.error || 'Falha ao extrair produto', 'error');
        return;
      }

      openDealInStudio(data.deal, data.previewCopy);

    } catch (err) {
      showToast('Erro de conexão com o servidor', 'error');
    } finally {
      btnExtract.disabled = false;
      btnText.textContent = 'Extrair Oferta & Gerar Arte';
      btnLoader.classList.add('hidden');
    }
  });

  // Botão de Recalcular Texto
  document.getElementById('btn-re-render').addEventListener('click', async () => {
    if (!currentExtractedDeal) return;

    syncDealWithInputs();
    updateProductImagePreview(currentExtractedDeal);
    updateTelegramCaptionPreview(currentExtractedDeal);
    showToast('Texto atualizado com base nos preços!', 'success');
  });

  // Botão de Gerar Copy com Gemini IA
  const btnAiCopy = document.getElementById('btn-generate-ai-copy');
  if (btnAiCopy) {
    btnAiCopy.addEventListener('click', async () => {
      if (!currentExtractedDeal) {
        showToast('Extraia uma oferta primeiro.', 'error');
        return;
      }

      syncDealWithInputs();
      btnAiCopy.disabled = true;
      btnAiCopy.textContent = '✨ Criando com Gemini IA...';

      try {
        const selectedChannel = document.getElementById('quick-post-channel-select').value;
        const res = await fetch('/api/quick-post/generate-ai-copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deal: currentExtractedDeal,
            channelId: selectedChannel
          })
        });
        const data = await res.json();
        if (data.success && data.copy) {
          document.getElementById('tg-caption-preview').innerHTML = data.copy;
          showToast('✨ Nova copy persuasiva gerada pelo Gemini IA!', 'success');
        } else {
          showToast(`Erro na IA: ${data.error || 'Verifique sua chave nas Configurações'}`, 'error');
        }
      } catch (err) {
        showToast('Erro ao contatar IA', 'error');
      } finally {
        btnAiCopy.disabled = false;
        btnAiCopy.textContent = '✨ Gerar com Gemini IA';
      }
    });
  }

  // Botão de Publicar no Telegram
  document.getElementById('btn-publish-now').addEventListener('click', async () => {
    if (!currentExtractedDeal) {
      showToast('Nenhuma oferta carregada no Studio.', 'error');
      return;
    }

    syncDealWithInputs();

    const btn = document.getElementById('btn-publish-now');
    const selectedChannel = document.getElementById('quick-post-channel-select').value;
    const currentCaption = document.getElementById('tg-caption-preview').innerHTML;

    btn.disabled = true;
    btn.textContent = 'Publicando no Telegram...';

    try {
      const res = await fetch('/api/quick-post/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal: currentExtractedDeal,
          channelId: selectedChannel,
          customCaption: currentCaption
        })
      });

      const data = await res.json();

      if (data.success) {
        showToast('🎉 Promoção publicada com sucesso no Telegram com foto do produto!', 'success');
        fetchStatus();
        fetchHistory();
      } else {
        showToast(`Erro ao publicar: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Falha na comunicação com o servidor', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📢 Publicar no Telegram Agora!';
    }
  });
}

function syncDealWithInputs() {
  if (!currentExtractedDeal) return;

  const newPrice = parseFloat(document.getElementById('edit-current-price').value);
  const oldPrice = parseFloat(document.getElementById('edit-original-price').value);
  const coupon = document.getElementById('edit-coupon-code').value.trim();

  if (!isNaN(newPrice) && newPrice > 0) {
    currentExtractedDeal.currentPrice = newPrice;
  }
  if (!isNaN(oldPrice) && oldPrice > 0) {
    currentExtractedDeal.originalPrice = oldPrice;
    currentExtractedDeal.discountPercent = Math.round(((oldPrice - currentExtractedDeal.currentPrice) / oldPrice) * 100);
  }
  currentExtractedDeal.couponCode = coupon || undefined;
}

function openDealInStudio(deal, customCopy) {
  currentExtractedDeal = { ...deal };

  document.getElementById('product-url-input').value = deal.originalUrl || deal.affiliateUrl;

  const previewStage = document.getElementById('preview-stage');
  previewStage.classList.remove('hidden');

  displayDealPreview(deal, customCopy);

  // Garante que muda para a aba do Quick Post
  const quickPostBtn = document.getElementById('nav-quick-post');
  if (!quickPostBtn.classList.contains('active')) {
    quickPostBtn.click();
  }

  previewStage.scrollIntoView({ behavior: 'smooth' });
  updateProductImagePreview(deal);
}

function displayDealPreview(deal, copyText) {
  const badge = document.getElementById('preview-store-badge');
  badge.textContent = deal.store === 'shopee' ? 'SHOPEE' : 'MERCADO LIVRE';
  badge.className = `badge ${deal.store}`;

  document.getElementById('edit-current-price').value = deal.currentPrice;
  document.getElementById('edit-original-price').value = deal.originalPrice || '';
  document.getElementById('edit-coupon-code').value = deal.couponCode || '';

  if (copyText) {
    document.getElementById('tg-caption-preview').innerHTML = copyText;
  } else {
    updateTelegramCaptionPreview(deal);
  }
}

function updateProductImagePreview(deal) {
  const img = document.getElementById('banner-preview-img');
  const loading = document.getElementById('banner-loading');
  if (img && deal.imageUrl) {
    loading.classList.remove('hidden');
    img.onload = () => loading.classList.add('hidden');
    img.onerror = () => loading.classList.add('hidden');
    img.src = deal.imageUrl;
  }
}

function updateTelegramCaptionPreview(deal) {
  const storeName = deal.store === 'shopee' ? 'SHOPEE' : 'MERCADO LIVRE';
  const curr = deal.currentPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const orig = deal.originalPrice ? deal.originalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;

  let text = `🚨 <b>OFERTA IMPERDÍVEL NA ${storeName}!</b> 🚨\n\n`;
  text += `📦 <b>${deal.title}</b>\n\n`;

  if (orig && deal.discountPercent) {
    text += `❌ De: <s>${orig}</s>\n`;
    text += `🔥 <b>Por: ${curr}</b> (${deal.discountPercent}% de desconto!)\n`;
  } else {
    text += `🔥 <b>Por apenas: ${curr}</b>\n`;
  }

  if (deal.freeShipping) text += `\n🚚 <i>Frete Grátis Disponível</i>`;
  if (deal.couponCode) text += `\n🎟️ <i>Use o Cupom:</i> <code>${deal.couponCode}</code>`;

  text += `\n\n🛒 <b>Compre com Desconto Seguro:</b>\n👉 <a href="${deal.affiliateUrl}">${deal.affiliateUrl}</a>`;

  document.getElementById('tg-caption-preview').innerHTML = text;
}

// ==========================================
// 6. RADAR DE OFERTAS (HUNTER)
// ==========================================
function initHunter() {
  document.getElementById('btn-refresh-hunter').addEventListener('click', () => loadHunterDeals());
  document.getElementById('hunter-category-filter').addEventListener('change', () => {
    document.getElementById('hunter-brand-search-input').value = '';
    loadHunterDeals();
  });

  const searchInput = document.getElementById('hunter-brand-search-input');
  const btnSearch = document.getElementById('btn-search-brand');

  btnSearch.addEventListener('click', () => {
    const query = searchInput.value.trim();
    loadHunterDeals(query);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = searchInput.value.trim();
      loadHunterDeals(query);
    }
  });

  document.getElementById('btn-trigger-autopilot').addEventListener('click', async () => {
    const btn = document.getElementById('btn-trigger-autopilot');
    btn.disabled = true;
    btn.textContent = 'Executando ciclo...';

    try {
      const res = await fetch('/api/autopilot/trigger', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`⚡ ${data.message}`, 'success');
        fetchStatus();
        fetchHistory();
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Erro ao acionar ciclo', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Disparar Ciclo Autônomo';
    }
  });
}

async function loadHunterDeals(customQuery = '') {
  const grid = document.getElementById('hunter-deals-grid');
  const category = document.getElementById('hunter-category-filter').value;
  const searchInput = document.getElementById('hunter-brand-search-input');
  const query = customQuery || searchInput.value.trim();

  const label = query ? `Marca: "${query}"` : getCategoryLabel(category);

  grid.innerHTML = `
    <div class="loading-state" style="grid-column: 1/-1; text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 16px;"></div>
      <p>Varrendo Shopee e Mercado Livre em busca de ofertas (${escapeHtml(label)})...</p>
    </div>
  `;

  try {
    const url = `/api/deals/hunter-preview?category=${encodeURIComponent(category)}&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.success || !data.deals || data.deals.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 40px;">Nenhuma oferta encontrada para ${escapeHtml(label)} no momento.</div>`;
      return;
    }

    grid.innerHTML = '';
    data.deals.forEach(deal => {
      const card = document.createElement('div');
      card.className = 'deal-card';

      const storeClass = deal.store === 'shopee' ? 'shopee' : 'mercadolivre';
      const storeName = deal.store === 'shopee' ? 'SHOPEE' : 'MERCADO LIVRE';
      const curr = deal.currentPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const orig = deal.originalPrice ? deal.originalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';

      card.innerHTML = `
        <div class="deal-card-img-wrap">
          <img src="${deal.imageUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}" alt="${escapeHtml(deal.title)}">
          <span class="deal-store-pill badge ${storeClass}">${storeName}</span>
          ${deal.discountPercent ? `<span class="deal-discount-badge">-${deal.discountPercent}%</span>` : ''}
        </div>
        <div class="deal-card-body">
          <h4 class="deal-card-title" title="${escapeHtml(deal.title)}">${escapeHtml(deal.title)}</h4>
          <div class="deal-card-price-box">
            ${orig ? `<div class="deal-old-price">De: ${orig}</div>` : ''}
            <div class="deal-new-price">Por: ${curr}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-primary btn-small btn-open-studio" style="flex: 1;">
              ✨ Abrir no Studio
            </button>
            <button class="btn-success btn-small btn-quick-publish" style="flex: 1;">
              📢 Postar
            </button>
          </div>
        </div>
      `;

      // Botão 1: Abrir no Studio
      card.querySelector('.btn-open-studio').addEventListener('click', () => {
        openDealInStudio(deal);
      });

      // Botão 2: Publicação Direta Instantânea
      card.querySelector('.btn-quick-publish').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Postando...';

        try {
          const res = await fetch('/api/quick-post/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deal })
          });
          const result = await res.json();
          if (result.success) {
            showToast(`🎉 "${deal.title.substring(0, 30)}..." publicado no Telegram!`, 'success');
            fetchStatus();
            fetchHistory();
          } else {
            showToast(`Erro ao publicar: ${result.error}`, 'error');
          }
        } catch (err) {
          showToast('Erro de conexão ao publicar', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '📢 Postar';
        }
      });

      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--accent-rose);">Erro ao carregar radar de ofertas.</div>`;
  }
}

// ==========================================
// 7. HISTÓRICO DE ENVIOS
// ==========================================
async function fetchHistory() {
  const tbody = document.getElementById('history-table-body');
  try {
    const res = await fetch('/api/deals/recent?limit=30');
    const data = await res.json();

    if (!data.success || !data.deals || data.deals.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color: var(--text-muted); padding: 30px;">Nenhuma promoção publicada ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    data.deals.forEach(item => {
      const tr = document.createElement('tr');
      const storeBadge = item.store === 'shopee' ? '<span class="badge shopee">Shopee</span>' : '<span class="badge mercadolivre">Mercado Livre</span>';
      const orig = item.original_price ? item.original_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';
      const curr = item.current_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const disc = item.discount_percent ? `<span style="color: var(--accent-rose); font-weight: bold;">-${item.discount_percent}%</span>` : '-';
      const date = new Date(item.posted_at).toLocaleString('pt-BR');

      tr.innerHTML = `
        <td><img src="${item.image_url}" class="table-thumb" alt="thumb"></td>
        <td>${storeBadge}</td>
        <td><span class="channel-niche-badge" style="font-size: 0.75rem;">${escapeHtml(item.category || 'Geral')}</span></td>
        <td style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(item.title)}">
          <b>${escapeHtml(item.title)}</b>
        </td>
        <td>${orig}</td>
        <td style="color: var(--accent-emerald); font-weight: bold;">${curr}</td>
        <td>${disc}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${date}</td>
        <td>
          <a href="${item.affiliate_url}" target="_blank" class="btn-secondary btn-small" style="text-decoration: none;">
            Ver Link ↗
          </a>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color: var(--accent-rose);">Erro ao carregar histórico.</td></tr>`;
  }
}

// ==========================================
// 8. CONFIGURAÇÕES
// ==========================================
function initSettings() {
  const toggleBtn = document.getElementById('btn-toggle-token-visibility');
  const tokenInput = document.getElementById('setting-tg-token');
  toggleBtn.addEventListener('click', () => {
    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
  });

  // Testar Conexão Telegram
  document.getElementById('btn-test-telegram').addEventListener('click', async () => {
    const botToken = tokenInput.value.trim();
    const chatId = document.getElementById('setting-tg-chat').value.trim();
    const feedback = document.getElementById('test-tg-feedback');

    feedback.textContent = 'Testando bot...';
    feedback.className = 'feedback-msg';

    try {
      const res = await fetch('/api/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken, chatId })
      });
      const data = await res.json();

      if (data.success) {
        feedback.innerHTML = `✅ Conectado com sucesso ao bot <b>@${data.botName}</b>! Mensagem de teste enviada.`;
        feedback.className = 'feedback-msg success';
        showToast('Bot do Telegram validado com sucesso!', 'success');
      } else {
        feedback.innerHTML = `❌ ${data.error}`;
        feedback.className = 'feedback-msg error';
      }
    } catch (err) {
      feedback.textContent = 'Erro ao se comunicar com a API do bot.';
      feedback.className = 'feedback-msg error';
    }
  });

  // Testar Conexão Gemini IA
  const btnTestGemini = document.getElementById('btn-test-gemini');
  if (btnTestGemini) {
    btnTestGemini.addEventListener('click', async () => {
      const apiKey = document.getElementById('setting-gemini-key').value.trim();
      const feedback = document.getElementById('gemini-test-feedback');
      feedback.textContent = 'Testando conexão com Google Gemini IA...';
      feedback.className = 'feedback-msg';

      try {
        const res = await fetch('/api/test-gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey })
        });
        const data = await res.json();

        if (data.success) {
          feedback.innerHTML = '✅ Conexão com Google Gemini IA estabelecida com sucesso!';
          feedback.className = 'feedback-msg success';
          showToast('Google Gemini IA validado com sucesso!', 'success');
        } else {
          feedback.innerHTML = `❌ ${data.error || 'Erro na chave de API do Gemini'}`;
          feedback.className = 'feedback-msg error';
        }
      } catch (err) {
        feedback.textContent = 'Erro ao se comunicar com o servidor.';
        feedback.className = 'feedback-msg error';
      }
    });
  }

  // Salvar Configurações
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = document.getElementById('save-feedback');
    feedback.textContent = 'Salvando...';

    const rawKeywords = document.getElementById('setting-default-keywords').value.trim();
    const defaultKeywords = rawKeywords ? rawKeywords.split(',').map(k => k.trim()).filter(Boolean) : [];

    const payload = {
      telegramBotToken: tokenInput.value.trim(),
      telegramChatId: document.getElementById('setting-tg-chat').value.trim(),
      mercadolivreAffiliateTag: document.getElementById('setting-ml-tag').value.trim(),
      shopeeAppId: document.getElementById('setting-shopee-appid').value.trim(),
      shopeeSecret: document.getElementById('setting-shopee-secret').value.trim(),
      autopilotEnabled: document.getElementById('setting-autopilot-enabled').checked,
      autopilotIntervalMinutes: parseInt(document.getElementById('setting-autopilot-interval').value, 10),
      minDiscountPercent: parseFloat(document.getElementById('setting-min-discount').value),
      minPrice: parseFloat(document.getElementById('setting-min-price').value),
      deduplicationHours: parseInt(document.getElementById('setting-dedup-hours').value, 10),
      defaultCategory: document.getElementById('setting-default-category').value,
      defaultKeywords,
      appBaseUrl: document.getElementById('setting-app-base-url')?.value.trim() || '',
      peakHoursOnly: document.getElementById('setting-peak-hours-only')?.checked || false,
      peakHoursRanges: document.getElementById('setting-peak-hours-ranges')?.value.trim() || '07:30-09:30,11:45-14:00,18:30-22:30',
      geminiApiKey: document.getElementById('setting-gemini-key')?.value.trim() || '',
      geminiAiEnabled: document.getElementById('setting-gemini-enabled')?.checked || false
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        feedback.textContent = '✅ Configurações salvas com sucesso!';
        showToast('Configurações salvas com sucesso!', 'success');
        fetchStatus();
      }
    } catch (err) {
      feedback.textContent = '❌ Erro ao salvar configurações.';
    }
  });
}

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();

    if (data.success) {
      const s = data.settings;
      if (s.telegramBotToken) document.getElementById('setting-tg-token').value = s.telegramBotToken;
      document.getElementById('setting-tg-chat').value = s.telegramChatId || '';
      document.getElementById('setting-ml-tag').value = s.mercadolivreAffiliateTag || '';
      document.getElementById('setting-shopee-appid').value = s.shopeeAppId || '';
      document.getElementById('setting-shopee-secret').value = s.shopeeSecret || '';
      document.getElementById('setting-autopilot-enabled').checked = s.autopilotEnabled;
      document.getElementById('setting-autopilot-interval').value = s.autopilotIntervalMinutes || 20;
      document.getElementById('setting-min-discount').value = s.minDiscountPercent || 20;
      document.getElementById('setting-min-price').value = s.minPrice || 15;
      document.getElementById('setting-dedup-hours').value = s.deduplicationHours || 72;
      if (s.defaultCategory) document.getElementById('setting-default-category').value = s.defaultCategory;
      if (s.defaultKeywords && Array.isArray(s.defaultKeywords)) {
        document.getElementById('setting-default-keywords').value = s.defaultKeywords.join(', ');
      }
      if (document.getElementById('setting-app-base-url')) {
        document.getElementById('setting-app-base-url').value = s.appBaseUrl || '';
      }
      if (document.getElementById('setting-peak-hours-only')) {
        document.getElementById('setting-peak-hours-only').checked = !!s.peakHoursOnly;
      }
      if (document.getElementById('setting-peak-hours-ranges')) {
        document.getElementById('setting-peak-hours-ranges').value = s.peakHoursRanges || '07:30-09:30,11:45-14:00,18:30-22:30';
      }
      if (document.getElementById('setting-gemini-key') && s.geminiApiKey) {
        document.getElementById('setting-gemini-key').value = s.geminiApiKey;
      }
      if (document.getElementById('setting-gemini-enabled')) {
        document.getElementById('setting-gemini-enabled').checked = s.geminiAiEnabled !== false;
      }
    }
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

// ==========================================
// 9. LOGS DO SISTEMA
// ==========================================
function initLogs() {
  document.getElementById('btn-refresh-logs').addEventListener('click', fetchLogs);
}

async function fetchLogs() {
  const terminal = document.getElementById('terminal-logs');
  try {
    const res = await fetch('/api/logs?limit=80');
    const data = await res.json();

    if (data.success && data.logs) {
      terminal.innerHTML = '';
      if (data.logs.length === 0) {
        terminal.innerHTML = '<div class="log-line info">[Nenhum log registrado ainda]</div>';
        return;
      }

      data.logs.forEach(log => {
        const line = document.createElement('div');
        line.className = `log-line ${log.level}`;
        const time = new Date(log.timestamp).toLocaleTimeString('pt-BR');
        const detailStr = log.details ? ` - <small style="opacity: 0.8">${escapeHtml(log.details)}</small>` : '';
        line.innerHTML = `[${time}] [${log.level.toUpperCase()}] ${escapeHtml(log.message)}${detailStr}`;
        terminal.appendChild(line);
      });

      terminal.scrollTop = terminal.scrollHeight;
    }
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
}

// ==========================================
// 10. TOAST UTILITY
// ==========================================
let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
