// ==UserScript==
// @name         Monitor Premium - Teste Final Persistente
// @namespace    http://tampermonkey.net/
// @version      1.3.0-test
// @description  X em Aguardando, tabela em Todos, pendência persistente ao trocar de tela/fechar e auto baixa em zero.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-start
// @grant        none
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Monitor-encomendas-simples-v1.user.js
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const STORAGE_ESTADO = "monitor_estado_confiavel_v130";
    const STORAGE_PENDENCIAS = "monitor_pendencias_persistentes_v130";
    const INTERVALO = 250;

    let ultimaURL = location.href;
    let ultimaAssinaturaRegistrada = "";
    let escritaInterna = false;
    const setItemOriginal = Storage.prototype.setItem;

    function normalizar(valor) {
        return String(valor || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function lerJSON(chave, padrao) {
        try {
            const valor = JSON.parse(localStorage.getItem(chave) || "null");
            return valor ?? padrao;
        } catch {
            return padrao;
        }
    }

    function salvarDireto(chave, valor) {
        escritaInterna = true;
        try {
            setItemOriginal.call(localStorage, chave, JSON.stringify(valor));
        } finally {
            escritaInterna = false;
        }
    }

    function modoFiltro() {
        const botao = [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(el => el.offsetParent !== null);

        if (!botao) return "outro";

        const texto = normalizar(
            botao.innerText || botao.textContent ||
            botao.getAttribute("aria-label") ||
            botao.getAttribute("title") || ""
        );

        if (texto.includes("aguardando") && texto.includes("entrega")) return "aguardando";
        if (texto.includes("todos") || texto === "todas") return "todos";
        if (texto.includes("entregue")) return "entregues";
        return "outro";
    }

    // O script-base nunca pode gravar o X de Todos/Entregues.
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
        return [...new Set(linhas)].filter(el => el.offsetParent !== null);
    }

    function pendentesEmTodos(unidade) {
        const vistos = new Set();
        const pendentes = [];

        for (const linha of linhasDaTabela()) {
            const texto = String(linha.innerText || linha.textContent || "").trim();
            const textoNormal = normalizar(texto);
            if (!texto.includes(unidade)) continue;
            if (!textoNormal.includes("aguardando entrega") &&
                !textoNormal.includes("aguardando a entrega")) continue;
            if (vistos.has(textoNormal)) continue;
            vistos.add(textoNormal);
            pendentes.push(texto);
        }
        return pendentes;
    }

    function salvarEstado(modo, unidade, quantidade) {
        salvarDireto(STORAGE_ESTADO, {
            modo,
            unidade,
            quantidade: Number(quantidade),
            urlOrigem: location.href,
            atualizadoEm: Date.now()
        });
    }

    function obterEstado() {
        const estado = lerJSON(STORAGE_ESTADO, null);
        return estado && typeof estado === "object" ? estado : null;
    }

    function limparEstado() {
        salvarEstado("outro", "", 0);
    }

    function obterHistorico() {
        const lista = lerJSON(STORAGE_HISTORICO, []);
        return Array.isArray(lista) ? lista : [];
    }

    function obterPendencias() {
        const lista = lerJSON(STORAGE_PENDENCIAS, []);
        return Array.isArray(lista) ? lista : [];
    }

    function atualizarPainelVisual() {
        const painel = document.querySelector("#painelConsultas505");
        const fechar = painel?.querySelector("#fecharPainel505");
        const abrir = document.querySelector("#botaoMonitor505");

        if (fechar && abrir) {
            fechar.click();
            setTimeout(() => abrir.click(), 80);
        }
    }

    function reconciliarHistorico() {
        const pendencias = obterPendencias();
        let historico = obterHistorico();

        for (const pendencia of pendencias) {
            historico = historico.filter(item => item.apartamento !== pendencia.apartamento);
            historico.unshift(pendencia);
        }

        salvarDireto(STORAGE_HISTORICO, historico.slice(0, 500));
        atualizarPainelVisual();
    }

    function registrarEstadoNoHistorico(motivo) {
        const estado = obterEstado();
        if (!estado) return false;

        const quantidade = Number(estado.quantidade);
        if (
            !["aguardando", "todos"].includes(estado.modo) ||
            !estado.unidade || quantidade <= 0
        ) return false;

        const assinatura = `${estado.unidade}|${quantidade}|${estado.atualizadoEm}`;
        if (assinatura === ultimaAssinaturaRegistrada) return false;
        ultimaAssinaturaRegistrada = assinatura;

        const texto = quantidade === 1
            ? "1 Encomenda não dado baixa"
            : `${quantidade} Encomendas não dado baixa`;

        const registro = {
            apartamento: estado.unidade,
            quantidade,
            motivo: `${texto} · ${motivo}`,
            dataCompleta: new Date().toLocaleString("pt-BR"),
            timestamp: Date.now()
        };

        // Primeiro grava numa fila própria, que não depende do painel nem da tela atual.
        const pendencias = obterPendencias()
            .filter(item => item.apartamento !== estado.unidade);
        pendencias.unshift(registro);
        salvarDireto(STORAGE_PENDENCIAS, pendencias.slice(0, 500));

        // Depois espelha no histórico usado pelo painel.
        reconciliarHistorico();
        return true;
    }

    function removerUnidade(unidade) {
        if (!unidade) return;

        const historico = obterHistorico()
            .filter(item => item.apartamento !== unidade);
        const pendencias = obterPendencias()
            .filter(item => item.apartamento !== unidade);

        salvarDireto(STORAGE_HISTORICO, historico);
        salvarDireto(STORAGE_PENDENCIAS, pendencias);
        limparEstado();
        ultimaAssinaturaRegistrada = "";
        atualizarPainelVisual();
    }

    function processarTrocaDeTela() {
        if (location.href === ultimaURL) return false;

        // Registra usando o estado persistido da tela anterior.
        registrarEstadoNoHistorico("Trocou de tela dentro do e-Condos");
        ultimaURL = location.href;
        limparEstado();
        return true;
    }

    function sincronizar() {
        // Mantém a fila própria sempre espelhada no histórico, em qualquer tela.
        if (obterPendencias().length) reconciliarHistorico();

        if (processarTrocaDeTela()) return;

        const modo = modoFiltro();
        const unidade = unidadeAtual();

        if (modo === "aguardando" && unidade) {
            const x = lerX();
            if (x === null) return;
            salvarEstado(modo, unidade, x);
            if (x === 0) removerUnidade(unidade);
            return;
        }

        if (modo === "todos" && unidade) {
            const quantidade = pendentesEmTodos(unidade).length;
            salvarEstado(modo, unidade, quantidade);
            if (quantidade === 0) removerUnidade(unidade);
            return;
        }

        // Entregues não lê X e não altera a pendência anterior.
    }

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            registrarEstadoNoHistorico("Aplicativo minimizado ou fechado");
        }
    }, true);

    window.addEventListener("beforeunload", () => {
        registrarEstadoNoHistorico("Página fechada ou atualizada");
    }, { capture: true });

    window.addEventListener("pagehide", () => {
        registrarEstadoNoHistorico("Página fechada ou atualizada");
    }, { capture: true });

    // Captura navegação SPA imediatamente, sem esperar apenas o intervalo.
    const pushStateOriginal = history.pushState;
    history.pushState = function (...args) {
        registrarEstadoNoHistorico("Trocou de tela dentro do e-Condos");
        const retorno = pushStateOriginal.apply(this, args);
        ultimaURL = location.href;
        limparEstado();
        return retorno;
    };

    const replaceStateOriginal = history.replaceState;
    history.replaceState = function (...args) {
        registrarEstadoNoHistorico("Trocou de tela dentro do e-Condos");
        const retorno = replaceStateOriginal.apply(this, args);
        ultimaURL = location.href;
        limparEstado();
        return retorno;
    };

    window.addEventListener("popstate", () => {
        registrarEstadoNoHistorico("Trocou de tela dentro do e-Condos");
        ultimaURL = location.href;
        limparEstado();
    }, true);

    setInterval(sincronizar, INTERVALO);
    setTimeout(sincronizar, 1000);
})();