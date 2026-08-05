// ==UserScript==
// @name         Monitor Premium - Teste aba Todos
// @namespace    http://tampermonkey.net/
// @version      1.1.1-test
// @description  Usa X em Aguardando, linhas pendentes em Todos e registra antes de trocar de tela, fechar ou atualizar.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Monitor-encomendas-simples-v1.user.js
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Painel%20Plus%20V1%20Modf/monitor-painel-plus-v1.user.js
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const STORAGE_ESTADO = "monitor_todos_estado_confiavel_v111";
    const INTERVALO = 300;

    let ultimaURL = location.href;
    let saidaProcessada = false;
    let ignorarProximaVisibilidade = false;

    function obterSetItemNativo() {
        try {
            const iframe = document.createElement("iframe");
            iframe.style.display = "none";
            document.documentElement.appendChild(iframe);
            const nativo = iframe.contentWindow.Storage.prototype.setItem;
            iframe.remove();
            return nativo;
        } catch {
            return Storage.prototype.setItem;
        }
    }

    const setItemNativo = obterSetItemNativo();

    function normalizar(valor) {
        return String(valor || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function modoFiltro() {
        const botao = [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(el => el.offsetParent !== null);

        if (!botao) return "outro";

        const texto = normalizar(
            botao.innerText ||
            botao.textContent ||
            botao.getAttribute("aria-label") ||
            botao.getAttribute("title") ||
            ""
        );

        if (texto.includes("aguardando") && texto.includes("entrega")) {
            return "aguardando";
        }

        if (texto.includes("todos") || texto === "todas") {
            return "todos";
        }

        if (texto.includes("entregue")) {
            return "entregues";
        }

        return "outro";
    }

    function unidadeAtual() {
        const campo = [...document.querySelectorAll(
            'input[data-testid="residence-autocomplete-input-search"]'
        )].find(el => el.offsetParent !== null);

        const valor = String(campo?.value || "").trim();
        return /^\d+\/\d+$/.test(valor) ? valor : "";
    }

    function tabelaAtual() {
        return [...document.querySelectorAll(
            '[data-testid="delivery-table"]'
        )].find(el => el.offsetParent !== null) || null;
    }

    function lerX() {
        const tabela = tabelaAtual();
        if (!tabela) return null;

        for (const elemento of tabela.querySelectorAll(
            "footer small, footer span, small"
        )) {
            if (elemento.offsetParent === null) continue;

            const match = normalizar(elemento.textContent).match(
                /(?:^|\s)(\d+)\s+encomenda(?:\(s\)|s)?(?:\s|$)/
            );

            if (match) return Number(match[1]);
        }

        return null;
    }

    function linhasDaTabela() {
        const tabela = tabelaAtual();
        if (!tabela) return [];

        const linhas = [
            ...tabela.querySelectorAll("tbody tr"),
            ...tabela.querySelectorAll("[role='row']"),
            ...tabela.querySelectorAll(".ag-row")
        ];

        return [...new Set(linhas)]
            .filter(el => el.offsetParent !== null);
    }

    function pendentesEmTodos(unidade) {
        if (!unidade) return [];

        const resultado = [];
        const vistos = new Set();

        for (const linha of linhasDaTabela()) {
            const texto = String(
                linha.innerText || linha.textContent || ""
            ).trim();
            const normal = normalizar(texto);

            if (!texto.includes(unidade)) continue;

            const aguardando =
                normal.includes("aguardando entrega") ||
                normal.includes("aguardando a entrega");

            if (!aguardando || vistos.has(normal)) continue;

            vistos.add(normal);
            resultado.push(texto);
        }

        return resultado;
    }

    function salvarEstado(estado) {
        try {
            setItemNativo.call(
                localStorage,
                STORAGE_ESTADO,
                JSON.stringify({
                    ...estado,
                    urlOrigem: location.href,
                    atualizadoEm: Date.now()
                })
            );
        } catch {
            // Nunca interfere no e-Condos.
        }
    }

    function obterEstado() {
        try {
            const estado = JSON.parse(
                localStorage.getItem(STORAGE_ESTADO) || "null"
            );

            return estado && typeof estado === "object"
                ? estado
                : null;
        } catch {
            return null;
        }
    }

    function invalidarEstado() {
        salvarEstado({
            modo: "outro",
            unidade: "",
            quantidade: 0
        });
    }

    function obterHistorico() {
        try {
            const lista = JSON.parse(
                localStorage.getItem(STORAGE_HISTORICO) || "[]"
            );
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function gravarHistorico(lista) {
        setItemNativo.call(
            localStorage,
            STORAGE_HISTORICO,
            JSON.stringify(lista.slice(0, 500))
        );
    }

    function registrarPendenciaConfiavel(motivo) {
        if (saidaProcessada) return false;

        const estado = obterEstado();
        if (!estado) return false;

        const quantidade = Number(estado.quantidade);

        if (
            !["aguardando", "todos"].includes(estado.modo) ||
            !estado.unidade ||
            quantidade <= 0
        ) {
            return false;
        }

        saidaProcessada = true;

        const texto = quantidade === 1
            ? "1 Encomenda não dado baixa"
            : `${quantidade} Encomendas não dado baixa`;

        const historico = obterHistorico()
            .filter(item => item.apartamento !== estado.unidade);

        historico.unshift({
            apartamento: estado.unidade,
            quantidade,
            motivo: `${texto} · ${motivo}`,
            dataCompleta: new Date().toLocaleString("pt-BR"),
            timestamp: Date.now()
        });

        gravarHistorico(historico);
        return true;
    }

    function removerDoHistorico(unidade) {
        if (!unidade) return false;

        const historico = obterHistorico();
        const novo = historico.filter(
            item => item.apartamento !== unidade
        );

        if (novo.length === historico.length) return false;

        gravarHistorico(novo);
        return true;
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelConsultas505");
        const fechar = painel?.querySelector("#fecharPainel505");
        const abrir = document.querySelector("#botaoMonitor505");

        if (fechar && abrir) {
            fechar.click();
            setTimeout(() => abrir.click(), 40);
        }
    }

    function mostrarStatus(unidade, quantidade, modo) {
        const painel = document.querySelector("#painelConsultas505");
        const caixa = painel?.querySelector(".statusBox505");
        if (!caixa) return;

        let linha = painel.querySelector("#testeTodos505");
        if (!linha) {
            linha = document.createElement("div");
            linha.id = "testeTodos505";
            linha.className = "statusLinha505";
            linha.innerHTML =
                '<span>LEITURA CONFIÁVEL</span>' +
                '<span id="testeTodosValor505" class="statusValor505">-</span>';
            caixa.appendChild(linha);
        }

        const valor = linha.querySelector("#testeTodosValor505");

        if (!unidade) {
            valor.textContent = "AGUARDANDO UNIDADE";
        } else if (modo === "todos") {
            valor.textContent = `${quantidade} AGUARDANDO EM TODOS`;
        } else {
            valor.textContent = `${quantidade} PELO X`;
        }
    }

    function processarTrocaInternaDeTela() {
        if (location.href === ultimaURL) return false;

        // ESSENCIAL: registra usando o estado da tela anterior antes de
        // consultar qualquer campo, filtro ou tabela da nova tela.
        registrarPendenciaConfiavel("Trocou de tela dentro do e-Condos");

        ultimaURL = location.href;
        invalidarEstado();
        saidaProcessada = false;
        ignorarProximaVisibilidade = true;

        return true;
    }

    function sincronizar() {
        // A troca de rota precisa ser a primeira verificação do ciclo.
        // Antes, a nova tela apagava/substituía o estado e a pendência sumia.
        if (processarTrocaInternaDeTela()) return;

        const modo = modoFiltro();
        const unidade = unidadeAtual();

        if (modo === "aguardando" && unidade) {
            const x = lerX();

            if (x !== null) {
                salvarEstado({ modo, unidade, quantidade: x });
                mostrarStatus(unidade, x, modo);
                saidaProcessada = false;

                if (x === 0 && removerDoHistorico(unidade)) {
                    atualizarPainel();
                }
            }
            return;
        }

        if (modo === "todos" && unidade) {
            const quantidade = pendentesEmTodos(unidade).length;

            salvarEstado({ modo, unidade, quantidade });
            mostrarStatus(unidade, quantidade, modo);
            saidaProcessada = false;

            if (quantidade === 0 && removerDoHistorico(unidade)) {
                atualizarPainel();
            }
            return;
        }

        if (modo === "entregues") {
            invalidarEstado();
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") return;

        if (ignorarProximaVisibilidade) {
            ignorarProximaVisibilidade = false;
            return;
        }

        registrarPendenciaConfiavel("Aplicativo minimizado ou fechado");
    }, true);

    window.addEventListener("beforeunload", () => {
        registrarPendenciaConfiavel("Página fechada ou atualizada");
    }, { capture: true });

    window.addEventListener("pagehide", () => {
        registrarPendenciaConfiavel("Página fechada ou atualizada");
    }, { capture: true });

    setInterval(sincronizar, INTERVALO);
    sincronizar();
})();