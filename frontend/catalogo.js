(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);

  const state = {
    products: [],
    favorites: [],
    category: "Todas",

    currentProduct: null,
    selectedColor: "",
    selectedSize: "",
    activeMedia: 0,
    previousFocus: null,

    toastTimer: null,

    catalogUrls: [],
    modalUrls: [],
    heroUrls: [],

    loading: true
  };

  /* ========================================
     UTILITÁRIOS
  ======================================== */

  function escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character])
    );
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function hasPrice(product) {
    return (
      typeof product.price === "number" &&
      Number.isFinite(product.price) &&
      product.price >= 0
    );
  }

  function priceText(product) {
    if (!hasPrice(product)) {
      return "Consulte o valor";
    }

    return product.price.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  function notify(message) {
    const toast = $("#toast");

    if (!toast) return;

    clearTimeout(state.toastTimer);

    toast.textContent = message;
    toast.hidden = false;

    state.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 4500);
  }

  function heartIcon(filled = false) {
    return `
      <svg
        class="icon"
        viewBox="0 0 24 24"
        fill="${filled ? "currentColor" : "none"}"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path
          d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
        ></path>
      </svg>
    `;
  }

  function colorStyle(color) {
    const value = COLORS[color];

    return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(
      value || ""
    )
      ? value
      : "#dddddd";
  }

  function releaseUrls(list) {
    for (const url of list) {
      URL.revokeObjectURL(url);
    }

    list.length = 0;
  }

  function urlList(scope) {
    if (scope === "modal") return state.modalUrls;
    if (scope === "hero") return state.heroUrls;

    return state.catalogUrls;
  }

  function mediaUrl(media, scope = "catalog") {
    if (media instanceof Blob) {
      const url = URL.createObjectURL(media);

      urlList(scope).push(url);

      return url;
    }

    if (typeof media !== "string" || !media.trim()) {
      return "";
    }

    try {
      const url = new URL(media.trim(), document.baseURI);

      if (["http:", "https:", "file:"].includes(url.protocol)) {
        return url.href;
      }
    } catch (error) {
      console.warn("Caminho de mídia inválido:", media);
    }

    return "";
  }

  function placeholder(name = "Burguesa Crochê") {
    return `
      <svg
        viewBox="0 0 300 350"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Foto indisponível: ${escapeHTML(name)}"
      >
        <rect
          width="300"
          height="350"
          fill="#f3eee4"
        ></rect>

        <circle
          cx="150"
          cy="145"
          r="70"
          fill="#f9db5c"
          opacity=".65"
        ></circle>

        <path
          d="M105 162l28-30 22 22 16-16 26 28"
          fill="none"
          stroke="#6b604e"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path>

        <circle
          cx="174"
          cy="121"
          r="7"
          fill="#6b604e"
        ></circle>

        <text
          x="150"
          y="253"
          text-anchor="middle"
          font-family="Georgia, serif"
          font-size="24"
          fill="#252525"
        >
          burguesa
        </text>

        <text
          x="150"
          y="279"
          text-anchor="middle"
          font-family="Arial, sans-serif"
          font-size="10"
          letter-spacing="2"
          fill="#666666"
        >
          FOTO EM BREVE
        </text>
      </svg>
    `;
  }

  function imageMarkup(product, media, scope = "catalog", index = 0) {
    const url = mediaUrl(media, scope);

    if (!url) {
      return placeholder(product.name);
    }

    return `
      <img
        src="${escapeHTML(url)}"
        alt="${escapeHTML(product.name)} — foto ${index + 1}"
        loading="${scope === "catalog" ? "lazy" : "eager"}"
        decoding="async"
        data-product-image
      >
    `;
  }

  function handleMediaError(event) {
    const element = event.target;

    if (
      element instanceof HTMLImageElement &&
      element.hasAttribute("data-product-image")
    ) {
      element.outerHTML = placeholder(
        element.alt || "Peça da Burguesa Crochê"
      );

      return;
    }

    if (
      element instanceof HTMLVideoElement &&
      element.hasAttribute("data-product-video")
    ) {
      const message = document.createElement("p");

      message.className = "small";
      message.style.padding = "20px";
      message.textContent =
        "Não foi possível carregar este vídeo. Consulte a atendente.";

      element.replaceWith(message);
    }
  }

  function prepareProduct(product) {
    return {
      ...product,

      views: product.views || 0,

      colors: Array.isArray(product.colors)
        ? product.colors
        : [],

      sizes: Array.isArray(product.sizes)
        ? product.sizes
        : [],

      photos: Array.isArray(product.photos)
        ? product.photos
        : [],

      ready: Array.isArray(product.ready)
        ? product.ready
        : [],

      availability: product.availability || "consult",

      modelMeasurements: product.modelMeasurements || {}
    };
  }

  /* ========================================
     ATENDIMENTO E CONTATOS
  ======================================== */

  function contact(message) {
    const phone = String(CONFIG.whatsapp || "")
      .replace(/\D/g, "");

    if (!/^\d{12,13}$/.test(phone)) {
      notify("O WhatsApp da loja ainda não foi configurado.");
      return;
    }

    // --- INTEGRAÇÃO GOOGLE ANALYTICS (GA4) ---
    if (typeof gtag !== "undefined") {
      gtag("event", "clique_whatsapp", {
        "nome_peca": state.currentProduct ? state.currentProduct.name : "Contato Geral"
      });
    }

    const text =
      message ||
      CONFIG.defaultMessage ||
      "Olá! Gostaria de conhecer as peças da Burguesa Crochê.";

    const url =
      `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function setupContacts() {
    const phone = String(CONFIG.whatsapp || "")
      .replace(/\D/g, "");

    const instagram = String(CONFIG.instagram || "")
      .replace(/^@/, "")
      .trim();

    const email = String(CONFIG.email || "").trim();

    const whatsappLink = $("#footerWhatsapp");
    const instagramLink = $("#footerInstagram");
    const emailLink = $("#footerEmail");

    if (whatsappLink) {
      whatsappLink.href = `https://wa.me/${phone}`;

      whatsappLink.addEventListener("click", event => {
        event.preventDefault();
        contact();
      });
    }

    if (instagramLink) {
      if (instagram) {
        instagramLink.hidden = false;
        instagramLink.textContent = `@${instagram}`;
        instagramLink.href =
          `https://www.instagram.com/${encodeURIComponent(instagram)}/`;

        instagramLink.target = "_blank";
        instagramLink.rel = "noopener noreferrer";
      } else {
        instagramLink.hidden = true;
      }
    }

    if (emailLink) {
      if (email) {
        emailLink.hidden = false;
        emailLink.textContent = email;
        emailLink.href = `mailto:${email}`;
      } else {
        emailLink.hidden = true;
      }
    }
  }

  /* ========================================
     FAVORITOS
  ======================================== */

  function loadFavorites() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(CONFIG.storage.favorites) || "[]"
      );

      state.favorites = Array.isArray(saved)
        ? [
            ...new Set(
              saved.filter(id =>
                Number.isSafeInteger(id) && id > 0
              )
            )
          ]
        : [];
    } catch (error) {
      state.favorites = [];
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(
        CONFIG.storage.favorites,
        JSON.stringify(state.favorites)
      );

      return true;
    } catch (error) {
      return false;
    }
  }

  function toggleFavorite(id) {
    const productExists = state.products.some(product =>
      product.id === id
    );

    if (!productExists) return;

    const alreadySaved = state.favorites.includes(id);

    state.favorites = alreadySaved
      ? state.favorites.filter(item => item !== id)
      : [...state.favorites, id];

    const persisted = saveFavorites();

    renderLists();
    updateModalFavorite();

    if (!persisted) {
      notify(
        "Favorito atualizado nesta sessão, mas não foi possível salvá-lo no navegador."
      );

      return;
    }

    notify(
      alreadySaved
        ? "Peça removida dos favoritos."
        : "Peça salva nos favoritos."
    );
  }

  function shareFavorites() {
    const selected = state.products.filter(product =>
      state.favorites.includes(product.id)
    );

    if (!selected.length) {
      notify("Escolha pelo menos uma peça para consultar.");
      return;
    }

    const list = selected
      .map(product =>
        `• ${product.name} — ${priceText(product)}`
      )
      .join("\n");

    contact(
      "Olá! Vim pelo catálogo da Burguesa Crochê " +
      "e gostei destas peças:\n\n" +
      list +
      "\n\nPode me ajudar com cores, tamanhos, " +
      "disponibilidade e envio?"
    );
  }

  /* ========================================
     DISPONIBILIDADE
  ======================================== */

  function combinationStatus(product, color, size) {
    const combination = `${color}|${size}`;

    if (
      color &&
      size &&
      product.ready.includes(combination)
    ) {
      return "ready";
    }

    if (product.availability === "ready") {
      return "ready";
    }

    if (product.availability === "order") {
      return "order";
    }

    return "consult";
  }

  function availabilityTag(product) {
    if (product.availability === "ready") {
      return {
        text: "Pronta entrega",
        ready: true
      };
    }

    if (product.ready.length > 0) {
      return {
        text: "Pronta entrega*",
        ready: true
      };
    }

    if (product.availability === "order") {
      return {
        text: "Sob encomenda",
        ready: false
      };
    }

    return {
      text: "Consulte disponibilidade",
      ready: false
    };
  }

  function matchesAvailability(product, filter, color, size) {
    if (!filter) return true;

    const colors = color
      ? [color]
      : product.colors.length
        ? product.colors
        : [""];

    const sizes = size
      ? [size]
      : product.sizes.length
        ? product.sizes
        : [""];

    return colors.some(currentColor =>
      sizes.some(currentSize =>
        combinationStatus(
          product,
          currentColor,
          currentSize
        ) === filter
      )
    );
  }

  /* ========================================
     CATEGORIAS
  ======================================== */

  function allCategories() {
    return [
      ...new Set([
        "Todas",
        ...CATEGORIES,
        ...state.products.map(product => product.category)
      ])
    ].filter(Boolean);
  }

  function renderCategories() {
    const categories = allCategories();

    $("#categories").innerHTML = categories
      .map(category => `
        <button
          class="category ${
            state.category === category ? "active" : ""
          }"
          type="button"
          data-category="${escapeHTML(category)}"
          aria-pressed="${state.category === category}"
        >
          ${escapeHTML(category)}
        </button>
      `)
      .join("");

    $("#mobileNav").innerHTML = categories
      .map(category => `
        <a
          href="#catalogo"
          data-category="${escapeHTML(category)}"
        >
          ${escapeHTML(
            category === "Todas"
              ? "Todas as peças"
              : category
          )}
        </a>
      `)
      .join("") + `
        <a href="#sobre">Sobre a marca</a>
        <a href="#contato">Contato</a>
      `;

    const desktopNav = $(".desktop-nav");

    if (desktopNav) {
      desktopNav.innerHTML = categories
        .filter(category => category !== "Todas")
        .map(category => `
          <a
            href="#catalogo"
            data-category="${escapeHTML(category)}"
          >
            ${escapeHTML(category)}
          </a>
        `)
        .join("");
    }
  }

  /* ========================================
     FILTROS E ORDENAÇÃO
  ======================================== */

  function populateFilters() {
    const colors = [
      ...new Set(
        state.products.flatMap(product => product.colors)
      )
    ].sort((a, b) => a.localeCompare(b, "pt-BR"));

    const sizes = [
      ...new Set([
        "PP",
        "P",
        "M",
        "G",
        "GG",
        "Único",
        ...state.products.flatMap(product => product.sizes)
      ])
    ];

    $("#colorFilter").innerHTML = `
      <option value="">Todas as cores</option>

      ${colors.map(color => `
        <option value="${escapeHTML(color)}">
          ${escapeHTML(color)}
        </option>
      `).join("")}
    `;

    $("#sizeFilter").innerHTML = `
      <option value="">Todos os tamanhos</option>

      ${sizes.map(size => `
        <option value="${escapeHTML(size)}">
          ${escapeHTML(size)}
        </option>
      `).join("")}
    `;

    $("#availabilityFilter").innerHTML = `
      <option value="">Todas</option>
      <option value="ready">Pronta entrega</option>
      <option value="order">Sob encomenda</option>
      <option value="consult">A confirmar</option>
    `;
  }

  function filteredProducts() {
    const search = normalize(
      $("#searchInput").value.trim()
    );

    const color = $("#colorFilter").value;
    const size = $("#sizeFilter").value;
    const availability = $("#availabilityFilter").value;
    const sort = $("#sortFilter").value;

    const filtered = state.products.filter(product => {
      if (
        state.category !== "Todas" &&
        product.category !== state.category
      ) {
        return false;
      }

      const searchable = normalize(
        `${product.name} ` +
        `${product.category} ` +
        `${product.description || ""}`
      );

      if (search && !searchable.includes(search)) {
        return false;
      }

      if (
        color &&
        !product.colors.includes(color)
      ) {
        return false;
      }

      if (
        size &&
        !product.sizes.includes(size)
      ) {
        return false;
      }

      return matchesAvailability(
        product,
        availability,
        color,
        size
      );
    });

    if (sort === "name") {
      filtered.sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR")
      );

      return filtered;
    }

    if (sort === "low" || sort === "high") {
      filtered.sort((a, b) => {
        if (!hasPrice(a) && !hasPrice(b)) return 0;
        if (!hasPrice(a)) return 1;
        if (!hasPrice(b)) return -1;

        return sort === "low"
          ? a.price - b.price
          : b.price - a.price;
      });

      return filtered;
    }

    filtered.sort((a, b) => b.id - a.id);

    return filtered;
  }

  /* ========================================
     CARDS DAS PEÇAS
  ======================================== */

  function productCard(product) {
    const saved = state.favorites.includes(product.id);
    const tag = availabilityTag(product);

    const colorsLabel = product.colors.length
      ? `Cores: ${product.colors.join(", ")}`
      : "Cores a consultar";

    const colorMarkup = product.colors.length
      ? product.colors.map(color => `
          <span
            class="swatch"
            style="background:${colorStyle(color)}"
            title="${escapeHTML(color)}"
          ></span>
        `).join("")
      : `
        <span class="sizes">
          Cores a consultar
        </span>
      `;

    const sizesText = product.sizes.length
      ? product.sizes.join(" · ")
      : "Tamanhos a consultar";

    return `
      <article class="product-card">
        <div class="product-media">
          <button
            class="product-open"
            type="button"
            data-open="${product.id}"
            aria-label="Ver detalhes: ${escapeHTML(product.name)}"
          >
            ${imageMarkup(
              product,
              product.photos[0],
              "catalog"
            )}
          </button>

          <span class="tag ${tag.ready ? "ready" : ""}">
            ${escapeHTML(tag.text)}
          </span>

          <button
            class="favorite-button ${saved ? "selected" : ""}"
            type="button"
            data-favorite="${product.id}"
            aria-label="${
              saved ? "Remover dos" : "Adicionar aos"
            } favoritos: ${escapeHTML(product.name)}"
            aria-pressed="${saved}"
          >
            ${heartIcon(saved)}
          </button>
        </div>

        <button
          class="product-title"
          type="button"
          data-open="${product.id}"
        >
          ${escapeHTML(product.name)}
        </button>

        <p class="price">
          ${escapeHTML(priceText(product))}
        </p>

        <div class="card-meta">
          <div
            class="swatches"
            aria-label="${escapeHTML(colorsLabel)}"
          >
            ${colorMarkup}
          </div>

          <span class="sizes">
            ${escapeHTML(sizesText)}
          </span>
        </div>
      </article>
    `;
  }

  function renderLists() {
    const products = filteredProducts();

    const favorites = state.products.filter(product =>
      state.favorites.includes(product.id)
    );

    $("#productGrid").replaceChildren();
    $("#favoritesGrid").replaceChildren();

    releaseUrls(state.catalogUrls);

    $("#resultCount").textContent =
      `${products.length} ` +
      `${products.length === 1 ? "peça" : "peças"}`;

    if (state.loading) {
      $("#productGrid").innerHTML = `
        <div class="empty">
          Carregando as peças...
        </div>
      `;
    } else {
      $("#productGrid").innerHTML = products.length
        ? products.map(productCard).join("")
        : `
          <div class="empty">
            Nenhuma peça encontrada.<br>
            Experimente outra combinação de filtros.
          </div>
        `;
    }

    $("#favoritesGrid").innerHTML = favorites.length
      ? favorites.map(productCard).join("")
      : `
        <div class="empty">
          Sua seleção começa com um coração ♡
          <br>
          Toque no coração de uma peça para salvá-la aqui.
        </div>
      `;

    $("#favoriteCount").textContent = favorites.length;

    $("#shareFavorites").disabled =
      state.loading || favorites.length === 0;
  }

  /* ========================================
     IMAGEM PRINCIPAL DO SITE
  ======================================== */

  function renderHero() {
    $("#heroArt").replaceChildren();

    releaseUrls(state.heroUrls);

    const product =
      state.products.find(item =>
        item.category === "Conjunto" &&
        item.photos.length > 0
      ) ||
      state.products.find(item =>
        item.photos.length > 0
      );

    if (!product) {
      $("#heroArt").innerHTML = placeholder();
      return;
    }

    $("#heroArt").innerHTML = imageMarkup(
      product,
      product.photos[0],
      "hero"
    );
  }

  /* ========================================
     INFORMAÇÕES DA PEÇA
  ======================================== */

  function modelMeasurementsText(product) {
    const model = product.modelMeasurements || {};

    const values = [
      ["Altura", model.height],
      ["Busto", model.bust],
      ["Cintura", model.waist],
      ["Quadril", model.hips]
    ]
      .filter(([, value]) =>
        String(value || "").trim()
      )
      .map(([label, value]) =>
        `${label}: ${value}`
      );

    return values.length
      ? values.join(" | ")
      : "Medidas da modelo não informadas.";
  }

  function detailsSection(title, content, open = false) {
    return `
      <details ${open ? "open" : ""}>
        <summary>
          ${escapeHTML(title)}
        </summary>

        <p>${escapeHTML(content)}</p>
      </details>
    `;
  }

  function productMessage() {
    const product = state.currentProduct;

    if (!product) return "";

    const lines = [
      "Olá! Vim pelo catálogo da Burguesa Crochê.",
      "",
      `Tenho interesse na peça: ${product.name}.`
    ];

    if (hasPrice(product)) {
      lines.push(
        `Valor anunciado: ${priceText(product)}.`
      );
    }

    if (state.selectedColor) {
      lines.push(`Cor: ${state.selectedColor}.`);
    }

    if (state.selectedSize) {
      lines.push(`Tamanho: ${state.selectedSize}.`);
    }

    lines.push(
      "",
      "Gostaria de confirmar as opções, " +
      "as medidas e a disponibilidade."
    );

    return lines.join("\n");
  }

  function requiredOptionsSelected() {
    const product = state.currentProduct;

    if (!product) return false;

    if (
      product.colors.length > 0 &&
      !state.selectedColor
    ) {
      notify("Selecione uma cor antes de continuar.");
      return false;
    }

    if (
      product.sizes.length > 0 &&
      !state.selectedSize
    ) {
      notify("Selecione um tamanho antes de continuar.");
      return false;
    }

    return true;
  }

  /* ========================================
     ABRIR DETALHES
  ======================================== */

  function openProduct(id) {
    const product = state.products.find(item =>
      item.id === id
    );

    if (!product) return;

    // --- INCREMENTA VISUALIZAÇÕES PARA O TOP 5 DO ADMIN ---
    product.views = (product.views || 0) + 1;
    if (typeof ProdutosService !== "undefined" && ProdutosService.salvarProduto) {
      ProdutosService.salvarProduto(product).catch(() => {});
    }

    // --- DISPARA EVENTO NO GOOGLE ANALYTICS (GA4) ---
    if (typeof gtag !== "undefined") {
      gtag("event", "ver_produto", {
        "nome_peca": product.name,
        "categoria": product.category,
        "preco": product.price || 0
      });
    }

    state.previousFocus = document.activeElement;
    state.currentProduct = product;
    state.selectedColor = "";
    state.selectedSize = "";
    state.activeMedia = 0;

    releaseUrls(state.modalUrls);

    const couponText = CONFIG.firstPurchaseCoupon
      ? (
          "Atendimento exclusivo e cupom de " +
          `${CONFIG.firstPurchaseCoupon} na primeira compra. ` +
          "Consulte as condições com a atendente."
        )
      : (
          "Converse com a atendente para combinar " +
          "os detalhes do seu pedido."
        );

    $("#modalContent").innerHTML = `
      <div class="detail-grid">
        <div>
          <div
            class="detail-main"
            id="detailMedia"
          ></div>

          <div
            class="thumbnails"
            id="thumbnails"
          ></div>

          <p class="small">
            Confira as fotos e confirme os detalhes no atendimento.
          </p>
        </div>

        <div>
          <span class="eyebrow">
            ${escapeHTML(product.category)}
            · Burguesa Crochê
          </span>

          <h2
            class="detail-title"
            id="detailTitle"
          >
            ${escapeHTML(product.name)}
          </h2>

          <p class="detail-price">
            ${escapeHTML(priceText(product))}
          </p>

          <p class="detail-description">
            ${escapeHTML(
              product.description ||
              "Consulte os detalhes desta peça com a atendente."
            )}
          </p>

          <p class="option-title">
            Cor:
            <span id="selectedColorLabel"></span>
          </p>

          <div
            class="options"
            id="colorOptions"
            role="group"
            aria-label="Escolher cor"
          ></div>

          <p class="option-title">
            Tamanho:
            <span id="selectedSizeLabel"></span>
          </p>

          <div
            class="options"
            id="sizeOptions"
            role="group"
            aria-label="Escolher tamanho"
          ></div>

          <div
            class="availability"
            id="availabilityText"
            aria-live="polite"
          ></div>

          <div class="contact-box">
            <h3>Compre direto com a atendente</h3>

            <p>${escapeHTML(couponText)}</p>

            <button
              class="button full"
              id="productContact"
              type="button"
            >
              Falar com a atendente ↗
            </button>
          </div>

          <div class="detail-actions">
            <button
              class="button button-outline full"
              id="modalFavorite"
              type="button"
            ></button>
          </div>

          <div class="shipping">
            <h3>
              Consulte o envio para seu endereço
            </h3>

            <form
              class="shipping-form"
              id="shippingForm"
            >
              <input
                id="shippingCep"
                type="text"
                inputmode="numeric"
                autocomplete="postal-code"
                maxlength="9"
                placeholder="Digite seu CEP"
                aria-label="CEP de destino"
                required
              >

              <button
                class="button"
                type="submit"
              >
                Consultar
              </button>
            </form>

            <div
              class="shipping-output"
              id="shippingOutput"
              aria-live="polite"
            ></div>
          </div>

          ${detailsSection(
            "Descrição",
            product.description ||
            "Descrição não informada.",
            true
          )}

          ${detailsSection(
            "Características · material e composição",
            product.material ||
            "Consulte o material e a composição com a atendente."
          )}

          ${detailsSection(
            "Na foto",
            product.fit ||
            "Consulte a cor e o tamanho apresentados nas fotos."
          )}

          ${detailsSection(
            "Medidas da modelo",
            modelMeasurementsText(product)
          )}

          ${detailsSection(
            "Medidas da peça",
            product.measurements ||
            "Consulte as medidas desta peça com a atendente."
          )}

          ${detailsSection(
            "Cuidados com a peça",
            product.care ||
            "Solicite as orientações de cuidado específicas desta peça."
          )}
        </div>
      </div>
    `;

    renderMedia();
    renderOptions();
    updateModalFavorite();
    resetShipping();

    $("#productModal").hidden = false;
    $("#productModal").scrollTop = 0;

    document.body.classList.add("modal-open");

    $("#closeModal").focus();

    $("#productContact").addEventListener("click", () => {
      if (!requiredOptionsSelected()) return;

      contact(productMessage());
    });

    $("#modalFavorite").addEventListener("click", () => {
      toggleFavorite(product.id);
    });

    $("#shippingCep").addEventListener("input", event => {
      const numbers = event.target.value
        .replace(/\D/g, "")
        .slice(0, 8);

      event.target.value = numbers.length > 5
        ? `${numbers.slice(0, 5)}-${numbers.slice(5)}`
        : numbers;

      resetShipping();
    });

    $("#shippingForm").addEventListener(
      "submit",
      prepareShipping
    );
  }

  /* ========================================
     FECHAR DETALHES
  ======================================== */

  function closeProduct() {
    if (!state.currentProduct) return;

    const focusTarget = state.previousFocus;
    const productId = state.currentProduct.id;

    $("#productModal").hidden = true;
    $("#modalContent").replaceChildren();

    releaseUrls(state.modalUrls);

    document.body.classList.remove("modal-open");

    state.currentProduct = null;
    state.previousFocus = null;

    if (focusTarget?.isConnected) {
      focusTarget.focus();
      return;
    }

    const replacement = document.querySelector(
      `[data-open="${productId}"]`
    );

    (replacement || $("#searchButton")).focus();
  }

  /* ========================================
     GALERIA DE FOTOS E VÍDEO
  ======================================== */

  function mediaItems() {
    const product = state.currentProduct;

    if (!product) return [];

    const items = product.photos.length
      ? product.photos.map((source, index) => ({
          type: "image",
          source,
          index
        }))
      : [
          {
            type: "image",
            source: "",
            index: 0
          }
        ];

    if (product.video) {
      items.push({
        type: "video",
        source: product.video
      });
    }

    return items;
  }

  function renderMedia() {
    const product = state.currentProduct;

    if (!product) return;

    const items = mediaItems();
    const active = items[state.activeMedia] || items[0];

    $("#detailMedia").replaceChildren();
    $("#thumbnails").replaceChildren();

    releaseUrls(state.modalUrls);

    if (active.type === "video") {
      const url = mediaUrl(active.source, "modal");

      $("#detailMedia").innerHTML = url
        ? `
          <video
            controls
            playsinline
            preload="metadata"
            src="${escapeHTML(url)}"
            aria-label="Vídeo de ${escapeHTML(product.name)}"
            data-product-video
          ></video>
        `
        : placeholder(product.name);
    } else {
      $("#detailMedia").innerHTML = imageMarkup(
        product,
        active.source,
        "modal",
        active.index
      );
    }

    $("#thumbnails").innerHTML = items
      .map((item, index) => `
        <button
          class="thumbnail ${
            state.activeMedia === index ? "active" : ""
          }"
          type="button"
          data-media="${index}"
          aria-label="${
            item.type === "video"
              ? "Ver vídeo"
              : `Ver foto ${index + 1}`
          }"
          aria-pressed="${state.activeMedia === index}"
        >
          ${
            item.type === "video"
              ? "▶ Vídeo"
              : imageMarkup(
                  product,
                  item.source,
                  "modal",
                  item.index
                )
          }
        </button>
      `)
      .join("");

    $("#thumbnails")
      .querySelectorAll("[data-media]")
      .forEach(button => {
        button.addEventListener("click", () => {
          state.activeMedia = Number(button.dataset.media);

          renderMedia();

          const activeButton = $("#thumbnails").querySelector(
            `[data-media="${state.activeMedia}"]`
          );

          activeButton?.focus();
        });
      });
  }

  /* ========================================
     CORES E TAMANHOS
  ======================================== */

  function renderOptions() {
    const product = state.currentProduct;

    if (!product) return;

    $("#selectedColorLabel").textContent =
      product.colors.length
        ? state.selectedColor || "selecione"
        : "consulte no atendimento";

    $("#selectedSizeLabel").textContent =
      product.sizes.length
        ? state.selectedSize || "selecione"
        : "consulte no atendimento";

    $("#colorOptions").innerHTML = product.colors
      .map(color => `
        <button
          class="option ${
            state.selectedColor === color ? "selected" : ""
          }"
          type="button"
          data-color="${escapeHTML(color)}"
          aria-pressed="${state.selectedColor === color}"
        >
          <span
            class="swatch"
            style="background:${colorStyle(color)}"
          ></span>

          ${escapeHTML(color)}
        </button>
      `)
      .join("");

    $("#sizeOptions").innerHTML = product.sizes
      .map(size => `
        <button
          class="option ${
            state.selectedSize === size ? "selected" : ""
          }"
          type="button"
          data-size="${escapeHTML(size)}"
          aria-pressed="${state.selectedSize === size}"
        >
          ${escapeHTML(size)}
        </button>
      `)
      .join("");

    $("#colorOptions")
      .querySelectorAll("[data-color]")
      .forEach(button => {
        button.addEventListener("click", () => {
          state.selectedColor = button.dataset.color;

          renderOptions();
          resetShipping();

          const replacement = [
            ...$("#colorOptions").children
          ].find(item =>
            item.dataset.color === state.selectedColor
          );

          replacement?.focus();
        });
      });

    $("#sizeOptions")
      .querySelectorAll("[data-size]")
      .forEach(button => {
        button.addEventListener("click", () => {
          state.selectedSize = button.dataset.size;

          renderOptions();
          resetShipping();

          const replacement = [
            ...$("#sizeOptions").children
          ].find(item =>
            item.dataset.size === state.selectedSize
          );

          replacement?.focus();
        });
      });

    updateAvailability();
  }

  function updateAvailability() {
    const product = state.currentProduct;

    if (!product) return;

    const pendingColor =
      product.colors.length > 0 &&
      !state.selectedColor;

    const pendingSize =
      product.sizes.length > 0 &&
      !state.selectedSize;

    if (pendingColor || pendingSize) {
      $("#availabilityText").textContent =
        "Selecione as opções para consultar a " +
        "disponibilidade da combinação.";

      return;
    }

    const status = combinationStatus(
      product,
      state.selectedColor,
      state.selectedSize
    );

    if (status === "ready") {
      $("#availabilityText").textContent =
        "● Pronta entrega informada. " +
        "Confirme a disponibilidade com a atendente.";

      return;
    }

    if (status === "order") {
      const production =
        product.productionTime ||
        CONFIG.productionTime;

      $("#availabilityText").textContent = production
        ? (
            `○ Sob encomenda. Produção: ${production}. ` +
            "O prazo de transporte é separado. " +
            "Confirme no atendimento."
          )
        : (
            "○ Sob encomenda. Consulte o prazo de produção. " +
            "O prazo de transporte é separado."
          );

      return;
    }

    $("#availabilityText").textContent =
      "Disponibilidade a confirmar com a atendente.";
  }

  function updateModalFavorite() {
    if (!state.currentProduct) return;

    const button = $("#modalFavorite");

    if (!button) return;

    const saved = state.favorites.includes(
      state.currentProduct.id
    );

    button.innerHTML = `
      ${heartIcon(saved)}
      ${
        saved
          ? "Remover dos favoritos"
          : "Salvar nos favoritos"
      }
    `;

    button.setAttribute(
      "aria-pressed",
      String(saved)
    );
  }

  /* ========================================
     CONSULTA DE ENVIO
  ======================================== */

  function resetShipping() {
    const output = $("#shippingOutput");

    if (!output) return;

    output.innerHTML = `
      <span class="demo-badge">
        CONSULTA PELO ATENDIMENTO
      </span>

      <br>

      Informe o CEP para preparar uma mensagem à atendente.
      Esta versão não calcula frete nem valida o endereço.
    `;
  }

  function prepareShipping(event) {
    event.preventDefault();

    const cep = $("#shippingCep").value
      .replace(/\D/g, "");

    const output = $("#shippingOutput");

    if (!/^\d{8}$/.test(cep)) {
      output.textContent =
        "Digite um CEP com 8 números.";

      return;

    }

    if (!requiredOptionsSelected()) return;

    const formatted =
      `${cep.slice(0, 5)}-${cep.slice(5)}`;

    output.innerHTML = `
      <span class="demo-badge">
        SEM COTAÇÃO AUTOMÁTICA
      </span>

      <br>

      CEP informado: ${formatted}.

      <br>

      A existência do CEP não foi verificada.
      Solicite o valor e o prazo de envio à atendente.

      <button
        class="button button-outline full"
        id="requestShipping"
        type="button"
      >
        Consultar envio pelo WhatsApp ↗
      </button>
    `;

    $("#requestShipping").addEventListener("click", () => {
      contact(
        productMessage() +
        "\n\n" +
        `Meu CEP de destino é ${formatted}.\n` +
        "Pode informar o valor do frete, o prazo de envio " +
        "e, se necessário, o prazo de produção?"
      );
    });
  }

  /* ========================================
     MENU MOBILE
  ======================================== */

  function closeMobileMenu() {
    $("#mobileNav").hidden = true;

    $("#menuButton").setAttribute(
      "aria-expanded",
      "false"
    );

    $("#menuButton").setAttribute(
      "aria-label",
      "Abrir menu"
    );
  }

  function toggleMobileMenu() {
    const opening = $("#mobileNav").hidden;

    $("#mobileNav").hidden = !opening;

    $("#menuButton").setAttribute(
      "aria-expanded",
      String(opening)
    );

    $("#menuButton").setAttribute(
      "aria-label",
      opening ? "Fechar menu" : "Abrir menu"
    );
  }

  /* ========================================
     FOCO E ACESSIBILIDADE DA JANELA
  ======================================== */

  function trapModalFocus(event) {
    if (event.key !== "Tab") return;

    const selectors = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "summary",
      "video[controls]",
      '[tabindex="0"]'
    ].join(", ");

    const focusable = [
      ...$("#productModal").querySelectorAll(selectors)
    ].filter(element =>
      element.getClientRects().length > 0
    );

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first || !last) return;

    if (
      event.shiftKey &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last.focus();

      return;
    }

    if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();

      return;
    }

    if (
      !$("#productModal").contains(document.activeElement)
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  function restoreFavoriteFocus(id, originSection) {
    const buttons = [
      ...document.querySelectorAll(
        `[data-favorite="${id}"]`
      )
    ];

    const replacement = buttons.find(button =>
      button.closest(originSection)
    );

    const fallback =
      buttons[0] ||
      (
        !$("#shareFavorites").disabled
          ? $("#shareFavorites")
          : $("#searchButton")
      );

    (replacement || fallback)?.focus();
  }

  /* ========================================
     EVENTOS
  ======================================== */

  function bindEvents() {
    document.addEventListener(
      "error",
      handleMediaError,
      true
    );

    document.addEventListener("click", event => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const categoryButton =
        event.target.closest("[data-category]");

      const openButton =
        event.target.closest("[data-open]");

      const favoriteButton =
        event.target.closest("[data-favorite]");

      const contactButton =
        event.target.closest("[data-contact]");

      if (categoryButton) {
        const fromCategoryTabs = Boolean(
          categoryButton.closest("#categories")
        );

        state.category =
          categoryButton.dataset.category;

        renderCategories();
        renderLists();
        closeMobileMenu();

        if (fromCategoryTabs) {
          const replacement = [
            ...$("#categories").querySelectorAll(
              "[data-category]"
            )
          ].find(button =>
            button.dataset.category === state.category
          );

          replacement?.focus();
        }
      }

      if (openButton) {
        openProduct(
          Number(openButton.dataset.open)
        );
      }

      if (favoriteButton) {
        const id = Number(
          favoriteButton.dataset.favorite
        );

        const originSection = favoriteButton.closest(
          "#favoritesGrid"
        )
          ? "#favoritesGrid"
          : "#productGrid";

        toggleFavorite(id);

        if (!state.currentProduct) {
          restoreFavoriteFocus(id, originSection);
        }
      }

      if (contactButton) {
        contact();
      }

      if (event.target.closest("#mobileNav a")) {
        closeMobileMenu();
      }
    });

    $("#menuButton").addEventListener(
      "click",
      toggleMobileMenu
    );

    $("#searchButton").addEventListener("click", () => {
      closeMobileMenu();

      $("#catalogo").scrollIntoView();

      $("#searchInput").focus({
        preventScroll: true
      });
    });

    $("#searchInput").addEventListener(
      "input",
      renderLists
    );

    [
      "#colorFilter",
      "#sizeFilter",
      "#availabilityFilter",
      "#sortFilter"
    ].forEach(selector => {
      $(selector).addEventListener(
        "change",
        renderLists
      );
    });

    $("#shareFavorites").addEventListener(
      "click",
      shareFavorites
    );

    $("#closeModal").addEventListener(
      "click",
      closeProduct
    );

    $("#productModal").addEventListener(
      "click",
      event => {
        if (event.target === $("#productModal")) {
          closeProduct();
        }
      }
    );

    document.addEventListener("keydown", event => {
      if ($("#productModal").hidden) {
        if (event.key === "Escape") {
          const wasOpen = !$("#mobileNav").hidden;

          closeMobileMenu();

          if (wasOpen) {
            $("#menuButton").focus();
          }
        }

        return;
      }

      if (event.key === "Escape") {
        closeProduct();
        return;
      }

      trapModalFocus(event);
    });

    window.addEventListener("storage", event => {
      if (
        event.key === CONFIG.storage.favorites ||
        event.key === null
      ) {
        loadFavorites();
        renderLists();
        updateModalFavorite();
      }
    });
  }

  /* ========================================
     CARREGAMENTO DOS PRODUTOS
  ======================================== */

  async function loadProducts() {
    try {
      const products =
        await ProdutosService.listarProdutos();

      state.products = products
        .filter(product =>
          product.published !== false
        )
        .map(prepareProduct);
    } catch (error) {
      console.error(
        "Não foi possível carregar as peças salvas:",
        error
      );

      state.products = PRODUTOS_INICIAIS
        .filter(product =>
          product.published !== false
        )
        .map(prepareProduct);

      notify(
        "Armazenamento local indisponível. " +
        "Exibindo apenas as peças iniciais."
      );
    } finally {
      state.loading = false;
    }
  }

  /* ========================================
     INICIALIZAÇÃO
  ======================================== */

  async function init() {
    const year = $("#year");

    if (year) {
      year.textContent = new Date().getFullYear();
    }

    setupContacts();
    loadFavorites();
    bindEvents();

    renderCategories();
    renderLists();

    await loadProducts();

    renderCategories();
    populateFilters();
    renderHero();
    renderLists();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();