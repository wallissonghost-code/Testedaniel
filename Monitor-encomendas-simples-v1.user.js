// ==UserScript==
// @name         Monitor de Encomendas Simples
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Lógica estável com painel premium e ajuda ao passar o mouse
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

    // ==========================================================
    // UTILITÁRIOS
    // ==========================================================

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

    // ==========================================================
    // LEITURA DO CAMPO E DA QUANTIDADE
    // ==========================================================

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
        const apartamentoLido =
            encontrarApartamento();

        const quantidadeLida =
            lerQuantidadeEncomendas();

        // Campo vazio: encerra a sessão atual.
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

        // Mudou para outro apartamento.
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

        // Zero nunca gera notificação.
        if (quantidadeRestante <= 0) {
            sessaoAtiva = false;
            saidaProcessada = false;
            atualizarPainel();
            return;
        }

        // Uma ou mais encomendas: começa/continua monitorando.
        sessaoAtiva = true;
        saidaProcessada = false;
        atualizarPainel();
    }

    // ==========================================================
    // SAÍDA / ABANDONO
    // ==========================================================

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

    // Mudança de rota interna do e-Condos.
    setInterval(() => {
        if (location.href !== ultimaURL) {
            registrarSaida(
                "Saiu da tela de encomendas"
            );

            ultimaURL = location.href;
        }

        sincronizarEstado();
    }, 700);

    // Clique na lixeira específica do campo.
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

    // Fechar ou atualizar a página.
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

    // ==========================================================
    // INTERFACE SIMPLES
    // ==========================================================

    function adicionarEstilo() {
        if (document.querySelector("#monitorSimplesCSS"))
            return;

        const style = document.createElement("style");
        style.id = "monitorSimplesCSS";

        style.textContent = `
            #botaoMonitorSimples {
                margin-left: 10px;
                padding: 9px 14px;
                border: 1px solid #22c55e;
                border-radius: 8px;
                background: #080808;
                color: #22c55e;
                font: 800 11px Arial, sans-serif;
                cursor: pointer;
                box-shadow: 0 0 14px rgba(34,197,94,.18);
            }

            #botaoMonitorSimples:hover {
                background: #22c55e;
                color: #050505;
            }

            #painelMonitorSimples {
                position: fixed;
                top: 70px;
                right: 20px;
                width: 390px;
                max-height: 600px;
                background: #050505;
                color: #fff;
                border: 1px solid #22c55e;
                border-radius: 16px;
                box-shadow: 0 0 30px rgba(34,197,94,.28);
                z-index: 2147483647;
                font-family: Arial, sans-serif;
                overflow: hidden;
            }

            #painelMonitorSimples .cabecalho {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 16px;
                border-bottom: 1px solid rgba(34,197,94,.20);
            }

            #painelMonitorSimples .titulo {
                color: #22c55e;
                font-size: 16px;
                font-weight: 900;
                letter-spacing: .7px;
            }

            #painelMonitorSimples .subtitulo {
                margin-top: 4px;
                color: #666;
                font-size: 9px;
                letter-spacing: 1.5px;
            }

            #painelMonitorSimples .status {
                margin: 12px;
                padding: 12px;
                border: 1px solid rgba(34,197,94,.22);
                border-radius: 10px;
                background: #0b0b0b;
                font-size: 11px;
                line-height: 1.9;
            }

            #painelMonitorSimples .statusLinha {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                color: #888;
            }

            #painelMonitorSimples .statusLinha strong {
                color: #22c55e;
                text-align: right;
            }

            #painelMonitorSimples .acoes {
                display: flex;
                gap: 8px;
                padding: 0 12px 12px;
            }

            #painelMonitorSimples button {
                flex: 1;
                padding: 8px 10px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 10px;
                font-weight: 900;
            }

            #limparHistoricoSimples {
                border: 1px solid #ef4444;
                background: rgba(239,68,68,.08);
                color: #ef4444;
            }

            #fecharMonitorSimples {
                border: 1px solid #22c55e;
                background: rgba(34,197,94,.08);
                color: #22c55e;
            }

            #listaMonitorSimples {
                max-height: 380px;
                overflow-y: auto;
                padding: 0 12px 12px;
            }

            .registroMonitorSimples {
                border: 1px solid rgba(34,197,94,.20);
                border-radius: 10px;
                padding: 11px;
                margin-bottom: 8px;
                background: #111827;
                font-size: 11px;
                line-height: 1.5;
            }

            .registroMonitorSimples strong {
                display: block;
                color: #22c55e;
                font-size: 16px;
                margin-bottom: 4px;
            }

            .registroMonitorSimples .motivo {
                color: #fbbf24;
            }

            .registroMonitorSimples .data {
                margin-top: 5px;
                color: #777;
                font-size: 10px;
            }

            .vazioMonitorSimples {
                padding: 45px 10px;
                text-align: center;
                color: #555;
                font-size: 11px;
                letter-spacing: 1.5px;
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
        botao.title =
            "Como funciona:\n" +
            "• Digite o apartamento normalmente.\n" +
            "• O monitor lê a quantidade de encomendas.\n" +
            "• Se chegar a 0, não registra nada.\n" +
            "• Se sair deixando 1 ou mais, registra no histórico.";
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
                <div>
                    <div class="titulo">
                        MONITOR DE ENCOMENDAS
                    </div>
                    <div class="subtitulo">
                        SISTEMA ONLINE
                    </div>
                </div>
            </div>

            <div class="status">
                <div class="statusLinha">
                    <span>APARTAMENTO</span>
                    <strong id="aptMonitorSimples">-</strong>
                </div>

                <div class="statusLinha">
                    <span>ENCOMENDAS RESTANTES</span>
                    <strong id="qtdMonitorSimples">0</strong>
                </div>

                <div class="statusLinha">
                    <span>REGISTROS</span>
                    <strong id="registrosMonitorSimples">0</strong>
                </div>
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
            if (!confirm("Deseja limpar todo o histórico?"))
                return;

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

        const registros = painel.querySelector(
            "#registrosMonitorSimples"
        );

        const lista = painel.querySelector(
            "#listaMonitorSimples"
        );

        const historico = obterHistorico();

        apt.textContent = apartamentoAtual || "-";
        qtd.textContent = String(
            quantidadeRestante || 0
        );
        registros.textContent = String(
            historico.length
        );

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
                <div class="motivo">${escaparHTML(item.motivo)}</div>
                <div class="data">${escaparHTML(item.dataCompleta)}</div>
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
