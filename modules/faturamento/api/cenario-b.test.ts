import { describe, expect, it } from 'vitest';
import type { NotaParaCliente } from '../contracts';
import { criarServicoDescidaNotas, exigirFaturamentoLigado, type FilaNotasParaDescer, type LicencaFaturamento, type NotaPendenteDeDescida } from './cenario-b';
import { tx } from './apoio-teste';

const T = '00000000-0000-4000-8000-0000000000aa';
const PEDIDO = '11111111-1111-4111-8111-111111111111';
const CHAVE = '13261112345678000195550010000012341000012345';
const licenca = (ativa: boolean): LicencaFaturamento => ({ ativa: async () => ativa });
const nota = (chave = CHAVE): NotaParaCliente => ({ chave_acesso: chave, pedido_id: PEDIDO, numero: 1234, serie: 1, emitida_em: '2026-11-24T14:00:00.000Z', protocolo: '1', total_produtos_centavos: 100, total_desconto_centavos: 0, total_centavos: 100, itens: [{ sequencia: 1, produto_id: null, codigo: 'P', descricao: 'x', unidade: 'UN', quantidade: 10_000, valor_unitario_centavos: 100, total_centavos: 100 }] });
const pendente = (o: Partial<NotaPendenteDeDescida['elegibilidade']> = {}, chave = CHAVE): NotaPendenteDeDescida => ({ nota: nota(chave), elegibilidade: { status: 'autorizada', ambiente: 'producao', xml_guardado: true, chave_acesso: chave, pedido_id: PEDIDO, faturamento: 'ligado', ...o } });

function filaFake(itens: NotaPendenteDeDescida[]) {
  const desceu = new Set<string>();
  const fila: FilaNotasParaDescer = {
    pendentes: async () => itens.filter((i) => !desceu.has(i.nota.chave_acesso)),
    marcarDescida: async (_t, _tn, chave) => (!itens.some((i) => i.nota.chave_acesso === chave) ? 'inexistente' : desceu.has(chave) ? 'repetida' : (desceu.add(chave), 'marcada')),
  };
  return { fila, desceu };
}

describe('fila de notas para descer (ADR 0014 §13)', () => {
  it('RN-FAT-03: lista só a nota autorizada de produção com XML guardado; as outras ficam fora e o motivo vai ao log sem dado pessoal', async () => {
    const logs: { motivo?: string }[] = [];
    const outra = '13261112345678000195550010000012351000012346';
    const { fila } = filaFake([pendente(), pendente({ xml_guardado: false }, outra)]);
    const s = criarServicoDescidaNotas({ fila, licenca: licenca(true), log: (e) => logs.push(e) });
    expect((await s.listarPendentes(tx, T)).map((n) => n.chave_acesso)).toEqual([CHAVE]);
    expect(logs[0]?.motivo).toBe('RN-FAT-03');
  });
  it('RN-FAT-04: nota de homologação nunca é listada', async () => {
    const s = criarServicoDescidaNotas({ fila: filaFake([pendente({ ambiente: 'homologacao' })]).fila, licenca: licenca(true) });
    expect(await s.listarPendentes(tx, T)).toEqual([]);
  });
  it('RN-FAT-11: com o faturamento desligado a lista é vazia', async () => {
    const s = criarServicoDescidaNotas({ fila: filaFake([pendente()]).fila, licenca: licenca(false) });
    expect(await s.listarPendentes(tx, T)).toEqual([]);
  });
  it('RN-FAT-11: o retorno é idempotente pela chave e a chave desconhecida dá 404', async () => {
    const { fila } = filaFake([pendente()]);
    const s = criarServicoDescidaNotas({ fila, licenca: licenca(true) });
    expect(await s.confirmarDescida(tx, T, CHAVE)).toBe('marcada');
    expect(await s.confirmarDescida(tx, T, CHAVE)).toBe('repetida');
    expect(await s.listarPendentes(tx, T)).toEqual([]);
    await expect(s.confirmarDescida(tx, T, 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('recusa de emissão com o faturamento desligado (ADR 0014 §15)', () => {
  it('RN-FAT-11: desligado recusa com 409 CONFLITO e detalhes.codigo faturamento_desligado; ligado passa', async () => {
    await expect(exigirFaturamentoLigado(licenca(false), tx, T)).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO', detalhes: { codigo: 'faturamento_desligado' } });
    await expect(exigirFaturamentoLigado(licenca(true), tx, T)).resolves.toBeUndefined();
  });
});
