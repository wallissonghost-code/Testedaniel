// ==UserScript==
// @name         Monitor de Encomendas Simples
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Monitora apenas a quantidade restante de encomendas
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO =
        "monitor_encomendas_simples_historico";

    let apartamentoAtual = "";
    let quantidadeRestante = 0;
    let sessaoAtiva = false;
    let ultimaURL = location.href;
    let saidaProcessada = false;
    let painelAberto = false;

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

    function salvarHistorico(apartamento, quantidade, motivo) {
        if (!apartamento || quantidade <= 0)
            return;

        const agora = new Date();
        const lista = obterHistorico();

        lista.unshift({
            apartamento,
            quantidade,
            motivo,
            dataCompleta: agora.toLocaleString("pt-BR"),
            timestamp: Date.now()
        });

        localStorage.setItem(
            STORAGE_HISTORICO,
            JSON.stringify(lista.slice(0, 500))
        );

        atualizarPainel();
    }

    function encontrarApartamento() {
        const inputs = Array.from(
            document.querySelectorAll("input")
        );

        for (const input of inputs) {
            if (input.offsetParent === null)
                continue;

            const valor = String(input.value || "").trim();

            if (/^\d+\/\d+$/.test(valor))
                return valor;
        }

        return "";
    }

    function lerQuantidadeEncomendas() {
        const elementos = Array.from(
            document.querySelectorAll("small, span, div")
        );

        for (const elemento of elementos) {
            if (elemento.offsetParent === null)
                continue;

            const texto = normalizarTexto(
                elemento.textContent
            );

            const match = texto.match(
                /(?:^|\s)(\d+)\s+encomenda\(s\)(?:\s|$)/
            );

            if (match)
                return Number(match[1]);
        }

        return null;
    }

    function sincronizarEstado() {
        const apartamentoLido = encontrarApartamento();
        const quantidadeLida = lerQuantidadeEncomendas();

        if (!apartamentoLido) {
            if (sessaoAtiva && quantidadeRestante > 0) {
                registrarSaida(
                    "Campo apagado antes de concluir a baixa"
                );
            }

            apartamentoAtual = "";
            quantidadeRestante = 0;
            sessaoAtiva = false;
            saidaProcessada = false;
            atualizarPainel();
            return;
        }

        if (
            apartamentoAtual &&
            apartamentoLido !== apartamentoAtual
        ) {
            if (sessaoAtiva && quantidadeRestante > 0) {
                registrarSaida(
                    "Outra residência foi pesquisada antes de concluir a baixa"
                );
            }

            apartamentoAtual = apartamentoLido;
            quantidadeRestante = 0;
            sessaoAtiva = false;
            saidaProcessada = false;
        }

        apartamentoAtual = apartamentoLido;

        if (quantidadeLida === null)
            return;

        quantidadeRestante = quantidadeLida;

        if (quantidadeRestante <= 0) {
            sessaoAtiva = false;
            saidaProcessada = false;
            atualizarPainel();
            return;
        }

        sessaoAtiva = true;
        saidaProcessada = false;
        atualizarPainel();
    }

    function registrarSaida(motivo) {
        if (saidaProcessada)
            return;

        if (!sessaoAtiva)
            return;

        if (!apartamentoAtual)
            return;

        if (quantidadeRestante <= 0)
            return;

        saidaProcessada = true;

        const texto =
            quantidadeRestante === 1
                ? "1 Encomenda não dado baixa"
                : `${quantidadeRestante} Encomendas não dado baixa`;

        salvarHistorico(
            apartamentoAtual,
            quantidadeRestante,
            `${texto} · ${motivo}`
        );

        sessaoAtiva = false;
        apartamentoAtual = "";
        quantidadeRestante = 0;
    }

    setInterval(() => {
        if (location.href !== ultimaURL) {
            registrarSaida(
                "Saiu da tela de encomendas"
            );

            ultimaURL = location.href;
        }

        sincronizarEstado();
    }, 700);

    document.addEventListener(
        "click",
        evento => {
            const botao = evento.target.closest("button");

            if (!botao)
                return;

            if (
                botao.getAttribute("data-testid") ===
                "residence-autocomplete-clear-input-button"
            ) {
                registrarSaida(
                    "Campo apagado antes de concluir a baixa"
                );
            }
        },
        true
    );

    function aoSairDaPagina() {
        registrarSaida(
            "Página fechada ou atualizada"
        );
    }

    window.addEventListener(
        "pagehide",
        aoSairDaPagina,
        { capture: true }
    );

    function adicionarEstilo() {
        if (document.querySelector("#monitorSimplesCSS"))
            return;

        const style = document.createElement("style");
        style.id = "monitorSimplesCSS";

        style.textContent = `
            #botaoMonitorSimples {
                margin-left: 10px;
                padding: 9px 14px;
                border: 1px solid #222;
                border-radius: 6px;
                background: #fff;
                color: #111;
                font: 600 12px Arial, sans-serif;
                cursor: pointer;
            }

            #painelMonitorSimples {
                position: fixed;
                top: 70px;
                right: 20px;
                width: 360px;
                max-height: 520px;
                background: #fff;
                color: #111;
                border: 1px solid #bbb;
                border-radius: 8px;
                box-shadow: 0 8px 30px rgba(0,0,0,.20);
                z-index: 2147483647;
                font-family: Arial, sans-serif;
                overflow: hidden;
            }

            #painelMonitorSimples .cabecalho {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 12px;
                border-bottom: 1px solid #ddd;
                font-weight: 700;
                font-size: 14px;
            }

            #painelMonitorSimples .status {
                padding: 10px 12px;
                border-bottom: 1px solid #eee;
                font-size: 12px;
                line-height: 1.7;
            }

            #painelMonitorSimples .acoes {
                display: flex;
                gap: 8px;
                padding: 10px 12px;
                border-bottom: 1px solid #eee;
            }

            #painelMonitorSimples button {
                padding: 7px 10px;
                border: 1px solid #aaa;
                border-radius: 5px;
                background: #f7f7f7;
                cursor: pointer;
                font-size: 11px;
            }

            #listaMonitorSimples {
                max-height: 340px;
                overflow-y: auto;
                padding: 10px 12px;
            }

            .registroMonitorSimples {
                border: 1px solid #ddd;
                border-radius: 6px;
                padding: 10px;
                margin-bottom: 8px;
                font-size: 12px;
                line-height: 1.5;
            }

            .registroMonitorSimples strong {
                display: block;
                font-size: 15px;
                margin-bottom: 3px;
            }

            .vazioMonitorSimples {
                padding: 40px 10px;
                text-align: center;
                color: #777;
                font-size: 12px;
            }

            @media (max-width: 600px) {
                #painelMonitorSimples {
                    top: 10px;
                    left: 10px;
                    right: 10px;
                    width: auto;
                    max-height: calc(100vh - 20px);
                }
            }
        `;

        document.head.appendChild(style);
    }

    function criarBotao() {
        adicionarEstilo();

        if (document.querySelector("#botaoMonitorSimples"))
            return;

        const referencia = document.querySelector(
            'button[data-testid="delivery-select-multiple-deliveries-button"]'
        );

        if (!referencia)
            return;

        const botao = document.createElement("button");
        botao.id = "botaoMonitorSimples";
        botao.type = "button";
        botao.textContent = "MONITOR DE ENCOMENDAS";
        botao.addEventListener("click", abrirPainel);

        referencia.insertAdjacentElement(
            "afterend",
            botao
        );
    }

    function abrirPainel() {
        if (painelAberto)
            return;

        painelAberto = true;

        const painel = document.createElement("div");
        painel.id = "painelMonitorSimples";

        painel.innerHTML = `
            <div class="cabecalho">
                <span>MONITOR DE ENCOMENDAS</span>
            </div>

            <div class="status">
                <div>APARTAMENTO: <strong id="aptMonitorSimples">-</strong></div>
                <div>RESTANTES: <strong id="qtdMonitorSimples">0</strong></div>
            </div>

            <div class="acoes">
                <button id="limparHistoricoSimples">
                    LIMPAR HISTÓRICO
                </button>

                <button id="fecharMonitorSimples">
                    FECHAR
                </button>
            </div>

            <div id="listaMonitorSimples"></div>
        `;

        document.body.appendChild(painel);

        painel.querySelector(
            "#limparHistoricoSimples"
        ).addEventListener("click", () => {
            localStorage.removeItem(
                STORAGE_HISTORICO
            );

            atualizarPainel();
        });

        painel.querySelector(
            "#fecharMonitorSimples"
        ).addEventListener("click", () => {
            painel.remove();
            painelAberto = false;
        });

        atualizarPainel();
    }

    function atualizarPainel() {
        const painel = document.querySelector(
            "#painelMonitorSimples"
        );

        if (!painel)
            return;

        const apt = painel.querySelector(
            "#aptMonitorSimples"
        );

        const qtd = painel.querySelector(
            "#qtdMonitorSimples"
        );

        const lista = painel.querySelector(
            "#listaMonitorSimples"
        );

        apt.textContent = apartamentoAtual || "-";
        qtd.textContent = String(
            quantidadeRestante || 0
        );

        const historico = obterHistorico();

        if (!historico.length) {
            lista.innerHTML = `
                <div class="vazioMonitorSimples">
                    SEM REGISTROS
                </div>
            `;
            return;
        }

        lista.innerHTML = historico.map(item => `
            <div class="registroMonitorSimples">
                <strong>${escaparHTML(item.apartamento)}</strong>
                <div>${escaparHTML(item.motivo)}</div>
                <div>${escaparHTML(item.dataCompleta)}</div>
            </div>
        `).join("");
    }

    const observadorBotao =
        new MutationObserver(() => {
            criarBotao();
        });

    observadorBotao.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

    criarBotao();
    sincronizarEstado();

})();