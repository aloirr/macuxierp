import { describe, expect, it } from 'vitest';
import { ambientesComPadrao } from './ambiente';

const F1 = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const F2 = '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d';

describe('ambiente fiscal: filial sem linha vale homologação (RN-CORE-08)', () => {
  it('a Matriz cadastrada sem linha aparece em homologação', () => {
    expect(ambientesComPadrao([], [F1])).toEqual([{ filial_id: F1, ambiente: 'homologacao', recado_aprovacao: null }]);
  });
  it('mantém a linha gravada e só completa as que faltam', () => {
    const r = ambientesComPadrao([{ filial_id: F2, ambiente: 'producao', recado_aprovacao: null }], [F1, F2]);
    expect(r.map((a) => [a.filial_id, a.ambiente])).toEqual([[F2, 'producao'], [F1, 'homologacao']]);
  });
});
