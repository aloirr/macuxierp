# Ativos da marca — Macuxi ERP

- `2026-11-22-v1/` — **ativos finais da assinatura "Macuxi ERP"** (T-0049): versões A (horizontal, principal) e C (vertical de apoio), em positivo, negativo azul-noite, negativo grafite, mono preto e mono branco; guias da área de proteção; `contraste.json` com a conferência dos pares. Regra de uso: [../assinatura-erp.md](../assinatura-erp.md).
- `fdv-2026-11-12-v1/` — **cópia sem alteração** dos ativos oficiais do Macuxi FDV (10 SVGs e `contraste.json`). Origem: `aloirr/macuxifdv@b75ab88`, `docs/marca/ativos/2026-11-12-v1/`, recebidos como anexo em `aloirr/macuxierp-recados@643f6ab` (`recados/anexos/T-0049/marca-fdv-2026-11-12-v1/`), por decisão do Alexandre de 22/11/2026, 01h40 (Manaus): "marca: opção B". É só referência: não se edita aqui; mudança de marca nasce no FDV.
- `gerar-assinatura-erp.mjs` — gera `2026-11-22-v1/` a partir de `fdv-2026-11-12-v1/`. Usa o símbolo e o "Macuxi" em curvas literalmente dos arquivos do FDV e monta só o "ERP" (IBM Plex Sans SemiBold). Antes de gravar, remonta as 7 versões do FDV com "FORÇA DE VENDAS" e exige que saiam idênticas, byte a byte, às oficiais. Uso no cabeçalho do script.

O símbolo sozinho (favicon, ícone, avatar) é o do FDV: `fdv-2026-11-12-v1/macuxi-simbolo{,-negativo,-mono}.svg`.
