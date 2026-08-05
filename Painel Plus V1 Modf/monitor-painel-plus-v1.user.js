// ==UserScript==
// @name         Painel Plus V1 Modf
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Pendências agrupadas por unidade, contador rápido, detalhes da tabela e reconciliação automática.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE = "painel_plus_v1_modf_pendencias";
    const INTERVALO = 800;
    const LIMITE_SUSPEITO = 50;

    let apartamentoAtual = "";
    let quantidadeAtual = null;
    let encomendasAtuais = [];
    let ultimaURL = location.href;
    let saidaProcessada = false;
    let zeroApartamento = "";
    let zeroConfirmacoes = 0;

    function normalizar(v) {
        return String(v || "").trim().toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function escapar(v) {
        return String(v ?? "")
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
        for (const el of document.querySelectorAll("small, span")) {
            if (el.offsetParent === null) continue;
            const texto = normalizar(el.textContent);
            const m = texto.match(/(?:^|\s)(\d+)\s+encomenda(?:\(s\)|s)?(?:\s|$)/);
            if (m) return Number(m[1]);
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

    function pendenciaExiste(apartamento) {
        return carregar().some(item => item.apartamento === apartamento);
    }

    function criarOuAtualizar(apartamento, quantidade, encomendas, motivo) {
        if (!apartamento || quantidade <= 0) return;

        const lista = carregar();
        const indice = lista.findIndex(item => item.apartamento === apartamento);
        const anterior = indice >= 0 ? lista[indice] : null;

        const registro = {
            apartamento,
            quantidade,
            encomendas: encomendas.length ? encomendas : (anterior?.encomendas || []),
            motivo,
            atualizadoEm: new Date().toLocaleString("pt-BR"),
            timestamp: Date.now()
        };

        if (indice >= 0) lista[indice] = registro;
        else lista.unshift(registro);

        gravar(lista);
    }

    function remover(apartamento) {
        const lista = carregar();
        const nova = lista.filter(item => item.apartamento !== apartamento);
        if (nova.length !== lista.length) gravar(nova);
    }

    function confirmarZero(apartamento, contador, linhas) {
        if (contador !== 0 || linhas.length !== 0) {
            zeroApartamento = "";
            zeroConfirmacoes = 0;
            return false;
        }

        if (zeroApartamento !== apartamento) {
            zeroApartamento = apartamento;
            zeroConfirmacoes = 1;
            return false;
        }

        zeroConfirmacoes++;
        return zeroConfirmacoes >= 2;
    }

    function registrarSaida(motivo) {
        if (saidaProcessada) return;
        if (!apartamentoAtual) return;
        if (quantidadeAtual === null || quantidadeAtual <= 0) return;

        saidaProcessada = true;
        criarOuAtualizar(
            apartamentoAtual,
            quantidadeAtual,
            encomendasAtuais,
            motivo
        );
    }

    function limparSessao() {
        apartamentoAtual = "";
        quantidadeAtual = null;
        encomendasAtuais = [];
        saidaProcessada = false;
        zeroApartamento = "";
        zeroConfirmacoes = 0;
        atualizarPainel();
    }

    function sincronizar() {
        const apartamento = encontrarApartamento();

        if (!apartamento) {
            if (apartamentoAtual && quantidadeAtual > 0) {
                registrarSaida("Campo apagado antes de concluir todas as baixas");
            }
            limparSessao();
            return;
        }

        if (apartamentoAtual && apartamentoAtual !== apartamento) {
            if (quantidadeAtual > 0) registrarSaida("Outra unidade foi pesquisada");
            limparSessao();
        }

        apartamentoAtual = apartamento;

        const contador = lerContador();
        const linhas = capturarLinhas(apartamentoAtual);

        if (contador === null) {
            atualizarPainel();
            return;
        }

        if (contador > LIMITE_SUSPEITO) {
            console.warn("[Painel Plus] Contador suspeito ignorado", contador);
            return;
        }

        if (contador === 0) {
            if (confirmarZero(apartamentoAtual, contador, linhas)) {
                quantidadeAtual = 0;
                encomendasAtuais = [];
                saidaProcessada = false;
                remover(apartamentoAtual);
            }
            atualizarPainel();
            return;
        }

        zeroApartamento = "";
        zeroConfirmacoes = 0;
        quantidadeAtual = contador;
        saidaProcessada = false;

        if (linhas.length) encomendasAtuais = linhas;

        if (pendenciaExiste(apartamentoAtual)) {
            criarOuAtualizar(
                apartamentoAtual,
                quantidadeAtual,
                encomendasAtuais,
                "Pendência atualizada automaticamente"
            );
        }

        if (linhas.length && linhas.length !== contador) {
            console.warn("[Painel Plus] Divergência", {
                apartamento: apartamentoAtual,
                contador,
                linhas: linhas.length
            });
        }

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
            registrarSaida("Campo apagado antes de concluir todas as baixas");
        }
    }, true);

    function fecharOuOcultar() {
        registrarSaida("Página fechada, atualizada ou aplicativo encerrado");
    }

    window.addEventListener("pagehide", fecharOuOcultar, { capture: true });
    window.addEventListener("beforeunload", fecharOuOcultar, { capture: true });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") fecharOuOcultar();
    });

    function adicionarEstilo() {
        if (document.querySelector("#plusCSS")) return;
        const style = document.createElement("style");
        style.id = "plusCSS";
        style.textContent = `
            #botaoPainelPlus{margin-left:10px;padding:9px 14px;border:1px solid #22c55e;border-radius:8px;background:#080808;color:#22c55e;font:800 11px Arial;cursor:pointer}
            #painelPlus{position:fixed;top:60px;right:20px;width:390px;max-height:620px;background:#050505;color:#fff;border:1px solid #22c55e;border-radius:16px;box-shadow:0 0 30px rgba(34,197,94,.28);z-index:2147483647;font-family:Arial;overflow:hidden}
            #painelPlus .topo{padding:16px;border-bottom:1px solid rgba(34,197,94,.2)}
            #painelPlus .titulo{color:#22c55e;font-size:16px;font-weight:900}
            #painelPlus .status{margin:12px;padding:10px;border:1px solid rgba(34,197,94,.2);border-radius:10px;font-size:11px;line-height:1.8}
            #painelPlus .acoes{display:flex;gap:8px;padding:0 12px 12px}
            #painelPlus button{flex:1;padding:8px;border-radius:8px;font-weight:800;cursor:pointer}
            #painelPlus .lista{max-height:430px;overflow-y:auto;padding:0 12px 12px}
            #painelPlus .item{margin-bottom:8px;padding:10px;border:1px solid rgba(34,197,94,.2);border-radius:10px;background:#111827}
            #painelPlus .apt{color:#22c55e;font-size:18px;font-weight:900}
            #painelPlus .meta{color:#aaa;font-size:11px;margin-top:4px}
            #painelPlus .detalhes{display:none;margin-top:8px;padding-top:8px;border-top:1px solid #333;color:#ddd;font-size:10px;line-height:1.5}
            #painelPlus .vazio{padding:50px 10px;text-align:center;color:#666}
        `;
        document.head.appendChild(style);
    }

    function criarBotao() {
        adicionarEstilo();
        if (document.querySelector("#botaoPainelPlus")) return;
        const ref = document.querySelector('button[data-testid="delivery-select-multiple-deliveries-button"]');
        if (!ref) return;
        const botao = document.createElement("button");
        botao.id = "botaoPainelPlus";
        botao.type = "button";
        botao.textContent = "PAINEL PLUS V1";
        botao.onclick = abrirPainel;
        ref.insertAdjacentElement("afterend", botao);
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
            <div class="topo"><div class="titulo">PAINEL PLUS V1 MODF</div></div>
            <div class="status">
                Unidade atual: <strong id="plusApt">-</strong><br>
                Contador atual: <strong id="plusQtd">-</strong><br>
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

        painel.querySelector("#plusFechar").onclick = () => painel.remove();
        atualizarPainel();
    }

    function atualizarPainel() {
        const painel = document.querySelector("#painelPlus");
        if (!painel) return;

        const lista = carregar();
        painel.querySelector("#plusApt").textContent = apartamentoAtual || "-";
        painel.querySelector("#plusQtd").textContent = quantidadeAtual === null ? "-" : String(quantidadeAtual);
        painel.querySelector("#plusTotal").textContent = String(lista.length);

        const area = painel.querySelector("#plusLista");
        if (!lista.length) {
            area.innerHTML = '<div class="vazio">SEM PENDÊNCIAS</div>';
            return;
        }

        area.innerHTML = lista.map((item, indice) => `
            <div class="item">
                <div class="apt">${escapar(item.apartamento)}</div>
                <div class="meta">${item.quantidade} encomenda(s) sem baixa</div>
                <div class="meta">${escapar(item.atualizadoEm)}</div>
                <div class="meta">${escapar(item.motivo)}</div>
                <button type="button" data-detalhe="${indice}">VER DETALHES</button>
                <div class="detalhes" id="detalhe${indice}">
                    ${(item.encomendas || []).length
                        ? item.encomendas.map((e, i) => `
                            <div><strong>Encomenda ${i + 1}</strong><br>
                            Número: ${escapar(e.numero || "-")}<br>
                            Destinatário: ${escapar(e.destinatario || "-")}<br>
                            Status: ${escapar(e.status || "-")}<br>
                            Data: ${escapar(e.data || "-")}</div>
                            ${i < item.encomendas.length - 1 ? "<hr>" : ""}
                        `).join("")
                        : "Detalhes ainda não carregados pela tabela."}
                </div>
            </div>
        `).join("");

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