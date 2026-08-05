// ==UserScript==
// @name         Monitor de Encomendas Premium + Detalhes
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @description  Usa a lógica estável original e acrescenta somente detalhes e exclusão automática quando X chega a 0.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/wallissonghost-code/Testedaniel/main/Monitor-encomendas-simples-v1.user.js
// ==/UserScript==

(function () {
    "use strict";

    /*
     * IMPORTANTE
     * ----------
     * A lógica principal e toda a interface continuam no arquivo original:
     * Monitor-encomendas-simples-v1.user.js
     *
     * Este complemento adiciona SOMENTE:
     * 1. Detalhes das encomendas no histórico.
     * 2. Exclusão automática do histórico quando X encomenda(s) chega a 0.
     */

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const STORAGE_CACHE_DETALHES = "monitor_encomendas_detalhes_cache_v150";
    const INTERVALO = 700;

    let apartamentoMonitorado = "";
    let ultimoX = null;
    let detalhesAtuais = [];

    function normalizarTexto(valor) {
        return String(valor || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function escaparHTML(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
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
        localStorage.setItem(
            STORAGE_HISTORICO,
            JSON.stringify(lista.slice(0, 500))
        );
    }

    function obterCacheDetalhes() {
        try {
            const cache = JSON.parse(
                localStorage.getItem(STORAGE_CACHE_DETALHES) || "{}"
            );

            return cache && typeof cache === "object" ? cache : {};
        } catch {
            return {};
        }
    }

    function salvarCacheDetalhes(apartamento, detalhes) {
        if (!apartamento || !detalhes.length) return;

        const cache = obterCacheDetalhes();
        cache[apartamento] = {
            detalhes,
            atualizadoEm: Date.now()
        };

        localStorage.setItem(
            STORAGE_CACHE_DETALHES,
            JSON.stringify(cache)
        );
    }

    // Mesma lógica do script estável original.
    function encontrarApartamento() {
        const inputs = Array.from(
            document.querySelectorAll("input")
        );

        for (const input of inputs) {
            if (input.offsetParent === null) continue;

            const valor = String(input.value || "").trim();

            if (/^\d+\/\d+$/.test(valor)) {
                return valor;
            }
        }

        return "";
    }

    // X continua sendo o veredito final.
    function lerQuantidadeEncomendas() {
        const elementos = Array.from(
            document.querySelectorAll("small, span, div")
        );

        for (const elemento of elementos) {
            if (elemento.offsetParent === null) continue;

            const texto = normalizarTexto(elemento.textContent);
            const match = texto.match(
                /(?:^|\s)(\d+)\s+encomenda\(s\)(?:\s|$)/
            );

            if (match) {
                return Number(match[1]);
            }
        }

        return null;
    }

    function encontrarRaizTabela() {
        const porTeste = Array.from(
            document.querySelectorAll('[data-testid="delivery-table"]')
        ).find(elemento => elemento.offsetParent !== null);

        if (porTeste) return porTeste;

        return Array.from(document.querySelectorAll("table"))
            .find(elemento => elemento.offsetParent !== null) || null;
    }

    function capturarDetalhes(apartamento) {
        if (!apartamento) return [];

        const raiz = encontrarRaizTabela();
        if (!raiz) return [];

        const resultado = [];
        const linhas = raiz.querySelectorAll(
            "tbody tr, [role='row'], .ag-row"
        );

        for (const linha of linhas) {
            if (linha.offsetParent === null) continue;

            const celulas = Array.from(
                linha.querySelectorAll("td, [role='gridcell'], .ag-cell")
            )
                .map(celula => String(celula.innerText || "").trim())
                .filter(Boolean);

            if (!celulas.length) continue;

            const textoCompleto = celulas.join(" | ");
            const unidadeEncontrada = celulas.find(
                valor => /^\d+\/\d+$/.test(valor)
            );

            if (
                unidadeEncontrada &&
                unidadeEncontrada !== apartamento
            ) {
                continue;
            }

            if (
                !unidadeEncontrada &&
                !textoCompleto.includes(apartamento)
            ) {
                continue;
            }

            resultado.push({
                numero: celulas[0] || "",
                apartamento,
                destinatario: celulas[2] || "",
                status: celulas[3] || "",
                data: celulas[4] || "",
                resumo: textoCompleto
            });
        }

        return resultado;
    }

    function enriquecerHistoricoComDetalhes() {
        if (!apartamentoMonitorado || !detalhesAtuais.length) return;

        const historico = obterHistorico();
        let alterado = false;

        for (const item of historico) {
            if (item.apartamento !== apartamentoMonitorado) continue;

            const detalhesAnteriores = Array.isArray(item.detalhes)
                ? item.detalhes
                : [];

            if (!detalhesAnteriores.length) {
                item.detalhes = detalhesAtuais;
                alterado = true;
            }
        }

        if (alterado) {
            gravarHistorico(historico);
        }
    }

    function removerApartamentoDoHistorico(apartamento) {
        if (!apartamento) return false;

        const historico = obterHistorico();
        const novoHistorico = historico.filter(
            item => item.apartamento !== apartamento
        );

        if (novoHistorico.length === historico.length) {
            return false;
        }

        gravarHistorico(novoHistorico);

        const cache = obterCacheDetalhes();
        delete cache[apartamento];
        localStorage.setItem(
            STORAGE_CACHE_DETALHES,
            JSON.stringify(cache)
        );

        return true;
    }

    function forcarAtualizacaoVisual() {
        const painel = document.querySelector("#painelConsultas505");
        if (!painel) return;

        const botaoFechar = painel.querySelector("#fecharPainel505");
        const botaoAbrir = document.querySelector("#botaoMonitor505");

        // O script original não observa alterações externas no localStorage.
        // Reabre somente quando o painel já estava aberto.
        if (botaoFechar && botaoAbrir) {
            botaoFechar.click();
            setTimeout(() => botaoAbrir.click(), 30);
        }
    }

    function aplicarAutoDeletePorX() {
        if (!apartamentoMonitorado) return;
        if (ultimoX !== 0) return;

        const removeu = removerApartamentoDoHistorico(
            apartamentoMonitorado
        );

        if (removeu) {
            forcarAtualizacaoVisual();
        }
    }

    function atualizarMonitorComplementar() {
        const apartamento = encontrarApartamento();
        const quantidade = lerQuantidadeEncomendas();

        if (!apartamento) {
            apartamentoMonitorado = "";
            ultimoX = null;
            detalhesAtuais = [];
            decorarHistorico();
            return;
        }

        apartamentoMonitorado = apartamento;

        if (quantidade !== null) {
            ultimoX = quantidade;
        }

        const detalhesLidos = capturarDetalhes(
            apartamentoMonitorado
        );

        if (detalhesLidos.length) {
            detalhesAtuais = detalhesLidos;
            salvarCacheDetalhes(
                apartamentoMonitorado,
                detalhesAtuais
            );
            enriquecerHistoricoComDetalhes();
        }

        // X é o veredito: 2 → 1 → 0 remove tudo da unidade.
        aplicarAutoDeletePorX();
        decorarHistorico();
    }

    function obterDetalhesDoItem(item) {
        if (Array.isArray(item.detalhes) && item.detalhes.length) {
            return item.detalhes;
        }

        const cache = obterCacheDetalhes();
        return cache[item.apartamento]?.detalhes || [];
    }

    function decorarHistorico() {
        const listaVisual = document.querySelector(
            "#listaHistorico505"
        );

        if (!listaVisual) return;

        const historico = obterHistorico();
        const cartoes = Array.from(
            listaVisual.querySelectorAll(".registroSistema505")
        );

        cartoes.forEach((cartao, indice) => {
            if (cartao.querySelector(".detalhesAddon505")) return;

            const item = historico[indice];
            if (!item) return;

            const detalhes = obterDetalhesDoItem(item);

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

            if (!detalhes.length) {
                conteudo.textContent =
                    "Os detalhes não estavam disponíveis no momento da captura.";
            } else {
                conteudo.innerHTML = detalhes.map((detalhe, i) => `
                    <div style="margin-bottom:${i < detalhes.length - 1 ? "9px" : "0"}">
                        <b style="color:#22c55e">Encomenda ${i + 1}</b><br>
                        Número: ${escaparHTML(detalhe.numero || "-")}<br>
                        Destinatário: ${escaparHTML(detalhe.destinatario || "-")}<br>
                        Status: ${escaparHTML(detalhe.status || "-")}<br>
                        Data: ${escaparHTML(detalhe.data || "-")}
                    </div>
                `).join("");
            }

            botao.addEventListener("click", () => {
                const abrir = conteudo.style.display !== "block";
                conteudo.style.display = abrir ? "block" : "none";
                botao.textContent = abrir
                    ? "OCULTAR DETALHES"
                    : "VER DETALHES";
            });

            bloco.appendChild(botao);
            bloco.appendChild(conteudo);
            cartao.appendChild(bloco);
        });
    }

    setInterval(atualizarMonitorComplementar, INTERVALO);

    const observadorPainel = new MutationObserver(() => {
        decorarHistorico();
    });

    observadorPainel.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    atualizarMonitorComplementar();
})();