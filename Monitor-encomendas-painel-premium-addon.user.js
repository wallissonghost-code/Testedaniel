// ==UserScript==
// @name         Monitor de Encomendas - Painel Premium Add-on
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Melhora somente o painel do Monitor de Encomendas Simples, sem alterar a lógica de captura
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const CSS_ID = "monitorPremiumAddonCSS";
    const PAINEL_ID = "painelMonitorSimples";
    const BOTAO_ID = "botaoMonitorSimples";

    function adicionarEstilo() {
        if (document.getElementById(CSS_ID)) return;

        const style = document.createElement("style");
        style.id = CSS_ID;
        style.textContent = `
            #${BOTAO_ID} {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                margin-left: 10px !important;
                padding: 9px 14px !important;
                border: 1px solid #22c55e !important;
                border-radius: 9px !important;
                background: #090909 !important;
                color: #22c55e !important;
                font: 800 11px Arial, sans-serif !important;
                letter-spacing: .4px !important;
                box-shadow: 0 0 15px rgba(34,197,94,.18) !important;
                cursor: pointer !important;
            }

            #${BOTAO_ID}::after {
                content: "";
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #22c55e;
                box-shadow: 0 0 10px #22c55e;
                animation: monitorPremiumPulso 1.2s infinite;
            }

            @keyframes monitorPremiumPulso {
                50% { opacity: .35; transform: scale(.82); }
            }

            #${PAINEL_ID} {
                top: 60px !important;
                right: 24px !important;
                width: 420px !important;
                max-height: none !important;
                height: 610px !important;
                display: flex !important;
                flex-direction: column !important;
                background: radial-gradient(circle at top right, rgba(34,197,94,.10), transparent 30%), #050505 !important;
                color: #fff !important;
                border: 1px solid #22c55e !important;
                border-radius: 18px !important;
                box-shadow: 0 0 36px rgba(34,197,94,.28) !important;
                overflow: hidden !important;
                animation: monitorPremiumAbrir .2s ease-out !important;
            }

            @keyframes monitorPremiumAbrir {
                from { opacity: 0; transform: translateY(-8px) scale(.985); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }

            #${PAINEL_ID} .cabecalho {
                padding: 18px 18px 14px !important;
                border-bottom: 1px solid rgba(34,197,94,.18) !important;
                color: #22c55e !important;
                font-size: 17px !important;
                font-weight: 900 !important;
                letter-spacing: .8px !important;
                text-shadow: 0 0 14px rgba(34,197,94,.65) !important;
            }

            #${PAINEL_ID} .status {
                margin: 14px 16px 0 !important;
                padding: 13px !important;
                border: 1px solid rgba(34,197,94,.22) !important;
                border-radius: 12px !important;
                background: rgba(0,0,0,.58) !important;
                color: #aaa !important;
                line-height: 1.8 !important;
            }

            #${PAINEL_ID} .status strong {
                color: #22c55e !important;
            }

            #${PAINEL_ID} .acoes {
                padding: 10px 16px !important;
                border-bottom: 1px solid rgba(34,197,94,.12) !important;
                gap: 8px !important;
            }

            #${PAINEL_ID} .acoes button {
                padding: 9px 8px !important;
                border-radius: 9px !important;
                font-size: 10px !important;
                font-weight: 900 !important;
            }

            #limparHistoricoSimples {
                border: 1px solid #ef4444 !important;
                background: rgba(239,68,68,.10) !important;
                color: #ef4444 !important;
            }

            #fecharMonitorSimples {
                border: 1px solid #22c55e !important;
                background: rgba(34,197,94,.10) !important;
                color: #22c55e !important;
            }

            #listaMonitorSimples {
                flex: 1 !important;
                max-height: none !important;
                overflow-y: auto !important;
                padding: 12px 16px 14px !important;
            }

            #listaMonitorSimples::-webkit-scrollbar { width: 5px; }
            #listaMonitorSimples::-webkit-scrollbar-thumb {
                border-radius: 8px;
                background: #22c55e;
            }

            .registroMonitorSimples {
                margin-bottom: 9px !important;
                padding: 12px !important;
                border: 1px solid rgba(34,197,94,.20) !important;
                border-radius: 12px !important;
                background: rgba(17,24,39,.86) !important;
                color: #aaa !important;
            }

            .registroMonitorSimples strong {
                color: #22c55e !important;
                font-size: 18px !important;
            }

            #monitorPremiumAjuda {
                margin: 0 16px 12px;
                padding: 12px;
                border: 1px solid rgba(34,197,94,.18);
                border-radius: 12px;
                background: rgba(17,24,39,.72);
                color: #aaa;
                font: 11px/1.55 Arial, sans-serif;
            }

            #monitorPremiumAjuda summary {
                color: #22c55e;
                font-weight: 900;
                cursor: pointer;
            }

            #monitorPremiumAjuda strong { color: #fff; }

            @media (max-width: 600px) {
                #${PAINEL_ID} {
                    top: 10px !important;
                    left: 10px !important;
                    right: 10px !important;
                    width: auto !important;
                    height: calc(100vh - 20px) !important;
                }
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function incrementarPainel() {
        const painel = document.getElementById(PAINEL_ID);
        if (!painel || painel.dataset.premiumAddon === "1") return;

        painel.dataset.premiumAddon = "1";

        const ajuda = document.createElement("details");
        ajuda.id = "monitorPremiumAjuda";
        ajuda.innerHTML = `
            <summary>COMO FUNCIONA</summary>
            <p><strong>1.</strong> Digite o apartamento normalmente.</p>
            <p><strong>2.</strong> O monitor lê automaticamente “X encomenda(s)”.</p>
            <p><strong>3.</strong> Com 0 encomendas, nada é registrado.</p>
            <p><strong>4.</strong> Se sair deixando 1 ou mais, o histórico registra a pendência.</p>
            <p><strong>Exemplo:</strong> entrou com 3, baixou 2 e saiu com 1: registra “1 Encomenda não dado baixa”.</p>
        `;

        const lista = painel.querySelector("#listaMonitorSimples");
        if (lista) painel.insertBefore(ajuda, lista);
    }

    function aplicar() {
        adicionarEstilo();
        incrementarPainel();
    }

    const observer = new MutationObserver(aplicar);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    aplicar();
})();
