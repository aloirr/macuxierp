# MenuAcoes (T-0099)

Botão "Ações" único das linhas de tabelas e listas do /config e do BKO (`@macuxierp/ui`). Substitui o "⋯" e as fileiras de botões. O shell precisa importar `@macuxierp/ui/botoes.css` (alvo de 44 px, hover e foco dos itens).

```tsx
<MenuAcoes
  rotuloLinha="Pedido 123"                       // aria-label "Ações de Pedido 123"; texto visível segue "Ações"
  principal={falhou ? { rotulo: 'Reprocessar', aoAcionar } : { rotulo: 'Log', aoAcionar }}
  acoes={[{ chave: 'editar', rotulo: 'Editar', aoAcionar }, { chave: 'zerar', rotulo: 'Zerar', aoAcionar, perigo: true }]}
/>
```

Item: `{ chave, rotulo, aoAcionar, perigo?, desabilitado?, oculto? }`. Principal: `{ rotulo, aoAcionar, desabilitado?, oculto? }`.

Regra: [docs/marca/botao-acoes.md](../marca/botao-acoes.md).

Da API
- Sem item visível e sem principal, nada é renderizado.
- O menu é `position: fixed` pelo retângulo do gatilho, então o `overflow` do quadro não o corta.
- Alvo de 44 px no celular pela classe `.mx-acoes-alvo` (`botoes.css`); item de perigo leva `.mx-acoes-perigo`.
