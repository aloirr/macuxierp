# MenuAcoes (T-0099)

Botão "Ações" único das linhas de tabelas e listas do /config e do BKO (`@macuxierp/ui`). Substitui o "⋯" e as fileiras de botões. O shell precisa importar `@macuxierp/ui/botoes.css` (alvo de 44 px, hover e foco dos itens).

```tsx
<MenuAcoes
  rotuloLinha="Pedido 123"                       // aria-label "Ações de Pedido 123"; texto visível segue "Ações"
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
