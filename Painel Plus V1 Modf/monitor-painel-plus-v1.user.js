// ==UserScript==
// @name         Painel Plus V1 Modf
// @namespace    http://tampermonkey.net/
// @version      1.3.3
// @description  Monitora somente Aguardando entrega, usando o contador e a tabela da consulta atual.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_HISTORICO = 'painel_plus_historico_v133';
    const STORAGE_FILTRO = 'painel_plus_filtro_v133';
    const ROTA = '/gate/deliveries';
    const INTERVALO = 500;

    let apartamentoAtual = '';
    let ultimoXValido = null;
    let detalhesAtuais = [];
    let ultimaURL = location.href;
    let saidaProcessada = false;
    let filtroAtual = localStorage.getItem(STORAGE_FILTRO) || 'aguardando';
    let logs = [];
    let matrixTimer = null;

    const normalizar = valor => String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const escapar = valor => String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    const naTelaEncomendas = () => location.pathname.includes(ROTA);

    function lerHistorico() {
        try {
            const lista = JSON.parse(localStorage.getItem(STORAGE_HISTORICO) || '[]');
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function salvarHistorico(lista) {
        localStorage.setItem(STORAGE_HISTORICO, JSON.stringify(lista.slice(0, 500)));
        renderizarPainel();
    }

    function registrarLog(tipo, mensagem) {
        logs.unshift({ tipo, mensagem, hora: new Date().toLocaleTimeString('pt-BR') });
        logs = logs.slice(0, 100);
        renderizarPainel();
    }

    function campoUnidade() {
        if (!naTelaEncomendas()) return null;

        const seletores = [
            'input[data-testid="residence-autocomplete-input-search"]',
            'app-residence-autocomplete input',
            'input[placeholder*="unidade" i]'
        ];

        for (const seletor of seletores) {
            const encontrado = [...document.querySelectorAll(seletor)]
                .find(elemento => elemento.offsetParent !== null);
            if (encontrado) return encontrado;
        }

        return null;
    }

    function lerApartamento() {
        const campo = campoUnidade();
        const componente = campo?.closest('app-residence-autocomplete');
        const candidatos = [
            campo?.value,
            campo?.getAttribute('value'),
            campo?.getAttribute('aria-label'),
            componente?.innerText,
            componente?.textContent
        ];

        for (const candidato of candidatos) {
            const match = String(candidato || '').match(/(?:^|\s)(\d+\/\d+)(?:\s|$)/);
            if (match) return match[1];
        }

        return '';
    }

    function raizTabela() {
        if (!naTelaEncomendas()) return null;

        return [...document.querySelectorAll('[data-testid="delivery-table"]')]
            .find(elemento => elemento.offsetParent !== null) || null;
    }

    function lerXDaTabelaAtual() {
        if (filtroAtual !== 'aguardando') return null;

        const raiz = raizTabela();
        if (!raiz) return null;

        const candidatos = raiz.querySelectorAll('footer small, footer span, small');

        for (const elemento of candidatos) {
            if (elemento.offsetParent === null) continue;

            const texto = normalizar(elemento.textContent);
            const match = texto.match(/^(\d+)\s+encomenda(?:\(s\)|s)?$/);

            if (match) return Number(match[1]);
        }

        return null;
    }

    function capturarDetalhes(apartamento) {
        if (filtroAtual !== 'aguardando') return [];

        const raiz = raizTabela();
        if (!raiz || !apartamento) return [];

        const resultado = [];

        for (const linha of raiz.querySelectorAll('tbody tr')) {
            if (linha.offsetParent === null) continue;

            const colunas = [...linha.querySelectorAll('td')]
                .map(celula => celula.innerText.trim());

            if (!colunas.length) continue;

            const unidade = colunas.find(valor => /^\d+\/\d+$/.test(valor)) || '';
            if (unidade !== apartamento) continue;

            resultado.push({
                numero: colunas[0] || '',
                unidade,
                destinatario: colunas[2] || '',
                status: colunas[3] || '',
                data: colunas[4] || '',
                resumo: colunas.join(' | ')
            });
        }

        return resultado;
    }

    function atualizarRegistro(unidade, quantidade, detalhes, motivo) {
        if (!unidade || quantidade <= 0) return;

        const lista = lerHistorico();
        const indice = lista.findIndex(item => item.unidade === unidade);
        const anterior = indice >= 0 ? lista[indice] : null;

        const registro = {
            unidade,
            quantidade,
            detalhes: detalhes.length ? detalhes : (anterior?.detalhes || []),
            motivo,
            atualizadoEm: new Date().toLocaleString('pt-BR'),
            timestamp: Date.now()
        };

        if (indice >= 0) lista[indice] = registro;
        else lista.unshift(registro);

        salvarHistorico(lista);
    }

    function removerRegistro(unidade) {
        const lista = lerHistorico();
        const novaLista = lista.filter(item => item.unidade !== unidade);
        if (novaLista.length !== lista.length) salvarHistorico(novaLista);
    }

    function existeRegistro(unidade) {
        return lerHistorico().some(item => item.unidade === unidade);
    }

    function reconciliarRegistroExistente() {
        if (!apartamentoAtual || ultimoXValido === null) return;
        if (!existeRegistro(apartamentoAtual)) return;

        if (ultimoXValido === 0) {
            removerRegistro(apartamentoAtual);
            return;
        }

        atualizarRegistro(
            apartamentoAtual,
            ultimoXValido,
            detalhesAtuais,
            'Pendência antiga atualizada pela consulta atual.'
        );
    }

    function registrarSaida(motivo) {
        if (saidaProcessada) return;
        if (!apartamentoAtual) return;
        if (ultimoXValido === null) return;

        saidaProcessada = true;

        if (ultimoXValido === 0) {
            removerRegistro(apartamentoAtual);
            registrarLog('BAIXA', `${apartamentoAtual}: concluída com X = 0`);
            return;
        }

        atualizarRegistro(
            apartamentoAtual,
            ultimoXValido,
            detalhesAtuais,
            motivo
        );

        registrarLog('PENDÊNCIA', `${apartamentoAtual}: ${ultimoXValido} restante(s)`);
    }

    function limparSessao() {
        apartamentoAtual = '';
        ultimoXValido = null;
        detalhesAtuais = [];
        saidaProcessada = false;
        renderizarPainel();
    }

    function sincronizar() {
        if (!naTelaEncomendas()) return;

        const unidade = lerApartamento();

        if (!unidade) {
            if (apartamentoAtual) registrarSaida('Campo apagado ou consulta abandonada.');
            limparSessao();
            return;
        }

        if (apartamentoAtual && apartamentoAtual !== unidade) {
            registrarSaida('Outra unidade foi pesquisada.');
            limparSessao();
        }

        apartamentoAtual = unidade;

        if (filtroAtual !== 'aguardando') {
            renderizarPainel();
            return;
        }

        const novoX = lerXDaTabelaAtual();
        if (novoX === null) {
            renderizarPainel();
            return;
        }

        const xAnterior = ultimoXValido;
        ultimoXValido = novoX;

        const novosDetalhes = capturarDetalhes(apartamentoAtual);
        if (novosDetalhes.length || novoX === 0) detalhesAtuais = novosDetalhes;

        saidaProcessada = false;

        if (xAnterior !== novoX) {
            registrarLog('CONTADOR', `${apartamentoAtual}: ${xAnterior ?? '-'} → ${novoX}`);
        }

        // Entrar na unidade nunca cria histórico novo.
        // Somente reconcilia se ela já estava registrada anteriormente.
        reconciliarRegistroExistente();

        if (novoX === 0) removerRegistro(apartamentoAtual);

        renderizarPainel();
    }

    function identificarFiltroPeloClique(evento) {
        const elemento = evento.target.closest('button, [role="menuitem"], .dropdown-item, li, a');
        if (!elemento) return;

        const texto = normalizar(elemento.innerText || elemento.textContent);
        let novoFiltro = '';

        if (/^todos?$/.test(texto)) novoFiltro = 'todos';
        else if (/^entregues?$/.test(texto)) novoFiltro = 'entregues';
        else if (texto.includes('aguardando') && texto.includes('entrega')) novoFiltro = 'aguardando';

        if (!novoFiltro) return;

        filtroAtual = novoFiltro;
        localStorage.setItem(STORAGE_FILTRO, filtroAtual);
        registrarLog('FILTRO', `Alterado para ${novoFiltro}`);
    }

    document.addEventListener('click', evento => {
        identificarFiltroPeloClique(evento);

        const botao = evento.target.closest('button');
        if (
            botao?.getAttribute('data-testid') ===
            'residence-autocomplete-clear-input-button'
        ) {
            registrarSaida('Campo apagado antes da conclusão.');
        }
    }, true);

    setInterval(() => {
        if (location.href !== ultimaURL) {
            if (ultimaURL.includes(ROTA)) registrarSaida('Saiu da tela de encomendas.');
            ultimaURL = location.href;
            if (!naTelaEncomendas()) limparSessao();
        }

        sincronizar();
        criarBotao();
    }, INTERVALO);

    window.addEventListener('pagehide', () => {
        registrarSaida('Página fechada ou atualizada.');
    }, { capture: true });

    window.addEventListener('beforeunload', () => {
        registrarSaida('Aplicativo ou navegador encerrado.');
    }, { capture: true });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            registrarSaida('Aba ou aplicativo ficou oculto.');
        }
    });

    function adicionarCSS() {
        if (document.querySelector('#pp505css')) return;

        const style = document.createElement('style');
        style.id = 'pp505css';
        style.textContent = `
#ppBtn{display:inline-flex!important;align-items:center;gap:8px;margin-left:10px!important}.ppLed{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 12px #22c55e;animation:ppBlink 1s infinite}@keyframes ppBlink{50%{opacity:.3}}
#ppTip{display:none;position:fixed;width:320px;padding:15px;background:#050505;border:1px solid #22c55e;border-radius:12px;z-index:2147483647;box-shadow:0 0 30px rgba(34,197,94,.35);color:#aaa;font:12px/18px Arial}.ppTT{color:#22c55e;font-weight:bold;font-size:14px;margin-bottom:10px}.ppTA{margin-top:10px;text-align:right;color:#22c55e;font-size:11px}
#ppPanel,#ppPanel *{box-sizing:border-box;font-family:Arial}#ppPanel{position:fixed;top:60px;right:25px;width:410px;height:610px;background:#050505;color:#fff;z-index:2147483646;border-radius:18px;overflow:hidden;border:1px solid #22c55e;box-shadow:0 0 35px rgba(34,197,94,.35)}#ppCanvas{position:absolute;inset:0;width:100%;height:100%;opacity:.12;pointer-events:none}.ppBody{position:relative;z-index:2;padding:18px;height:100%;display:flex;flex-direction:column}.ppTop{display:flex;justify-content:space-between}.ppTitle{font-size:18px;font-weight:bold;color:#22c55e;text-shadow:0 0 15px #22c55e}.ppSub{font-size:10px;color:#777;margin-top:5px;letter-spacing:2px}.ppStatus{margin-top:15px;padding:12px;border-radius:12px;background:#000b;border:1px solid #22c55e44;font-size:12px;line-height:20px}.ppRow{display:flex;justify-content:space-between;gap:10px}.ppVal{color:#22c55e;font-weight:bold;text-align:right}.ppTabs,.ppAct{display:flex;gap:8px;margin-top:10px}.ppTabs button,.ppAct button{flex:1;padding:8px;border-radius:9px;font-size:10px;font-weight:bold;cursor:pointer;background:#111827;color:#888;border:1px solid #22c55e44}.ppTabs .on{color:#22c55e;border-color:#22c55e}.ppArea{flex:1;min-height:0;margin-top:12px;overflow:auto}.ppItem{background:#111827e8;border:1px solid #22c55e33;padding:12px;border-radius:12px;margin-bottom:9px}.ppApt{font-size:18px;font-weight:bold;color:#22c55e}.ppMeta{font-size:10px;color:#fbbf24;margin-top:5px}.ppEmpty{text-align:center;margin-top:80px;color:#555;letter-spacing:2px}.ppFoot{text-align:center;font-size:9px;color:#777;padding-top:8px}`;

        document.head.appendChild(style);
    }

    function criarTooltip(botao) {
        document.querySelector('#ppTip')?.remove();

        const tooltip = document.createElement('div');
        tooltip.id = 'ppTip';
        tooltip.innerHTML = `<div class="ppTT">MONITOR DE ENCOMENDAS</div>
O monitor lê somente a unidade selecionada na tela de Encomendas.<br><br>
O <b style="color:#22c55e">X encomenda(s)</b> é obtido exclusivamente no rodapé de <b style="color:#22c55e">delivery-table</b>.<br><br>
Os números de Todos e Entregues são ignorados. A tabela atual fornece os detalhes de cada encomenda.<br><br>
Entrar em uma unidade apenas inicia o monitoramento. O histórico é criado somente ao sair com X maior que 0.<br><br>
Quando X chega a 0, a unidade é removida do histórico.<div class="ppTA">Criado por Daniel Alexandre</div>`;

        document.body.appendChild(tooltip);

        botao.onmouseenter = () => {
            const posicao = botao.getBoundingClientRect();
            tooltip.style.display = 'block';
            tooltip.style.top = `${Math.min(innerHeight - tooltip.offsetHeight - 10, posicao.bottom + 8)}px`;
            tooltip.style.left = `${Math.max(10, Math.min(innerWidth - 330, posicao.left))}px`;
        };

        botao.onmouseleave = () => tooltip.style.display = 'none';
    }

    function criarBotao() {
        adicionarCSS();

        if (!naTelaEncomendas()) {
            document.querySelector('#ppBtn')?.remove();
            document.querySelector('#ppTip')?.remove();
            return;
        }

        if (document.querySelector('#ppBtn')) return;

        const referencia = document.querySelector(
            'button[data-testid="delivery-select-multiple-deliveries-button"]'
        );

        if (!referencia) return;

        const botao = document.createElement('button');
        botao.id = 'ppBtn';
        botao.type = 'button';
        botao.className = referencia.className;
        botao.innerHTML = 'MONITOR DE ENCOMENDAS <span class="ppLed"></span>';
        botao.onclick = abrirPainel;

        referencia.insertAdjacentElement('afterend', botao);
        criarTooltip(botao);
    }

    function abrirPainel() {
        const antigo = document.querySelector('#ppPanel');
        if (antigo) {
            antigo.remove();
            clearInterval(matrixTimer);
            return;
        }

        const painel = document.createElement('div');
        painel.id = 'ppPanel';
        painel.dataset.tab = 'historico';
        painel.innerHTML = `<canvas id="ppCanvas"></canvas><div class="ppBody">
<div class="ppTop"><div><div class="ppTitle">MONITOR DE ENCOMENDAS</div><div class="ppSub">SYSTEM ONLINE · V1.3.3</div></div><span class="ppLed"></span></div>
<div class="ppStatus">
<div class="ppRow"><span>UNIDADE</span><span class="ppVal" id="pA">NENHUMA</span></div>
<div class="ppRow"><span>FILTRO</span><span class="ppVal" id="pF">-</span></div>
<div class="ppRow"><span>X ENCOMENDA(S)</span><span class="ppVal" id="pX">-</span></div>
<div class="ppRow"><span>REGISTROS</span><span class="ppVal" id="pR">0</span></div>
<div class="ppRow"><span>ÚLTIMA AÇÃO</span><span class="ppVal" id="pL">-</span></div></div>
<div class="ppTabs"><button id="pTH" class="on">HISTÓRICO</button><button id="pTC">TEMPO REAL</button></div>
<div class="ppAct"><button id="pClear">LIMPAR HISTÓRICO</button><button id="pLogs">LIMPAR CONSOLE</button><button id="pClose">FECHAR</button></div>
<div class="ppArea" id="pArea"></div><div class="ppFoot">Criado por Daniel Alexandre</div></div>`;

        document.body.appendChild(painel);

        painel.querySelector('#pTH').onclick = () => {
            painel.dataset.tab = 'historico';
            painel.querySelector('#pTH').classList.add('on');
            painel.querySelector('#pTC').classList.remove('on');
            renderizarPainel();
        };

        painel.querySelector('#pTC').onclick = () => {
            painel.dataset.tab = 'console';
            painel.querySelector('#pTC').classList.add('on');
            painel.querySelector('#pTH').classList.remove('on');
            renderizarPainel();
        };

        painel.querySelector('#pClear').onclick = () => {
            if (confirm('Limpar histórico?')) {
                localStorage.removeItem(STORAGE_HISTORICO);
                renderizarPainel();
            }
        };

        painel.querySelector('#pLogs').onclick = () => {
            logs = [];
            renderizarPainel();
        };

        painel.querySelector('#pClose').onclick = () => {
            painel.remove();
            clearInterval(matrixTimer);
        };

        renderizarPainel();
        iniciarMatrix();
    }

    function renderizarPainel() {
        const painel = document.querySelector('#ppPanel');
        if (!painel) return;

        const historico = lerHistorico();
        painel.querySelector('#pA').textContent = apartamentoAtual || 'NENHUMA';
        painel.querySelector('#pF').textContent = filtroAtual === 'aguardando'
            ? 'AGUARDANDO ENTREGA'
            : `IGNORANDO ${filtroAtual.toUpperCase()}`;
        painel.querySelector('#pX').textContent = ultimoXValido === null ? '-' : ultimoXValido;
        painel.querySelector('#pR').textContent = historico.length;
        painel.querySelector('#pL').textContent = logs[0]
            ? `${logs[0].tipo}: ${logs[0].mensagem}`
            : 'SISTEMA INICIADO';

        const area = painel.querySelector('#pArea');

        if (painel.dataset.tab === 'console') {
            area.innerHTML = logs.length
                ? logs.map(log => `<div class="ppItem"><div class="ppApt">${escapar(log.tipo)}</div><div class="ppMeta">${escapar(log.hora)} · ${escapar(log.mensagem)}</div></div>`).join('')
                : '<div class="ppEmpty">SEM EVENTOS</div>';
            return;
        }

        area.innerHTML = historico.length
            ? historico.map((item, indice) => `<div class="ppItem">
<div class="ppApt">${escapar(item.unidade)}</div>
<div class="ppMeta">${item.quantidade} encomenda(s) sem baixa · ${escapar(item.atualizadoEm)}</div>
<button data-det="${indice}">VER DETALHES</button>
<div id="det${indice}" style="display:none;font-size:10px;margin-top:8px">
${(item.detalhes || []).length
    ? item.detalhes.map((detalhe, i) => `<div><b>Encomenda ${i + 1}</b><br>Número: ${escapar(detalhe.numero || '-')}<br>Destinatário: ${escapar(detalhe.destinatario || '-')}<br>Status: ${escapar(detalhe.status || '-')}<br>Data: ${escapar(detalhe.data || '-')}</div>${i < item.detalhes.length - 1 ? '<hr>' : ''}`).join('')
    : 'Detalhes ainda não carregados.'}
</div></div>`).join('')
            : '<div class="ppEmpty">SEM REGISTROS</div>';

        area.querySelectorAll('[data-det]').forEach(botao => {
            botao.onclick = () => {
                const detalhes = area.querySelector(`#det${botao.dataset.det}`);
                const abrir = detalhes.style.display !== 'block';
                detalhes.style.display = abrir ? 'block' : 'none';
                botao.textContent = abrir ? 'OCULTAR DETALHES' : 'VER DETALHES';
            };
        });
    }

    function iniciarMatrix() {
        const canvas = document.querySelector('#ppCanvas');
        const painel = document.querySelector('#ppPanel');
        if (!canvas || !painel) return;

        canvas.width = painel.offsetWidth;
        canvas.height = painel.offsetHeight;

        const contexto = canvas.getContext('2d');
        const caracteres = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&@';
        const tamanho = 14;
        const gotas = Array(Math.floor(canvas.width / tamanho))
            .fill(0)
            .map(() => Math.random() * 40);

        clearInterval(matrixTimer);
        matrixTimer = setInterval(() => {
            if (!document.body.contains(canvas)) {
                clearInterval(matrixTimer);
                return;
            }

            contexto.fillStyle = 'rgba(0,0,0,.12)';
            contexto.fillRect(0, 0, canvas.width, canvas.height);
            contexto.fillStyle = '#22c55e';
            contexto.font = `${tamanho}px monospace`;

            gotas.forEach((y, indice) => {
                const caractere = caracteres[Math.floor(Math.random() * caracteres.length)];
                contexto.fillText(caractere, indice * tamanho, y * tamanho);
                if (y * tamanho > canvas.height && Math.random() > .975) gotas[indice] = 0;
                gotas[indice]++;
            });
        }, 90);
    }

    new MutationObserver(criarBotao).observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    adicionarCSS();
    criarBotao();
    sincronizar();
})();