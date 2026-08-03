// ==UserScript==
// @name         Monitor v505 - Correção de baixa por aviso
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Confirma a baixa quando o próprio e-Condos exibe o aviso de encomenda encerrada com sucesso.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_ATUAL = "monitor503_atual";
    const STORAGE_HISTORICO = "monitor503_historico";
    const STORAGE_FLUXO = "monitor505_fluxo";
    const TEXTO_SUCESSO = "aviso de encomenda encerrado com sucesso";

    let baixaJaConfirmada = false;
    let codigoConfirmado = "";
    let intervaloProtecao = null;

    function normalizarTexto(valor) {
        return String(valor || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ");
    }

    function removerDoHistorico(codigo) {
        if (!codigo) return;

        try {
            const historico = JSON.parse(
                localStorage.getItem(STORAGE_HISTORICO) || "[]"
            );

            if (!Array.isArray(historico)) return;

            const corrigido = historico.filter(item => {
                return String(item?.codigo || "").trim() !== codigo;
            });

            if (corrigido.length !== historico.length) {
                localStorage.setItem(
                    STORAGE_HISTORICO,
                    JSON.stringify(corrigido)
                );

                console.log(
                    "[MONITOR v505 PATCH] Registro incorreto removido do histórico:",
                    codigo
                );
            }
        } catch (erro) {
            console.error(
                "[MONITOR v505 PATCH] Erro ao corrigir histórico:",
                erro
            );
        }
    }

    function confirmarBaixaPeloAviso() {
        if (baixaJaConfirmada) return;

        baixaJaConfirmada = true;
        codigoConfirmado = String(
            localStorage.getItem(STORAGE_ATUAL) || ""
        ).trim();

        localStorage.removeItem(STORAGE_ATUAL);
        sessionStorage.removeItem(STORAGE_FLUXO);
        sessionStorage.setItem("monitor505_baixa_confirmada_por_aviso", "1");

        removerDoHistorico(codigoConfirmado);

        console.log(
            "[MONITOR v505 PATCH] Baixa confirmada pelo aviso do e-Condos.",
            codigoConfirmado || "SEM CÓDIGO"
        );

        // Durante alguns segundos, remove qualquer falso abandono que o
        // script antigo ainda tente registrar após a confirmação do sistema.
        intervaloProtecao = setInterval(() => {
            localStorage.removeItem(STORAGE_ATUAL);
            sessionStorage.removeItem(STORAGE_FLUXO);
            removerDoHistorico(codigoConfirmado);
        }, 200);

        setTimeout(() => {
            clearInterval(intervaloProtecao);

            // Reinicia o script antigo sem a encomenda ativa na memória.
            // Isso impede que a troca de rota seja interpretada como abandono.
            location.reload();
        }, 1200);
    }

    function verificarAvisos(raiz = document) {
        const candidatos = raiz.querySelectorAll
            ? raiz.querySelectorAll(
                '[role="alert"], .toast-message, .toast, [class*="toast"]'
            )
            : [];

        for (const elemento of candidatos) {
            const texto = normalizarTexto(elemento.textContent);

            if (texto.includes(TEXTO_SUCESSO)) {
                confirmarBaixaPeloAviso();
                return true;
            }
        }

        return false;
    }

    function iniciarObservacao() {
        verificarAvisos(document);

        const observador = new MutationObserver(mutacoes => {
            if (baixaJaConfirmada) return;

            for (const mutacao of mutacoes) {
                for (const no of mutacao.addedNodes) {
                    if (!(no instanceof Element)) continue;

                    const textoDoNo = normalizarTexto(no.textContent);

                    if (textoDoNo.includes(TEXTO_SUCESSO)) {
                        confirmarBaixaPeloAviso();
                        return;
                    }

                    if (verificarAvisos(no)) return;
                }
            }
        });

        observador.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    if (document.documentElement) {
        iniciarObservacao();
    } else {
        document.addEventListener("DOMContentLoaded", iniciarObservacao, {
            once: true
        });
    }
})();
