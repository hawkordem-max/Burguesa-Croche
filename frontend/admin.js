(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);

  const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
  const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

  const IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  const VIDEO_TYPES = [
    "video/mp4",
    "video/webm"
  ];

  const state = {
    products: [],

    editingId: null,
    originalProduct: null,

    photos: [],
    video: "",

    photoUrls: [],
    videoUrls: [],
    listUrls: [],

    ready: false,
    busy: false,
    dirty: false,

    toastTimer: null
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

  function textValue(selector) {
    return $(selector).value.trim();
  }

  function splitList(value) {
    return [
      ...new Set(
        String(value || "")
          .split(",")
          .map(item => item.trim())
          .filter(Boolean)
      )
    ];
  }

  function notify(message) {
    clearTimeout(state.toastTimer);

    $("#toast").textContent = message;
    $("#toast").hidden = false;

    state.toastTimer = setTimeout(() => {
      $("#toast").hidden = true;
    }, 4500);
  }

  function formMessage(message = "", type = "success") {
    const element = $("#formMessage");

    element.textContent = message;
    element.dataset.type = type;
    element.hidden = !message;
  }

  function priceText(product) {
    if (
      typeof product.price !== "number" ||
      !Number.isFinite(product.price)
    ) {
      return "Consulte o valor";
    }

    return product.price.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  function releaseUrls(list) {
    for (const url of list) {
      URL.revokeObjectURL(url);
    }

    list.length = 0;
  }

  function mediaUrl(media, list) {
    if (media instanceof Blob) {
      const url = URL.createObjectURL(media);

      list.push(url);

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
    } catch {}

    return "";
  }

  function mediaName(media, fallback) {
    if (media instanceof File) {
      return media.name;
    }

    if (typeof media === "string" && media) {
      const name = media.split("/").pop().split("?")[0];

      try {
        return decodeURIComponent(name) || fallback;
      } catch {
        return name || fallback;
      }
    }

    return fallback;
  }

  function imageMarkup(media, list, alt) {
    const url = mediaUrl(media, list);

    if (!url) {
      return `
        <span class="admin-image-fallback">
          Sem foto
        </span>
      `;
    }

    return `
      <img
        src="${escapeHTML(url)}"
        alt="${escapeHTML(alt)}"
        loading="lazy"
        data-admin-image
      >
    `;
  }

  function updateControls() {
    const disabled = state.busy || !state.ready;

    $("#saveProductButton").disabled = disabled;

    $("#saveProductButton").textContent = state.busy
      ? "Aguarde..."
      : state.editingId
        ? "Salvar alterações"
        : "Salvar peça";

    $("#newProductButton").disabled = disabled;
    $("#cancelEditButton").disabled = disabled;

    $("#refreshProductsButton").disabled = state.busy;

    $("#productForm")
      .querySelectorAll("fieldset")
      .forEach(fieldset => {
        fieldset.disabled = disabled;
      });

    $("#adminProductsList")
      .querySelectorAll("button")
      .forEach(button => {
        button.disabled = disabled;
      });
  }

  function setBusy(value) {
    state.busy = value;
    updateControls();
  }

  function confirmDiscard() {
    if (!state.dirty) return true;

    return window.confirm(
      "Você tem alterações não salvas. Deseja descartá-las?"
    );
  }

  /* ========================================
     CATEGORIAS
  ======================================== */

  function setupCategories(extraCategory = "") {
    const current = $("#productCategory").value;

    const categories = [
      ...new Set([
        ...CATEGORIES,
        ...state.products.map(product => product.category),
        extraCategory
      ])
    ].filter(category =>
      category && category !== "Todas"
    );

    $("#productCategory").innerHTML = `
      <option value="">Selecione</option>

      ${categories.map(category => `
        <option value="${escapeHTML(category)}">
          ${escapeHTML(category)}
        </option>
      `).join("")}
    `;

    $("#productCategory").value = current;
  }

  /* ========================================
     FOTOS
  ======================================== */

  function renderPhotos() {
    $("#photosPreview").replaceChildren();

    releaseUrls(state.photoUrls);

    $("#photosEmpty").hidden = state.photos.length > 0;

    $("#photosPreview").innerHTML = state.photos
      .map((photo, index) => `
        <div class="admin-photo-card ${index === 0 ? "is-cover" : ""}">
          <div class="admin-photo-image">
            ${imageMarkup(
              photo,
              state.photoUrls,
              `Foto ${index + 1} da peça`
            )}
          </div>

          <div class="admin-photo-info">
            <span class="admin-photo-name">
              ${escapeHTML(
                mediaName(photo, `Foto ${index + 1}`)
              )}
            </span>

            <div class="admin-photo-actions">
              <button
                class="admin-small-button ${index === 0 ? "is-cover" : ""}"
                type="button"
                data-cover="${index}"
                ${index === 0 ? "disabled" : ""}
              >
                ${index === 0 ? "✓ Foto de capa" : "Usar como capa"}
              </button>

              <button
                class="admin-small-button danger"
                type="button"
                data-remove-photo="${index}"
              >
                Remover foto
              </button>
            </div>
          </div>
        </div>
      `)
      .join("");
  }

  function addPhotos(event) {
    const files = [...event.target.files];

    if (!files.length) return;

    const invalidType = files.find(file =>
      !IMAGE_TYPES.includes(file.type)
    );

    if (invalidType) {
      notify(
        `Formato não aceito: ${invalidType.name}. Use JPEG, PNG ou WebP.`
      );

      event.target.value = "";
      return;
    }

    const oversized = files.find(file =>
      file.size > MAX_PHOTO_SIZE
    );

    if (oversized) {
      notify(
        `A foto ${oversized.name} ultrapassa o limite de 10 MB por arquivo.`
      );

      event.target.value = "";
      return;
    }

    state.photos.push(...files);
    state.dirty = true;

    renderPhotos();

    event.target.value = "";
  }

  function setCover(index) {
    if (
      index <= 0 ||
      index >= state.photos.length
    ) {
      return;
    }

    const [photo] = state.photos.splice(index, 1);

    state.photos.unshift(photo);
    state.dirty = true;

    renderPhotos();
  }

  function removePhoto(index) {
    if (
      index < 0 ||
      index >= state.photos.length
    ) {
      return;
    }

    state.photos.splice(index, 1);
    state.dirty = true;

    renderPhotos();
  }

  /* ========================================
     VÍDEO
  ======================================== */

  function renderVideo() {
    $("#videoPreview").replaceChildren();

    releaseUrls(state.videoUrls);

    const hasVideo = Boolean(state.video);

    $("#videoPreview").hidden = !hasVideo;
    $("#removeVideoButton").hidden = !hasVideo;

    if (!hasVideo) return;

    const url = mediaUrl(state.video, state.videoUrls);

    if (!url) {
      $("#videoPreview").innerHTML = `
        <p class="admin-video-caption">
          Não foi possível preparar este vídeo.
          Remova o arquivo ou selecione outro.
        </p>
      `;

      return;
    }

    $("#videoPreview").innerHTML = `
      <video
        controls
        playsinline
        preload="metadata"
        src="${escapeHTML(url)}"
        aria-label="Prévia do vídeo da peça"
        data-admin-video
      ></video>

      <p class="admin-video-caption">
        ${escapeHTML(
          mediaName(state.video, "Vídeo da peça")
        )}
      </p>
    `;
  }

  function addVideo(event) {
    const file = event.target.files[0];

    if (!file) return;

    if (!VIDEO_TYPES.includes(file.type)) {
      notify("Selecione um vídeo MP4 ou WebM.");

      event.target.value = "";
      return;
    }

    if (file.size > MAX_VIDEO_SIZE) {
      notify("O vídeo ultrapassa o limite de 100 MB.");

      event.target.value = "";
      return;
    }

    state.video = file;
    state.dirty = true;

    renderVideo();

    event.target.value = "";
  }

  function removeVideo() {
    state.video = "";
    state.dirty = true;

    $("#productVideo").value = "";

    renderVideo();
  }

  /* ========================================
     NOVO CADASTRO E LIMPEZA
  ======================================== */

  function resetEditor() {
    $("#productForm").reset();

    state.editingId = null;
    state.originalProduct = null;
    state.photos = [];
    state.video = "";
    state.dirty = false;

    $("#productId").value = "";

    $("#editorTitle").textContent = "Cadastrar peça";
    $("#editorStatus").textContent = "Novo cadastro";

    $("#cancelEditButton").textContent = "Limpar formulário";

    formMessage();

    renderPhotos();
    renderVideo();
    updateControls();
  }

  function startNewProduct() {
    if (state.busy || !state.ready) return;
    if (!confirmDiscard()) return;

    resetEditor();

    $("#editorSection").scrollIntoView();
    $("#productName").focus({
      preventScroll: true
    });
  }

  /* ========================================
     EDIÇÃO
  ======================================== */

  function editProduct(id) {
    if (state.busy || !state.ready) return;
    if (!confirmDiscard()) return;

    const product = state.products.find(item =>
      item.id === id
    );

    if (!product) {
      notify("Esta peça não foi encontrada.");
      return;
    }

    $("#productForm").reset();

    state.editingId = product.id;
    state.originalProduct = product;

    state.photos = Array.isArray(product.photos)
      ? [...product.photos]
      : [];

    state.video = product.video || "";

    setupCategories(product.category);

    $("#productId").value = product.id;
    $("#productName").value = product.name || "";
    $("#productCategory").value = product.category || "";

    $("#productPrice").value =
      typeof product.price === "number"
        ? product.price
        : "";

    $("#productDescription").value =
      product.description || "";

    $("#productMaterial").value =
      product.material || "";

    $("#productColors").value =
      (product.colors || []).join(", ");

    $("#productSizes").value =
      (product.sizes || []).join(", ");

    $("#productAvailability").value =
      product.availability || "consult";

    $("#productProductionTime").value =
      product.productionTime || "";

    $("#productReady").value =
      (product.ready || []).join("\n");

    $("#productFit").value = product.fit || "";

    const model = product.modelMeasurements || {};

    $("#modelHeight").value = model.height || "";
    $("#modelBust").value = model.bust || "";
    $("#modelWaist").value = model.waist || "";
    $("#modelHips").value = model.hips || "";

    $("#productMeasurements").value =
      product.measurements || "";

    $("#productCare").value =
      product.care || "";

    $("#productPublished").checked =
      product.published !== false;

    $("#editorTitle").textContent = "Editar peça";
    $("#editorStatus").textContent = `Cadastro #${product.id}`;

    $("#cancelEditButton").textContent = "Cancelar edição";

    state.dirty = false;

    formMessage();

    renderPhotos();
    renderVideo();
    updateControls();

    $("#editorSection").scrollIntoView();

    $("#productName").focus({
      preventScroll: true
    });
  }

  /* ========================================
     VALIDAÇÃO E LEITURA DO FORMULÁRIO
  ======================================== */

 
function readReadyCombinations(colors, sizes) {
  const lines = textValue("#productReady")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const combinations = [];

  for (const line of lines) {
    const parts = line.split("|").map(item => item.trim());

    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1]
    ) {
      throw new Error(
        `Combinação inválida: "${line}". Use o formato Cor|Tamanho.`
      );
    }

    const [color, size] = parts;

    combinations.push(`${color}|${size}`);
  }

  return [...new Set(combinations)];
}

  function createId() {
    let id = Date.now();

    while (state.products.some(product => product.id === id)) {
      id += 1;
    }

    return id;
  }

  function readForm() {
    const name = textValue("#productName");
    const category = $("#productCategory").value;

    if (!name) {
      throw new Error("Informe o nome da peça.");
    }

    if (!category) {
      throw new Error("Selecione uma categoria.");
    }

   
const rawPrice = $("#productPrice").value.trim();

if (rawPrice === "") {
  throw new Error("Informe o preço da peça.");
}

const price = Number(rawPrice);

if (!Number.isFinite(price) || price < 0) {
  throw new Error("Informe um valor válido para a peça.");
}


    const colors = splitList($("#productColors").value);
    const sizes = splitList($("#productSizes").value);
    console.log("Cores digitadas:", $("#productColors").value);
    console.log("Cores separadas:", colors);
    console.log("Tamanhos separados:", sizes);
    
    const ready = readReadyCombinations(colors, sizes);

    /*
      Preserva informações de criação e outros
      campos já existentes no objeto original.
    */
    return {
      ...(state.originalProduct || {}),

  ...(state.editingId ? { id: state.editingId } : {}),

      name,
      category,
      price,

      photos: [...state.photos],
      video: state.video || "",

      description: textValue("#productDescription"),
      material: textValue("#productMaterial"),

      colors,
      sizes,

      availability: $("#productAvailability").value,
      ready,

      productionTime: textValue("#productProductionTime"),

      fit: textValue("#productFit"),

      modelMeasurements: {
        height: textValue("#modelHeight"),
        bust: textValue("#modelBust"),
        waist: textValue("#modelWaist"),
        hips: textValue("#modelHips")
      },

      measurements: textValue("#productMeasurements"),
      care: textValue("#productCare"),

      published: $("#productPublished").checked
    };
  }

  /* ========================================
     SALVAR
  ======================================== */

  async function saveProduct(event) {
    event.preventDefault();

    if (state.busy || !state.ready) return;

    if (!$("#productForm").reportValidity()) {
      return;
    }

    let data;

    try {
      data = readForm();
    } catch (error) {
      formMessage(error.message, "error");
      notify(error.message);
      return;
    }

    const wasEditing = Boolean(state.editingId);

    formMessage();
    setBusy(true);

    try {
      const saved = await ProdutosService.salvarProduto(data);

      /*
        Atualiza a lista sem depender de uma segunda
        consulta ao banco depois de salvar.
      */
      state.products = [
        ...state.products.filter(product =>
          product.id !== saved.id
        ),
        saved
      ].sort((a, b) => b.id - a.id);

      resetEditor();
      setupCategories();
      renderList();

      const message = wasEditing
        ? "Alterações salvas com sucesso."
        : "Peça cadastrada com sucesso.";

      formMessage(message, "success");
      notify(message);
    } catch (error) {
      console.error("Erro ao salvar a peça:", error);

      const message = error.name === "QuotaExceededError"
        ? (
            "O espaço disponível no navegador foi excedido. " +
            "Reduza o tamanho das fotos ou do vídeo e tente novamente."
          )
        : (
            "Não foi possível salvar a peça. " +
            "Seus dados continuam no formulário. " +
            "Verifique o armazenamento do navegador e tente novamente."
          );

      formMessage(message, "error");
      notify(message);
    } finally {
      setBusy(false);
    }
  }

  /* ========================================
     EXCLUIR
  ======================================== */

  async function deleteProduct(id) {
    if (state.busy || !state.ready) return;

    const product = state.products.find(item =>
      item.id === id
    );

    if (!product) return;

    const editingThisProduct = state.editingId === id;

    const warning =
      `Excluir a peça "${product.name}"?\n\n` +
      "A exclusão não poderá ser desfeita por este painel." +
      (
        editingThisProduct && state.dirty
          ? "\nAs alterações não salvas desta peça também serão descartadas."
          : ""
      );

    if (!window.confirm(warning)) return;

    setBusy(true);

    try {
      await ProdutosService.excluirProduto(id);

      state.products = state.products.filter(item =>
        item.id !== id
      );

      if (editingThisProduct) {
        resetEditor();
      }

      renderList();

      notify("Peça excluída.");

      $("#newProductButton").disabled = false;
      $("#newProductButton").focus();
    } catch (error) {
      console.error("Erro ao excluir a peça:", error);

      notify(
        "Não foi possível excluir a peça. Tente novamente."
      );
    } finally {
      setBusy(false);
    }
  }

  /* ========================================
     LISTAGEM E ESTATÍSTICAS
  ======================================== */

  function availabilityText(product) {
    if (product.availability === "ready") {
      return "Pronta entrega";
    }

    if ((product.ready || []).length > 0) {
      return "Pronta entrega em algumas opções";
    }

    if (product.availability === "order") {
      return "Sob encomenda";
    }

    return "Disponibilidade a confirmar";
  }

   /* ========================================
     ESTATÍSTICAS / DASHBOARD
  ======================================== */

  let chartCatInstance = null;
  let chartStatusInstance = null;

  function updateStats() {
    const produtos = state.products;

    // 1. Atualizar Número Total
    const dashTotal = $("#dashTotal");
    if (dashTotal) dashTotal.textContent = produtos.length;

    // 2. Contagens
    let countsCategorias = {};
    let countsStatus = { ready: 0, order: 0, consult: 0 };
    let alertas = [];

    produtos.forEach(p => {
      const cat = p.category || 'Sem Categoria';
      countsCategorias[cat] = (countsCategorias[cat] || 0) + 1;

      const status = p.availability || 'consult';
      countsStatus[status] = (countsStatus[status] || 0) + 1;

      let faltando = [];
      if (!p.price) faltando.push("Preço");
      if (!p.photos || p.photos.length === 0) faltando.push("Foto");
      if (!p.sizes || p.sizes.length === 0) faltando.push("Tamanho");
      if (!p.colors || p.colors.length === 0) faltando.push("Cor");

      if (faltando.length > 0) {
        alertas.push(`<strong>${p.name || 'S/ Nome'}</strong>: faltam ${faltando.join(", ")}`);
      }
    });

    // 3. Renderizar Alertas
    const dashAlertCount = $("#dashAlertCount");
    if (dashAlertCount) dashAlertCount.textContent = alertas.length;

    const dashAlertList = $("#dashAlertList");
    if (dashAlertList) {
      if (alertas.length === 0) {
        dashAlertList.innerHTML = '<li class="ok">✅ Todas as peças estão completas!</li>';
      } else {
        dashAlertList.innerHTML = alertas.map(a => `<li>${a}</li>`).join('');
      }
    }

    // 4. Top 5 Peças
    const dashTop5List = $("#dashTop5List");
    if (dashTop5List) {
      let top5 = [...produtos].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
      dashTop5List.innerHTML = top5.map((p, index) =>
        `<li>
           <span class="top5-rank">#${index+1}</span>
           <span class="top5-name">${escapeHTML(p.name)}</span>
           <span class="top5-views">👁️ ${p.views || 0}</span>
         </li>`
      ).join('');
    }

    // 5. Gráficos Chart.js
    if (typeof Chart !== 'undefined') {
      const canvasCat = document.getElementById('chartCategorias');
      if (canvasCat) {
        if (chartCatInstance) chartCatInstance.destroy();
        chartCatInstance = new Chart(canvasCat.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: Object.keys(countsCategorias),
            datasets: [{
              data: Object.values(countsCategorias),
              backgroundColor: ['#f9db5c', '#f4a261', '#e76f51', '#2a9d8f', '#e9c46a', '#d4a373']
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
      }

      const canvasStatus = document.getElementById('chartStatus');
      if (canvasStatus) {
        if (chartStatusInstance) chartStatusInstance.destroy();
        chartStatusInstance = new Chart(canvasStatus.getContext('2d'), {
          type: 'bar',
          data: {
            labels: ['Pronta Entrega', 'Encomenda', 'Sob Consulta'],
            datasets: [{
              label: 'Qtd de Peças',
              data: [countsStatus.ready, countsStatus.order, countsStatus.consult],
              backgroundColor: ['#2a9d8f', '#f4a261', '#cccccc']
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
          }
        });
      }
    }
  }

  function productListItem(product) {
    const published = product.published !== false;

    return `
      <article class="admin-product-item">
        <div class="admin-product-image">
          ${imageMarkup(
            (product.photos || [])[0],
            state.listUrls,
            product.name
          )}
        </div>

        <div class="admin-product-info">
          <h3 class="admin-product-name">
            ${escapeHTML(product.name)}
          </h3>

          <p class="admin-product-meta">
            ${escapeHTML(product.category)}
            ·
            ${escapeHTML(priceText(product))}
          </p>

          <div class="admin-product-badges">
            <span class="admin-product-badge ${published ? "published" : "hidden"}">
              ${published ? "Publicada" : "Oculta"}
            </span>

            <span class="admin-product-badge">
              ${escapeHTML(availabilityText(product))}
            </span>
          </div>

          <div class="admin-product-actions">
            <button
              class="admin-small-button"
              type="button"
              data-edit="${product.id}"
              aria-label="Editar ${escapeHTML(product.name)}"
            >
              Editar
            </button>

            <button
              class="admin-small-button danger"
              type="button"
              data-delete="${product.id}"
              aria-label="Excluir ${escapeHTML(product.name)}"
            >
              Excluir
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderList() {
    const search = normalize($("#adminSearch").value.trim());
    const visibility = $("#adminVisibilityFilter").value;

    const filtered = state.products.filter(product => {
      const searchable = normalize(
        `${product.name} ${product.category}`
      );

      if (search && !searchable.includes(search)) {
        return false;
      }

      const published = product.published !== false;

      if (visibility === "published" && !published) {
        return false;
      }

      if (visibility === "hidden" && published) {
        return false;
      }

      return true;
    });

    $("#adminProductsList").replaceChildren();

    releaseUrls(state.listUrls);

    $("#adminResultCount").textContent =
      `${filtered.length} ` +
      `${filtered.length === 1 ? "peça encontrada" : "peças encontradas"}`;

    $("#adminProductsList").innerHTML = filtered.length
      ? filtered.map(productListItem).join("")
      : `
        <div class="admin-list-empty">
          Nenhuma peça encontrada.<br>
          Cadastre uma peça ou ajuste os filtros.
        </div>
      `;

    updateStats();
    updateControls();
  }

  /* ========================================
     CARREGAR OU ATUALIZAR LISTAGEM
  ======================================== */

  async function refreshProducts() {
    if (state.busy) return;

    setBusy(true);

    $("#adminResultCount").textContent = "Carregando...";

    try {
      state.products = await ProdutosService.listarProdutos();
      state.ready = true;

      setupCategories();
      renderList();
    } catch (error) {
      console.error("Erro ao carregar o painel:", error);

      state.ready = false;

      $("#adminProductsList").replaceChildren();

      releaseUrls(state.listUrls);

      $("#adminProductsList").innerHTML = `
        <div class="admin-list-empty">
          Não foi possível acessar os cadastros.<br>
          Verifique se o navegador permite armazenamento local
          e clique em Atualizar para tentar novamente.
        </div>
      `;

      $("#adminResultCount").textContent =
        "Armazenamento indisponível.";

      notify(
        "O painel precisa do armazenamento local para salvar as peças."
      );
    } finally {
      setBusy(false);
    }
  }

  /* ========================================
     EVENTOS
  ======================================== */

  function bindEvents() {
    $("#productForm").addEventListener(
      "submit",
      saveProduct
    );

    $("#productForm").addEventListener("input", event => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "file"
      ) {
        return;
      }

      state.dirty = true;
      formMessage();
    });

    $("#productForm").addEventListener("change", event => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "file"
      ) {
        return;
      }

      state.dirty = true;
      formMessage();
    });

    $("#productPhotos").addEventListener(
      "change",
      addPhotos
    );

    $("#productVideo").addEventListener(
      "change",
      addVideo
    );

    $("#removeVideoButton").addEventListener("click", () => {
      if (state.busy || !state.ready) return;
      removeVideo();
    });

    $("#photosPreview").addEventListener("click", event => {
      if (
        state.busy ||
        !state.ready ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const coverButton = event.target.closest("[data-cover]");
      const removeButton = event.target.closest("[data-remove-photo]");

      if (coverButton) {
        setCover(Number(coverButton.dataset.cover));
      }

      if (removeButton) {
        removePhoto(Number(removeButton.dataset.removePhoto));
      }
    });

    $("#newProductButton").addEventListener(
      "click",
      startNewProduct
    );

    $("#cancelEditButton").addEventListener("click", () => {
      if (state.busy || !state.ready) return;
      if (!confirmDiscard()) return;

      resetEditor();
    });

    $("#refreshProductsButton").addEventListener(
      "click",
      refreshProducts
    );

    $("#adminSearch").addEventListener("input", () => {
      if (!state.ready || state.busy) return;
      renderList();
    });

    $("#adminVisibilityFilter").addEventListener("change", () => {
      if (!state.ready || state.busy) return;
      renderList();
    });

    $("#adminProductsList").addEventListener("click", event => {
      if (
        state.busy ||
        !state.ready ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const editButton = event.target.closest("[data-edit]");
      const deleteButton = event.target.closest("[data-delete]");

      if (editButton) {
        editProduct(Number(editButton.dataset.edit));
      }

      if (deleteButton) {
        deleteProduct(Number(deleteButton.dataset.delete));
      }
    });

    document.addEventListener("error", event => {
      const element = event.target;

      if (
        element instanceof HTMLImageElement &&
        element.hasAttribute("data-admin-image")
      ) {
        const fallback = document.createElement("span");

        fallback.className = "admin-image-fallback";
        fallback.textContent = "Foto indisponível";

        element.replaceWith(fallback);
      }

      if (
        element instanceof HTMLVideoElement &&
        element.hasAttribute("data-admin-video")
      ) {
        const message = document.createElement("p");

        message.className = "admin-video-caption";
        message.textContent =
          "Não foi possível reproduzir este vídeo. Selecione outro arquivo.";

        element.replaceWith(message);
      }
    }, true);

    window.addEventListener("beforeunload", event => {
      if (!state.dirty && !state.busy) return;

      event.preventDefault();
      event.returnValue = "";
    });
  }

  /* ========================================
     INICIALIZAÇÃO
  ======================================== */

  async function init() {
    $("#adminYear").textContent =
      new Date().getFullYear();

    const photoHelp = $("#photosHelp");

    photoHelp.textContent +=
      " Formatos aceitos: JPEG, PNG e WebP. " +
      "Limite desta versão: 10 MB por foto.";

    $("#videoHelp").textContent =
      "Vídeo opcional em MP4 ou WebM. " +
      "Limite desta versão: 100 MB.";

    setupCategories();
    bindEvents();
    resetEditor();

    await refreshProducts();
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
