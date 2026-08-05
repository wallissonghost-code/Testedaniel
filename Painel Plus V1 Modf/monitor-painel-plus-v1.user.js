// ==UserScript==
// @name         Painel Plus V1 Modf
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Monitora pendências por unidade, agrupa encomendas e reconcilia o histórico automaticamente.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE = "painel_plus_v1_modf_pendencias";
    const INTERVALO_MS = 1200;

    let apartamentoAtual = "";
    let encomendasAtuais = [];
    let quantidadeAtual = 0;
    let ultimaURL = location.href;
    let ultimaAssinatura = "";
    let saidaProcessada = false;
    let painelAberto = false;

    function normalizar(valor) {
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

    function carregarPendencias() {
        try {
            const dados = JSON.parse(localStorage.getItem(STORAGE) || "[]");
            return Array.isArray(dados) ? dados : [];
        } catch {
            return [];
        }
    }

    function salvarPendencias(lista) {
        localStorage.setItem(STORAGE, JSON.stringify(lista.slice(0, 500)));
        atualizarPainel();
    }

    function encontrarApartamento() {
        const inputs = Array.from(document.querySelectorAll("input"));

        for (const input of inputs) {
            if (input.offsetParent === null) continue;
            const valor = String(input.value || "").trim();
            if (/^\d+\/\d+$/.test(valor)) return valor;
        }

        return "";
    }

    function localizarTabelaEncomendas() {
        const tabelas = Array.from(document.querySelectorAll("table"));

        for (const tabela of tabelas) {
            if (tabela.offsetParent === null) continue;
            const texto = normalizar(tabela.innerText);
            if (texto.includes("encomenda") || texto.includes("destinatario")) {
                return tabela;
            }
        }

        return document.querySelector("table");
    }

    function capturarTabela() {
        const tabela = localizarTabelaEncomendas();
        if (!tabela) return [];

        const linhas = [];
        const trs = Array.from(tabela.querySelectorAll("tbody tr"));

        for (const tr of trs) {
            if (tr.offsetParent === null) continue;

            const colunas = Array.from(tr.querySelectorAll("td"))
                .map(td => td.innerText.trim());

            if (colunas.length < 2) continue;

            const apartamento = colunas.find(valor => /^\d+\/\d+$/.test(valor)) || "";
            if (!apartamento) continue;

            linhas.push({
                numero: colunas[0] || "",
                apartamento,
                destinatario: colunas[2] || "",
                status: colunas[3] || "",
                data: colunas[4] || "",
                resumo: colunas.join(" | ")
            });
        }

        return linhas;
    }

    function lerContadorVisual() {
        const elementos = Array.from(document.querySelectorAll("small, span"));

        for (const elemento of elementos) {
            if (elemento.offsetParent === null) continue;
            const texto = normalizar(elemento.textContent);
            const match = texto.match(/(?:^|\s)(\d+)\s+encomenda(?:\(s\)|s)?(?:\s|$)/);
            if (match) return Number(match[1]);
        }

        return null;
    }

    function capturarEncomendas(apartamento) {
        return capturarTabela().filter(item => item.apartamento === apartamento);
    }

    function assinaturaEncomendas(encomendas) {
        return encomendas
            .map(item => `${item.numero}|${item.apartamento}|${item.data}|${item.status}`)
            .sort()
            .join(";");
    }

    function criarOuAtualizarPendencia(apartamento, encomendas, motivo) {
        if (!apartamento || !encomendas.length) return;

        const lista = carregarPendencias();
        const indice = lista.findIndex(item => item.apartamento === apartamento);
        const agora = new Date();

        const registro = {
            apartamento,
            quantidade: encomendas.length,
            encomendas,
            motivo,
            atualizadoEm: agora.toLocaleString("pt-BR"),
            timestamp: Date.now()
        };

        if (indice >= 0) {
            lista[indice] = registro;
        } else {
            lista.unshift(registro);
        }

        salvarPendencias(lista);
    }

    function removerPendencia(apartamento) {
        if (!apartamento) return;
        const lista = carregarPendencias();
        const novaLista = lista.filter(item => item.apartamento !== apartamento);
        if (novaLista.length !== lista.length) salvarPendencias(novaLista);
    }

    function reconciliarPendenciaExistente(apartamento, encomendas) {
        const lista = carregarPendencias();
        const existe = lista.some(item => item.apartamento === apartamento);
        if (!existe) return;

        if (!encomendas.length) {
            removerPendencia(apartamento);
            return;
        }

        criarOuAtualizarPendencia(
            apartamento,
            encomendas,
            "Pendência atualizada automaticamente"
        );
    }

    function registrarSaida(motivo) {
        if (saidaProcessada) return;
        if (!apartamentoAtual || quantidadeAtual <= 0 || !encomendasAtuais.length) return;

        saidaProcessada = true;
        criarOuAtualizarPendencia(apartamentoAtual, encomendasAtuais, motivo);
    }

    function resetarSessao() {
        apartamentoAtual = "";
        encomendasAtuais = [];
        quantidadeAtual = 0;
        ultimaAssinatura = "";
        saidaProcessada = false;
        atualizarPainel();
    }

    function sincronizarEstado() {
        const apartamentoLido = encontrarApartamento();

        if (!apartamentoLido) {
            if (apartamentoAtual && quantidadeAtual > 0) {
                registrarSaida("Campo apagado antes de concluir todas as baixas");
            }
            resetarSessao();
            return;
        }

        if (apartamentoAtual && apartamentoAtual !== apartamentoLido) {
            if (quantidadeAtual > 0) {
                registrarSaida("Outra unidade foi pesquisada");
            }
            resetarSessao();
        }

        apartamentoAtual = apartamentoLido;

        const encomendas = capturarEncomendas(apartamentoAtual);
        const contadorVisual = lerContadorVisual();
        const quantidadeTabela = encomendas.length;

        if (contadorVisual !== null && contadorVisual !== quantidadeTabela) {
            console.warn("[Painel Plus] Divergência de contagem", {
                apartamento: apartamentoAtual,
                contadorVisual,
                quantidadeTabela
            });
        }

        const assinatura = assinaturaEncomendas(encomendas);
        const mudou = assinatura !== ultimaAssinatura;

        encomendasAtuais = encomendas;
        quantidadeAtual = quantidadeTabela;
        ultimaAssinatura = assinatura;
        saidaProcessada = false;

        if (quantidadeAtual === 0) {
            removerPendencia(apartamentoAtual);
        } else if (mudou) {
            reconciliarPendenciaExistente(apartamentoAtual, encomendasAtuais);
        }

        atualizarPainel();
    }

    setInterval(() => {
        if (location.href !== ultimaURL) {
            registrarSaida("Saiu da tela de encomendas");
            ultimaURL = location.href;
            resetarSessao();
        }

        sincronizarEstado();
    }, INTERVALO_MS);

    document.addEventListener("click", evento => {
        const botao = evento.target.closest("button");
        if (!botao) return;

        if (
            botao.getAttribute("data-testid") ===
            "residence-autocomplete-clear-input-button"
        ) {
            registrarSaida("Campo apagado antes de concluir todas as baixas");
        }
    }, true);

    function processarFechamento() {
        registrarSaida("Página fechada, atualizada ou aplicativo encerrado");
    }

    window.addEventListener("pagehide", processarFechamento, { capture: true });
    window.addEventListener("beforeunload", processarFechamento, { capture: true });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            processarFechamento();
        }
    });

    function adicionarEstilo() {
        if (document.querySelector("#painelPlusCSS")) return;

        const style = document.createElement("style");
        style.id = "painelPlusCSS";
        style.textContent = `
            #botaoPainelPlus {
                margin-left: 10px;
                padding: 9px 14px;
                border: 1px solid #22c55e;
                border-radius: 8px;
                background: #080808;
                color: #22c55e;
                font: 800 11px Arial, sans-serif;
                cursor: pointer;
            }
            #painelPlus {
                position: fixed;
                top: 60px;
                right: 20px;
                width: 390px;
                max-height: 620px;
                background: #050505;
                color: #fff;
                border: 1px solid #22c55e;
                border-radius: 16px;
                box-shadow: 0 0 30px rgba(34,197,94,.28);
                z-index: 2147483647;
                font-family: Arial, sans-serif;
                overflow: hidden;
            }
            #painelPlus .topo { padding: 16px; border-bottom: 1px solid rgba(34,197,94,.2); }
            #painelPlus .titulo { color: #22c55e; font-size: 16px; font-weight: 900; }
            #painelPlus .status { margin: 12px; padding: 10px; border: 1px solid rgba(34,197,94,.2); border-radius: 10px; font-size: 11px; line-height: 1.8; }
            #painelPlus .acoes { display: flex; gap: 8px; padding: 0 12px 12px; }
            #painelPlus button { flex: 1; padding: 8px; border-radius: 8px; font-weight: 800; cursor: pointer; }
            #painelPlus .lista { max-height: 430px; overflow-y: auto; padding: 0 12px 12px; }
            #painelPlus .item { margin-bottom: 8px; padding: 10px; border: 1px solid rgba(34,197,94,.2); border-radius: 10px; background: #111827; }
            #painelPlus .apt { color: #22c55e; font-size: 18px; font-weight: 900; }
            #painelPlus .meta { color: #aaa; font-size: 11px; margin-top: 4px; }
            #painelPlus .detalhes { display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid #333; color: #ddd; font-size: 10px; line-height: 1.5; }
            #painelPlus .vazio { padding: 50px 10px; text-align: center; color: #666; }
        `;

        document.head.appendChild(style);
    }

    function criarBotao() {
        adicionarEstilo();
        if (document.querySelector("#botaoPainelPlus")) return;

        const referencia = document.querySelector(
            'button[data-testid="delivery-select-multiple-deliveries-button"]'
        );
        if (!referencia) return;

        const botao = document.createElement("button");
        botao.id = "botaoPainelPlus";
        botao.type = "button";
        botao.textContent = "PAINEL PLUS V1";
        botao.addEventListener("click", abrirPainel);
        referencia.insertAdjacentElement("afterend", botao);
    }

    function abrirPainel() {
        const antigo = document.querySelector("#painelPlus");
        if (antigo) {
            antigo.remove();
            painelAberto = false;
            return;
        }

        painelAberto = true;
        const painel = document.createElement("div");
        painel.id = "painelPlus";
        painel.innerHTML = `
            <div class="topo">
                <div class="titulo">PAINEL PLUS V1 MODF</div>
            </div>
            <div class="status">
                Unidade atual: <strong id="plusApt">-</strong><br>
                Restantes: <strong id="plusQtd">0</strong><br>
                Pendências agrupadas: <strong id="plusTotal">0</strong>
            </div>
            <div class="acoes">
                <button id="plusLimpar">LIMPAR TUDO</button>
                <button id="plusFechar">FECHAR</button>
            </div>
            <div id="plusLista" class="lista"></div>
        `;

        document.body.appendChild(painel);

        painel.querySelector("#plusLimpar").onclick = () => {
            if (confirm("Deseja apagar todas as pendências?")) {
                localStorage.removeItem(STORAGE);
                atualizarPainel();
            }
        };

        painel.querySelector("#plusFechar").onclick = () => {
            painel.remove();
            painelAberto = false;
        };

        atualizarPainel();
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelPlus");
        if (!painel) return;

        const lista = carregarPendencias();
        painel.querySelector("#plusApt").textContent = apartamentoAtual || "-";
        painel.querySelector("#plusQtd").textContent = String(quantidadeAtual || 0);
        painel.querySelector("#plusTotal").textContent = String(lista.length);

        const area = painel.querySelector("#plusLista");

        if (!lista.length) {
            area.innerHTML = '<div class="vazio">SEM PENDÊNCIAS</div>';
            return;
        }

        area.innerHTML = lista.map((item, indice) => `
            <div class="item">
                <div class="apt">${escaparHTML(item.apartamento)}</div>
                <div class="meta">${item.quantidade} encomenda(s) sem baixa</div>
                <div class="meta">${escaparHTML(item.atualizadoEm)}</div>
                <button type="button" data-plus-detalhe="${indice}">VER DETALHES</button>
                <div class="detalhes" id="plusDetalhe${indice}">
                    ${item.encomendas.map((e, i) => `
                        <div>
                            <strong>${i + 1}.</strong>
                            ${escaparHTML(e.data || "Sem data")} ·
                            ${escaparHTML(e.status || "Sem status")} ·
                            ${escaparHTML(e.destinatario || "Sem destinatário")}
                        </div>
                    `).join("")}
                </div>
            </div>
        `).join("");

        area.querySelectorAll("[data-plus-detalhe]").forEach(botao => {
            botao.addEventListener("click", () => {
                const indice = botao.getAttribute("data-plus-detalhe");
                const detalhes = area.querySelector(`#plusDetalhe${indice}`);
                detalhes.style.display = detalhes.style.display === "block" ? "none" : "block";
            });
        });
    }

    const observer = new MutationObserver(criarBotao);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    criarBotao();
    sincronizarEstado();
})();
