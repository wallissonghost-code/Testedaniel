# Painel Plus V1 Modf

Versão experimental separada do monitor estável.

## Como funciona

- Pesquisa a unidade normalmente, por exemplo `2/202`.
- A tabela de encomendas é a fonte principal da contagem.
- O contador visual `X encomenda(s)` serve apenas como conferência.
- Pendências da mesma unidade ficam agrupadas em um único registro.
- Ao pesquisar novamente a mesma unidade, a quantidade é atualizada automaticamente.
- Quando a unidade chega a zero encomendas, ela é removida do painel.
- O botão **Ver detalhes** mostra as encomendas individuais sem ocupar o painel principal.

## Proteções

- Não aceita cegamente um contador visual incorreto, como `80 encomendas`, se a tabela real mostrar outra quantidade.
- Usa `pagehide`, `beforeunload` e `visibilitychange` como tentativas de registrar fechamento ou saída.
- A reconciliação automática corrige o histórico quando a unidade for pesquisada novamente.

## Instalação

Abra `monitor-painel-plus-v1.user.js`, copie o conteúdo e cole em um novo script do Tampermonkey.

Mantenha esta versão separada do monitor estável durante os testes.
