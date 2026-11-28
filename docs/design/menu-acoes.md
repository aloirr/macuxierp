# MenuAcoes (T-0099)

Botão "Ações" único das linhas de tabelas e listas do /config e do BKO (`@macuxierp/ui`). Substitui o "⋯" e as fileiras de botões. O shell precisa importar `@macuxierp/ui/botoes.css` (alvo de 44 px, hover e foco dos itens).

```tsx
<MenuAcoes
  rotuloLinha="Pedido 123"                       // aria-label "Ações de Pedido 123"; texto visível "Ações ▾"
  principal={falhou ? { rotulo: 'Reprocessar', aoAcionar } : { rotulo: 'Log', aoAcionar }}
  acoes={[{ chave: 'editar', rotulo: 'Editar', aoAcionar }, { chave: 'zerar', rotulo: 'Zerar', aoAcionar, perigo: true }]}
/>
```

Item: `{ chave, rotulo, aoAcionar, perigo?, desabilitado?: boolean | string, oculto? }` (texto = motivo). Principal: `{ rotulo, aoAcionar, desabilitado?: boolean | string, oculto? }` (mesmo tipo `Desabilitado` do item).

Regra: [docs/marca/botao-acoes.md](../marca/botao-acoes.md).

Da API
- Sem item visível e sem principal, nada é renderizado.
- O menu é `position: fixed` pelo retângulo do gatilho, então o `overflow` do quadro não o corta.
- Alvo de 44 px no celular pela classe `.mx-acoes-alvo` (`botoes.css`); item de perigo leva `.mx-acoes-perigo`.
- **Item desligado com motivo** (v0.3.15): `aria-disabled`, focável pelas setas (o leitor anuncia o motivo); Enter e Espaço não acionam nem fecham; o motivo aparece abaixo do rótulo (pequeno), ligado por `aria-describedby`; rótulo e motivo em `textoSecundario` (≥ 4,5:1), também no perigo. `desabilitado: true` sem motivo segue pulado.
- **Principal desligada**: `aria-disabled` (continua focável, o clique não faz nada); com texto, o motivo aparece em letra pequena abaixo do botão, ligado por `aria-describedby`. `true` sem motivo só desliga.
- **Tab no menu aberto** (T-0099): `preventDefault`, fecha e devolve o foco ao gatilho (padrão WAI-ARIA de menu button); o próximo Tab segue a ordem natural. O `aria-controls` do gatilho só existe com o menu aberto.

## Regra de uso (auditoria v0.3.32)
- **Uma coluna de ações por tabela**, com o `MenuAcoes` e no máximo uma principal. Nada de segundo botão solto na linha.
- **Título da coluna (RD-1111): cabeçalho visualmente vazio, com o texto "Ações" só para leitor de tela** (`.so-leitor`). O botão já diz "Ações ▾"; repetir o título na coluna é redundância (MENOS É MAIS). A coluna fica à direita.
- **Fechamento**: Esc (com o foco no gatilho ou em item), clique fora, rolagem da página e redimensionar da janela. A rolagem dentro do próprio menu não fecha. Ao fechar por Esc ou Tab, o foco volta ao gatilho; por clique fora ou rolagem, não toma o foco.
- **Teclado**: Enter, Espaço e ↓ abrem no primeiro item; ↑ no último; ↑ ↓ Home End circulam, pulando item desligado sem motivo.
- **Alvo de 44 px** no celular (até 640 px) no gatilho, na principal e nos itens (`.mx-acoes-alvo`).
- **Rótulo inteiro** (sem reticências, `nowrap`, `width: max-content`) e **perigo no fim**, depois do separador, em `erroTexto`.
- Conferência: `packages/ui/src/menu-acoes.test.tsx` e o e2e `tests/e2e/menu-acoes.mjs`.
