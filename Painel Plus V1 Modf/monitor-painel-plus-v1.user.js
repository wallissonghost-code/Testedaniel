// ==UserScript==
// @name         Painel Plus V1 Modf
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Dupla checagem pelo contador X encomenda(s) e pela tabela detalhada, com reconciliação automática.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE = "painel_plus_v1_modf_pendencias";
    const INTERVALO = 800;
    const ZERO_CONFIRMACOES = 2;

    let apartamentoAtual = "";
    let contadorAtual = null;
    let linhasAtuais = [];
    let ultimaURL = location.href;
    let saidaProcessada = false;
    let zeroApto = "";
    let zerosSeguidos = 0;

    function normalizar(valor) {
        return String(valor || "").trim().toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function carregar() {
        try {
            const lista = JSON.parse(localStorage.getItem(STORAGE) || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function gravar(lista) {
        localStorage.setItem(STORAGE, JSON.stringify(lista.slice(0, 500)));
        atualizarPainel();
    }

    function encontrarApartamento() {
        for (const input of document.querySelectorAll("input")) {
            if (input.offsetParent === null) continue;
            const valor = String(input.value || "").trim();
            if (/^\d+\/\d+$/.test(valor)) return valor;
        }
        return "";
    }

    function lerContador() {
        for (const elemento of document.querySelectorAll("small, span")) {
            if (elemento.offsetParent === null) continue;
            const texto = normalizar(elemento.textContent);
            const achou = texto.match(/(?:^|\s)(\d+)\s+encomenda(?:\(s\)|s)?(?:\s|$)/);
            if (achou) return Number(achou[1]);
        }
        return null;
    }

    function localizarTabela() {
        for (const tabela of document.querySelectorAll("table")) {
            if (tabela.offsetParent === null) continue;
            const texto = normalizar(tabela.innerText);
            if (texto.includes("encomenda") || texto.includes("destinatario")) {
                return tabela;
            }
        }
        return null;
    }

    function capturarLinhas(apartamento) {
        const tabela = localizarTabela();
        if (!tabela) return [];

        const resultado = [];

        for (const tr of tabela.querySelectorAll("tbody tr")) {
            if (tr.offsetParent === null) continue;

            const colunas = Array.from(tr.querySelectorAll("td"))
                .map(td => td.innerText.trim());

            if (colunas.length < 2) continue;

            const unidade = colunas.find(v => /^\d+\/\d+$/.test(v)) || "";
            if (unidade !== apartamento) continue;

            resultado.push({
                numero: colunas[0] || "",
                apartamento: unidade,
                destinatario: colunas[2] || "",
                status: colunas[3] || "",
                data: colunas[4] || "",
                resumo: colunas.join(" | ")
            });
        }

        return resultado;
    }

    function chave(item) {
        return [
            item.numero,
            item.apartamento,
            item.destinatario,
            item.status,
            item.data,
            item.resumo
        ].join("|");
    }

    function registroDo(apartamento) {
        return carregar().find(item => item.apartamento === apartamento) || null;
    }

    function remover(apartamento) {
        const lista = carregar();
        const nova = lista.filter(item => item.apartamento !== apartamento);
        if (nova.length !== lista.length) gravar(nova);
    }

    function salvarRegistro(registro) {
        const lista = carregar();
        const indice = lista.findIndex(item => item.apartamento === registro.apartamento);

        registro.atualizadoEm = new Date().toLocaleString("pt-BR");
        registro.timestamp = Date.now();

        if (indice >= 0) lista[indice] = registro;
        else lista.unshift(registro);

        gravar(lista);
    }

    function criarPendenciaNormal(apartamento, contador, linhas, motivo) {
        if (!apartamento || contador === null || contador <= 0) return;

        const anterior = registroDo(apartamento);
        const detalhes = linhas.length ? linhas : (anterior?.itensOriginais || []);

        salvarRegistro({
            apartamento,
            status: "PENDENTE",
            quantidade: contador,
            contadorCheck: contador,
            tabelaCheck: linhas.length,
            itensOriginais: detalhes,
            motivo,
            mensagem: `${contador} encomenda(s) sem baixa`
        });
    }

    function criarAguardandoConfirmacao(apartamento, linhas, motivo) {
        const anterior = registroDo(apartamento);
        const detalhes = linhas.length ? linhas : (anterior?.itensOriginais || []);

        salvarRegistro({
            apartamento,
            status: "AGUARDANDO_CONFIRMACAO",
            quantidade: 0,
            contadorCheck: 0,
            tabelaCheck: linhas.length,
            itensOriginais: detalhes,
            motivo,
            mensagem: linhas.length
                ? "Baixa identificada no contador; tabela ainda não confirmou"
                : "Baixa identificada; aguardando conferência final"
        });
    }

    function resetarZero() {
        zeroApto = "";
        zerosSeguidos = 0;
    }

    function confirmarZeroContador(apartamento, contador) {
        if (contador !== 0) {
            resetarZero();
            return false;
        }

        if (zeroApto !== apartamento) {
            zeroApto = apartamento;
            zerosSeguidos = 1;
            return false;
        }

        zerosSeguidos++;
        return zerosSeguidos >= ZERO_CONFIRMACOES;
    }

    function reconciliarRegistro(apartamento, contador, linhas) {
        const registro = registroDo(apartamento);
        if (!registro) return;

        if (contador === 0 && confirmarZeroContador(apartamento, contador)) {
            remover(apartamento);
            return;
        }

        if (contador === null) return;
        if (contador > 0) resetarZero();

        const chavesAtuais = new Set(linhas.map(chave));
        const originais = registro.itensOriginais || [];
        const antigasAindaPresentes = originais.filter(item => chavesAtuais.has(chave(item)));

        if (originais.length && linhas.length && antigasAindaPresentes.length === 0) {
            remover(apartamento);
            return;
        }

        if (registro.status === "AGUARDANDO_CONFIRMACAO") {
            if (contador === 0) return;

            if (originais.length && antigasAindaPresentes.length > 0) {
                salvarRegistro({
                    ...registro,
                    status: "PENDENTE",
                    quantidade: Math.min(contador, antigasAindaPresentes.length),
                    contadorCheck: contador,
                    tabelaCheck: linhas.length,
                    itensOriginais: antigasAindaPresentes,
                    mensagem: `${Math.min(contador, antigasAindaPresentes.length)} encomenda(s) antiga(s) ainda pendente(s)`,
                    motivo: "Reconciliação após reabrir a unidade"
                });
            }
            return;
        }

        if (originais.length && antigasAindaPresentes.length < originais.length) {
            if (!antigasAindaPresentes.length) {
                remover(apartamento);
                return;
            }

            salvarRegistro({
                ...registro,
                quantidade: antigasAindaPresentes.length,
                contadorCheck: contador,
                tabelaCheck: linhas.length,
                itensOriginais: antigasAindaPresentes,
                mensagem: `${antigasAindaPresentes.length} encomenda(s) antiga(s) ainda pendente(s)`,
                motivo: "Pendência atualizada pela tabela detalhada"
            });
        }
    }

    function registrarSaida(motivo) {
        if (saidaProcessada || !apartamentoAtual) return;

        const contadorSaida = lerContador();
        const linhasSaida = capturarLinhas(apartamentoAtual);

        if (contadorSaida === null) return;

        saidaProcessada = true;

        if (contadorSaida === 0) {
            criarAguardandoConfirmacao(
                apartamentoAtual,
                linhasSaida,
                `${motivo}. Contador marcou zero no fechamento.`
            );
            return;
        }

        criarPendenciaNormal(
            apartamentoAtual,
            contadorSaida,
            linhasSaida,
            motivo
        );
    }

    function limparSessao() {
        apartamentoAtual = "";
        contadorAtual = null;
        linhasAtuais = [];
        saidaProcessada = false;
        resetarZero();
        atualizarPainel();
    }

    function sincronizar() {
        const apartamento = encontrarApartamento();

        if (!apartamento) {
            if (apartamentoAtual) registrarSaida("Campo apagado ou consulta encerrada");
            limparSessao();
            return;
        }

        if (apartamentoAtual && apartamentoAtual !== apartamento) {
            registrarSaida("Outra unidade foi pesquisada");
            limparSessao();
        }

        apartamentoAtual = apartamento;
        contadorAtual = lerContador();
        linhasAtuais = capturarLinhas(apartamentoAtual);
        saidaProcessada = false;

        reconciliarRegistro(apartamentoAtual, contadorAtual, linhasAtuais);
        atualizarPainel();
    }

    setInterval(() => {
        if (location.href !== ultimaURL) {
            registrarSaida("Saiu da tela de encomendas");
            ultimaURL = location.href;
            limparSessao();
        }
        sincronizar();
    }, INTERVALO);

    document.addEventListener("click", evento => {
        const botao = evento.target.closest("button");
        if (!botao) return;

        if (botao.getAttribute("data-testid") === "residence-autocomplete-clear-input-button") {
            registrarSaida("Campo apagado antes de finalizar a consulta");
        }
    }, true);

    function processarFechamento() {
        registrarSaida("Sistema fechado, atualizado ou ocultado");
    }

    window.addEventListener("pagehide", processarFechamento, { capture: true });
    window.addEventListener("beforeunload", processarFechamento, { capture: true });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") processarFechamento();
    });

    function adicionarEstilo() {
        if (document.querySelector("#plusCSS")) return;

        const style = document.createElement("style");
        style.id = "plusCSS";
        style.textContent = `
            #botaoPainelPlus{margin-left:10px;padding:9px 14px;border:1px solid #22c55e;border-radius:8px;background:#080808;color:#22c55e;font:800 11px Arial;cursor:pointer}
            #painelPlus{position:fixed;top:60px;right:20px;width:410px;max-height:650px;background:#050505;color:#fff;border:1px solid #22c55e;border-radius:16px;box-shadow:0 0 30px rgba(34,197,94,.28);z-index:2147483647;font-family:Arial;overflow:hidden}
            #painelPlus .topo{padding:16px;border-bottom:1px solid rgba(34,197,94,.2)}
            #painelPlus .titulo{color:#22c55e;font-size:16px;font-weight:900}
            #painelPlus .status{margin:12px;padding:10px;border:1px solid rgba(34,197,94,.2);border-radius:10px;font-size:11px;line-height:1.8}
            #painelPlus .acoes{display:flex;gap:8px;padding:0 12px 12px}
            #painelPlus button{flex:1;padding:8px;border-radius:8px;font-weight:800;cursor:pointer}
            #painelPlus .lista{max-height:455px;overflow-y:auto;padding:0 12px 12px}
            #painelPlus .item{margin-bottom:8px;padding:10px;border:1px solid rgba(34,197,94,.2);border-radius:10px;background:#111827}
            #painelPlus .item.confirmacao{border-color:#f59e0b;background:#1c1608}
            #painelPlus .apt{color:#22c55e;font-size:18px;font-weight:900}
            #painelPlus .confirmacao .apt{color:#f59e0b}
            #painelPlus .meta{color:#aaa;font-size:11px;margin-top:4px}
            #painelPlus .checks{margin:8px 0;padding:8px;border-radius:8px;background:#080808;font-size:11px;line-height:1.65}
            #painelPlus .ok{color:#22c55e}.alerta{color:#f59e0b}.erro{color:#ef4444}
            #painelPlus .detalhes{display:none;margin-top:8px;padding-top:8px;border-top:1px solid #333;color:#ddd;font-size:10px;line-height:1.5}
            #painelPlus .vazio{padding:50px 10px;text-align:center;color:#666}
        `;
        document.head.appendChild(style);
    }

    function criarBotao() {
        adicionarEstilo();
        if (document.querySelector("#botaoPainelPlus")) return;

        const referencia = document.querySelector('button[data-testid="delivery-select-multiple-deliveries-button"]');
        if (!referencia) return;

        const botao = document.createElement("button");
        botao.id = "botaoPainelPlus";
        botao.type = "button";
        botao.textContent = "PAINEL PLUS V1";
        botao.onclick = abrirPainel;
        referencia.insertAdjacentElement("afterend", botao);
    }

    function abrirPainel() {
        const antigo = document.querySelector("#painelPlus");
        if (antigo) {
            antigo.remove();
            return;
        }

        const painel = document.createElement("div");
        painel.id = "painelPlus";
        painel.innerHTML = `
            <div class="topo"><div class="titulo">PAINEL PLUS V1 MODF · DUPLA CHECAGEM</div></div>
            <div class="status">
                Unidade atual: <strong id="plusApt">-</strong><br>
                X encomenda(s): <strong id="plusQtd">-</strong><br>
                Linhas da tabela: <strong id="plusTabela">0</strong><br>
                Registros agrupados: <strong id="plusTotal">0</strong>
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

        painel.querySelector("#plusFechar").onclick = () => painel.remove();
        atualizarPainel();
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelPlus");
        if (!painel) return;

        const lista = carregar();
        painel.querySelector("#plusApt").textContent = apartamentoAtual || "-";
        painel.querySelector("#plusQtd").textContent = contadorAtual === null ? "-" : String(contadorAtual);
        painel.querySelector("#plusTabela").textContent = String(linhasAtuais.length);
        painel.querySelector("#plusTotal").textContent = String(lista.length);

        const area = painel.querySelector("#plusLista");
        if (!lista.length) {
            area.innerHTML = '<div class="vazio">SEM PENDÊNCIAS</div>';
            return;
        }

        area.innerHTML = lista.map((item, indice) => {
            const aguardando = item.status === "AGUARDANDO_CONFIRMACAO";
            const classe = aguardando ? "item confirmacao" : "item";
            const contadorClasse = item.contadorCheck === 0 ? "ok" : "alerta";
            const tabelaClasse = item.tabelaCheck === 0 ? "ok" : "alerta";

            return `
                <div class="${classe}">
                    <div class="apt">${escapar(item.apartamento)}</div>
                    <div class="meta"><strong>${escapar(item.mensagem)}</strong></div>
                    <div class="checks">
                        <div class="${contadorClasse}">✓ X encomenda(s): ${item.contadorCheck ?? "não lido"}</div>
                        <div class="${tabelaClasse}">${item.tabelaCheck === 0 ? "✓" : "⚠"} Tabela detalhada: ${item.tabelaCheck ?? "não carregada"} linha(s)</div>
                    </div>
                    <div class="meta">Status: ${aguardando ? "BAIXA PROVÁVEL · AGUARDANDO CONFIRMAÇÃO" : "PENDENTE"}</div>
                    <div class="meta">${escapar(item.atualizadoEm)}</div>
                    <div class="meta">${escapar(item.motivo)}</div>
                    <button type="button" data-detalhe="${indice}">VER DETALHES</button>
                    <div class="detalhes" id="detalhe${indice}">
                        ${(item.itensOriginais || []).length
                            ? item.itensOriginais.map((e, i) => `
                                <div><strong>Encomenda ${i + 1}</strong><br>
                                Número: ${escapar(e.numero || "-")}<br>
                                Destinatário: ${escapar(e.destinatario || "-")}<br>
                                Status: ${escapar(e.status || "-")}<br>
                                Data: ${escapar(e.data || "-")}</div>
                                ${i < item.itensOriginais.length - 1 ? "<hr>" : ""}
                            `).join("")
                            : "Sem detalhes salvos pela tabela."}
                    </div>
                </div>
            `;
        }).join("");

        area.querySelectorAll("[data-detalhe]").forEach(botao => {
            botao.onclick = () => {
                const detalhes = area.querySelector(`#detalhe${botao.dataset.detalhe}`);
                const abrir = detalhes.style.display !== "block";
                detalhes.style.display = abrir ? "block" : "none";
                botao.textContent = abrir ? "OCULTAR DETALHES" : "VER DETALHES";
            };
        });
    }

    const observer = new MutationObserver(criarBotao);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    criarBotao();
    sincronizar();
})();
