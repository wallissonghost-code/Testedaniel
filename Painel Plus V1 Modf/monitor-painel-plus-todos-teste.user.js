// ==UserScript==
// @name         Monitor Premium - Teste aba Todos
// @namespace    http://tampermonkey.net/
// @version      1.0.0-test
// @description  Teste separado: na aba Todos ignora o X total e usa apenas linhas Aguardando entrega para concluir a baixa.
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
    const INTERVALO = 600;
    const setItemOriginal = Storage.prototype.setItem;
    let liberacaoInterna = false;

    function normalizar(valor) {
        return String(valor || "")
            .trim().toLowerCase().normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function modoFiltro() {
        const botao = [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(el => el.offsetParent !== null);

        if (!botao) return "outro";

        const texto = normalizar(
            botao.innerText || botao.textContent ||
            botao.getAttribute("aria-label") || ""
        );

        if (texto.includes("aguardando") && texto.includes("entrega")) return "aguardando";
        if (texto.includes("todos") || texto === "todas") return "todos";
        if (texto.includes("entregue")) return "entregues";
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
        return [...document.querySelectorAll('[data-testid="delivery-table"]')]
            .find(el => el.offsetParent !== null) || null;
    }

    function linhasDaTabela() {
        const tabela = tabelaAtual();
        if (!tabela) return [];

        const linhas = [...tabela.querySelectorAll(
            "tbody tr, [role='row'], .ag-row"
        )];

        return [...new Set(linhas)].filter(el => el.offsetParent !== null);
    }

    function pendentesEmTodos(unidade) {
        if (!unidade || modoFiltro() !== "todos") return [];

        const resultado = [];
        const vistos = new Set();

        for (const linha of linhasDaTabela()) {
            const texto = String(linha.innerText || linha.textContent || "").trim();
            const normal = normalizar(texto);

            if (!texto.includes(unidade)) continue;
            if (!normal.includes("aguardando entrega") &&
                !normal.includes("aguardando a entrega")) continue;

            const assinatura = normal;
            if (vistos.has(assinatura)) continue;
            vistos.add(assinatura);
            resultado.push(texto);
        }

        return resultado;
    }

    function obterHistorico() {
        try {
            const lista = JSON.parse(localStorage.getItem(STORAGE_HISTORICO) || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function gravarHistorico(lista) {
        liberacaoInterna = true;
        try {
            setItemOriginal.call(
                localStorage,
                STORAGE_HISTORICO,
                JSON.stringify(lista.slice(0, 500))
            );
        } finally {
            liberacaoInterna = false;
        }
    }

    function removerDoHistorico(unidade) {
        const historico = obterHistorico();
        const novo = historico.filter(item => item.apartamento !== unidade);

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

    function mostrarStatus(unidade, quantidade) {
        const painel = document.querySelector("#painelConsultas505");
        const caixa = painel?.querySelector(".statusBox505");
        if (!caixa) return;

        let linha = painel.querySelector("#testeTodos505");
        if (!linha) {
            linha = document.createElement("div");
            linha.id = "testeTodos505";
            linha.className = "statusLinha505";
            linha.innerHTML = '<span>LEITURA EM TODOS</span><span id="testeTodosValor505" class="statusValor505">-</span>';
            caixa.appendChild(linha);
        }

        linha.querySelector("#testeTodosValor505").textContent =
            unidade ? `${quantidade} AGUARDANDO` : "AGUARDANDO UNIDADE";
    }

    function sincronizar() {
        if (modoFiltro() !== "todos") return;

        const unidade = unidadeAtual();
        if (!unidade) {
            mostrarStatus("", 0);
            return;
        }

        const pendentes = pendentesEmTodos(unidade);
        mostrarStatus(unidade, pendentes.length);

        // Na aba Todos, o X total nunca é usado.
        // Zero linhas Aguardando entrega confirma a baixa.
        if (pendentes.length === 0 && removerDoHistorico(unidade)) {
            atualizarPainel();
        }
    }

    setInterval(sincronizar, INTERVALO);
    sincronizar();
})();