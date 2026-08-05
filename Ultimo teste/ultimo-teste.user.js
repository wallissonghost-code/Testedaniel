// ==UserScript==
// @name         Último Teste - Monitor de Encomendas Premium
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Script único: monitora apenas Aguardando entrega, registra ao sair e remove automaticamente quando X chega a 0.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_HISTORICO = "monitor_encomendas_simples_historico";
    const INTERVALO = 400;

    let apartamentoAtual = "";
    let quantidadeRestante = 0;
    let sessaoAtiva = false;
    let saidaProcessada = false;
    let ultimaURL = location.href;
    let painelAberto = false;
    let logsSistema = [];
    let intervaloMatrix = null;

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
            const lista = JSON.parse(localStorage.getItem(STORAGE_HISTORICO) || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function gravarHistorico(lista) {
        localStorage.setItem(STORAGE_HISTORICO, JSON.stringify(lista.slice(0, 500)));
    }

    function filtroSelecionado() {
        const botao = [...document.querySelectorAll(
            'button[data-testid="delivery-status-filter-button"]'
        )].find(el => el.offsetParent !== null);

        if (!botao) return "";

        const texto = normalizarTexto(
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

        return "";
    }

    function filtroAguardandoAtivo() {
        return filtroSelecionado() === "aguardando";
    }

    function encontrarApartamento() {
        if (!filtroAguardandoAtivo()) return "";

        const campo = [...document.querySelectorAll(
            'input[data-testid="residence-autocomplete-input-search"]'
        )].find(el => el.offsetParent !== null);

        if (!campo) return "";

        const valor = String(campo.value || "").trim();
        return /^\d+\/\d+$/.test(valor) ? valor : "";
    }

    function lerQuantidadeEncomendas() {
        if (!filtroAguardandoAtivo()) return null;

        const tabela = [...document.querySelectorAll(
            '[data-testid="delivery-table"]'
        )].find(el => el.offsetParent !== null);

        if (!tabela) return null;

        for (const elemento of tabela.querySelectorAll("footer small")) {
            if (elemento.offsetParent === null) continue;

            const match = normalizarTexto(elemento.textContent).match(
                /(?:^|\s)(\d+)\s+encomenda(?:\(s\)|s)?(?:\s|$)/
            );

            if (match) return Number(match[1]);
        }

        return null;
    }

    function removerApartamentoDoHistorico(apartamento) {
        if (!apartamento) return false;

        const historico = obterHistorico();
        const novo = historico.filter(item => item.apartamento !== apartamento);

        if (novo.length === historico.length) return false;

        gravarHistorico(novo);
        registrarEvento("BAIXA", "Registro removido automaticamente", apartamento);
        atualizarPainel();
        return true;
    }

    function salvarHistorico(apartamento, quantidade, motivo) {
        if (!apartamento || quantidade <= 0) return;

        const historico = obterHistorico().filter(
            item => item.apartamento !== apartamento
        );

        historico.unshift({
            apartamento,
            quantidade,
            motivo,
            dataCompleta: new Date().toLocaleString("pt-BR"),
            timestamp: Date.now()
        });

        gravarHistorico(historico);
        registrarEvento("HISTÓRICO", motivo, apartamento);
        atualizarPainel();
    }

    function encerrarSessao() {
        apartamentoAtual = "";
        quantidadeRestante = 0;
        sessaoAtiva = false;
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

        apartamentoAtual = "";
        quantidadeRestante = 0;
        sessaoAtiva = false;
    }

    function sincronizarEstado() {
        // Fora de Aguardando entrega, não lê, não registra e não reaproveita estado.
        if (!filtroAguardandoAtivo()) {
            encerrarSessao();
            return;
        }

        const apartamentoLido = encontrarApartamento();

        if (!apartamentoLido) {
            if (sessaoAtiva && quantidadeRestante > 0) {
                registrarSaida("Campo apagado antes de concluir a baixa");
            }
            encerrarSessao();
            return;
        }

        if (apartamentoAtual && apartamentoAtual !== apartamentoLido) {
            registrarSaida("Outra residência foi pesquisada antes de concluir a baixa");
            apartamentoAtual = apartamentoLido;
            quantidadeRestante = 0;
            sessaoAtiva = false;
            saidaProcessada = false;
        }

        apartamentoAtual = apartamentoLido;

        const quantidadeLida = lerQuantidadeEncomendas();
        if (quantidadeLida === null) return;

        quantidadeRestante = quantidadeLida;

        if (quantidadeRestante === 0) {
            removerApartamentoDoHistorico(apartamentoAtual);
            sessaoAtiva = false;
            saidaProcessada = false;
            atualizarPainel();
            return;
        }

        sessaoAtiva = quantidadeRestante > 0;
        saidaProcessada = false;
        atualizarPainel();
    }

    function cicloPrincipal() {
        // Primeiro registra a saída usando a sessão da tela anterior.
        if (location.href !== ultimaURL) {
            registrarSaida("Saiu da tela de encomendas");
            ultimaURL = location.href;
            encerrarSessao();
            return;
        }

        sincronizarEstado();
    }

    document.addEventListener("click", evento => {
        const botao = evento.target.closest("button");
        if (!botao) return;

        if (botao.getAttribute("data-testid") === "residence-autocomplete-clear-input-button") {
            registrarSaida("Campo apagado antes de concluir a baixa");
        }
    }, true);

    window.addEventListener("pagehide", () => {
        registrarSaida("Página fechada ou atualizada");
    }, { capture: true });

    window.addEventListener("beforeunload", () => {
        registrarSaida("Página fechada ou atualizada");
    }, { capture: true });

    function registrarEvento(tipo, mensagem, destaque = "") {
        logsSistema.unshift({
            tipo,
            mensagem,
            destaque,
            hora: new Date().toLocaleTimeString("pt-BR")
        });
        logsSistema = logsSistema.slice(0, 100);
        atualizarPainel();
    }

    function adicionarEstiloPainel() {
        if (document.querySelector("#cssMonitor505")) return;

        const style = document.createElement("style");
        style.id = "cssMonitor505";
        style.textContent = `
            #painelConsultas505,#painelConsultas505 *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
            #painelConsultas505{animation:abrirPainel505 .25s ease-out}
            @keyframes abrirPainel505{from{opacity:0;transform:translateY(-10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
            @keyframes piscarLed505{50%{opacity:.3;transform:scale(.8)}}
            .conteudoPainel505{position:relative;z-index:2;padding:18px;height:100%;display:flex;flex-direction:column}
            .topoPainel505{display:flex;justify-content:space-between;align-items:center}
            .tituloPainel505{font-size:18px;font-weight:bold;color:#22c55e;letter-spacing:1px;text-shadow:0 0 15px rgba(34,197,94,.9)}
            .subtituloPainel505{font-size:10px;color:#777;margin-top:5px;letter-spacing:2px}
            .ledSistema505{width:13px;height:13px;border-radius:50%;background:#22c55e;box-shadow:0 0 18px #22c55e;animation:piscarLed505 1.3s infinite}
            .statusBox505{margin-top:15px;padding:12px;border-radius:12px;background:rgba(0,0,0,.72);border:1px solid rgba(34,197,94,.25);font-size:12px;color:#aaa;line-height:20px}
            .statusLinha505{display:flex;justify-content:space-between;gap:10px}
            .statusValor505{color:#22c55e;font-weight:bold;text-align:right;max-width:230px;overflow-wrap:anywhere}
            .abasPainel505,.acoesPainel505{display:flex;gap:8px;margin-top:10px}
            .abaPainel505,.acoesPainel505 button{flex:1;border-radius:9px;padding:8px 5px;cursor:pointer;font-size:10px;font-weight:bold}
            .abaPainel505{border:1px solid rgba(34,197,94,.25);background:rgba(17,24,39,.75);color:#888}
            .abaPainel505.ativa505{color:#22c55e;border-color:#22c55e;background:rgba(34,197,94,.10)}
            #limparHistorico505{background:rgba(239,68,68,.12);border:1px solid #ef4444;color:#ef4444}
            #limparConsole505{background:rgba(59,130,246,.12);border:1px solid #3b82f6;color:#60a5fa}
            #fecharPainel505{background:rgba(34,197,94,.12);border:1px solid #22c55e;color:#22c55e}
            .areaConteudo505{position:relative;flex:1;min-height:0;margin-top:12px}
            .listaSistema505,.consoleSistema505{height:100%;overflow-y:auto;padding-right:5px}
            .registroSistema505{background:rgba(17,24,39,.88);border:1px solid rgba(34,197,94,.20);padding:12px;border-radius:12px;margin-bottom:9px}
            .codigoSistema505{font-size:18px;font-weight:bold;color:#22c55e}
            .dataSistema505{margin-top:5px;font-size:11px;color:#888}
            .motivoSistema505{margin-top:5px;font-size:10px;color:#fbbf24;line-height:15px}
            .eventoConsole505{background:rgba(0,0,0,.78);border-left:3px solid #22c55e;padding:9px 10px;margin-bottom:7px;border-radius:5px;font-family:monospace}
            .eventoTopo505{display:flex;justify-content:space-between}.eventoTipo505{color:#22c55e;font-size:10px;font-weight:bold}.eventoHora505{color:#555;font-size:9px}.eventoMensagem505{color:#aaa;font-size:11px;margin-top:5px}
            .vazioSistema505{text-align:center;margin-top:80px;color:#777;font-size:12px;letter-spacing:2px}.rodapePainel505{text-align:center;font-size:9px;color:#ccc;padding-top:8px}
            #tooltipMonitor505{display:none;position:fixed;width:320px;padding:15px;background:#050505;border:1px solid #22c55e;border-radius:12px;z-index:2147483647;box-shadow:0 0 30px rgba(34,197,94,.35);color:#fff}
            .tooltipTitulo505{color:#22c55e;font-weight:bold;font-size:14px;margin-bottom:10px}.tooltipTexto505{font-size:12px;color:#aaa;line-height:18px}.tooltipAutor505{margin-top:10px;text-align:right;color:#22c55e;font-size:11px}
            #botaoMonitor505{display:inline-flex!important;align-items:center;justify-content:center;gap:8px;white-space:nowrap;margin-left:10px!important}.ledBotao505{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 12px #22c55e;animation:piscarLed505 1s infinite}
            @media(max-width:600px){#painelConsultas505{top:10px!important;left:10px!important;right:10px!important;width:auto!important;height:calc(100vh - 20px)!important}}
        `;
        document.head.appendChild(style);
    }

    function criarBotao() {
        adicionarEstiloPainel();
        if (document.querySelector("#botaoMonitor505")) return;

        const referencia = document.querySelector(
            'button[data-testid="delivery-select-multiple-deliveries-button"]'
        );
        if (!referencia) return;

        const botao = document.createElement("button");
        botao.id = "botaoMonitor505";
        botao.type = "button";
        botao.className = referencia.className;
        botao.innerHTML = 'MONITOR DE ENCOMENDAS <span class="ledBotao505"></span>';
        botao.addEventListener("click", abrirPainel);
        referencia.insertAdjacentElement("afterend", botao);
        criarTooltip(botao);
    }

    function criarTooltip(botao) {
        document.querySelector("#tooltipMonitor505")?.remove();
        const tooltip = document.createElement("div");
        tooltip.id = "tooltipMonitor505";
        tooltip.innerHTML = `
            <div class="tooltipTitulo505">MONITOR DE ENCOMENDAS</div>
            <div class="tooltipTexto505">
                O monitor só funciona quando o filtro selecionado estiver em
                <b style="color:#22c55e">Aguardando entrega</b>.
                <br><br>
                Em <b>Todos</b> ou <b>Entregues</b>, nenhuma unidade ou quantidade é considerada.
                <br><br>
                O valor <b style="color:#22c55e">X encomenda(s)</b> é o veredito:
                se chegar a <b style="color:#22c55e">0</b>, a unidade é removida automaticamente do histórico.
                <br><br>
                Ao trocar de tela, apagar o campo, atualizar ou fechar a página com X maior que 0,
                a pendência é registrada.
            </div>
            <div class="tooltipAutor505">Criado por Daniel Alexandre</div>
        `;
        document.body.appendChild(tooltip);

        botao.addEventListener("mouseenter", () => {
            const posicao = botao.getBoundingClientRect();
            tooltip.style.display = "block";
            tooltip.style.top = `${posicao.bottom + 8}px`;
            tooltip.style.left = `${Math.max(10, Math.min(posicao.left, window.innerWidth - 330))}px`;
        });
        botao.addEventListener("mouseleave", () => tooltip.style.display = "none");
    }

    function abrirPainel() {
        if (painelAberto) return;
        painelAberto = true;
        adicionarEstiloPainel();

        const painel = document.createElement("div");
        painel.id = "painelConsultas505";
        Object.assign(painel.style, {
            position: "fixed", top: "60px", right: "25px", width: "410px", height: "610px",
            background: "#050505", color: "#fff", zIndex: "2147483646", borderRadius: "18px",
            overflow: "hidden", border: "1px solid #22c55e", boxShadow: "0 0 35px rgba(34,197,94,.35)"
        });

        painel.innerHTML = `
            <canvas id="matrixPainel505" style="position:absolute;inset:0;width:100%;height:100%;opacity:.12;pointer-events:none"></canvas>
            <div class="conteudoPainel505">
                <div class="topoPainel505"><div><div class="tituloPainel505">MONITOR DE ENCOMENDAS</div><div class="subtituloPainel505">SYSTEM ONLINE · V2.0</div></div><div class="ledSistema505"></div></div>
                <div class="statusBox505">
                    <div class="statusLinha505"><span>MONITORAMENTO</span><span id="statusMonitor505" class="statusValor505">ATIVO</span></div>
                    <div class="statusLinha505"><span>ENCOMENDA ATUAL</span><span id="codigoAtual505" class="statusValor505">NENHUMA</span></div>
                    <div class="statusLinha505"><span>ETAPA DA BAIXA</span><span id="etapaBaixa505" class="statusValor505">AGUARDANDO</span></div>
                    <div class="statusLinha505"><span>REGISTROS</span><span id="quantidadeRegistros505" class="statusValor505">0</span></div>
                    <div class="statusLinha505"><span>ÚLTIMA AÇÃO</span><span id="ultimaAcao505" class="statusValor505">INTERFACE: Painel aberto</span></div>
                </div>
                <div class="abasPainel505"><button id="abaHistorico505" class="abaPainel505 ativa505">HISTÓRICO</button><button id="abaTempoReal505" class="abaPainel505">TEMPO REAL</button></div>
                <div class="acoesPainel505"><button id="limparHistorico505">LIMPAR HISTÓRICO</button><button id="limparConsole505">LIMPAR CONSOLE</button><button id="fecharPainel505">FECHAR</button></div>
                <div class="areaConteudo505"><div id="listaHistorico505" class="listaSistema505"></div><div id="consoleTempoReal505" class="consoleSistema505" style="display:none"></div></div>
                <div class="rodapePainel505">Criado por Daniel Alexandre</div>
            </div>`;

        document.body.appendChild(painel);
        configurarPainel(painel);
        atualizarPainel();
        iniciarMatrix();
        registrarEvento("INTERFACE", "Painel aberto");
    }

    function configurarPainel(painel) {
        const abaHistorico = painel.querySelector("#abaHistorico505");
        const abaTempoReal = painel.querySelector("#abaTempoReal505");
        const historico = painel.querySelector("#listaHistorico505");
        const consoleReal = painel.querySelector("#consoleTempoReal505");

        abaHistorico.onclick = () => {
            abaHistorico.classList.add("ativa505"); abaTempoReal.classList.remove("ativa505");
            historico.style.display = "block"; consoleReal.style.display = "none";
        };
        abaTempoReal.onclick = () => {
            abaTempoReal.classList.add("ativa505"); abaHistorico.classList.remove("ativa505");
            historico.style.display = "none"; consoleReal.style.display = "block"; atualizarPainel();
        };
        painel.querySelector("#limparHistorico505").onclick = () => {
            if (!confirm("Deseja limpar todo o histórico?")) return;
            localStorage.removeItem(STORAGE_HISTORICO); registrarEvento("HISTÓRICO", "Histórico apagado"); atualizarPainel();
        };
        painel.querySelector("#limparConsole505").onclick = () => { logsSistema = []; registrarEvento("SISTEMA", "Console limpo"); };
        painel.querySelector("#fecharPainel505").onclick = () => {
            painel.remove(); painelAberto = false;
            if (intervaloMatrix) { clearInterval(intervaloMatrix); intervaloMatrix = null; }
        };
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelConsultas505");
        if (!painel) return;

        const aguardando = filtroAguardandoAtivo();
        const historico = obterHistorico();
        painel.querySelector("#statusMonitor505").textContent = aguardando ? "ATIVO" : "PAUSADO PELO FILTRO";
        painel.querySelector("#codigoAtual505").textContent = aguardando && apartamentoAtual ? apartamentoAtual : "NENHUMA";
        painel.querySelector("#etapaBaixa505").textContent = aguardando
            ? (quantidadeRestante > 0 ? `${quantidadeRestante} RESTANTE(S)` : apartamentoAtual ? "SEM PENDÊNCIAS" : "AGUARDANDO")
            : "IGNORANDO TODOS/ENTREGUES";
        painel.querySelector("#quantidadeRegistros505").textContent = String(historico.length);
        painel.querySelector("#ultimaAcao505").textContent = logsSistema[0]
            ? `${logsSistema[0].tipo}: ${logsSistema[0].mensagem}` : "SISTEMA INICIADO";

        const lista = painel.querySelector("#listaHistorico505");
        lista.innerHTML = historico.length ? historico.map(item => `
            <div class="registroSistema505"><div class="codigoSistema505">${escaparHTML(item.apartamento)}</div><div class="dataSistema505">${escaparHTML(item.dataCompleta)}</div><div class="motivoSistema505">${escaparHTML(item.motivo)}</div></div>
        `).join("") : '<div class="vazioSistema505">SEM REGISTROS</div>';

        const consoleReal = painel.querySelector("#consoleTempoReal505");
        consoleReal.innerHTML = logsSistema.length ? logsSistema.map(log => `
            <div class="eventoConsole505"><div class="eventoTopo505"><span class="eventoTipo505">${escaparHTML(log.tipo)}</span><span class="eventoHora505">${escaparHTML(log.hora)}</span></div><div class="eventoMensagem505">${escaparHTML(log.mensagem)}</div></div>
        `).join("") : '<div class="vazioSistema505">SEM EVENTOS</div>';
    }

    function iniciarMatrix() {
        const canvas = document.querySelector("#matrixPainel505");
        if (!canvas) return;
        const contexto = canvas.getContext("2d");
        canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
        const caracteres = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const tamanho = 13;
        const colunas = Math.floor(canvas.width / tamanho);
        const gotas = Array(colunas).fill(1);
        intervaloMatrix = setInterval(() => {
            contexto.fillStyle = "rgba(0,0,0,.08)"; contexto.fillRect(0, 0, canvas.width, canvas.height);
            contexto.fillStyle = "#22c55e"; contexto.font = `${tamanho}px monospace`;
            gotas.forEach((y, indice) => {
                const caractere = caracteres[Math.floor(Math.random() * caracteres.length)];
                contexto.fillText(caractere, indice * tamanho, y * tamanho);
                if (y * tamanho > canvas.height && Math.random() > .975) gotas[indice] = 0;
                gotas[indice]++;
            });
        }, 70);
    }

    new MutationObserver(criarBotao).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(cicloPrincipal, INTERVALO);
    criarBotao();
    cicloPrincipal();
})();
