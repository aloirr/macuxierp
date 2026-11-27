import { describe, expect, it } from 'vitest';
import { StatusNota } from '../contracts';
import { STATUS_NFE_QUE_TRAVA_TROCA_CNPJ } from './nfe-producao';

const QUE_CONTAM = ['autorizada', 'autorizada_guarda_pendente', 'cancelada', 'em_autorizacao', 'emitida_contingencia'] as const;
const QUE_NAO_CONTAM = ['rascunho', 'rejeitada', 'denegada', 'inutilizada'] as const;

describe('RN-CORE-16: status que travam a troca do CNPJ (na dúvida, bloqueia)', () => {
  it('RN-CORE-16: a lista tem exatamente os 5 status (autorizada, guarda pendente, cancelada, em autorização, em contingência)', () => {
    expect([...STATUS_NFE_QUE_TRAVA_TROCA_CNPJ].sort()).toEqual([...QUE_CONTAM].sort());
  });
  it('RN-CORE-16: rascunho, rejeitada, denegada e inutilizada não travam; as duas listas cobrem o contrato', () => {
    for (const s of QUE_NAO_CONTAM) expect(STATUS_NFE_QUE_TRAVA_TROCA_CNPJ).not.toContain(s);
    expect([...QUE_CONTAM, ...QUE_NAO_CONTAM].sort()).toEqual([...StatusNota.options].sort());
  });
});
