// ==UserScript==
// @name         Último Teste - Monitor de Encomendas Premium
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Painel Premium V505: monitora apenas Aguardando entrega e remove automaticamente do histórico quando X chega a 0.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Monitor-encomendas-simples-v1.user.js
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const INTERVALO = 300;
    let escritaInterna = false;

    const setItemOriginal = Storage.prototype.setItem;

    function normalizar(valor) {
        return String(valor || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function obterBotaoFiltro() {
        return [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(elemento => elemento.offsetParent !== null) || null;
    }

    function filtroAguardandoAtivo() {
        const botao = obterBotaoFiltro();
        if (!botao) return false;

        const texto = normalizar(
            botao.innerText ||
            botao.textContent ||
            botao.getAttribute("aria-label") ||
            botao.getAttribute("title") ||
            ""
        );

        return texto.includes("aguardando") && texto.includes("entrega");
    }

    // Impede que o script-base grave histórico usando X de Todos ou Entregues.
    Storage.prototype.setItem = function (chave, valor) {
        if (
            String(chave) === STORAGE_HISTORICO &&
            !escritaInterna &&
            !filtroAguardandoAtivo()
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

    function encontrarApartamento() {
        if (!filtroAguardandoAtivo()) return "";

        const campo = [...document.querySelectorAll(
            'input[data-testid="residence-autocomplete-input-search"]'
        )].find(elemento => elemento.offsetParent !== null);

        const valor = String(campo?.value || "").trim();
        return /^\d+\/\d+$/.test(valor) ? valor : "";
    }

    function lerX() {
        if (!filtroAguardandoAtivo()) return null;

        const tabela = [...document.querySelectorAll(
            '[data-testid="delivery-table"]'
        )].find(elemento => elemento.offsetParent !== null);

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

    function removerApartamentoDoHistorico(apartamento) {
        if (!apartamento) return false;

        const historico = obterHistorico();
        const novo = historico.filter(
            item => item.apartamento !== apartamento
        );

        if (novo.length === historico.length) return false;

        salvarDireto(STORAGE_HISTORICO, JSON.stringify(novo.slice(0, 500)));
        return true;
    }

    function atualizarPainelVisual() {
        const painel = document.querySelector("#painelConsultas505");
        if (!painel) return;

        if (!filtroAguardandoAtivo()) {
            const codigo = painel.querySelector("#codigoAtual505");
            const etapa = painel.querySelector("#etapaBaixa505");

            if (codigo) codigo.textContent = "NENHUMA";
            if (etapa) etapa.textContent = "AGUARDANDO";
        }
    }

    function recarregarPainel() {
        const painel = document.querySelector("#painelConsultas505");
        const fechar = painel?.querySelector("#fecharPainel505");
        const abrir = document.querySelector("#botaoMonitor505");

        if (fechar && abrir) {
            fechar.click();
            setTimeout(() => abrir.click(), 60);
        }
    }

    function sincronizar() {
        atualizarPainelVisual();

        if (!filtroAguardandoAtivo()) return;

        const apartamento = encontrarApartamento();
        if (!apartamento) return;

        const x = lerX();
        if (x !== 0) return;

        if (removerApartamentoDoHistorico(apartamento)) {
            recarregarPainel();
        }
    }

    setInterval(sincronizar, INTERVALO);
    sincronizar();
})();
