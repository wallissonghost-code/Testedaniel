// ==UserScript==
// @name         Monitor de Encomendas Simples
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Mesma lógica estável com painel premium e instruções
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";

    let apartamentoAtual = "";
    let quantidadeRestante = 0;
    let sessaoAtiva = false;
    let ultimaURL = location.href;
    let saidaProcessada = false;
    let painelAberto = false;

    // ==========================================================
    // LÓGICA ESTÁVEL — NÃO ALTERAR
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
        if (!apartamento || quantidade <= 0) return;

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
        const inputs = Array.from(document.querySelectorAll("input"));

        for (const input of inputs) {
            if (input.offsetParent === null) continue;

            const valor = String(input.value || "").trim();
            if (/^\d+\/\d+$/.test(valor)) return valor;
        }

        return "";
    }

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

            if (match) return Number(match[1]);
        }

        return null;
    }

    function sincronizarEstado() {
        const apartamentoLido = encontrarApartamento();
        const quantidadeLida = lerQuantidadeEncomendas();

        if (!apartamentoLido) {
            if (sessaoAtiva && quantidadeRestante > 0) {
                registrarSaida("Campo apagado antes de concluir a baixa");
            }

            apartamentoAtual = "";
            quantidadeRestante = 0;
            sessaoAtiva = false;
            saidaProcessada = false;
            atualizarPainel();
            return;
        }

        if (apartamentoAtual && apartamentoLido !== apartamentoAtual) {
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

        if (quantidadeLida === null) return;

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
        if (saidaProcessada) return;
        if (!sessaoAtiva) return;
        if (!apartamentoAtual) return;
        if (quantidadeRestante <= 0) return;

        saidaProcessada = true;

        const texto = quantidadeRestante === 1
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
            registrarSaida("Saiu da tela de encomendas");
            ultimaURL = location.href;
        }

        sincronizarEstado();
    }, 700);

    document.addEventListener(
        "click",
        evento => {
            const botao = evento.target.closest("button");
            if (!botao) return;

            if (
                botao.getAttribute("data-testid") ===
                "residence-autocomplete-clear-input-button"
            ) {
                registrarSaida("Campo apagado antes de concluir a baixa");
            }
        },
        true
    );

    window.addEventListener(
        "pagehide",
        () => registrarSaida("Página fechada ou atualizada"),
        { capture: true }
    );

    // ==========================================================
    // PAINEL PREMIUM — APENAS VISUAL
    // ==========================================================

    function adicionarEstilo() {
        if (document.querySelector("#monitorSimplesCSS")) return;

        const style = document.createElement("style");
        style.id = "monitorSimplesCSS";
        style.textContent = `
            #botaoMonitorSimples,#painelMonitorSimples,#painelMonitorSimples *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
            #botaoMonitorSimples{display:inline-flex!important;align-items:center;justify-content:center;gap:8px;margin-left:10px!important;padding:9px 14px!important;border:1px solid #22c55e!important;border-radius:9px!important;background:#090909!important;color:#22c55e!important;font-size:11px!important;font-weight:800!important;letter-spacing:.4px;cursor:pointer!important;box-shadow:0 0 15px rgba(34,197,94,.16);transition:.18s}
            #botaoMonitorSimples:hover{background:#22c55e!important;color:#050505!important;box-shadow:0 0 22px rgba(34,197,94,.35)}
            .ledMonitorSimples,.ledPainel{border-radius:50%;background:#22c55e;box-shadow:0 0 12px #22c55e;animation:pulsoMonitor 1.25s infinite}.ledMonitorSimples{width:8px;height:8px}.ledPainel{width:12px;height:12px}@keyframes pulsoMonitor{50%{opacity:.35;transform:scale(.82)}}
            #painelMonitorSimples{position:fixed;top:60px;right:24px;width:420px;height:610px;display:flex;flex-direction:column;background:radial-gradient(circle at top right,rgba(34,197,94,.1),transparent 30%),#050505;color:#fff;border:1px solid #22c55e;border-radius:18px;box-shadow:0 0 36px rgba(34,197,94,.28);z-index:2147483647;overflow:hidden}
            .cabecalhoMonitor{display:flex;align-items:center;justify-content:space-between;padding:18px;border-bottom:1px solid rgba(34,197,94,.18)}
            .tituloMonitor{color:#22c55e;font-size:17px;font-weight:900;letter-spacing:.8px;text-shadow:0 0 14px rgba(34,197,94,.65)}
            .subtituloMonitor{margin-top:4px;color:#666;font-size:9px;font-weight:700;letter-spacing:2px}
            .statusMonitor{margin:14px 16px 0;padding:13px;border:1px solid rgba(34,197,94,.22);border-radius:12px;background:rgba(0,0,0,.58)}
            .linhaStatus{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:23px;color:#888;font-size:11px;font-weight:700}.valorStatus{max-width:235px;color:#22c55e;font-size:12px;font-weight:900;text-align:right;overflow-wrap:anywhere}
            .abasMonitor,.acoesMonitor{display:flex;gap:8px;padding:12px 16px 0}.abaMonitor,.acoesMonitor button{flex:1;padding:9px 7px;border-radius:9px;font-size:10px;font-weight:900;cursor:pointer;transition:.18s}.abaMonitor{border:1px solid rgba(34,197,94,.2);background:rgba(17,24,39,.72);color:#777}.abaMonitor.ativa,.abaMonitor:hover{border-color:#22c55e;background:rgba(34,197,94,.1);color:#22c55e}
            #limparHistoricoSimples{border:1px solid #ef4444;background:rgba(239,68,68,.1);color:#ef4444}#fecharMonitorSimples{border:1px solid #22c55e;background:rgba(34,197,94,.1);color:#22c55e}
            .areaMonitor{flex:1;min-height:0;padding:12px 16px 14px}#listaMonitorSimples,#comoUsarMonitorSimples{height:100%;overflow-y:auto;padding-right:4px}
            .registroMonitor{margin-bottom:9px;padding:12px;border:1px solid rgba(34,197,94,.2);border-radius:12px;background:rgba(17,24,39,.86)}.apartamentoRegistro{color:#22c55e;font-size:18px;font-weight:900}.motivoRegistro{margin-top:5px;color:#fbbf24;font-size:10px;line-height:15px}.dataRegistro{margin-top:6px;color:#777;font-size:10px}.vazioMonitor{padding:80px 10px;color:#555;font-size:11px;font-weight:800;letter-spacing:2px;text-align:center}
            .blocoAjuda{margin-bottom:10px;padding:13px;border:1px solid rgba(34,197,94,.18);border-radius:12px;background:rgba(17,24,39,.75)}.blocoAjuda h3{margin:0 0 7px;color:#22c55e;font-size:12px}.blocoAjuda p{margin:0;color:#aaa;font-size:11px;line-height:17px}.blocoAjuda strong{color:#fff}.rodapeMonitor{padding:8px 16px 12px;color:#444;font-size:9px;text-align:center}
            @media(max-width:600px){#painelMonitorSimples{top:10px;left:10px;right:10px;width:auto;height:calc(100vh - 20px)}.tituloMonitor{font-size:14px}.valorStatus{max-width:175px}}
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function criarBotao() {
        adicionarEstilo();
        if (document.querySelector("#botaoMonitorSimples")) return;

        const referencia = document.querySelector(
            'button[data-testid="delivery-select-multiple-deliveries-button"]'
        );
        if (!referencia) return;

        const botao = document.createElement("button");
        botao.id = "botaoMonitorSimples";
        botao.type = "button";
        botao.innerHTML = `MONITOR DE ENCOMENDAS <span class="ledMonitorSimples"></span>`;
        botao.addEventListener("click", abrirPainel);
        referencia.insertAdjacentElement("afterend", botao);
    }

    function abrirPainel() {
        if (painelAberto) return;
        painelAberto = true;

        const painel = document.createElement("div");
        painel.id = "painelMonitorSimples";
        painel.innerHTML = `
            <div class="cabecalhoMonitor">
                <div><div class="tituloMonitor">MONITOR DE ENCOMENDAS</div><div class="subtituloMonitor">SISTEMA ONLINE · V1.1</div></div>
                <div class="ledPainel"></div>
            </div>
            <div class="statusMonitor">
                <div class="linhaStatus"><span>MONITORAMENTO</span><span class="valorStatus">ATIVO</span></div>
                <div class="linhaStatus"><span>APARTAMENTO</span><span id="aptMonitorSimples" class="valorStatus">-</span></div>
                <div class="linhaStatus"><span>ENCOMENDAS RESTANTES</span><span id="qtdMonitorSimples" class="valorStatus">0</span></div>
                <div class="linhaStatus"><span>REGISTROS</span><span id="registrosMonitorSimples" class="valorStatus">0</span></div>
            </div>
            <div class="abasMonitor">
                <button id="abaHistoricoSimples" class="abaMonitor ativa">HISTÓRICO</button>
                <button id="abaAjudaSimples" class="abaMonitor">COMO USAR</button>
            </div>
            <div class="acoesMonitor">
                <button id="limparHistoricoSimples">LIMPAR HISTÓRICO</button>
                <button id="fecharMonitorSimples">FECHAR</button>
            </div>
            <div class="areaMonitor">
                <div id="listaMonitorSimples"></div>
                <div id="comoUsarMonitorSimples" style="display:none">
                    <div class="blocoAjuda"><h3>1. Pesquise o apartamento</h3><p>Digite normalmente, por exemplo <strong>2/999</strong>.</p></div>
                    <div class="blocoAjuda"><h3>2. O monitor lê a quantidade</h3><p>O texto <strong>“X encomenda(s)”</strong> informa quantas ainda estão pendentes.</p></div>
                    <div class="blocoAjuda"><h3>3. Quantidade igual a zero</h3><p>Ao chegar em <strong>0 encomendas</strong>, nenhuma ocorrência é registrada.</p></div>
                    <div class="blocoAjuda"><h3>4. Saída com pendência</h3><p>Ao sair, apagar o campo, trocar de apartamento ou atualizar com uma ou mais encomendas, o histórico registra automaticamente.</p></div>
                    <div class="blocoAjuda"><h3>Exemplo</h3><p>Entrou com 3, deu baixa em 2 e saiu com 1: registra <strong>“1 Encomenda não dado baixa”</strong>.</p></div>
                </div>
            </div>
            <div class="rodapeMonitor">Criado por Daniel Alexandre</div>
        `;

        document.body.appendChild(painel);

        const abaHistorico = painel.querySelector("#abaHistoricoSimples");
        const abaAjuda = painel.querySelector("#abaAjudaSimples");
        const lista = painel.querySelector("#listaMonitorSimples");
        const ajuda = painel.querySelector("#comoUsarMonitorSimples");

        abaHistorico.onclick = () => {
            abaHistorico.classList.add("ativa");
            abaAjuda.classList.remove("ativa");
            lista.style.display = "block";
            ajuda.style.display = "none";
        };

        abaAjuda.onclick = () => {
            abaAjuda.classList.add("ativa");
            abaHistorico.classList.remove("ativa");
            lista.style.display = "none";
            ajuda.style.display = "block";
        };

        painel.querySelector("#limparHistoricoSimples").onclick = () => {
            if (!confirm("Deseja realmente limpar todo o histórico?")) return;
            localStorage.removeItem(STORAGE_HISTORICO);
            atualizarPainel();
        };

        painel.querySelector("#fecharMonitorSimples").onclick = () => {
            painel.remove();
            painelAberto = false;
        };

        atualizarPainel();
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelMonitorSimples");
        if (!painel) return;

        const historico = obterHistorico();
        painel.querySelector("#aptMonitorSimples").textContent = apartamentoAtual || "-";
        painel.querySelector("#qtdMonitorSimples").textContent = String(quantidadeRestante || 0);
        painel.querySelector("#registrosMonitorSimples").textContent = String(historico.length);

        const lista = painel.querySelector("#listaMonitorSimples");

        if (!historico.length) {
            lista.innerHTML = `<div class="vazioMonitor">SEM REGISTROS</div>`;
            return;
        }

        lista.innerHTML = historico.map(item => `
            <div class="registroMonitor">
                <div class="apartamentoRegistro">${escaparHTML(item.apartamento)}</div>
                <div class="motivoRegistro">${escaparHTML(item.motivo)}</div>
                <div class="dataRegistro">${escaparHTML(item.dataCompleta)}</div>
            </div>
        `).join("");
    }

    // ==========================================================
    // INICIALIZAÇÃO
    // ==========================================================

    const observadorBotao = new MutationObserver(criarBotao);
    observadorBotao.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    criarBotao();
    sincronizarEstado();
})();