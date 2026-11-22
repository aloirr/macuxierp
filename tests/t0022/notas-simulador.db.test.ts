// T-0022 (F4): as 20 notas no simulador da SEFAZ-AM, um `it.todo` por nota gerado de ./apoio/matriz.ts até a base
// (T-0045, T-0019, T-0020, T-0021) chegar. Viram `it` na ordem N01..N20, contra a API de produção no Postgres local
// (tests/apoio/api-pg.ts, papel macuxierp_app). Plano: docs/testes/T-0022.md.
// Produção bloqueada (N16, N20): o cliente do simulador NÃO passa pelo guarda de ./apoio/numeracao.ts (só dos testes
// puros); a contagem vem do próprio simulador, por filial/CNPJ e tpAmb, e o bloqueio tem de vir da API ou do worker,
// antes de reservar número e antes da rede.
// O A1 de teste é gerado em tempo de execução pelo helper da T-0045: nunca commitado, nunca em log.
import { describe, it } from 'vitest';
import { PG_DISPONIVEL } from '../../packages/platform-sdk/src/pg-testes';
import { BASE_NECESSARIA, MATRIZ } from './apoio/matriz';
import { rotuloSerie } from './apoio/numeracao';

describe.skipIf(!PG_DISPONIVEL)(
  `T-0022: 20 notas no simulador da SEFAZ-AM (base: ${BASE_NECESSARIA.join(', ')})`,
  () => {
    for (const n of MATRIZ) {
      it.todo(
        `${n.id} (${rotuloSerie(n)}, nº ${n.numero}; destravado pela ${n.destravadoPor}): ${n.cenario}. ` +
          `Entrada: ${n.entrada}. Esperado: ${n.esperado} [${n.regras.join(', ')}]`,
      );
    }
  },
);
