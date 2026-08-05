// ==UserScript==
// @name         Monitor de Encomendas Premium + Detalhes
// @namespace    http://tampermonkey.net/
// @version      1.5.2
// @description  Lógica original com detalhes, auto delete por X e bloqueio total do histórico fora de Aguardando entrega.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Monitor-encomendas-simples-v1.user.js
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const STORAGE_CACHE = "monitor_encomendas_detalhes_cache_v152";
    const INTERVALO = 500;

    let unidadeAtual = "";
    let ultimoX = null;
    let detalhesAtuais = [];
    let liberacaoInterna = false;

    const setItemOriginal = Storage.prototype.setItem;

    function normalizar(valor) {
        return String(valor || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function botaoFiltro() {
        return [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(elemento => elemento.offsetParent !== null) || null;
    }

    function filtroAguardandoAtivo() {
        const botao = botaoFiltro();
        if (!botao) return false;

        const texto = normalizar(
            botao.innerText ||
            botao.textContent ||
            botao.getAttribute("aria-label") ||
            botao.getAttribute("title") ||
            ""
        );

        return texto.includes("aguardando") &&
            texto.includes("entrega");
    }

    /*
     * TRAVA PRINCIPAL:
     * O script original pode tentar salvar usando o X de Todos/Entregues.
     * Esta interceptação impede que esse registro chegue ao localStorage.
     * Se o filtro não puder ser confirmado como Aguardando entrega, bloqueia.
     */
    Storage.prototype.setItem = function (chave, valor) {
        if (
            String(chave) === STORAGE_HISTORICO &&
            !liberacaoInterna &&
            !filtroAguardandoAtivo()
        ) {
            console.warn(
                "[Monitor] Registro bloqueado: filtro diferente de Aguardando entrega."
            );
            return;
        }

        return setItemOriginal.call(this, chave, valor);
    };

    function salvarInternamente(chave, valor) {
        liberacaoInterna = true;
        try {
            setItemOriginal.call(localStorage, chave, valor);
        } finally {
            liberacaoInterna = false;
        }
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
        salvarInternamente(
            STORAGE_HISTORICO,
            JSON.stringify(lista.slice(0, 500))
        );
    }

    function obterCache() {
        try {
            const cache = JSON.parse(
                localStorage.getItem(STORAGE_CACHE) || "{}"
            );
            return cache && typeof cache === "object" ? cache : {};
        } catch {
            return {};
        }
    }

    function gravarCache(cache) {
        salvarInternamente(
            STORAGE_CACHE,
            JSON.stringify(cache)
        );
    }

    function encontrarUnidade() {
        const campo = [...document.querySelectorAll(
            'input[data-testid="residence-autocomplete-input-search"]'
        )].find(elemento => elemento.offsetParent !== null);

        if (!campo) return "";

        const valor = String(campo.value || "").trim();
        return /^\d+\/\d+$/.test(valor) ? valor : "";
    }

    function raizTabela() {
        return [...document.querySelectorAll(
            '[data-testid="delivery-table"]'
        )].find(elemento => elemento.offsetParent !== null) || null;
    }

    function lerX() {
        if (!filtroAguardandoAtivo()) return null;

        const raiz = raizTabela();
        if (!raiz) return null;

        const elementos = raiz.querySelectorAll(
            "footer small, footer span, small"
        );

        for (const elemento of elementos) {
            if (elemento.offsetParent === null) continue;

            const texto = normalizar(elemento.textContent);
            const match = texto.match(
                /(?:^|\s)(\d+)\s+encomenda(?:\(s\)|s)?(?:\s|$)/
            );

            if (match) return Number(match[1]);
        }

        return null;
    }

    function capturarDetalhes(unidade) {
        if (!unidade || !filtroAguardandoAtivo()) return [];

        const raiz = raizTabela();
        if (!raiz) return [];

        const resultado = [];
        const linhas = raiz.querySelectorAll(
            "tbody tr, [role='row'], .ag-row"
        );

        for (const linha of linhas) {
            if (linha.offsetParent === null) continue;

            const celulas = [...linha.querySelectorAll(
                "td, [role='gridcell'], .ag-cell"
            )]
                .map(celula => String(celula.innerText || "").trim())
                .filter(Boolean);

            if (!celulas.length) continue;

            const textoCompleto = celulas.join(" | ");
            const unidadeDaLinha = celulas.find(
                valor => /^\d+\/\d+$/.test(valor)
            );

            if (unidadeDaLinha && unidadeDaLinha !== unidade) continue;
            if (!unidadeDaLinha && !textoCompleto.includes(unidade)) continue;

            resultado.push({
                numero: celulas[0] || "",
                apartamento: unidade,
                destinatario: celulas[2] || "",
                status: celulas[3] || "",
                data: celulas[4] || "",
                resumo: textoCompleto
            });
        }

        return resultado;
    }

    function salvarDetalhes(unidade, detalhes) {
        if (!unidade || !detalhes.length) return;

        const cache = obterCache();
        cache[unidade] = {
            detalhes,
            atualizadoEm: Date.now()
        };
        gravarCache(cache);

        const historico = obterHistorico();
        let mudou = false;

        for (const item of historico) {
            if (item.apartamento !== unidade) continue;
            item.detalhes = detalhes;
            mudou = true;
        }

        if (mudou) gravarHistorico(historico);
    }

    function removerUnidadeDoHistorico(unidade) {
        if (!unidade) return false;

        const historico = obterHistorico();
        const novo = historico.filter(
            item => item.apartamento !== unidade
        );

        if (novo.length === historico.length) return false;

        gravarHistorico(novo);

        const cache = obterCache();
        delete cache[unidade];
        gravarCache(cache);

        return true;
    }

    function atualizarPainelVisual() {
        const painel = document.querySelector("#painelConsultas505");
        if (!painel) return;

        const fechar = painel.querySelector("#fecharPainel505");
        const abrir = document.querySelector("#botaoMonitor505");

        if (fechar && abrir) {
            fechar.click();
            setTimeout(() => abrir.click(), 40);
        }
    }

    function detalhesDoItem(item) {
        if (Array.isArray(item.detalhes) && item.detalhes.length) {
            return item.detalhes;
        }

        return obterCache()[item.apartamento]?.detalhes || [];
    }

    function decorarHistorico() {
        const listaVisual = document.querySelector("#listaHistorico505");
        if (!listaVisual) return;

        const historico = obterHistorico();
        const cartoes = [...listaVisual.querySelectorAll(
            ".registroSistema505"
        )];

        cartoes.forEach((cartao, indice) => {
            if (cartao.querySelector(".detalhesAddon505")) return;

            const item = historico[indice];
            if (!item) return;

            const detalhes = detalhesDoItem(item);
            const bloco = document.createElement("div");
            bloco.className = "detalhesAddon505";
            bloco.style.marginTop = "9px";

            const botao = document.createElement("button");
            botao.type = "button";
            botao.textContent = "VER DETALHES";
            Object.assign(botao.style, {
                width: "100%",
                padding: "7px",
                borderRadius: "7px",
                border: "1px solid rgba(34,197,94,.45)",
                background: "rgba(34,197,94,.08)",
                color: "#22c55e",
                fontSize: "10px",
                fontWeight: "bold",
                cursor: "pointer"
            });

            const conteudo = document.createElement("div");
            conteudo.style.display = "none";
            conteudo.style.marginTop = "8px";
            conteudo.style.padding = "8px";
            conteudo.style.borderRadius = "7px";
            conteudo.style.background = "rgba(0,0,0,.45)";
            conteudo.style.fontSize = "10px";
            conteudo.style.lineHeight = "15px";
            conteudo.style.color = "#ccc";

            conteudo.innerHTML = detalhes.length
                ? detalhes.map((detalhe, i) => `
                    <div style="margin-bottom:${i < detalhes.length - 1 ? "9px" : "0"}">
                        <b style="color:#22c55e">Encomenda ${i + 1}</b><br>
                        Número: ${escapar(detalhe.numero || "-")}<br>
                        Destinatário: ${escapar(detalhe.destinatario || "-")}<br>
                        Status: ${escapar(detalhe.status || "-")}<br>
                        Data: ${escapar(detalhe.data || "-")}
                    </div>
                `).join("")
                : "Os detalhes não estavam disponíveis no momento da captura.";

            botao.onclick = () => {
                const abrir = conteudo.style.display !== "block";
                conteudo.style.display = abrir ? "block" : "none";
                botao.textContent = abrir
                    ? "OCULTAR DETALHES"
                    : "VER DETALHES";
            };

            bloco.append(botao, conteudo);
            cartao.appendChild(bloco);
        });
    }

    function sincronizarComplemento() {
        // Fora de Aguardando entrega, não lê X, não lê tabela e não altera histórico.
        if (!filtroAguardandoAtivo()) {
            unidadeAtual = "";
            ultimoX = null;
            detalhesAtuais = [];
            decorarHistorico();
            return;
        }

        const unidade = encontrarUnidade();
        if (!unidade) {
            unidadeAtual = "";
            ultimoX = null;
            detalhesAtuais = [];
            decorarHistorico();
            return;
        }

        unidadeAtual = unidade;

        const x = lerX();
        if (x !== null) ultimoX = x;

        const detalhes = capturarDetalhes(unidadeAtual);
        if (detalhes.length) {
            detalhesAtuais = detalhes;
            salvarDetalhes(unidadeAtual, detalhesAtuais);
        }

        // X é o veredito final.
        if (ultimoX === 0) {
            if (removerUnidadeDoHistorico(unidadeAtual)) {
                atualizarPainelVisual();
            }
        }

        decorarHistorico();
    }

    setInterval(sincronizarComplemento, INTERVALO);

    new MutationObserver(decorarHistorico).observe(
        document.documentElement,
        { childList: true, subtree: true }
    );

    sincronizarComplemento();
})();