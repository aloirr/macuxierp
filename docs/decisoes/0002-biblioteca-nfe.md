# ADR 0002 — Biblioteca de NF-e (modelo 55, layout 4.00, IBS/CBS/IS)

- **Status:** **proposta — a decisão é do Alexandre** (seção "Decisão pedida")
- **Data da pesquisa:** 21/11/2026 (Manaus)
- **Dono:** engenheiro-software
- **Relacionadas:** ADR 0001 (stack do FDV), doc 04 (fontes gratuitas), T-0018 (spike em homologação AM)

## Como a pesquisa foi feita (e o que não deu para conferir)
- Versões e datas vieram do **registry do npm** e do **Packagist**, que responderam na sessão; commits, branch e licenças vieram de `git clone --depth 1` dos repositórios.
- A sessão da nuvem **não alcança** os sites do governo (nfe.fazenda.gov.br, sefaz.am.gov.br), a BrasilAPI, o ViaCEP, o IBGE, o Siscomex, a Receita e o IBPT: o DNS deles é bloqueado no ambiente. O que depende dessas fontes ficou marcado **"a conferir"** e é conferido no **spike T-0018** (rodado de onde houver acesso, com o A1 de homologação).

## Contexto
O faturamento precisa de: montagem e assinatura do XML (A1, XMLDSig), envio SOAP com mTLS à SEFAZ-AM, retorno, eventos (cancelamento, CC-e), inutilização, consulta de protocolo e de status, contingência, DANFE em PDF e os grupos **IBS, CBS e IS** da NT 2025.002-RTC. Stack fixo: TypeScript/Node 24 (ADR 0001). Produto: SaaS fechado.

## Candidatas (fatos de 21/11/2026)
| | **NFeWizard** (`nfewizard-io`) | **Treeunfe DFe** (`@treeunfe/nfe`) | **sped-nfe** (`nfephp-org/sped-nfe`, PHP) | **sinete** (`@sinete/*`) |
|---|---|---|---|---|
| Última versão | 2.0.0 (08/11/2026) | nfe 2.6.6 (18/11/2026) | v5.2.11 (13/11/2026) | 0.8.0 (03/11/2026) |
| Último commit | 08/11/2026 | **repositório inacessível** (404 no GitHub; só o pacote no npm) | 13/11/2026 | 09/11/2026 |
| Licença | **GPL-3.0** | **GPL-3.0** (derivada do NFeWizard, mesmo autor) | **LGPL-3.0+ ou GPL-3.0+ ou MIT**, à escolha de quem usa | **Apache-2.0** |
| Maturidade | ~329 estrelas | sem dado (repo fechado) | ~1.600 estrelas, ~195 mil downloads/mês | 0 estrelas, criada em 09/2026, API 0.x |
| NF-e 4.00 (autorização, retorno, eventos, inutilização, consultas) | sim | sim | sim | sim (pelo código) |
| Contingência | SVC-AN e SVC-RS no código | SVC-AN confirmado | SVC-AN e SVC-RS por UF | SVC-AN e SVC-RS no código |
| DANFE PDF | sim (`@nfewizard/danfe`) | sim (`@treeunfe/danfe`) | sim (sped-da) | sim |
| IBS/CBS/IS | NT 2025.002 **v1.35** | NT 2025.002 **v1.20** | NT 2025.002 **v1.50** + NTs 2026.002/007/008; schemas PL_010g | código cita até **v1.52** |
| SEFAZ-AM | homologado só status e consulta; **autorização no AM não homologada** (STATUS_HOMOLOGACAO.md) | sem dado | autorizador AM mapeado | sem dado |
| Dependências nativas | `libxmljs2`, `pem` (binário openssl), JDK opcional | as mesmas | extensões openssl, soap e dom do PHP | nenhuma (declarado) |

Também vistas: `@brasil-fiscal/nfe` (MIT, IBS/CBS no README, ~36 estrelas), `nfets` (MIT, 0.0.x), `nfe-io` (SDK de serviço pago, descartado), `node-dfe` (abandonado em 2022).

**NT 2025.002-RTC** (fontes secundárias, **a conferir** no Portal Nacional): versão vigente **v1.53** (30/10/2026, produção prevista 16/11/2026); regime normal obrigado desde fatos geradores de 03/08/2026; Simples Nacional a partir de 01/01/2027; rejeição 1115 suspensa em produção sem data. Pacote de schemas **PL_010g** (v1.03, 26/10/2026), com divergência entre fontes (há quem cite PL_010f).

**SEFAZ-AM** (pelo código do sped-nfe e do Treeunfe; **a conferir**): autorizador próprio; homologação `homnfe.sefaz.am.gov.br/services2/services/…`, produção `nfe.sefaz.am.gov.br/services2/services/…`; contingência **SVC-RS**.

## Análise
- **GPL-3.0 num SaaS**: a GPLv3 só obriga a abrir o código quando há "conveying" (entrega de cópia). SaaS puro, rodando só no servidor, não entrega cópia. Mas a obrigação nasce se algum dia houver versão instalada no cliente, agente local (A3), imagem entregue a parceiro ou código GPL enviado ao navegador; e pesa em due diligence. Treeunfe soma o risco de repositório fechado.
- **Atraso de NT**: NFeWizard (v1.35) e Treeunfe (v1.20) estão abaixo da v1.53. O sped-nfe é o que acompanha mais de perto.
- **AM**: nenhuma biblioteca Node tem autorização no AM comprovada; o sped-nfe tem o autorizador mapeado e uma base enorme de uso.
- **sped-nfe sob MIT** permite **portar a lógica** para TypeScript (com a atribuição), sem contaminar o código, e serve de oráculo nos testes (mesmo pedido → mesmo XML).

## Decisão pedida ao Alexandre
| Opção | O que é | Impacto na F4 (previsão do doc 05) |
|---|---|---|
| **A (recomendada)** | **Módulo próprio em TypeScript** atrás da porta `EmissorNFe`, portando a lógica do **sped-nfe (opção MIT)**; XML validado contra o XSD oficial (PL_010g); assinatura e mTLS com o A1 em Node puro. O **sinete (Apache-2.0)** entra no spike T-0018 como atalho: se passar no AM, vira a implementação inicial atrás da porta | a previsão atual (T-0021 30h base) já assume A |
| B | **NFeWizard** (GPL-3.0) como base | −8 a −10 h na T-0021, mas GPL, autorização no AM não homologada, NT v1.35 e dependência de openssl/libxmljs2 nativos |
| C | **sinete** (Apache-2.0) como base direta, sem spike | −10 h na T-0021 se der certo; risco alto (2 meses de vida, 0 estrelas, API 0.x) |
| D | Serviço PHP com o **sped-nfe** ao lado da API | contraria a ADR 0001 (pilha nova); fora |

**Recomendação:** A. Motivos: licença limpa (MIT/Apache), controle do ritmo das NTs, nenhuma dependência nativa, e o sped-nfe como referência madura e oráculo de teste. Risco: custo de acompanhar as NTs (15+ versões da 2025.002 em um ano), mitigado pela porta `EmissorNFe` e pelo teste de XSD no CI.

## Consequências (se A for aprovada)
- T-0018 (spike): sinete × porte do sped-nfe em homologação AM, com o A1 de teste; confere endereços, SVC-RS e a NT vigente no portal oficial; registra o resultado aqui.
- A versão da NT usada fica nesta ADR (adendo a cada NT nova).
- `fiscal` expõe o cálculo em `contracts`; `faturamento` monta o XML a partir dele.
