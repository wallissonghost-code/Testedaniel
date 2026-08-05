// ==UserScript==
// @name         Monitor de Encomendas Premium + Detalhes
// @namespace    http://tampermonkey.net/
// @version      1.5.1
// @description  Mantém a lógica original, adiciona detalhes, auto delete por X=0 e ignora contadores de Todos/Entregues.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Monitor-encomendas-simples-v1.user.js
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const STORAGE_DETALHES = "monitor_encomendas_detalhes_v151";
    const ROTA = "/gate/deliveries";
    const INTERVALO = 500;

    let apartamentoAtual = "";
    let ultimoXValido = null;
    let detalhesAtuais = [];
    let snapshotFiltroProtegido = null;
    let filtroAnteriorAguardando = true;

    const normalizar = valor => String(valor || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const escapar = valor => String(valor ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    function naTelaEncomendas() {
        return location.pathname.includes(ROTA);
    }

    function lerHistoricoBruto() {
        return localStorage.getItem(STORAGE_HISTORICO) || "[]";
    }

    function lerHistorico() {
        try {
            const lista = JSON.parse(lerHistoricoBruto());
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function gravarHistorico(lista) {
        localStorage.setItem(
            STORAGE_HISTORICO,
            JSON.stringify(lista.slice(0, 500))
        );
    }

    function filtroAguardandoAtivo() {
        if (!naTelaEncomendas()) return false;

        const botao = [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(elemento => elemento.offsetParent !== null);

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

    /*
     * Proteção contra a lenda das 80 encomendas:
     * ao sair de Aguardando entrega, congela o histórico existente.
     * Enquanto estiver em Todos ou Entregues, qualquer registro criado
     * pela lógica original usando o X errado é imediatamente desfeito.
     */
    function protegerHistoricoDosOutrosFiltros() {
        const aguardando = filtroAguardandoAtivo();

        if (filtroAnteriorAguardando && !aguardando) {
            snapshotFiltroProtegido = lerHistoricoBruto();
        }

        if (!aguardando) {
            if (snapshotFiltroProtegido === null) {
                snapshotFiltroProtegido = lerHistoricoBruto();
            }

            if (lerHistoricoBruto() !== snapshotFiltroProtegido) {
                localStorage.setItem(
                    STORAGE_HISTORICO,
                    snapshotFiltroProtegido
                );
                atualizarPainelVisual();
            }
        } else {
            snapshotFiltroProtegido = null;
        }

        filtroAnteriorAguardando = aguardando;
        return aguardando;
    }

    function encontrarApartamento() {
        if (!naTelaEncomendas()) return "";

        const campo = [...document.querySelectorAll(
            'input[data-testid="residence-autocomplete-input-search"]'
        )].find(elemento => elemento.offsetParent !== null);

        if (!campo) return "";

        const valor = String(campo.value || "").trim();
        return /^\d+\/\d+$/.test(valor) ? valor : "";
    }

    function raizTabela() {
        if (!naTelaEncomendas()) return null;

        return [...document.querySelectorAll(
            '[data-testid="delivery-table"]'
        )].find(elemento => elemento.offsetParent !== null) || null;
    }

    function lerXDeAguardando() {
        if (!filtroAguardandoAtivo()) return null;

        const raiz = raizTabela();
        if (!raiz) return null;

        for (const elemento of raiz.querySelectorAll(
            "footer small, footer span, small"
        )) {
            if (elemento.offsetParent === null) continue;

            const texto = normalizar(elemento.textContent);
            const match = texto.match(
                /^(\d+)\s+encomenda(?:\(s\)|s)?$/
            );

            if (match) return Number(match[1]);
        }

        return null;
    }

    function capturarDetalhes(apartamento) {
        if (!apartamento || !filtroAguardandoAtivo()) return [];

        const raiz = raizTabela();
        if (!raiz) return [];

        const resultado = [];

        for (const linha of raiz.querySelectorAll(
            "tbody tr, [role='row'], .ag-row"
        )) {
            if (linha.offsetParent === null) continue;

            const celulas = [...linha.querySelectorAll(
                "td, [role='gridcell'], .ag-cell"
            )]
                .map(celula => String(celula.innerText || "").trim())
                .filter(Boolean);

            if (!celulas.length) continue;

            const texto = celulas.join(" | ");
            const unidade = celulas.find(valor => /^\d+\/\d+$/.test(valor));

            if (unidade && unidade !== apartamento) continue;
            if (!unidade && !texto.includes(apartamento)) continue;

            resultado.push({
                numero: celulas[0] || "",
                apartamento,
                destinatario: celulas[2] || "",
                status: celulas[3] || "",
                data: celulas[4] || "",
                resumo: texto
            });
        }

        return resultado;
    }

    function lerCache() {
        try {
            const cache = JSON.parse(
                localStorage.getItem(STORAGE_DETALHES) || "{}"
            );
            return cache && typeof cache === "object" ? cache : {};
        } catch {
            return {};
        }
    }

    function salvarDetalhes(apartamento, detalhes) {
        if (!apartamento || !detalhes.length) return;

        const cache = lerCache();
        cache[apartamento] = detalhes;
        localStorage.setItem(STORAGE_DETALHES, JSON.stringify(cache));

        const historico = lerHistorico();
        let alterado = false;

        for (const item of historico) {
            if (item.apartamento !== apartamento) continue;
            item.detalhes = detalhes;
            alterado = true;
        }

        if (alterado) gravarHistorico(historico);
    }

    function removerHistoricoDaUnidade(apartamento) {
        if (!apartamento) return false;

        const historico = lerHistorico();
        const novo = historico.filter(
            item => item.apartamento !== apartamento
        );

        if (novo.length === historico.length) return false;

        gravarHistorico(novo);

        const cache = lerCache();
        delete cache[apartamento];
        localStorage.setItem(STORAGE_DETALHES, JSON.stringify(cache));
        return true;
    }

    function atualizarPainelVisual() {
        const painel = document.querySelector("#painelConsultas505");
        const fechar = painel?.querySelector("#fecharPainel505");
        const abrir = document.querySelector("#botaoMonitor505");

        if (fechar && abrir) {
            fechar.click();
            setTimeout(() => abrir.click(), 40);
        }
    }

    function autoDeletePorX() {
        if (!apartamentoAtual) return;
        if (ultimoXValido !== 0) return;

        if (removerHistoricoDaUnidade(apartamentoAtual)) {
            atualizarPainelVisual();
        }
    }

    function detalhesDoItem(item) {
        if (Array.isArray(item.detalhes) && item.detalhes.length) {
            return item.detalhes;
        }

        return lerCache()[item.apartamento] || [];
    }

    function decorarHistorico() {
        const listaVisual = document.querySelector("#listaHistorico505");
        if (!listaVisual) return;

        const historico = lerHistorico();
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
        const aguardando = protegerHistoricoDosOutrosFiltros();

        if (!aguardando) {
            decorarHistorico();
            return;
        }

        const apartamento = encontrarApartamento();
        const quantidade = lerXDeAguardando();

        if (!apartamento) {
            apartamentoAtual = "";
            ultimoXValido = null;
            detalhesAtuais = [];
            decorarHistorico();
            return;
        }

        apartamentoAtual = apartamento;

        if (quantidade !== null) {
            ultimoXValido = quantidade;
        }

        const detalhes = capturarDetalhes(apartamentoAtual);
        if (detalhes.length) {
            detalhesAtuais = detalhes;
            salvarDetalhes(apartamentoAtual, detalhesAtuais);
        }

        // O X de Aguardando entrega é o veredito final.
        autoDeletePorX();
        decorarHistorico();
    }

    setInterval(sincronizarComplemento, INTERVALO);

    new MutationObserver(decorarHistorico).observe(
        document.documentElement,
        { childList: true, subtree: true }
    );

    sincronizarComplemento();
})();