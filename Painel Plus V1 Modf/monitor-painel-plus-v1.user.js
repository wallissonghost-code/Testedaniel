// ==UserScript==
// @name         Painel Plus V1 Modf
// @namespace    http://tampermonkey.net/
// @version      1.3.4
// @description  Monitor de encomendas com seleção estável da unidade, contador do rodapé e origem da captura.
// @author       Daniel Alexandre
// @match        https://app.econdos.com.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE = 'painel_plus_historico_v134';
    const ROTA = '/gate/deliveries';
    const INTERVALO = 500;

    let unidadeAtual = '';
    let unidadeCandidata = '';
    let leiturasEstaveis = 0;
    let ultimoX = null;
    let detalhesAtuais = [];
    let origemAtual = 'NENHUMA';
    let ultimaURL = location.href;
    let saidaProcessada = false;
    let logs = [];
    let matrixTimer = null;

    const normalizar = v => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const escapar = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const naTela = () => location.pathname.includes(ROTA);

    function lerHistorico() {
        try {
            const lista = JSON.parse(localStorage.getItem(STORAGE) || '[]');
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function salvarHistorico(lista) {
        localStorage.setItem(STORAGE, JSON.stringify(lista.slice(0, 500)));
        renderizar();
    }

    function log(tipo, mensagem) {
        logs.unshift({ tipo, mensagem, hora: new Date().toLocaleTimeString('pt-BR') });
        logs = logs.slice(0, 100);
        renderizar();
    }

    function obterCampoUnidade() {
        if (!naTela()) return null;
        return [...document.querySelectorAll('input[data-testid="residence-autocomplete-input-search"]')]
            .find(el => el.offsetParent !== null) || null;
    }

    function lerUnidadeConfirmada() {
        const campo = obterCampoUnidade();
        if (!campo) {
            unidadeCandidata = '';
            leiturasEstaveis = 0;
            return '';
        }

        const valor = String(campo.value || '').trim();
        const componente = campo.closest('app-residence-autocomplete');
        const botaoLimpar = componente?.querySelector('button[data-testid="residence-autocomplete-clear-input-button"]');
        const listaAberta = campo.getAttribute('aria-expanded') === 'true';

        if (!/^\d+\/\d+$/.test(valor) || listaAberta || !botaoLimpar || botaoLimpar.offsetParent === null) {
            unidadeCandidata = '';
            leiturasEstaveis = 0;
            return '';
        }

        if (unidadeCandidata !== valor) {
            unidadeCandidata = valor;
            leiturasEstaveis = 1;
            return '';
        }

        leiturasEstaveis += 1;
        return leiturasEstaveis >= 2 ? valor : '';
    }

    function filtroAguardandoAtivo() {
        const botao = [...document.querySelectorAll('button[data-testid="delivery-status-filter-button"]')]
            .find(el => el.offsetParent !== null);
        const texto = normalizar(botao?.innerText || botao?.textContent || '');
        return texto.includes('aguardando') && texto.includes('entrega');
    }

    function raizTabela() {
        return [...document.querySelectorAll('[data-testid="delivery-table"]')]
            .find(el => el.offsetParent !== null) || null;
    }

    function lerX() {
        if (!filtroAguardandoAtivo()) return null;
        const raiz = raizTabela();
        if (!raiz) return null;

        for (const el of raiz.querySelectorAll('footer small')) {
            if (el.offsetParent === null) continue;
            const match = normalizar(el.textContent).match(/^(\d+)\s+encomenda(?:\(s\)|s)?$/);
            if (match) return Number(match[1]);
        }
        return null;
    }

    function capturarDetalhes(unidade) {
        if (!filtroAguardandoAtivo()) return [];
        const raiz = raizTabela();
        if (!raiz || !unidade) return [];

        const resultado = [];
        for (const tr of raiz.querySelectorAll('tbody tr')) {
            if (tr.offsetParent === null) continue;
            const colunas = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
            if (!colunas.length) continue;
            const unidadeLinha = colunas.find(v => /^\d+\/\d+$/.test(v)) || '';
            if (unidadeLinha !== unidade) continue;
            resultado.push({
                numero: colunas[0] || '',
                unidade: unidadeLinha,
                destinatario: colunas[2] || '',
                status: colunas[3] || '',
                data: colunas[4] || '',
                resumo: colunas.join(' | ')
            });
        }
        return resultado;
    }

    function calcularOrigem(x, detalhes) {
        const xCapturou = Number.isInteger(x);
        const painelCapturou = detalhes.length > 0;
        if (xCapturou && painelCapturou) return 'X E PAINEL CAPTURARAM';
        if (xCapturou) return 'X CAPTUROU';
        if (painelCapturou) return 'PAINEL CAPTUROU';
        return 'NENHUMA CAPTURA';
    }

    function atualizarRegistro(unidade, quantidade, detalhes, motivo, origem) {
        if (!unidade || quantidade <= 0) return;
        const lista = lerHistorico();
        const indice = lista.findIndex(item => item.unidade === unidade);
        const anterior = indice >= 0 ? lista[indice] : null;
        const registro = {
            unidade,
            quantidade,
            detalhes: detalhes.length ? detalhes : (anterior?.detalhes || []),
            motivo,
            origem,
            atualizadoEm: new Date().toLocaleString('pt-BR'),
            timestamp: Date.now()
        };
        if (indice >= 0) lista[indice] = registro;
        else lista.unshift(registro);
        salvarHistorico(lista);
    }

    function removerRegistro(unidade) {
        const lista = lerHistorico();
        const nova = lista.filter(item => item.unidade !== unidade);
        if (nova.length !== lista.length) salvarHistorico(nova);
    }

    function registrarSaida(motivo) {
        if (saidaProcessada || !unidadeAtual || ultimoX === null) return;
        saidaProcessada = true;
        if (ultimoX === 0) {
            removerRegistro(unidadeAtual);
            log('BAIXA', `${unidadeAtual}: X = 0`);
            return;
        }
        atualizarRegistro(unidadeAtual, ultimoX, detalhesAtuais, motivo, origemAtual);
        log('PENDÊNCIA', `${unidadeAtual}: ${ultimoX} restante(s) · ${origemAtual}`);
    }

    function limparSessao() {
        unidadeAtual = '';
        unidadeCandidata = '';
        leiturasEstaveis = 0;
        ultimoX = null;
        detalhesAtuais = [];
        origemAtual = 'NENHUMA';
        saidaProcessada = false;
        renderizar();
    }

    function sincronizar() {
        if (!naTela()) return;

        const unidade = lerUnidadeConfirmada();
        if (!unidade) {
            renderizar();
            return;
        }

        if (unidadeAtual && unidadeAtual !== unidade) {
            registrarSaida('Outra unidade foi selecionada.');
            limparSessao();
        }

        unidadeAtual = unidade;

        if (!filtroAguardandoAtivo()) {
            renderizar();
            return;
        }

        const novoX = lerX();
        const novosDetalhes = capturarDetalhes(unidadeAtual);
        origemAtual = calcularOrigem(novoX, novosDetalhes);

        if (novoX !== null) {
            const anterior = ultimoX;
            ultimoX = novoX;
            saidaProcessada = false;
            if (anterior !== novoX) log('X CAPTUROU', `${unidadeAtual}: ${anterior ?? '-'} → ${novoX}`);
            if (novoX === 0) removerRegistro(unidadeAtual);
        }

        if (novosDetalhes.length) {
            const mudou = JSON.stringify(novosDetalhes) !== JSON.stringify(detalhesAtuais);
            detalhesAtuais = novosDetalhes;
            if (mudou) log('PAINEL CAPTUROU', `${unidadeAtual}: ${novosDetalhes.length} linha(s)`);
        } else if (novoX === 0) {
            detalhesAtuais = [];
        }

        renderizar();
    }

    document.addEventListener('click', evento => {
        const botao = evento.target.closest('button');
        if (botao?.getAttribute('data-testid') === 'residence-autocomplete-clear-input-button') {
            registrarSaida('Campo limpo antes da conclusão.');
            limparSessao();
        }
    }, true);

    setInterval(() => {
        if (location.href !== ultimaURL) {
            if (ultimaURL.includes(ROTA)) registrarSaida('Saiu da tela de encomendas.');
            ultimaURL = location.href;
            if (!naTela()) limparSessao();
        }
        sincronizar();
        criarBotao();
    }, INTERVALO);

    window.addEventListener('pagehide', () => registrarSaida('Página fechada ou atualizada.'), { capture: true });
    window.addEventListener('beforeunload', () => registrarSaida('Aplicativo ou navegador encerrado.'), { capture: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') registrarSaida('Aba ou aplicativo ficou oculto.');
    });

    function adicionarCSS() {
        if (document.querySelector('#pp505css')) return;
        const s = document.createElement('style');
        s.id = 'pp505css';
        s.textContent = `
#ppBtn{display:inline-flex!important;align-items:center;gap:8px;margin-left:10px!important}.ppLed{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 12px #22c55e;animation:ppBlink 1s infinite}@keyframes ppBlink{50%{opacity:.3}}
#ppTip{display:none;position:fixed;width:320px;padding:15px;background:#050505;border:1px solid #22c55e;border-radius:12px;z-index:2147483647;box-shadow:0 0 30px rgba(34,197,94,.35);color:#aaa;font:12px/18px Arial}.ppTT{color:#22c55e;font-weight:bold;font-size:14px;margin-bottom:10px}.ppTA{margin-top:10px;text-align:right;color:#22c55e;font-size:11px}
#ppPanel,#ppPanel *{box-sizing:border-box;font-family:Arial}#ppPanel{position:fixed;top:60px;right:25px;width:410px;height:610px;background:#050505;color:#fff;z-index:2147483646;border-radius:18px;overflow:hidden;border:1px solid #22c55e;box-shadow:0 0 35px rgba(34,197,94,.35)}#ppCanvas{position:absolute;inset:0;width:100%;height:100%;opacity:.12;pointer-events:none}.ppBody{position:relative;z-index:2;padding:18px;height:100%;display:flex;flex-direction:column}.ppTop{display:flex;justify-content:space-between}.ppTitle{font-size:18px;font-weight:bold;color:#22c55e;text-shadow:0 0 15px #22c55e}.ppSub{font-size:10px;color:#777;margin-top:5px;letter-spacing:2px}.ppStatus{margin-top:15px;padding:12px;border-radius:12px;background:#000b;border:1px solid #22c55e44;font-size:12px;line-height:20px}.ppRow{display:flex;justify-content:space-between;gap:10px}.ppVal{color:#22c55e;font-weight:bold;text-align:right}.ppTabs,.ppAct{display:flex;gap:8px;margin-top:10px}.ppTabs button,.ppAct button{flex:1;padding:8px;border-radius:9px;font-size:10px;font-weight:bold;cursor:pointer;background:#111827;color:#888;border:1px solid #22c55e44}.ppTabs .on{color:#22c55e;border-color:#22c55e}.ppArea{flex:1;min-height:0;margin-top:12px;overflow:auto}.ppItem{background:#111827e8;border:1px solid #22c55e33;padding:12px;border-radius:12px;margin-bottom:9px}.ppApt{font-size:18px;font-weight:bold;color:#22c55e}.ppMeta{font-size:10px;color:#fbbf24;margin-top:5px}.ppOrigem{font-size:10px;color:#60a5fa;margin-top:5px;font-weight:bold}.ppEmpty{text-align:center;margin-top:80px;color:#555;letter-spacing:2px}.ppFoot{text-align:center;font-size:9px;color:#777;padding-top:8px}`;
        document.head.appendChild(s);
    }

    function criarTooltip(botao) {
        document.querySelector('#ppTip')?.remove();
        const tip = document.createElement('div');
        tip.id = 'ppTip';
        tip.innerHTML = `<div class="ppTT">MONITOR DE ENCOMENDAS</div>
A unidade só é aceita depois que o autocomplete fecha, o botão de limpar aparece e o valor número/número permanece estável.<br><br>
<b style="color:#22c55e">X capturou</b>: contador do rodapé.<br>
<b style="color:#22c55e">Painel capturou</b>: linhas e detalhes da tabela.<br>
<b style="color:#22c55e">X e painel capturaram</b>: as duas fontes responderam.<br><br>
Sugestões abertas enquanto você digita são ignoradas.<div class="ppTA">Criado por Daniel Alexandre</div>`;
        document.body.appendChild(tip);
        botao.onmouseenter = () => {
            const r = botao.getBoundingClientRect();
            tip.style.display = 'block';
            tip.style.top = `${Math.min(innerHeight - tip.offsetHeight - 10, r.bottom + 8)}px`;
            tip.style.left = `${Math.max(10, Math.min(innerWidth - 330, r.left))}px`;
        };
        botao.onmouseleave = () => tip.style.display = 'none';
    }

    function criarBotao() {
        adicionarCSS();
        if (!naTela()) {
            document.querySelector('#ppBtn')?.remove();
            document.querySelector('#ppTip')?.remove();
            return;
        }
        if (document.querySelector('#ppBtn')) return;
        const ref = document.querySelector('button[data-testid="delivery-select-multiple-deliveries-button"]');
        if (!ref) return;
        const b = document.createElement('button');
        b.id = 'ppBtn';
        b.type = 'button';
        b.className = ref.className;
        b.innerHTML = 'MONITOR DE ENCOMENDAS <span class="ppLed"></span>';
        b.onclick = abrirPainel;
        ref.insertAdjacentElement('afterend', b);
        criarTooltip(b);
    }

    function abrirPainel() {
        const antigo = document.querySelector('#ppPanel');
        if (antigo) { antigo.remove(); clearInterval(matrixTimer); return; }
        const p = document.createElement('div');
        p.id = 'ppPanel';
        p.dataset.tab = 'historico';
        p.innerHTML = `<canvas id="ppCanvas"></canvas><div class="ppBody"><div class="ppTop"><div><div class="ppTitle">MONITOR DE ENCOMENDAS</div><div class="ppSub">SYSTEM ONLINE · V1.3.4</div></div><span class="ppLed"></span></div><div class="ppStatus"><div class="ppRow"><span>UNIDADE</span><span class="ppVal" id="pA">NENHUMA</span></div><div class="ppRow"><span>FONTE</span><span class="ppVal" id="pO">NENHUMA</span></div><div class="ppRow"><span>X ENCOMENDA(S)</span><span class="ppVal" id="pX">-</span></div><div class="ppRow"><span>LINHAS DA TABELA</span><span class="ppVal" id="pD">0</span></div><div class="ppRow"><span>REGISTROS</span><span class="ppVal" id="pR">0</span></div><div class="ppRow"><span>ÚLTIMA AÇÃO</span><span class="ppVal" id="pL">-</span></div></div><div class="ppTabs"><button id="pTH" class="on">HISTÓRICO</button><button id="pTC">TEMPO REAL</button></div><div class="ppAct"><button id="pClear">LIMPAR HISTÓRICO</button><button id="pLogs">LIMPAR CONSOLE</button><button id="pClose">FECHAR</button></div><div class="ppArea" id="pArea"></div><div class="ppFoot">Criado por Daniel Alexandre</div></div>`;
        document.body.appendChild(p);
        p.querySelector('#pTH').onclick = () => { p.dataset.tab = 'historico'; p.querySelector('#pTH').classList.add('on'); p.querySelector('#pTC').classList.remove('on'); renderizar(); };
        p.querySelector('#pTC').onclick = () => { p.dataset.tab = 'console'; p.querySelector('#pTC').classList.add('on'); p.querySelector('#pTH').classList.remove('on'); renderizar(); };
        p.querySelector('#pClear').onclick = () => { if (confirm('Limpar histórico?')) { localStorage.removeItem(STORAGE); renderizar(); } };
        p.querySelector('#pLogs').onclick = () => { logs = []; renderizar(); };
        p.querySelector('#pClose').onclick = () => { p.remove(); clearInterval(matrixTimer); };
        renderizar();
        iniciarMatrix();
    }

    function renderizar() {
        const p = document.querySelector('#ppPanel');
        if (!p) return;
        const historico = lerHistorico();
        p.querySelector('#pA').textContent = unidadeAtual || 'NENHUMA';
        p.querySelector('#pO').textContent = origemAtual;
        p.querySelector('#pX').textContent = ultimoX === null ? '-' : ultimoX;
        p.querySelector('#pD').textContent = detalhesAtuais.length;
        p.querySelector('#pR').textContent = historico.length;
        p.querySelector('#pL').textContent = logs[0] ? `${logs[0].tipo}: ${logs[0].mensagem}` : 'SISTEMA INICIADO';
        const area = p.querySelector('#pArea');
        if (p.dataset.tab === 'console') {
            area.innerHTML = logs.length ? logs.map(l => `<div class="ppItem"><div class="ppApt">${escapar(l.tipo)}</div><div class="ppMeta">${escapar(l.hora)} · ${escapar(l.mensagem)}</div></div>`).join('') : '<div class="ppEmpty">SEM EVENTOS</div>';
            return;
        }
        area.innerHTML = historico.length ? historico.map((item, i) => `<div class="ppItem"><div class="ppApt">${escapar(item.unidade)}</div><div class="ppMeta">${item.quantidade} encomenda(s) sem baixa · ${escapar(item.atualizadoEm)}</div><div class="ppOrigem">${escapar(item.origem || 'ORIGEM NÃO INFORMADA')}</div><button data-det="${i}">VER DETALHES</button><div id="det${i}" style="display:none;font-size:10px;margin-top:8px">${(item.detalhes || []).length ? item.detalhes.map((d, j) => `<div><b>Encomenda ${j + 1}</b><br>Número: ${escapar(d.numero || '-')}<br>Destinatário: ${escapar(d.destinatario || '-')}<br>Status: ${escapar(d.status || '-')}<br>Data: ${escapar(d.data || '-')}</div>${j < item.detalhes.length - 1 ? '<hr>' : ''}`).join('') : 'Painel não capturou detalhes nesta ocorrência.'}</div></div>`).join('') : '<div class="ppEmpty">SEM REGISTROS</div>';
        area.querySelectorAll('[data-det]').forEach(b => b.onclick = () => {
            const d = area.querySelector(`#det${b.dataset.det}`);
            const abrir = d.style.display !== 'block';
            d.style.display = abrir ? 'block' : 'none';
            b.textContent = abrir ? 'OCULTAR DETALHES' : 'VER DETALHES';
        });
    }

    function iniciarMatrix() {
        const c = document.querySelector('#ppCanvas');
        const p = document.querySelector('#ppPanel');
        if (!c || !p) return;
        c.width = p.offsetWidth; c.height = p.offsetHeight;
        const z = c.getContext('2d');
        const chars = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&@';
        const fs = 14;
        const gotas = Array(Math.floor(c.width / fs)).fill(0).map(() => Math.random() * 40);
        clearInterval(matrixTimer);
        matrixTimer = setInterval(() => {
            if (!document.body.contains(c)) { clearInterval(matrixTimer); return; }
            z.fillStyle = 'rgba(0,0,0,.12)'; z.fillRect(0, 0, c.width, c.height);
            z.fillStyle = '#22c55e'; z.font = `${fs}px monospace`;
            gotas.forEach((y, i) => { z.fillText(chars[Math.floor(Math.random() * chars.length)], i * fs, y * fs); if (y * fs > c.height && Math.random() > .975) gotas[i] = 0; gotas[i]++; });
        }, 90);
    }

    new MutationObserver(criarBotao).observe(document.documentElement, { childList: true, subtree: true });
    adicionarCSS();
    criarBotao();
    sincronizar();
})();
