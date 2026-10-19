/* ==========================================================
   DASHBOARD — FILTROS

   Módulo isolado. Recebe a lista de peças (já convertida pelo
   produtos-service.js) e devolve a lista filtrada.

   API (window.DashboardFiltros):
     iniciar({ onChange })  injeta a barra em .admin-dashboard
     filtrar(produtos)      atualiza opções, aplica o estado,
                            atualiza o contador e devolve a lista
     aplicar(parcial)       altera parte do estado e avisa onChange
     limpar()               volta ao padrão e avisa onChange
     estado()               cópia do estado atual

   onChange(listaFiltrada, estado) é chamado quando o usuário
   muda um filtro (nunca durante filtrar()).
========================================================== */
(() => {
  "use strict";

  const SEM_VALOR = "__sem__";
  const ESPERA_DIGITACAO = 250;

  const ROTULOS_DISPONIBILIDADE = {
    ready: "Pronta entrega",
    order: "Encomenda",
    consult: "Sob consulta"
  };

  const CAMPOS = {
    dataInicio: "dashFiltroInicio",
    dataFim: "dashFiltroFim",
    busca: "dashFiltroBusca",
    categoria: "dashFiltroCategoria",
    disponibilidade: "dashFiltroDisponibilidade",
    publicado: "dashFiltroPublicado",
    cor: "dashFiltroCor",
    tamanho: "dashFiltroTamanho",
    precoMin: "dashFiltroPrecoMin",
    precoMax: "dashFiltroPrecoMax"
  };

  const CAMPOS_DIGITADOS = ["busca", "precoMin", "precoMax"];

  const estadoPadrao = () => ({
    dataInicio: "",
    dataFim: "",
    busca: "",
    categoria: "",
    disponibilidade: "",
    publicado: "",
    cor: "",
    tamanho: "",
    precoMin: null,
    precoMax: null
  });

  let estadoAtual = estadoPadrao();
  let aoMudar = () => {};
  let listaOrigem = [];
  let listaDasOpcoes = null;
  let barra = null;
  let temporizador = null;

  /* ========================================
     UTILITÁRIOS
  ======================================== */

  function normalizar(valor) {
    return String(valor ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  }

  function escapar(valor) {
    return String(valor ?? "").replace(
      /[&<>"']/g,
      caractere => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[caractere])
    );
  }

  function lista(valor) {
    return Array.isArray(valor) ? valor : [];
  }

  function copiar(objeto) {
    return { ...objeto };
  }

  /*
    criado_em chega como "AAAA-MM-DD HH:MM:SS" (UTC, sem fuso).
    Só a parte da data importa e, no formato ISO, ela se compara
    corretamente como texto, sem depender do parser de Date.
  */
  function dataDaPeca(peca) {
    const data = String(peca.createdAt ?? "").slice(0, 10);

    return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : "";
  }

  function precoDaPeca(peca) {
    return typeof peca.price === "number" && Number.isFinite(peca.price)
      ? peca.price
      : null;
  }

  function ordenar(valores) {
    return valores.sort((a, b) =>
      a.localeCompare(b, "pt-BR", { numeric: true })
    );
  }

  function valoresUnicos(pecas, extrair) {
    const encontrados = new Map();

    for (const peca of pecas) {
      for (const item of extrair(peca)) {
        const texto = String(item ?? "").trim();
        const chave = normalizar(texto);

        if (texto && !encontrados.has(chave)) {
          encontrados.set(chave, texto);
        }
      }
    }

    return ordenar([...encontrados.values()]);
  }

  /* ========================================
     VALIDAÇÃO E LÓGICA DOS FILTROS
  ======================================== */

  function validar(estado) {
    const avisos = [];

    /*
      O campo de data do navegador aceita anos com mais de 4 dígitos
      (ex.: 12026-10-01), que não se comparam corretamente como texto.
    */
    const formatoValido = [estado.dataInicio, estado.dataFim].every(
      data => !data || /^\d{4}-\d{2}-\d{2}$/.test(data)
    );

    const periodoValido = formatoValido && !(
      estado.dataInicio &&
      estado.dataFim &&
      estado.dataInicio > estado.dataFim
    );

    if (!formatoValido) {
      avisos.push(
        "Data inválida (use ano com 4 dígitos). " +
        "O filtro de período foi ignorado."
      );
    } else if (!periodoValido) {
      avisos.push(
        "A data inicial é maior que a data final. " +
        "O filtro de período foi ignorado."
      );
    }

    const { precoMin, precoMax } = estado;
    let precoValido = true;

    if (
      (precoMin !== null && precoMin < 0) ||
      (precoMax !== null && precoMax < 0)
    ) {
      precoValido = false;

      avisos.push(
        "O preço não pode ser negativo. " +
        "O filtro de preço foi ignorado."
      );
    } else if (
      precoMin !== null &&
      precoMax !== null &&
      precoMin > precoMax
    ) {
      precoValido = false;

      avisos.push(
        "O preço mínimo é maior que o máximo. " +
        "O filtro de preço foi ignorado."
      );
    }

    return { periodoValido, precoValido, avisos };
  }

  function algumFiltroAtivo(estado, validacao) {
    return Boolean(
      (validacao.periodoValido && (estado.dataInicio || estado.dataFim)) ||
      normalizar(estado.busca) ||
      estado.categoria ||
      estado.disponibilidade ||
      estado.publicado ||
      estado.cor ||
      estado.tamanho ||
      (validacao.precoValido &&
        (estado.precoMin !== null || estado.precoMax !== null))
    );
  }

  function contemItem(itens, procurado) {
    const alvo = normalizar(procurado);

    return lista(itens).some(item => normalizar(item) === alvo);
  }

  function passaNaLista(itens, procurado) {
    if (!procurado) return true;

    if (procurado === SEM_VALOR) {
      return lista(itens).length === 0;
    }

    return contemItem(itens, procurado);
  }

  function pecaPassa(peca, estado, validacao, busca) {
    if (
      validacao.periodoValido &&
      (estado.dataInicio || estado.dataFim)
    ) {
      const data = dataDaPeca(peca);

      if (!data) return false;
      if (estado.dataInicio && data < estado.dataInicio) return false;
      if (estado.dataFim && data > estado.dataFim) return false;
    }

    if (busca && !normalizar(peca.name).includes(busca)) {
      return false;
    }

    if (
      estado.categoria &&
      String(peca.category ?? "").trim() !== estado.categoria
    ) {
      return false;
    }

    if (
      estado.disponibilidade &&
      (peca.availability || "consult") !== estado.disponibilidade
    ) {
      return false;
    }

    if (estado.publicado) {
      const publicada = peca.published !== false;

      if (estado.publicado === "sim" && !publicada) return false;
      if (estado.publicado === "nao" && publicada) return false;
    }

    if (!passaNaLista(peca.colors, estado.cor)) return false;
    if (!passaNaLista(peca.sizes, estado.tamanho)) return false;

    if (
      validacao.precoValido &&
      (estado.precoMin !== null || estado.precoMax !== null)
    ) {
      const preco = precoDaPeca(peca);

      if (preco === null) return false;
      if (estado.precoMin !== null && preco < estado.precoMin) return false;
      if (estado.precoMax !== null && preco > estado.precoMax) return false;
    }

    return true;
  }

  /* ========================================
     BARRA DE FILTROS (INTERFACE)
  ======================================== */

  function campo(nome) {
    return barra ? barra.querySelector(`#${CAMPOS[nome]}`) : null;
  }

  function montarBarra() {
    const secao = document.createElement("section");

    secao.className = "dash-filtros";
    secao.setAttribute("aria-label", "Filtros do dashboard");

    secao.innerHTML = `
      <div class="dash-filtros-topo">
        <div>
          <span class="eyebrow">Filtros</span>
          <h2 class="dash-filtros-titulo">Filtrar o dashboard</h2>
        </div>

        <div class="dash-filtros-acoes">
          <p
            class="small dash-filtros-contador"
            id="dashFiltrosContador"
            aria-live="polite"
          >Carregando...</p>

          <button
            type="button"
            class="button button-outline"
            id="dashFiltrosLimpar"
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div class="dash-filtros-grade">
        <div class="field">
          <label for="${CAMPOS.dataInicio}">Cadastrada de</label>
          <input type="date" id="${CAMPOS.dataInicio}">
        </div>

        <div class="field">
          <label for="${CAMPOS.dataFim}">Cadastrada até</label>
          <input type="date" id="${CAMPOS.dataFim}">
        </div>

        <div class="field">
          <label for="${CAMPOS.busca}">Produto</label>
          <input
            type="search"
            id="${CAMPOS.busca}"
            placeholder="Nome da peça..."
            autocomplete="off"
          >
        </div>

        <div class="field">
          <label for="${CAMPOS.categoria}">Categoria</label>
          <select id="${CAMPOS.categoria}"></select>
        </div>

        <div class="field">
          <label for="${CAMPOS.disponibilidade}">Disponibilidade</label>
          <select id="${CAMPOS.disponibilidade}"></select>
        </div>

        <div class="field">
          <label for="${CAMPOS.publicado}">Publicação</label>
          <select id="${CAMPOS.publicado}">
            <option value="">Todas</option>
            <option value="sim">Publicadas</option>
            <option value="nao">Ocultas</option>
          </select>
        </div>

        <div class="field">
          <label for="${CAMPOS.cor}">Cor</label>
          <select id="${CAMPOS.cor}"></select>
        </div>

        <div class="field">
          <label for="${CAMPOS.tamanho}">Tamanho</label>
          <select id="${CAMPOS.tamanho}"></select>
        </div>

        <div class="field">
          <label for="${CAMPOS.precoMin}">Preço mínimo (R$)</label>
          <input
            type="number"
            id="${CAMPOS.precoMin}"
            min="0"
            step="0.01"
            inputmode="decimal"
            placeholder="0,00"
          >
        </div>

        <div class="field">
          <label for="${CAMPOS.precoMax}">Preço máximo (R$)</label>
          <input
            type="number"
            id="${CAMPOS.precoMax}"
            min="0"
            step="0.01"
            inputmode="decimal"
            placeholder="sem limite"
          >
        </div>
      </div>

      <p
        class="dash-filtros-aviso"
        id="dashFiltrosAviso"
        role="status"
        hidden
      ></p>

      <p class="small dash-filtros-nota">
        O período usa a data de cadastro da peça. O Top 5 considera
        só as peças filtradas, mas as visualizações não têm data. O
        relatório de tráfego (Looker Studio) não responde a estes
        filtros.
      </p>
    `;

    return secao;
  }

  function opcoesDoSelect(select, primeira, itens) {
    select.innerHTML = [
      { valor: "", rotulo: primeira },
      ...itens
    ]
      .map(item => `
        <option value="${escapar(item.valor)}">
          ${escapar(item.rotulo)}
        </option>
      `)
      .join("");
  }

  function atualizarOpcoes(pecas) {
    const textos = itens => itens.map(item => ({
      valor: item,
      rotulo: item
    }));

    const disponibilidades = ["ready", "consult"];

    if (pecas.some(peca => peca.availability === "order")) {
      disponibilidades.splice(1, 0, "order");
    }

    const definicoes = [
      [
        "categoria",
        "Todas",
        textos(
          valoresUnicos(pecas, peca => [peca.category])
        )
      ],
      [
        "disponibilidade",
        "Todas",
        disponibilidades.map(valor => ({
          valor,
          rotulo: ROTULOS_DISPONIBILIDADE[valor]
        }))
      ],
      [
        "cor",
        "Todas",
        [
          ...textos(
            valoresUnicos(pecas, peca => lista(peca.colors))
          ),
          { valor: SEM_VALOR, rotulo: "(sem cor)" }
        ]
      ],
      [
        "tamanho",
        "Todos",
        [
          ...textos(
            valoresUnicos(pecas, peca => lista(peca.sizes))
          ),
          { valor: SEM_VALOR, rotulo: "(sem tamanho)" }
        ]
      ]
    ];

    for (const [nome, primeira, itens] of definicoes) {
      const select = campo(nome);

      if (!select) continue;

      opcoesDoSelect(select, primeira, itens);

      select.value = estadoAtual[nome];

      /*
        Se a opção escolhida deixou de existir (por exemplo, a
        última peça da categoria foi excluída), volta para "Todas".
      */
      if (select.value !== estadoAtual[nome]) {
        estadoAtual[nome] = select.value;
      }
    }
  }

  function sincronizarCampos() {
    for (const nome of Object.keys(CAMPOS)) {
      const elemento = campo(nome);

      if (!elemento) continue;

      const valor = estadoAtual[nome];

      elemento.value = valor === null ? "" : String(valor);
    }
  }

  function numeroOuNulo(texto) {
    if (texto === "") return null;

    const numero = Number(texto);

    return Number.isFinite(numero) ? numero : null;
  }

  function lerCampos() {
    const lido = estadoPadrao();

    for (const nome of Object.keys(CAMPOS)) {
      const elemento = campo(nome);

      if (!elemento) {
        lido[nome] = estadoAtual[nome];
        continue;
      }

      lido[nome] = nome === "precoMin" || nome === "precoMax"
        ? numeroOuNulo(elemento.value)
        : elemento.value;
    }

    return lido;
  }

  function mostrarResumo(total, filtradas, validacao) {
    if (!barra) return;

    const contador = barra.querySelector("#dashFiltrosContador");
    const aviso = barra.querySelector("#dashFiltrosAviso");
    const ativo = algumFiltroAtivo(estadoAtual, validacao);

    let texto = `${filtradas} de ${total} ${
      total === 1 ? "peça" : "peças"
    }`;

    if (ativo && total > 0 && filtradas === 0) {
      texto += " — nenhuma peça com esses filtros";
    }

    contador.textContent = texto;

    aviso.textContent = validacao.avisos.join(" ");
    aviso.hidden = validacao.avisos.length === 0;

    barra.dataset.ativo = String(ativo);
  }

  /* ========================================
     API PÚBLICA
  ======================================== */

  function filtrar(produtos) {
    const pecas = Array.isArray(produtos) ? produtos : [];

    listaOrigem = pecas;

    if (barra && pecas !== listaDasOpcoes) {
      listaDasOpcoes = pecas;
      atualizarOpcoes(pecas);
    }

    const validacao = validar(estadoAtual);
    const busca = normalizar(estadoAtual.busca);

    const resultado = pecas.filter(peca =>
      pecaPassa(peca, estadoAtual, validacao, busca)
    );

    mostrarResumo(pecas.length, resultado.length, validacao);

    return resultado;
  }

  function avisarMudanca() {
    aoMudar(filtrar(listaOrigem), copiar(estadoAtual));
  }

  function aplicarCampos() {
    const lido = lerCampos();

    if (JSON.stringify(lido) === JSON.stringify(estadoAtual)) {
      return;
    }

    estadoAtual = lido;
    avisarMudanca();
  }

  function aplicar(parcial = {}) {
    for (const nome of Object.keys(CAMPOS)) {
      if (Object.prototype.hasOwnProperty.call(parcial, nome)) {
        estadoAtual[nome] = parcial[nome];
      }
    }

    sincronizarCampos();
    avisarMudanca();
  }

  function limpar() {
    clearTimeout(temporizador);

    estadoAtual = estadoPadrao();

    sincronizarCampos();
    avisarMudanca();
  }

  function aoDigitar(evento) {
    const nome = Object.keys(CAMPOS).find(
      chave => CAMPOS[chave] === evento.target.id
    );

    if (!CAMPOS_DIGITADOS.includes(nome)) return;

    clearTimeout(temporizador);
    temporizador = setTimeout(aplicarCampos, ESPERA_DIGITACAO);
  }

  function aoAlterar() {
    clearTimeout(temporizador);
    aplicarCampos();
  }

  function iniciar(opcoes = {}) {
    if (barra) return;

    const dashboard = document.querySelector(".admin-dashboard");

    if (!dashboard) {
      console.warn(
        "DashboardFiltros: seção .admin-dashboard não encontrada."
      );
      return;
    }

    if (typeof opcoes.onChange === "function") {
      aoMudar = opcoes.onChange;
    }

    barra = montarBarra();
    dashboard.prepend(barra);

    sincronizarCampos();

    barra.addEventListener("input", aoDigitar);
    barra.addEventListener("change", aoAlterar);

    barra
      .querySelector("#dashFiltrosLimpar")
      .addEventListener("click", limpar);
  }

  window.DashboardFiltros = {
    iniciar,
    filtrar,
    aplicar,
    limpar,
    estado: () => copiar(estadoAtual)
  };
})();
