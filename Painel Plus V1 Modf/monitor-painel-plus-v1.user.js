// ==UserScript==
// @name         Painel Plus V1 Modf
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Contador rápido + tabela detalhada + histórico conservador por unidade.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE = "painel_plus_v1_modf_pendencias";
    const INTERVALO = 800;

    let aptAtual = "";
    let contadorAtual = null;
    let linhasAtuais = [];
    let ultimaURL = location.href;
    let saidaProcessada = false;

    function norm(v) {
        return String(v || "").trim().toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function esc(v) {
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

    function salvar(lista) {
        localStorage.setItem(STORAGE, JSON.stringify(lista.slice(0, 500)));
        atualizarPainel();
    }

    function aptTela() {
        for (const input of document.querySelectorAll("input")) {
            if (input.offsetParent === null) continue;
            const v = String(input.value || "").trim();
            if (/^\d+\/\d+$/.test(v)) return v;
        }
        return "";
    }

    function contadorTela() {
        for (const el of document.querySelectorAll("small, span")) {
            if (el.offsetParent === null) continue;
            const m = norm(el.textContent).match(/(?:^|\s)(\d+)\s+encomenda(?:\(s\)|s)?(?:\s|$)/);
            if (m) return Number(m[1]);
        }
        return null;
    }

    function tabelaTela() {
        for (const t of document.querySelectorAll("table")) {
            if (t.offsetParent === null) continue;
            const txt = norm(t.innerText);
            if (txt.includes("encomenda") || txt.includes("destinatario") || txt.includes("residencia")) return t;
        }
        return null;
    }

    function linhasDoApt(apt) {
        const tabela = tabelaTela();
        if (!tabela) return [];
        const lista = [];

        for (const tr of tabela.querySelectorAll("tbody tr")) {
            if (tr.offsetParent === null) continue;
            const c = Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim());
            const unidade = c.find(v => /^\d+\/\d+$/.test(v)) || "";
            if (unidade !== apt) continue;

            lista.push({
                numero: c[0] || "",
                apartamento: unidade,
                destinatario: c[2] || "",
                status: c[3] || "",
                data: c[4] || "",
                resumo: c.join(" | ")
            });
        }
        return lista;
    }

    function chave(item) {
        return [item.numero, item.apartamento, item.destinatario, item.status, item.data, item.resumo].join("|");
    }

    function registro(apt) {
        return carregar().find(item => item.apartamento === apt) || null;
    }

    function gravarRegistro(dados) {
        const lista = carregar();
        const i = lista.findIndex(item => item.apartamento === dados.apartamento);
        const anterior = i >= 0 ? lista[i] : null;

        const novo = {
            apartamento: dados.apartamento,
            status: dados.status,
            quantidade: dados.quantidade,
            itensOriginais: dados.itensOriginais ?? anterior?.itensOriginais ?? [],
            itensPendentes: dados.itensPendentes ?? anterior?.itensPendentes ?? [],
            mensagem: dados.mensagem,
            motivo: dados.motivo || anterior?.motivo || "",
            atualizadoEm: new Date().toLocaleString("pt-BR"),
            timestamp: Date.now()
        };

        if (i >= 0) lista[i] = novo;
        else lista.unshift(novo);
        salvar(lista);
    }

    function remover(apt) {
        const lista = carregar();
        const nova = lista.filter(item => item.apartamento !== apt);
        if (nova.length !== lista.length) salvar(nova);
    }

    function antigasAindaPresentes(reg, atuais) {
        const atuaisSet = new Set(atuais.map(chave));
        return (reg.itensPendentes || reg.itensOriginais || []).filter(item => atuaisSet.has(chave(item)));
    }

    function reconciliar(apt, contador, linhas) {
        const reg = registro(apt);
        if (!reg) return;

        if (contador === 0) {
            remover(apt);
            return;
        }

        if (!linhas.length) return;

        const antigas = antigasAindaPresentes(reg, linhas);

        if (!antigas.length) {
            // As antigas sumiram. As linhas atuais são novas e não pertencem à ocorrência velha.
            remover(apt);
            return;
        }

        gravarRegistro({
            apartamento: apt,
            status: "PENDENTE",
            quantidade: antigas.length,
            itensOriginais: reg.itensOriginais,
            itensPendentes: antigas,
            mensagem: `${antigas.length} encomenda(s) antiga(s) ainda sem baixa.`,
            motivo: "Reconciliação automática após reabrir a unidade"
        });
    }

    function registrarSaida(motivo) {
        if (saidaProcessada || !aptAtual || contadorAtual === null) return;
        saidaProcessada = true;

        if (contadorAtual === 0) {
            const reg = registro(aptAtual);
            if (reg) {
                gravarRegistro({
                    apartamento: aptAtual,
                    status: "BAIXA PROVÁVEL",
                    quantidade: 0,
                    itensOriginais: reg.itensOriginais,
                    itensPendentes: reg.itensPendentes,
                    mensagem: "X encomenda(s) chegou a 0, mas o sistema foi fechado antes da tabela confirmar.",
                    motivo
                });
            }
            return;
        }

        const detalhes = linhasAtuais.length ? linhasAtuais : (registro(aptAtual)?.itensPendentes || []);

        gravarRegistro({
            apartamento: aptAtual,
            status: "PENDENTE",
            quantidade: contadorAtual,
            itensOriginais: detalhes,
            itensPendentes: detalhes,
            mensagem: `${contadorAtual} encomenda(s) sem baixa.`,
            motivo
        });
    }

    function limparSessao() {
        aptAtual = "";
        contadorAtual = null;
        linhasAtuais = [];
        saidaProcessada = false;
        atualizarPainel();
    }

    function sincronizar() {
        const apt = aptTela();

        if (!apt) {
            if (aptAtual) registrarSaida("Campo apagado ou consulta encerrada");
            limparSessao();
            return;
        }

        if (aptAtual && aptAtual !== apt) {
            registrarSaida("Outra unidade foi pesquisada");
            limparSessao();
        }

        aptAtual = apt;
        contadorAtual = contadorTela();
        linhasAtuais = linhasDoApt(aptAtual);
        saidaProcessada = false;

        if (contadorAtual !== null) reconciliar(aptAtual, contadorAtual, linhasAtuais);
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
            registrarSaida("Campo apagado antes de concluir a consulta");
        }
    }, true);

    function fechar(motivo) {
        registrarSaida(motivo);
    }

    window.addEventListener("pagehide", () => fechar("Página fechada ou atualizada"), { capture: true });
    window.addEventListener("beforeunload", () => fechar("Aplicativo ou navegador encerrado"), { capture: true });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") fechar("Aba ou aplicativo ficou oculto");
    });

    function estilo() {
        if (document.querySelector("#plusCSS")) return;
        const s = document.createElement("style");
        s.id = "plusCSS";
        s.textContent = `
            #botaoPainelPlus{margin-left:10px;padding:9px 14px;border:1px solid #22c55e;border-radius:8px;background:#080808;color:#22c55e;font:800 11px Arial;cursor:pointer}
            #painelPlus{position:fixed;top:60px;right:20px;width:410px;max-height:650px;background:#050505;color:#fff;border:1px solid #22c55e;border-radius:16px;box-shadow:0 0 30px rgba(34,197,94,.28);z-index:2147483647;font-family:Arial;overflow:hidden}
            #painelPlus .topo{padding:16px;border-bottom:1px solid rgba(34,197,94,.2)}
            #painelPlus .titulo{color:#22c55e;font-size:16px;font-weight:900}
            #painelPlus .status{margin:12px;padding:10px;border:1px solid rgba(34,197,94,.2);border-radius:10px;font-size:11px;line-height:1.8}
            #painelPlus .acoes{display:flex;gap:8px;padding:0 12px 12px}
            #painelPlus button{flex:1;padding:8px;border-radius:8px;font-weight:800;cursor:pointer}
            #painelPlus .lista{max-height:455px;overflow-y:auto;padding:0 12px 12px}
            #painelPlus .item{margin-bottom:8px;padding:10px;border:1px solid rgba(34,197,94,.2);border-radius:10px;background:#111827}
            #painelPlus .item.provavel{border-color:#60a5fa;background:#0b1628}
            #painelPlus .apt{color:#22c55e;font-size:18px;font-weight:900}
            #painelPlus .provavel .apt{color:#60a5fa}
            #painelPlus .meta{color:#aaa;font-size:11px;margin-top:4px}
            #painelPlus .checks{margin:8px 0;padding:8px;border-radius:8px;background:#080808;font-size:11px;line-height:1.65}
            #painelPlus .ok{color:#22c55e}.alerta{color:#f59e0b}.azul{color:#60a5fa}
            #painelPlus .detalhes{display:none;margin-top:8px;padding-top:8px;border-top:1px solid #333;color:#ddd;font-size:10px;line-height:1.5}
            #painelPlus .vazio{padding:50px 10px;text-align:center;color:#666}
        `;
        document.head.appendChild(s);
    }

    function criarBotao() {
        estilo();
        if (document.querySelector("#botaoPainelPlus")) return;
        const ref = document.querySelector('button[data-testid="delivery-select-multiple-deliveries-button"]');
        if (!ref) return;
        const b = document.createElement("button");
        b.id = "botaoPainelPlus";
        b.type = "button";
        b.textContent = "PAINEL PLUS V1";
        b.onclick = abrirPainel;
        ref.insertAdjacentElement("afterend", b);
    }

    function abrirPainel() {
        const antigo = document.querySelector("#painelPlus");
        if (antigo) {
            antigo.remove();
            return;
        }

        const p = document.createElement("div");
        p.id = "painelPlus";
        p.innerHTML = `
            <div class="topo"><div class="titulo">PAINEL PLUS V1 MODF</div></div>
            <div class="status">
                Unidade atual: <strong id="plusApt">-</strong><br>
                X encomenda(s): <strong id="plusQtd">-</strong><br>
                Linhas detalhadas: <strong id="plusLinhas">0</strong><br>
                Registros: <strong id="plusTotal">0</strong>
            </div>
            <div class="acoes">
                <button id="plusLimpar">LIMPAR TUDO</button>
                <button id="plusFechar">FECHAR</button>
            </div>
            <div id="plusLista" class="lista"></div>
        `;
        document.body.appendChild(p);

        p.querySelector("#plusLimpar").onclick = () => {
            if (confirm("Deseja apagar todos os registros?")) {
                localStorage.removeItem(STORAGE);
                atualizarPainel();
            }
        };
        p.querySelector("#plusFechar").onclick = () => p.remove();
        atualizarPainel();
    }

    function atualizarPainel() {
        const p = document.querySelector("#painelPlus");
        if (!p) return;

        const lista = carregar();
        p.querySelector("#plusApt").textContent = aptAtual || "-";
        p.querySelector("#plusQtd").textContent = contadorAtual === null ? "-" : String(contadorAtual);
        p.querySelector("#plusLinhas").textContent = String(linhasAtuais.length);
        p.querySelector("#plusTotal").textContent = String(lista.length);

        const area = p.querySelector("#plusLista");
        if (!lista.length) {
            area.innerHTML = '<div class="vazio">SEM REGISTROS</div>';
            return;
        }

        area.innerHTML = lista.map((item, i) => {
            const provavel = item.status === "BAIXA PROVÁVEL";
            return `
                <div class="item ${provavel ? "provavel" : ""}">
                    <div class="apt">${esc(item.apartamento)}</div>
                    <div class="meta ${provavel ? "azul" : "alerta"}">${esc(item.status)}</div>
                    <div class="checks">
                        <div class="ok">✓ X encomenda(s): ${esc(item.quantidade)}</div>
                        <div class="ok">✓ Linhas antigas salvas: ${(item.itensPendentes || []).length}</div>
                    </div>
                    <div class="meta">${esc(item.mensagem)}</div>
                    <div class="meta">${esc(item.motivo || "")}</div>
                    <div class="meta">${esc(item.atualizadoEm)}</div>
                    <button type="button" data-det="${i}">VER DETALHES</button>
                    <div class="detalhes" id="det${i}">
                        ${(item.itensPendentes || []).length
                            ? item.itensPendentes.map((e, n) => `
                                <div><strong>Encomenda ${n + 1}</strong><br>
                                Número: ${esc(e.numero || "-")}<br>
                                Destinatário: ${esc(e.destinatario || "-")}<br>
                                Status: ${esc(e.status || "-")}<br>
                                Data: ${esc(e.data || "-")}</div>
                                ${n < item.itensPendentes.length - 1 ? "<hr>" : ""}
                            `).join("")
                            : "Sem detalhes salvos."}
                    </div>
                </div>
            `;
        }).join("");

        area.querySelectorAll("[data-det]").forEach(b => {
            b.onclick = () => {
                const d = area.querySelector(`#det${b.dataset.det}`);
                const abrir = d.style.display !== "block";
                d.style.display = abrir ? "block" : "none";
                b.textContent = abrir ? "OCULTAR DETALHES" : "VER DETALHES";
            };
        });
    }

    const observer = new MutationObserver(criarBotao);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    criarBotao();
    sincronizar();
})();