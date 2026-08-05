// ==UserScript==
// @name         Monitor Premium - Teste aba Todos
// @namespace    http://tampermonkey.net/
// @version      1.2.0-test
// @description  Usa X em Aguardando, linhas pendentes em Todos e sobe a pendência ao histórico antes de trocar de tela, fechar ou atualizar.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Monitor-encomendas-simples-v1.user.js
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const STORAGE_ESTADO = "monitor_todos_estado_confiavel_v120";
    const INTERVALO = 300;

    let ultimaURL = location.href;
    let saidaProcessada = false;
    let escritaInterna = false;

    const setItemOriginal = Storage.prototype.setItem;

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

    /*
     * Impede o script-base de gravar o X total de Todos/Entregues.
     * As gravações confiáveis deste complemento usam escritaInterna.
     */
    Storage.prototype.setItem = function (chave, valor) {
        if (
            String(chave) === STORAGE_HISTORICO &&
            !escritaInterna &&
            modoFiltro() !== "aguardando"
        ) {
            return;
        }

        return setItemOriginal.call(this, chave, valor);
    };

    function salvarDireto(chave, valor) {
        escritaInterna = true;
        try {
            setItemOriginal.call(localStorage, chave, valor);
        } finally {
            escritaInterna = false;
        }
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

        for (const elemento of tabela.querySelectorAll("footer small")) {
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
        salvarDireto(
            STORAGE_ESTADO,
            JSON.stringify({
                ...estado,
                urlOrigem: location.href,
                atualizadoEm: Date.now()
            })
        );
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

    function limparEstado() {
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
        salvarDireto(
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
        saidaProcessada = true;
        atualizarPainel();
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
        atualizarPainel();
        return true;
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelConsultas505");
        const fechar = painel?.querySelector("#fecharPainel505");
        const abrir = document.querySelector("#botaoMonitor505");

        if (fechar && abrir) {
            fechar.click();
            setTimeout(() => abrir.click(), 60);
        }
    }

    function processarTrocaInternaDeTela() {
        if (location.href === ultimaURL) return false;

        /*
         * Aqui a pendência sobe de verdade para o histórico antes de a
         * tela de encomendas desaparecer. Depois disso ela permanece lá,
         * mesmo que o programa seja fechado em Portaria, Visitantes etc.
         */
        registrarPendenciaConfiavel("Trocou de tela dentro do e-Condos");

        ultimaURL = location.href;
        limparEstado();
        saidaProcessada = false;
        return true;
    }

    function sincronizar() {
        if (processarTrocaInternaDeTela()) return;

        const modo = modoFiltro();
        const unidade = unidadeAtual();

        if (modo === "aguardando" && unidade) {
            const x = lerX();

            if (x !== null) {
                salvarEstado({ modo, unidade, quantidade: x });
                saidaProcessada = false;

                if (x === 0) {
                    removerDoHistorico(unidade);
                }
            }
            return;
        }

        if (modo === "todos" && unidade) {
            const quantidade = pendentesEmTodos(unidade).length;

            salvarEstado({ modo, unidade, quantidade });
            saidaProcessada = false;

            if (quantidade === 0) {
                removerDoHistorico(unidade);
            }
            return;
        }

        if (modo === "entregues") {
            limparEstado();
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            registrarPendenciaConfiavel("Aplicativo minimizado ou fechado");
        }
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