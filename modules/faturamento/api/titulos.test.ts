import { ErroApi } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { configuracaoFake, depsFake, DIGVAL, geracaoFake, NPROT, titulosFake, tx, TENANT } from './apoio-teste';
import { criarProcessadorRetorno, criarServicoEmissao, EVENTO_NOTA_AUTORIZADA } from './emissao';
import type { NotaRegistro, RetornoSefaz } from './portas';
import { cancelarTitulosDaNotaCancelada, criarServicoTitulos, EVENTO_TITULO_BAIXADO, EVENTO_TITULO_GERADO, contaComoRealDaNota, criarVarreduraTitulos, gerarTitulosDaNota, consultaTitulosPedido } from './titulos';

const autorizada: RetornoSefaz = { cStat: '100', xMotivo: 'Autorizado o uso da NF-e', nProt: NPROT, digVal: DIGVAL, dhRecbto: '2026-11-21T10:31:02-04:00', xmlProtocolo: '<protNFe versao="4.00"/>', nRec: null };
const opcoes = { xmlAssinado: '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFex"/></NFe>', digestValue: DIGVAL };

async function cenario(o: Parameters<typeof depsFake>[0] = {}, bandeira = false) {
  const f = depsFake(o);
  const t = titulosFake(
    () => [...f.r.notas.values()].filter((n) => n.status === 'autorizada').map((n) => n.id),
    (nota_id) => f.r.conteudos.get(nota_id)?.conta_como_real === true,
  );
  const c = configuracaoFake({ [IDS.filial]: bandeira });
  const logs: { evento: string; nota_id?: string; motivo?: string }[] = [];
  const r = await criarServicoEmissao({ ...f.deps, configuracao: c.repo, log: (e) => logs.push(e) }).emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-tit-0001' });
  if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
  await f.r.repo.mudarStatus(tx, r.nota.id, 'rascunho', 'em_autorizacao');
  const nota = f.r.notas.get(r.nota.id) as NotaRegistro;
  const processar = criarProcessadorRetorno(f.r.repo, t.repo, (e) => logs.push(e));
  const autorizar = () => processar(tx, nota, autorizada, opcoes);
  const svc = criarServicoTitulos({ titulos: t.repo, notas: f.r.repo }, () => new Date('2026-11-25T15:00:00Z'));
  const eventos = (nome: string) => f.r.eventos.filter((e) => e.nome === nome);
  return { ...f, f, t, c, logs, nota, autorizar, svc, eventos };
}

describe('títulos a receber: geração na autorização (RF-FAT-07, RN-FAT-06)', () => {
  it('RN-FAT-06: boleto em 2 prazos gera 2 títulos na autorização, com rateio exato, e publica titulo.gerado@1 DEPOIS do nota.autorizada@1 (agregado = titulo.id)', async () => {
    const s = await cenario();
    await s.autorizar();
    const lista = [...s.t.titulos.values()];
    expect(lista.map((x) => [x.parcela, x.total_parcelas, x.status])).toEqual([[1, 2, 'aberto'], [2, 2, 'aberto']]);
    expect(lista.reduce((a, x) => a + x.valor_centavos, 0)).toBe(s.nota.total_centavos);
    expect(lista.map((x) => x.vencimento)).toEqual(['2026-12-21', '2027-01-20']);
    expect(s.f.r.log.filter((l) => l.startsWith('evento:'))).toEqual([`evento:${EVENTO_NOTA_AUTORIZADA}`, `evento:${EVENTO_TITULO_GERADO}`, `evento:${EVENTO_TITULO_GERADO}`]);
    expect(s.eventos(EVENTO_TITULO_GERADO).map((e) => e.agregado_id)).toEqual(lista.map((x) => x.id));
  });

  it('RN-FAT-06: reprocessar a geração não duplica título nem republica o evento', async () => {
    const s = await cenario();
    await s.autorizar();
    const de = { titulos: s.t.repo, notas: s.f.r.repo };
    expect(await gerarTitulosDaNota(tx, de, s.f.r.notas.get(s.nota.id) as NotaRegistro)).toEqual([]);
    expect(s.t.titulos.size).toBe(2);
    expect(s.eventos(EVENTO_TITULO_GERADO)).toHaveLength(2);
  });

  it('RN-FAT-06: cartão e à vista não geram título', async () => {
    for (const tPag of ['03', '01']) {
      const s = await cenario();
      const c = s.f.r.conteudos.get(s.nota.id);
      if (c) s.f.r.conteudos.set(s.nota.id, { ...c, pagamentos: c.pagamentos.map((p) => ({ ...p, tPag })) });
      await s.autorizar();
      expect(s.t.titulos.size).toBe(0);
      expect(s.eventos(EVENTO_TITULO_GERADO)).toEqual([]);
    }
  });

  it('RN-FAT-03: nota rejeitada ou com guarda pendente não gera título', async () => {
    const s = await cenario();
    await criarProcessadorRetorno(s.f.r.repo, s.t.repo, (e) => s.logs.push(e))(tx, s.nota, { ...autorizada, cStat: '539', xMotivo: 'Duplicidade' }, opcoes);
    expect(s.t.titulos.size).toBe(0);
  });
});

describe('títulos a receber: baixa e estorno', () => {
  it('RN-FAT-06: baixa parcial deixa aberto, total baixa; titulo.baixado@1 leva valor_baixado_centavos e o saldo novo', async () => {
    const s = await cenario();
    await s.autorizar();
    const [t1] = [...s.t.titulos.values()];
    const parcial = await s.svc.baixar(tx, t1!.id, { valor_centavos: 1000, forma: 'pix' }, 'u-1');
    expect(parcial.titulo).toMatchObject({ status: 'aberto', saldo_centavos: t1!.valor_centavos - 1000 });
    const total = await s.svc.baixar(tx, t1!.id, { valor_centavos: t1!.valor_centavos - 1000, forma: 'pix' }, 'u-1');
    expect(total.titulo).toMatchObject({ status: 'baixado', saldo_centavos: 0 });
    expect(s.eventos(EVENTO_TITULO_BAIXADO).map((e) => (e.payload as { valor_baixado_centavos: number; baixado_em: string }).valor_baixado_centavos)).toEqual([1000, t1!.valor_centavos - 1000]);
    expect((s.eventos(EVENTO_TITULO_BAIXADO)[0]?.payload as { baixado_em: string }).baixado_em).toBe('2026-11-25');
  });

  it('RN-FAT-06: data_baixa vira o baixado_em do evento; sem ela, hoje (Manaus); data futura é 422; forma padrão manual', async () => {
    const s = await cenario();
    await s.autorizar();
    const [t1] = [...s.t.titulos.values()];
    await s.svc.baixar(tx, t1!.id, { valor_centavos: 100, data_baixa: '2026-11-20', forma: 'manual' }, null);
    await expect(s.svc.baixar(tx, t1!.id, { valor_centavos: 100, data_baixa: '2026-11-26', forma: 'manual' }, null)).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-06' });
    expect(s.eventos(EVENTO_TITULO_BAIXADO).map((e) => (e.payload as { baixado_em: string }).baixado_em)).toEqual(['2026-11-20']);
    const { BaixarTituloEntrada } = await import('../contracts');
    expect(BaixarTituloEntrada.parse({ valor_centavos: 5, data_baixa: '2026-11-20' }).forma).toBe('manual');
  });

  it('RN-FAT-06: valor acima do saldo, título baixado e título cancelado recusam a baixa (422)', async () => {
    const s = await cenario();
    await s.autorizar();
    const [t1, t2] = [...s.t.titulos.values()];
    await expect(s.svc.baixar(tx, t1!.id, { valor_centavos: t1!.valor_centavos + 1, forma: 'pix' }, null)).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-06' });
    await s.svc.baixar(tx, t1!.id, { valor_centavos: t1!.valor_centavos, forma: 'pix' }, null);
    await expect(s.svc.baixar(tx, t1!.id, { valor_centavos: 1, forma: 'pix' }, null)).rejects.toBeInstanceOf(ErroApi);
    await s.t.repo.cancelar(tx, [t2!.id]);
    await expect(s.svc.baixar(tx, t2!.id, { valor_centavos: 1, forma: 'pix' }, null)).rejects.toMatchObject({ codigo: 'RN-FAT-06' });
    await expect(s.svc.baixar(tx, '00000000-0000-4000-8000-0000000000aa', { valor_centavos: 1, forma: 'pix' }, null)).rejects.toMatchObject({ status: 404 });
  });

  it('RN-FAT-06: o estorno devolve o saldo e reabre o título baixado; estornar duas vezes é 422', async () => {
    const s = await cenario();
    await s.autorizar();
    const [t1] = [...s.t.titulos.values()];
    const b = await s.svc.baixar(tx, t1!.id, { valor_centavos: t1!.valor_centavos, forma: 'boleto' }, null);
    expect(b.titulo.status).toBe('baixado');
    const e = await s.svc.estornar(tx, t1!.id, b.baixa.id);
    expect(e.titulo).toMatchObject({ status: 'aberto', saldo_centavos: t1!.valor_centavos });
    await expect(s.svc.estornar(tx, t1!.id, b.baixa.id)).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-06' });
  });
});

describe('títulos a receber: cancelamento da nota', () => {
  it('RN-FAT-06: nota cancelada cancela os títulos abertos sem baixa', async () => {
    const s = await cenario();
    await s.autorizar();
    const r = await cancelarTitulosDaNotaCancelada(tx, { titulos: s.t.repo }, s.nota.id);
    expect(r).toEqual({ cancelados: 2, divergentes: [] });
    expect([...s.t.titulos.values()].map((x) => x.status)).toEqual(['cancelado', 'cancelado']);
  });

  it('RN-FAT-06: com baixa o cancelamento NÃO é bloqueado: a parcela baixada fica como está e vira divergência; as outras são canceladas', async () => {
    const s = await cenario();
    await s.autorizar();
    const [t1, t2] = [...s.t.titulos.values()];
    await s.svc.baixar(tx, t1!.id, { valor_centavos: 500, forma: 'pix' }, null);
    const r = await cancelarTitulosDaNotaCancelada(tx, { titulos: s.t.repo }, s.nota.id);
    expect(r).toEqual({ cancelados: 1, divergentes: [{ id: t1!.id, parcela: 1 }] });
    expect(s.t.titulos.get(t1!.id)?.status).toBe('aberto');
    expect(s.t.titulos.get(t2!.id)?.status).toBe('cancelado');
  });
});

describe('bandeira faturamento real com NF-e simulada', () => {
  const contaReal = (e: { payload: unknown }) => (e.payload as { conta_como_real?: boolean }).conta_como_real;

  it('RN-FAT-04: bandeira LIGADA e nota de homologação: nota.autorizada@1, titulo.gerado@1 e titulo.baixado@1 levam conta_como_real: true; a nota segue homologacao', async () => {
    const s = await cenario({ ambiente: 'homologacao' }, true);
    await s.autorizar();
    const [t1] = [...s.t.titulos.values()];
    await s.svc.baixar(tx, t1!.id, { valor_centavos: 100, forma: 'pix' }, null);
    expect(s.eventos(EVENTO_NOTA_AUTORIZADA).map(contaReal)).toEqual([true]);
    expect(s.eventos(EVENTO_TITULO_GERADO).map(contaReal)).toEqual([true, true]);
    expect(s.eventos(EVENTO_TITULO_BAIXADO).map(contaReal)).toEqual([true]);
    expect(s.nota.ambiente).toBe('homologacao');
    expect([...s.t.titulos.values()].every((x) => x.ambiente === 'homologacao')).toBe(true);
  });

  it('RN-FAT-04: bandeira DESLIGADA (padrão): conta_como_real ausente em todos os payloads', async () => {
    const s = await cenario({ ambiente: 'homologacao' }, false);
    await s.autorizar();
    const [t1] = [...s.t.titulos.values()];
    await s.svc.baixar(tx, t1!.id, { valor_centavos: 100, forma: 'pix' }, null);
    for (const nome of [EVENTO_NOTA_AUTORIZADA, EVENTO_TITULO_GERADO, EVENTO_TITULO_BAIXADO]) expect(s.eventos(nome).map(contaReal).every((v) => v === undefined)).toBe(true);
  });

  it('RN-FAT-04: em produção a bandeira ligada não muda nada (conta_como_real ausente); sem a porta, desligada', async () => {
    const s = await cenario({ ambiente: 'producao' }, true);
    await s.autorizar();
    expect(s.eventos(EVENTO_NOTA_AUTORIZADA).map(contaReal)).toEqual([undefined]);
    expect(contaComoRealDaNota(null, { ambiente: 'homologacao' })).toBe(false);
  });
});

describe('conta_como_real guardado na nota (RN-FAT-04)', () => {
  const contaReal = (e: { payload: unknown }) => (e.payload as { conta_como_real?: boolean }).conta_como_real;

  it('RN-FAT-04: a baixa usa o conta_como_real da nota (calculado na emissão), não a bandeira de agora: desligar depois não muda o titulo.baixado@1', async () => {
    const s = await cenario({ ambiente: 'homologacao' }, true);
    expect(s.f.r.conteudos.get(s.nota.id)?.conta_como_real).toBe(true);
    await s.autorizar();
    await s.c.repo.definir(tx, IDS.filial, false, 'u-1');
    const [t1] = [...s.t.titulos.values()];
    await s.svc.baixar(tx, t1!.id, { valor_centavos: 100, forma: 'pix' }, null);
    expect(s.eventos(EVENTO_TITULO_GERADO).map(contaReal)).toEqual([true, true]);
    expect(s.eventos(EVENTO_TITULO_BAIXADO).map(contaReal)).toEqual([true]);
  });

  it('RN-FAT-04: se a leitura da bandeira falha, vale false, com log, e a emissão segue', async () => {
    const f = depsFake({ ambiente: 'homologacao' });
    const log: { evento: string }[] = [];
    const cfg = { ...configuracaoFake().repo, faturamentoRealComNfeSimulada: async () => { throw new Error('relation "faturamento.configuracao_filial" does not exist'); } };
    const r = await criarServicoEmissao({ ...f.deps, configuracao: { ...cfg, lerBandeiraSegura: async (_t, _f, avisar) => { avisar('falha ao ler a bandeira'); return false; } }, log: (e) => log.push(e) }).emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-band-0001' });
    expect(r.ok).toBe(true);
    expect(log).toEqual([{ evento: 'faturamento.bandeira.leitura_falhou', motivo: 'falha ao ler a bandeira' }]);
    expect(f.r.conteudos.get((r as { nota: { id: string } }).nota.id)?.conta_como_real).toBe(false);
  });

  it('RN-PED-04: o saldo aberto do cliente soma produção e título de nota conta_como_real (decisão do Alexandre de 22/11: nota simulada vale como real)', async () => {
    const real = await cenario({ ambiente: 'homologacao' }, true);
    await real.autorizar();
    expect(await consultaTitulosPedido(real.t.repo).saldoAbertoCliente(tx, IDS.cliente)).toBe(real.nota.total_centavos);
    const simulada = await cenario({ ambiente: 'homologacao' }, false);
    await simulada.autorizar();
    expect(await consultaTitulosPedido(simulada.t.repo).saldoAbertoCliente(tx, IDS.cliente)).toBe(0);
  });
});

describe('geração de título que falha não derruba a nota (RN-FAT-03)', () => {
  it('RN-FAT-03: a geração falha: a nota fica autorizada com o nfeProc guardado, sem título, com pendência no resultado e no log; a varredura gera depois (idempotente)', async () => {
    const s = await cenario();
    const original = s.t.repo.inserirParcelas;
    let falhar = true;
    s.t.repo.inserirParcelas = async (...a) => { if (falhar) throw new Error('relation "faturamento.titulo" does not exist'); return original(...a); };
    const r = await s.autorizar();
    expect(r).toMatchObject({ resultado: 'autorizada', titulos_pendentes: expect.stringContaining('falha_inesperada') });
    expect(s.f.r.notas.get(s.nota.id)?.status).toBe('autorizada');
    expect(s.f.r.xmls).toHaveLength(1);
    expect(s.t.titulos.size).toBe(0);
    expect(s.logs).toEqual([expect.objectContaining({ evento: 'faturamento.titulo.geracao_pendente', nota_id: s.nota.id })]);
    falhar = false;
    const varrer = criarVarreduraTitulos({ titulos: s.t.repo, notas: s.f.r.repo, log: (e) => s.logs.push(e) });
    expect(await varrer(tx, { ha_minutos: 5 })).toEqual({ verificadas: 1, geradas: 2, pendentes: 0, desistidas: 0 });
    expect(s.t.titulos.size).toBe(2);
    expect(await varrer(tx, { ha_minutos: 5 })).toEqual({ verificadas: 0, geradas: 0, pendentes: 0, desistidas: 0 }); // já tem título: nada a fazer
  });

  it('RN-FAT-03: prazos vazios na nota gravada viram pendência (sem lançar), não rollback da guarda', async () => {
    const s = await cenario();
    const c = s.f.r.conteudos.get(s.nota.id)!;
    s.f.r.conteudos.set(s.nota.id, { ...c, prazos_dias: [], cobranca: null });
    const r = await s.autorizar();
    expect(r).toMatchObject({ resultado: 'autorizada', titulos_pendentes: expect.stringContaining('RN-FAT-06') });
    expect(s.f.r.xmls).toHaveLength(1);
  });

  it('RN-FAT-06: na EMISSÃO, boleto sem prazos é violação e nenhum número é reservado', async () => {
    const f = depsFake();
    const cadastros = { ...f.deps.cadastros, condicao: async () => ({ forma_tpag: '15', prazos_dias: [] as number[] }) };
    const r = await criarServicoEmissao({ ...f.deps, cadastros }).emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-sem-prazo-1' });
    expect(r).toMatchObject({ ok: false, violacoes: [{ rn: 'RN-FAT-06', mensagem: 'A condição de pagamento do boleto não tem prazos.' }] });
    expect(f.r.estado.reservas).toBe(0);
  });
});

describe('varredura de títulos: teto de tentativas (RN-FAT-03)', () => {
  /** Notas e títulos de mentira: 'ruim' sempre falha a geração; 'boa' gera. Só a varredura é exercitada. */
  function varredura(ids: string[], max?: number) {
    const logs: { evento: string; nota_id?: string; motivo?: string }[] = [];
    const geradas: string[] = [];
    let atual = '';
    const notas = { obter: async (_t: unknown, id: string) => { atual = id; return { id, tenant_id: TENANT, status: 'autorizada' }; } };
    const geracao = geracaoFake();
    const titulos = {
      notasBoletoSemTitulo: async (_t: unknown, o: { limite: number; max_tentativas: number }) =>
        geracao.filtrarEOrdenar(ids.filter((i) => !geradas.includes(i)), o.max_tentativas).slice(0, o.limite),
      registrarFalhaGeracao: geracao.registrarFalhaGeracao,
      emSavepoint: async () => (atual === 'ruim' ? { ok: false as const, erro: new Error('falha') } : (geradas.push(atual), { ok: true as const, valor: [] as unknown[] })),
    };
    const varrer = criarVarreduraTitulos({ titulos, notas, log: (e: { evento: string; nota_id?: string; motivo?: string }) => logs.push(e) } as unknown as Parameters<typeof criarVarreduraTitulos>[0], max === undefined ? {} : { max_tentativas: max });
    return { varrer, logs, geradas };
  }

  it('RN-FAT-03: a nota que sempre falha sai da varredura no teto (5), vai ao log como titulo.geracao_desistida e não trava as outras', async () => {
    const v = varredura(['ruim', 'boa']);
    for (let i = 1; i <= 4; i++) expect(await v.varrer(tx, { ha_minutos: 5, limite: 5 })).toMatchObject({ pendentes: 1, desistidas: 0 });
    expect(v.logs.filter((l) => l.evento === 'faturamento.titulo.geracao_desistida')).toHaveLength(0);
    expect(await v.varrer(tx, { ha_minutos: 5, limite: 5 })).toMatchObject({ pendentes: 1, desistidas: 1 }); // 5ª tentativa
    expect(v.logs.filter((l) => l.evento === 'faturamento.titulo.geracao_desistida')).toEqual([expect.objectContaining({ nota_id: 'ruim' })]);
    expect(await v.varrer(tx, { ha_minutos: 5, limite: 5 })).toMatchObject({ geradas: 0, verificadas: 0, pendentes: 0 }); // 'ruim' não volta
    expect(v.geradas).toEqual(['boa']);
  });

  it('RN-FAT-03: as notas com a tentativa mais antiga vêm primeiro (a recém-falhada espera a vez) e o teto é configurável', async () => {
    const v = varredura(['ruim', 'boa'], 1);
    expect(await v.varrer(tx, { ha_minutos: 5 })).toEqual({ verificadas: 2, geradas: 0, pendentes: 1, desistidas: 1 }); // teto 1: a 1ª falha já desiste; 'boa' foi gerada (valor vazio no stub)
    expect(await v.varrer(tx, { ha_minutos: 5 })).toEqual({ verificadas: 0, geradas: 0, pendentes: 0, desistidas: 0 });
    const w = varredura(['ruim', 'boa2', 'boa3']);
    await w.varrer(tx, { ha_minutos: 5, limite: 1 }); // 'ruim' falha e passa a ter tentativa
    await w.varrer(tx, { ha_minutos: 5, limite: 3 });
    expect(w.geradas).toEqual(['boa2', 'boa3']); // nunca tentadas vêm antes da que já falhou
  });
});
