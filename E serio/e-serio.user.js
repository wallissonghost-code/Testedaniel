// ==UserScript==
// @name         E sério - Monitor de Encomendas Premium
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Monitora Aguardando entrega, pausa em Todos/Entregues e registra pendências ao sair, limpar, atualizar ou fechar.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const INTERVALO = 300;

    let unidadeAtual = "";
    let quantidadeAtual = 0;
    let sessaoAtiva = false;
    let filtroValido = false;
    let ultimaURL = location.href;
    let saidaProcessada = false;
    let painelAberto = false;

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

    function modoFiltro() {
        const botao = [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(elemento => elemento.offsetParent !== null);

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

    function lerUnidadeSelecionada() {
        const campo = [...document.querySelectorAll(
            'input[data-testid="residence-autocomplete-input-search"]'
        )].find(elemento => elemento.offsetParent !== null);

        if (!campo) return "";

        const valor = String(campo.value || "").trim();
        return /^\d+\/\d+$/.test(valor) ? valor : "";
    }

    function lerX() {
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

    function salvarPendencia(motivo) {
        if (saidaProcessada) return false;
        if (!sessaoAtiva) return false;
        if (!filtroValido) return false;
        if (!unidadeAtual) return false;
        if (quantidadeAtual <= 0) return false;

        saidaProcessada = true;

        const texto = quantidadeAtual === 1
            ? "1 Encomenda não dado baixa"
            : `${quantidadeAtual} Encomendas não dado baixa`;

        const historico = obterHistorico().filter(
            item => item.apartamento !== unidadeAtual
        );

        historico.unshift({
            apartamento: unidadeAtual,
            quantidade: quantidadeAtual,
            motivo: `${texto} · ${motivo}`,
            dataCompleta: new Date().toLocaleString("pt-BR"),
            timestamp: Date.now()
        });

        gravarHistorico(historico);
        atualizarPainel();
        return true;
    }

    function limparSessao() {
        unidadeAtual = "";
        quantidadeAtual = 0;
        sessaoAtiva = false;
        filtroValido = false;
        saidaProcessada = false;
        atualizarPainel();
    }

    function sincronizar() {
        // Mudança real de rota: registra o último estado confiável antes de limpar.
        if (location.href !== ultimaURL) {
            salvarPendencia("Saiu da página de encomendas");
            ultimaURL = location.href;
            limparSessao();
            return;
        }

        const modo = modoFiltro();

        // Todos e Entregues apenas pausam. Não leem X, não salvam e não limpam.
        if (modo === "todos" || modo === "entregues") {
            atualizarPainel();
            return;
        }

        // O filtro não existe: a tela de encomendas foi desmontada ou abandonada.
        if (modo === "outro") {
            salvarPendencia("Saiu da página de encomendas");
            limparSessao();
            return;
        }

        filtroValido = true;

        const unidade = lerUnidadeSelecionada();

        if (!unidade) {
            if (sessaoAtiva && quantidadeAtual > 0) {
                salvarPendencia("Campo apagado antes de concluir a baixa");
            }
            limparSessao();
            return;
        }

        const x = lerX();
        if (x === null) return;

        unidadeAtual = unidade;
        quantidadeAtual = x;
        saidaProcessada = false;

        if (x === 0) {
            sessaoAtiva = false;
            removerDoHistorico(unidade);
            atualizarPainel();
            return;
        }

        sessaoAtiva = true;
        atualizarPainel();
    }

    document.addEventListener("click", evento => {
        const botao = evento.target.closest("button");
        if (!botao) return;

        if (
            botao.getAttribute("data-testid") ===
            "residence-autocomplete-clear-input-button"
        ) {
            salvarPendencia("Campo apagado antes de concluir a baixa");
            limparSessao();
        }
    }, true);

    window.addEventListener("beforeunload", () => {
        salvarPendencia("Página fechada ou atualizada");
    }, { capture: true });

    window.addEventListener("pagehide", () => {
        salvarPendencia("Página fechada ou atualizada");
    }, { capture: true });

    function adicionarEstilo() {
        if (document.querySelector("#cssESerio")) return;

        const estilo = document.createElement("style");
        estilo.id = "cssESerio";
        estilo.textContent = `
            #painelESerio,#painelESerio *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
            #painelESerio{position:fixed;top:60px;right:25px;width:410px;height:590px;background:#050505;color:#fff;z-index:2147483646;border-radius:18px;overflow:hidden;border:1px solid #22c55e;box-shadow:0 0 35px rgba(34,197,94,.35)}
            .conteudoESerio{padding:18px;height:100%;display:flex;flex-direction:column}
            .topoESerio{display:flex;justify-content:space-between;align-items:center}
            .tituloESerio{font-size:18px;font-weight:bold;color:#22c55e;letter-spacing:1px;text-shadow:0 0 15px rgba(34,197,94,.9)}
            .subtituloESerio{font-size:10px;color:#777;margin-top:5px;letter-spacing:2px}
            .ledESerio{width:12px;height:12px;border-radius:50%;background:#22c55e;box-shadow:0 0 15px #22c55e}
            .statusESerio{margin-top:15px;padding:12px;border-radius:12px;background:rgba(0,0,0,.72);border:1px solid rgba(34,197,94,.25);font-size:12px;color:#aaa;line-height:20px}
            .linhaESerio{display:flex;justify-content:space-between;gap:10px}.valorESerio{color:#22c55e;font-weight:bold;text-align:right}
            .acoesESerio{display:flex;gap:8px;margin-top:10px}.acoesESerio button{flex:1;padding:8px;border-radius:9px;font-size:10px;font-weight:bold;cursor:pointer}
            #limparESerio{background:rgba(239,68,68,.12);border:1px solid #ef4444;color:#ef4444}
            #fecharESerio{background:rgba(34,197,94,.12);border:1px solid #22c55e;color:#22c55e}
            .listaESerio{flex:1;min-height:0;overflow-y:auto;margin-top:12px;padding-right:5px}
            .registroESerio{background:rgba(17,24,39,.88);border:1px solid rgba(34,197,94,.2);padding:12px;border-radius:12px;margin-bottom:9px}
            .codigoESerio{font-size:18px;font-weight:bold;color:#22c55e}.dataESerio{margin-top:5px;font-size:11px;color:#888}.motivoESerio{margin-top:5px;font-size:10px;color:#fbbf24;line-height:15px}
            .vazioESerio{text-align:center;margin-top:80px;color:#666;font-size:12px;letter-spacing:2px}
            .rodapeESerio{text-align:center;font-size:9px;color:#555;padding-top:8px}
            #botaoESerio{display:inline-flex!important;align-items:center;justify-content:center;gap:8px;white-space:nowrap;margin-left:10px!important}
            @media(max-width:600px){#painelESerio{top:10px;left:10px;right:10px;width:auto;height:calc(100vh - 20px)}}
        `;
        document.head.appendChild(estilo);
    }

    function criarBotao() {
        adicionarEstilo();
        if (document.querySelector("#botaoESerio")) return;

        const referencia = document.querySelector(
            'button[data-testid="delivery-select-multiple-deliveries-button"]'
        );
        if (!referencia) return;

        const botao = document.createElement("button");
        botao.id = "botaoESerio";
        botao.type = "button";
        botao.className = referencia.className;
        botao.textContent = "MONITOR DE ENCOMENDAS";
        botao.addEventListener("click", abrirPainel);
        referencia.insertAdjacentElement("afterend", botao);
    }

    function abrirPainel() {
        const antigo = document.querySelector("#painelESerio");
        if (antigo) {
            antigo.remove();
            painelAberto = false;
            return;
        }

        painelAberto = true;
        adicionarEstilo();

        const painel = document.createElement("div");
        painel.id = "painelESerio";
        painel.innerHTML = `
            <div class="conteudoESerio">
                <div class="topoESerio">
                    <div>
                        <div class="tituloESerio">MONITOR DE ENCOMENDAS</div>
                        <div class="subtituloESerio">E SÉRIO · V1.1</div>
                    </div>
                    <div class="ledESerio"></div>
                </div>
                <div class="statusESerio">
                    <div class="linhaESerio"><span>FILTRO</span><span id="filtroESerio" class="valorESerio">IGNORADO</span></div>
                    <div class="linhaESerio"><span>UNIDADE</span><span id="unidadeESerio" class="valorESerio">NENHUMA</span></div>
                    <div class="linhaESerio"><span>ETAPA</span><span id="quantidadeESerio" class="valorESerio">AGUARDANDO</span></div>
                    <div class="linhaESerio"><span>REGISTROS</span><span id="registrosESerio" class="valorESerio">0</span></div>
                </div>
                <div class="acoesESerio">
                    <button id="limparESerio">LIMPAR HISTÓRICO</button>
                    <button id="fecharESerio">FECHAR</button>
                </div>
                <div id="listaESerio" class="listaESerio"></div>
                <div class="rodapeESerio">Criado por Daniel Alexandre</div>
            </div>`;

        document.body.appendChild(painel);

        painel.querySelector("#fecharESerio").onclick = () => {
            painel.remove();
            painelAberto = false;
        };

        painel.querySelector("#limparESerio").onclick = () => {
            if (!confirm("Deseja limpar todo o histórico?")) return;
            localStorage.removeItem(STORAGE_HISTORICO);
            atualizarPainel();
        };

        atualizarPainel();
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelESerio");
        if (!painel) return;

        const modo = modoFiltro();
        const historico = obterHistorico();

        const filtroTexto = modo === "aguardando"
            ? "AGUARDANDO ENTREGA"
            : (modo === "todos" || modo === "entregues")
                ? "PAUSADO"
                : "FORA DA TELA";

        painel.querySelector("#filtroESerio").textContent = filtroTexto;
        painel.querySelector("#unidadeESerio").textContent =
            modo === "aguardando" && unidadeAtual ? unidadeAtual : "NENHUMA";
        painel.querySelector("#quantidadeESerio").textContent =
            modo === "aguardando" && unidadeAtual
                ? (quantidadeAtual > 0
                    ? `${quantidadeAtual} RESTANTE(S)`
                    : "SEM PENDÊNCIAS")
                : "AGUARDANDO";
        painel.querySelector("#registrosESerio").textContent =
            String(historico.length);

        const lista = painel.querySelector("#listaESerio");
        lista.innerHTML = historico.length
            ? historico.map(item => `
                <div class="registroESerio">
                    <div class="codigoESerio">${escapar(item.apartamento)}</div>
                    <div class="dataESerio">${escapar(item.dataCompleta)}</div>
                    <div class="motivoESerio">${escapar(item.motivo)}</div>
                </div>`).join("")
            : '<div class="vazioESerio">SEM REGISTROS</div>';
    }

    new MutationObserver(criarBotao).observe(
        document.documentElement,
        { childList: true, subtree: true }
    );

    criarBotao();
    sincronizar();
    setInterval(sincronizar, INTERVALO);
})();