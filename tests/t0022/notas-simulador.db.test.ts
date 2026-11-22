// T-0022 (F4): um `it.todo` por nota, gerado de ./apoio/matriz.ts; a nota vira `it` só pela API ou pelo worker do
// faturamento (Postgres local, papel macuxierp_app), nunca chamando o simulador direto. Plano: docs/testes/T-0022.md.
// O A1 de teste é gerado em tempo de execução (`gerarA1DeTeste`) e sobe pelo POST /v1/core/certificados: nunca commitado, nunca em log.
import { describe, it } from 'vitest';
import { PG_DISPONIVEL } from '../../packages/platform-sdk/src/pg-testes';
import { BASE_PENDENTE, FILIAIS, MATRIZ } from './apoio/matriz';
import { rotuloSerie } from './apoio/numeracao';

describe.skipIf(!PG_DISPONIVEL)(
  `T-0022: 20 notas no simulador da SEFAZ-AM pela API e pelo worker (pendente: ${BASE_PENDENTE.join(', ')})`,
  () => {
    for (const n of MATRIZ) {
      it.todo(
        `${n.id} (${rotuloSerie(n)}, CRT ${FILIAIS[n.filial]?.crt}, nº ${n.numero}; além da base: ${n.alemDaBase.join(', ') || 'nada'}): ` +
          `${n.cenario}. Entrada: ${n.entrada}. Esperado: ${n.esperado} [${n.regras.join(', ')}]`,
      );
    }
  },
);
