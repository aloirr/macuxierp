import { describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { criarProcessadorRetorno, criarServicoEmissao, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_REJEITADA, xmlDaNota, type DepsEmissao } from './emissao';
import { CNPJ_EMITENTE, contingenciaFake, depsFake, DIGVAL, NPROT, titulosFake, tx, TENANT, uuid } from './apoio-teste';
import type { NotaRegistro, RetornoSefaz } from './portas';

const entrada = (idempotencia = 'idem-0000001') => ({ pedido_id: IDS.pedido, idempotencia });
const retorno = (cStat: string, xMotivo = 'x', extra: Partial<RetornoSefaz> = {}): RetornoSefaz => ({ cStat, xMotivo, nProt: null, digVal: null, dhRecbto: null, xmlProtocolo: null, nRec: null, ...extra });
const autorizada = retorno('100', 'Autorizado o uso da NF-e', { nProt: NPROT, digVal: DIGVAL, dhRecbto: '2026-11-21T10:31:02-04:00', xmlProtocolo: '<protNFe versao="4.00"/>' });
const opcoes = { xmlAssinado: '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFex"/></NFe>', digestValue: DIGVAL };

function montar(o: Parameters<typeof depsFake>[0] = {}) {
  const f = depsFake(o);
  // O retorno da SEFAZ é do worker: o teste o monta com as portas de título e de log. A geração de títulos é testada em titulos.test.ts: aqui ela é neutra (sem eventos de título).
  const titulos = { ...titulosFake().repo, emSavepoint: async <T>(_t: unknown, fn: () => Promise<T>) => { void fn; return { ok: true as const, valor: [] as unknown as T }; } };
  const processarRetorno = criarProcessadorRetorno(f.r.repo, titulos, () => undefined);
  return { ...f, ...f.r, svc: { ...criarServicoEmissao(f.deps), processarRetorno } };
}
/** Fase da API: a nota nasce em rascunho (a API não assina). */
async function emitirRascunho(m: ReturnType<typeof montar>, idem?: string): Promise<NotaRegistro> {
  const r = await m.svc.emitirNota(tx, TENANT, entrada(idem));
  if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
  return r.nota;
}
/** Emite e simula o início da fase do worker (assinar e ir a em_autorizacao): para os testes do retorno da SEFAZ, que só olham a nota em autorização. */
async function emitir(m: ReturnType<typeof montar>, idem?: string): Promise<NotaRegistro> {
  const n = await emitirRascunho(m, idem);
  await m.repo.mudarStatus(tx, n.id, 'rascunho', 'em_autorizacao');
  m.log.length = 0;
  return m.notas.get(n.id)!;
}

describe('emissão da NF-e (serviço de aplicação, portas em memória)', () => {
  it('RN-FAT-01: trava a idempotência, reserva o número, grava a nota em rascunho (conteúdo, chave, cNF e dhEmi) e a deixa em rascunho: a API não assina, não guarda nfe_assinada e não fala com a SEFAZ', async () => {
    const m = montar();
    const nota = await emitirRascunho(m);
    expect(nota).toMatchObject({ numero: 100, serie: 1, status: 'rascunho', ambiente: 'producao', total_centavos: 4500 });
    expect(nota.chave_acesso).toMatch(new RegExp(`^132611${CNPJ_EMITENTE}550010000001001\\d{9}$`));
    expect(nota.cnf).toBe(nota.chave_acesso.slice(35, 43)); // o cNF sorteado pelo emissor é gravado na nota
    expect(m.log).toEqual(['trava', 'numero:100', 'gravar']);
    expect(m.assinados).toEqual([]);
    expect(m.assinadas).toEqual([]);
    expect(m.estado.ambienteReserva).toBe('producao');
    // RN-FAT-01/RF-FAT-01: o pedido já saiu todo na 1ª nota; a 2ª é recusada pelo saldo do próprio faturamento (o pedido ainda diz 0) e não gasta número.
    const segunda = await m.svc.emitirNota(tx, TENANT, entrada('idem-0000002'));
    expect(!segunda.ok && segunda.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01', campo: 'itens' });
    expect(m.estado.reservas).toBe(1);
  });

  it('RN-FAT-04: filial em produção com a emissão de produção desligada (padrão): a API recusa (422) ANTES de reservar o número e a série não anda', async () => {
    const m = montar();
    for (const habilitada of [false, undefined]) {
      const svc = criarServicoEmissao({ ...m.deps, emissaoProducaoHabilitada: habilitada });
      const r = await svc.emitirNota(tx, TENANT, entrada(`idem-prod-${String(habilitada)}`));
      expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-FAT-04', mensagem: 'Emissão em produção ainda não habilitada (homologação real pendente, T-0046).' });
    }
    expect(m.estado.reservas).toBe(0);
    expect(m.log).toEqual(['trava', 'trava']);
  });

  it('ADR 0005 item 4: a API emite sem nenhum A1 decifrado: a porta lerA1 nem existe nas dependências da API (o tipo a recusa)', async () => {
    const m = montar();
    // @ts-expect-error DepsEmissao (API) não tem `lerA1`: só o worker lê o A1 decifrado
    const comA1: DepsEmissao = { ...m.deps, lerA1: async () => null };
    expect(Object.keys(m.deps)).not.toContain('lerA1');
    expect(comA1).toBeDefined();
    expect((await emitirRascunho(m)).status).toBe('rascunho');
  });

  it('RF-FAT-01: a NotaParaEmissao entregue ao emissor traz detPag (indPag), frete, origem do produto e CRT do emitente; o boleto fica no conteúdo gravado', async () => {
    const m = montar();
    m.pedido.pedido.frete = { modalidade: 'CIF', transportadora: null, valor_centavos: 300 };
    const nota = await emitir(m);
    const n = m.recebidas.at(-1)!;
    expect(n).toMatchObject({ ide: { tpAmb: 1, serie: 1, nNF: 100 }, transp: { modFrete: 0 }, emit: { CRT: 3 } });
    expect(n.pag.detPag).toEqual([{ indPag: 1, tPag: '15', vPag: 4800 }]);
    expect(m.conteudos.get(nota.id)?.cobranca?.parcelas.map((p) => p.vencimento)).toEqual(['2026-12-21', '2027-01-20']);
    expect(n.itens.map((i) => i.imposto.ICMS)).toMatchObject([{ orig: 0 }, { orig: 0 }]);
    // refazer a partir do conteúdo gravado entrega o mesmo documento ao emissor (determinismo, RN-FAT-02)
    const x = xmlDaNota(m.deps.emissor, nota, m.conteudos.get(nota.id)!);
    expect(x).toBe(xmlDaNota(m.deps.emissor, nota, m.conteudos.get(nota.id)!));
    expect(x).toContain(`Id="NFe${nota.chave_acesso}"`);
    expect(x).toContain(`<cNF>${nota.cnf}</cNF>`);
  });

  it('NT 2024.001: emitente MEI (CRT 4) com CSOSN 101 ou 201 é violação ANTES da reserva; com 102 a nota segue e o CRT 4 vai ao emissor', async () => {
    const m = montar();
    const filial = (await m.deps.cadastros.filial(tx, IDS.filial))!;
    m.deps.cadastros.filial = async () => ({ ...filial, crt: 4 });
    const calcular = m.deps.calculo.calcular;
    const com = (csosn: string) => async (t: typeof tx, e: Parameters<typeof calcular>[1]) => {
      const r = await calcular(t, e);
      return r.ok ? { ...r, saida: { ...r.saida, itens: r.saida.itens.map((i) => ({ ...i, icms: { orig: '0' as const, csosn, ...(csosn === '101' ? { p_cred_sn: 100_000, v_cred_icms_sn: 1 } : {}) } })) } } : r;
    };
    for (const c of ['101', '201']) {
      m.deps.calculo.calcular = com(c);
      const r = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada(`idem-${c}-0001`));
      expect(!r.ok && r.violacoes[0]?.mensagem).toContain('MEI');
    }
    m.deps.calculo.calcular = com('102');
    const ok = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada('idem-102-0001'));
    expect(ok.ok).toBe(true);
    expect(m.recebidas.at(-1)?.emit.CRT).toBe(4);
  });

  it('RF-FAT-01: filial emissora sem IE (o cadastros devolve "") é violação explícita ANTES da reserva do número', async () => {
    const m = montar();
    const filial = m.deps.cadastros.filial;
    m.deps.cadastros.filial = async (t, id) => {
      const f = await filial(t, id);
      return f ? { ...f, ie: '' } : f;
    };
    const r = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01', campo: 'filial_id', mensagem: 'Cadastre a inscrição estadual da filial emissora.' });
    expect(m.estado.reservas).toBe(0);
    expect(m.notas.size).toBe(0);
  });

  it('RN-CORE-06: filial sem A1 ativo (metadados, sem decifrar) é violação ANTES da reserva do número (nenhum número queimado)', async () => {
    const m = montar({ semA1: true });
    const r = await m.svc.emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-CORE-06', campo: 'filial_id' });
    expect(m.estado.reservas).toBe(0);
    expect(m.notas.size).toBe(0);
  });

  it('RN-FAT-07: o reenvio da rejeitada só refaz e regrava o conteúdo (revisão +1), MANTÉM o status rejeitada e o número; não assina nem guarda nfe_assinada (o worker o faz)', async () => {
    const m = montar();
    const nota = await emitir(m);
    await m.svc.processarRetorno(tx, nota, retorno('778', 'Rejeicao: NCM inexistente'), opcoes);
    m.log.length = 0;
    const re = await m.svc.reenviarNota(tx, m.notas.get(nota.id)!);
    expect(re.ok && re.nota).toMatchObject({ status: 'rejeitada', numero: 100, revisao: 2 });
    expect(m.log).toEqual(['conteudo']);
    expect(m.assinados).toEqual([]);
    expect(m.estado.reservas).toBe(1);
  });

  it('RN-CORE-06: o reenvio sem A1 ativo é violação e não regrava o conteúdo', async () => {
    const m = montar();
    const nota = await emitir(m);
    await m.svc.processarRetorno(tx, nota, retorno('778', 'x'), opcoes);
    m.log.length = 0;
    m.deps.certificado.temA1Ativo = async () => ({ valido: false, motivo: 'vencido', mensagem: 'A1 vencido' });
    const re = await criarServicoEmissao(m.deps).reenviarNota(tx, m.notas.get(nota.id)!);
    expect(!re.ok && re.violacoes[0]?.rn).toBe('RN-CORE-06');
    expect(m.log).toEqual([]);
  });

  it('RN-CORE-05: a repetição com a mesma idempotência não reserva outro número nem grava outra nota', async () => {
    const m = montar();
    const a = await emitir(m);
    const r = await m.svc.emitirNota(tx, TENANT, entrada());
    expect(r.ok && r.repetida && r.nota.id).toBe(a.id);
    expect(m.estado.reservas).toBe(1);
    expect(m.notas.size).toBe(1);
  });

  it('RN-FAT-04: em homologação vai_ao_fdv é falso; em produção é verdadeiro', async () => {
    const rh = await montar({ ambiente: 'homologacao' }).svc.emitirNota(tx, TENANT, entrada());
    if (!rh.ok) throw new Error('esperava ok');
    expect(rh.nota).toMatchObject({ ambiente: 'homologacao', vai_ao_fdv: false });
    expect((await emitirRascunho(montar())).vai_ao_fdv).toBe(true);
  });

  it('RN-FAT-01: violação ANTES da reserva não queima número (pedido não faturável, xMun, CFOP, cálculo fiscal, vNF)', async () => {
    const cenarios: [string, (m: ReturnType<typeof montar>) => void][] = [
      ['pedido cancelado', (m) => { m.deps.situacao.situacao = async () => ({ status: 'cancelado' as never, itens: [] }); }],
      ['município sem nome', (m) => { m.pedido.pedido.cliente_retrato = { ...m.pedido.pedido.cliente_retrato, endereco: { ...m.pedido.pedido.cliente_retrato.endereco, municipio_nome: null } }; }],
      ['cálculo com erro', (m) => { m.deps.calculo.calcular = async () => ({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA', mensagem: 'Sem regra.', item_id: '1' }] }); }],
      ['CFOP ausente', (m) => { const c = m.deps.calculo.calcular; m.deps.calculo.calcular = async (t, e) => { const r = await c(t, e); return r.ok ? { ...r, cfops: {} } : r; }; }],
      ['vNF diverge do fiscal', (m) => { const c = m.deps.calculo.calcular; m.deps.calculo.calcular = async (t, e) => { const r = await c(t, e); return r.ok ? { ...r, saida: { ...r.saida, totais: { ...r.saida.totais, v_nf: r.saida.totais.v_nf + 1 } } } : r; }; }],
    ];
    for (const [nome, preparar] of cenarios) {
      const m = montar();
      preparar(m);
      const r = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada(`idem-${nome.length}-0001`));
      expect(r.ok, nome).toBe(false);
      expect(m.estado.reservas, nome).toBe(0);
      expect(m.notas.size, nome).toBe(0);
    }
  });

  it('RN-PED-02: pedido que não pode ser faturado devolve violação e NÃO reserva número', async () => {
    const m = montar({ status: 'cancelado' });
    const r = await m.svc.emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]?.rn).toBe('RN-PED-02');
  });

  it('RN-FAT-01: município do destinatário sem nome (xMun) é violação ANTES da reserva do número', async () => {
    const m = montar();
    m.pedido.pedido.cliente_retrato = { ...m.pedido.pedido.cliente_retrato, endereco: { ...m.pedido.pedido.cliente_retrato.endereco, municipio_nome: null } };
    const r = await m.svc.emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]?.campo).toBe('destinatario.endereco.municipio_nome');
  });

  it('RN-FAT-01: XML que a SEFAZ rejeitaria (CFOP ausente, recusado pelo emissor) falha antes da reserva do número', async () => {
    const m = montar();
    const calcular = m.deps.calculo.calcular;
    m.deps.calculo.calcular = async (t, e) => {
      const r = await calcular(t, e);
      return r.ok ? { ...r, cfops: {} } : r;
    };
    const r = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]?.campo).toBe('itens.1.cfop');
  });

  it('RF-FAT-01: o cálculo recebe a origem do ProdutoRetrato por item', async () => {
    const m = montar();
    m.pedido.pedido.itens[0]!.produto_retrato = { ...m.pedido.pedido.itens[0]!.produto_retrato, origem: '2' };
    let origens: string[] = [];
    const calcular = m.deps.calculo.calcular;
    m.deps.calculo.calcular = async (t, e) => {
      origens = e.itens.map((i) => i.origem);
      return calcular(t, e);
    };
    await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada());
    expect(origens).toEqual(['2', '0']);
  });

  it('RN-FIS-01: erro do cálculo fiscal vira violação com a RN do fiscal, sem reservar número', async () => {
    const m = montar();
    m.deps.calculo.calcular = async () => ({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA', mensagem: 'Sem regra para o NCM.', item_id: '2' }] });
    const r = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-FIS-01', campo: 'itens.2.calculo' });
  });

  it('RN-FAT-03: autorizada grava cStat e protocolo no mesmo UPDATE, guarda o nfeProc (o gatilho leva a autorizada) e só então publica o evento', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.log.length = 0;
    const r = await m.svc.processarRetorno(tx, nota, autorizada, opcoes);
    expect(r.resultado).toBe('autorizada');
    expect(m.log).toEqual(['status:autorizada_guarda_pendente', 'xml:autorizado', `evento:${EVENTO_NOTA_AUTORIZADA}`]);
    expect(m.dadosStatus.at(-1)).toMatchObject({ para: 'autorizada_guarda_pendente', dados: { protocolo: NPROT, cStat: '100', autorizadaEm: '2026-11-21T14:31:02.000Z' } });
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'autorizada', protocolo: NPROT });
    expect(m.xmls[0]?.conteudo).toBe(`<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${opcoes.xmlAssinado}<protNFe versao="4.00"/></nfeProc>`);
    expect(m.eventos[0]?.payload).toMatchObject({ ambiente: 'producao', pedido_id: IDS.pedido, nota: { numero: 100, protocolo: NPROT } });
    // Estoque: por item, produto_id e filial_id (quantidade já é inteiro em escala 4); ambiente, nota.numero e nota.serie já estão na raiz.
    const p = m.eventos[0]?.payload as { filial_id?: string; itens: { produto_id?: string; filial_id?: string; quantidade: number; quantidade_escala4?: number }[] };
    expect(p.filial_id).toBeUndefined();
    expect(p.itens.length).toBeGreaterThan(0);
    for (const i of p.itens) {
      expect(i).toMatchObject({ produto_id: expect.any(String), filial_id: nota.filial_id, quantidade: expect.any(Number) });
      expect(i.quantidade_escala4).toBeUndefined();
    }
  });

  it('RN-FAT-03: falha na guarda deixa a nota em autorizada_guarda_pendente e nenhum evento sai; o reprocesso fecha o ciclo', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.estado.falharGuarda = true;
    const r = await m.svc.processarRetorno(tx, nota, autorizada, opcoes);
    expect(r).toMatchObject({ resultado: 'guarda_pendente', motivo: 'falha_na_guarda' });
    expect(m.notas.get(nota.id)?.status).toBe('autorizada_guarda_pendente');
    expect(m.eventos).toEqual([]);
    m.estado.falharGuarda = false;
    expect((await m.svc.processarRetorno(tx, m.notas.get(nota.id)!, autorizada, opcoes)).resultado).toBe('autorizada');
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
  });

  it('RN-FAT-03: sem o protNFe ou sem o XML refeito, a guarda fica pendente e não há evento', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, { ...autorizada, xmlProtocolo: null }, opcoes);
    expect(r).toMatchObject({ resultado: 'guarda_pendente', motivo: 'sem_xml' });
    expect(m.eventos).toEqual([]);
  });

  it('RN-FAT-03: digest da assinatura diferente do digVal do protocolo não guarda o XML refeito', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, autorizada, { ...opcoes, digestValue: 'b3V0cm8=' });
    expect(r).toMatchObject({ resultado: 'guarda_pendente', motivo: 'digest_diferente' });
    expect(m.xmls).toEqual([]);
    expect(m.eventos).toEqual([]);
  });

  it('RN-FAT-03: sem o digestValue da assinatura ou sem o digVal do protocolo, nada é guardado: guarda_pendente com o motivo sem_digest e sem evento', async () => {
    const m = montar();
    const nota = await emitir(m);
    expect(await m.svc.processarRetorno(tx, nota, autorizada, { ...opcoes, digestValue: null })).toMatchObject({ resultado: 'guarda_pendente', motivo: 'sem_digest' });
    expect(await m.svc.processarRetorno(tx, m.notas.get(nota.id)!, { ...autorizada, digVal: null }, opcoes)).toMatchObject({ resultado: 'guarda_pendente', motivo: 'sem_digest' });
    expect(m.xmls).toEqual([]);
    expect(m.eventos).toEqual([]);
  });

  it('RN-PED-02, RN-FAT-07: reenvio da rejeitada com o pedido cancelado é recusado, sem mudar número nem conteúdo', async () => {
    const m = montar();
    const nota = await emitir(m);
    await m.svc.processarRetorno(tx, nota, retorno('778', 'Rejeicao: NCM inexistente'), opcoes);
    m.deps.situacao.situacao = async () => ({ status: 'cancelado' as never, itens: [] });
    const re = await criarServicoEmissao(m.deps).reenviarNota(tx, m.notas.get(nota.id)!);
    expect(!re.ok && re.violacoes[0]?.rn).toBe('RN-PED-02');
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'rejeitada', numero: 100, revisao: 1 });
  });

  it('RN-FAT-07: rejeitada publica nota.rejeitada@1 e o reenvio mantém série, número e chave, sem reservar outro', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, retorno('778', 'Rejeicao: NCM inexistente'), opcoes);
    expect(r).toMatchObject({ resultado: 'rejeitada', codigo: '778' });
    expect(m.eventos[0]).toMatchObject({ nome: EVENTO_NOTA_REJEITADA, payload: { codigo: '778', nota: { protocolo: null, numero: 100 } } });
    const rejeitada = m.notas.get(nota.id)!;
    const reservas = m.estado.reservas;
    const re = await m.svc.reenviarNota(tx, rejeitada);
    if (!re.ok) throw new Error(JSON.stringify(re.violacoes));
    expect(re.nota).toMatchObject({ numero: 100, serie: 1, chave_acesso: nota.chave_acesso, status: 'rejeitada', recibo: null });
    expect(m.estado.reservas).toBe(reservas);
    expect(m.notas.size).toBe(1);
  });

  it('RN-FAT-07: só a rejeitada pode ser reenviada', async () => {
    const m = montar();
    const r = await m.svc.reenviarNota(tx, await emitir(m)); // em_autorizacao
    expect(!r.ok && r.violacoes[0]?.rn).toBe('RN-FAT-07');
  });

  it('RN-FAT-07: duplicidade (204) pede a consulta do protocolo; a resposta da consulta autoriza e NÃO publica rejeição', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, retorno('204', 'Duplicidade de NF-e'), opcoes);
    expect(r.resultado).toBe('consultar_protocolo');
    expect(m.eventos).toEqual([]);
    expect((await m.svc.processarRetorno(tx, nota, autorizada, { ...opcoes, jaConsultou: true })).resultado).toBe('autorizada');
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
  });

  it('RN-FAT-07: duplicidade que a consulta não resolveu (inclusive 217) não muda o status nem publica evento', async () => {
    const m = montar();
    const nota = await emitir(m);
    for (const c of ['539', '217']) expect((await m.svc.processarRetorno(tx, nota, retorno(c, 'x'), { ...opcoes, jaConsultou: true })).resultado).toBe('duplicidade');
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
    expect(m.eventos).toEqual([]);
  });

  it('RN-FAT-02: denegada não é reenviável e não publica evento; em processamento nada muda', async () => {
    const m = montar();
    const nota = await emitir(m);
    expect((await m.svc.processarRetorno(tx, nota, retorno('105', 'Lote em processamento'))).resultado).toBe('aguardando');
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
    expect((await m.svc.processarRetorno(tx, nota, retorno('301', 'Uso Denegado', { nProt: NPROT }))).resultado).toBe('denegada');
    expect(m.eventos).toEqual([]);
    expect((await m.svc.reenviarNota(tx, m.notas.get(nota.id)!)).ok).toBe(false);
  });

  it('RN-FAT-02: retorno repetido de nota já autorizada é ignorado (idempotente, um só evento)', async () => {
    const m = montar();
    const r1 = await m.svc.processarRetorno(tx, await emitir(m), autorizada, opcoes);
    if (r1.resultado !== 'autorizada') throw new Error('esperava autorizada');
    expect((await m.svc.processarRetorno(tx, r1.nota, autorizada, opcoes)).resultado).toBe('ja_processada');
    expect(m.eventos).toHaveLength(1);
  });

  it('RN-FAT-07: rejeitada → corrige o preço → reenvia → o evento autorizado leva o total novo, igual ao vNF do XML refeito', async () => {
    const m = montar();
    const nota = await emitir(m);
    await m.svc.processarRetorno(tx, nota, retorno('778', 'Rejeicao: IE do emitente'), opcoes);
    const novo = pedidoAprovado([itemPedido(1, 20_000, 1100), itemPedido(2, 10_000, 2500)]);
    novo.pedido.condicao_pagamento_id = uuid(77);
    m.deps.pedidos.obter = async () => ({ pedido: novo, status: 'a_faturar' as const });
    const re = await criarServicoEmissao(m.deps).reenviarNota(tx, m.notas.get(nota.id)!);
    if (!re.ok) throw new Error(JSON.stringify(re.violacoes));
    expect(re.nota).toMatchObject({ total_centavos: 4700, numero: 100 });
    expect(xmlDaNota(m.deps.emissor, re.nota, m.conteudos.get(nota.id)!)).toContain('<vNF>47.00</vNF>');
    await m.repo.mudarStatus(tx, nota.id, 'rejeitada', 'em_autorizacao'); // o worker assina e transmite
    const aut = await m.svc.processarRetorno(tx, m.notas.get(nota.id)!, autorizada, opcoes);
    expect(aut.resultado).toBe('autorizada');
    expect(m.eventos.at(-1)?.payload).toMatchObject({ nota: { total_centavos: 4700 } });
  });

  it('RN-CORE-05: a mesma idempotência com outro pedido ou outros itens é violação de idempotência', async () => {
    const m = montar();
    await emitir(m);
    const outroPedido = await m.svc.emitirNota(tx, TENANT, { ...entrada(), pedido_id: uuid(99) });
    expect(!outroPedido.ok && outroPedido.violacoes[0]).toMatchObject({ rn: 'RN-CORE-05', campo: 'idempotencia' });
    const outrosItens = await m.svc.emitirNota(tx, TENANT, { ...entrada(), itens: [{ sequencia: 1, quantidade: 10_000 }] });
    expect(!outrosItens.ok && outrosItens.violacoes[0]?.rn).toBe('RN-CORE-05');
    expect(m.estado.reservas).toBe(1);
  });

  it('RF-FAT-01: vNF da nota diferente do v_nf do cálculo fiscal é violação antes de reservar número', async () => {
    const m = montar();
    const calcular = m.deps.calculo.calcular;
    m.deps.calculo.calcular = async (t, e) => {
      const r = await calcular(t, e);
      return r.ok ? { ...r, saida: { ...r.saida, totais: { ...r.saida.totais, v_nf: r.saida.totais.v_nf + 1 } } } : r;
    };
    const r = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01', campo: 'total' });
  });

  describe('contingência SVC aberta (RN-FAT-05, RN-FAT-08, ADR 0011)', () => {
    const inicio = new Date('2026-11-21T09:00:00Z');
    const abrir = async (modalidade: 'svc_an' | 'svc_rs' | 'epec', m: ReturnType<typeof montar>) => {
      const c = contingenciaFake();
      await c.repo.abrir(tx, { filial_id: IDS.filial, ambiente: 'producao', modalidade, motivo: 'SEFAZ-AM fora do ar desde as 9h', inicio_em: inicio, ligada_por: uuid(1) });
      return { c, svc: criarServicoEmissao({ ...m.deps, contingencia: c.repo, svcDisponivel: () => true, epecLigada: true }) };
    };

    it('RN-FAT-08: com svc_rs aberta a nota nasce com tpEmis 7 (na chave, na coluna e no ide), dhCont = início UTC com Z e xJust = motivo, na mesma série e sequência', async () => {
      const m = montar();
      const { svc } = await abrir('svc_rs', m);
      const r = await svc.emitirNota(tx, TENANT, entrada());
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      expect(r.nota).toMatchObject({ tp_emis: 7, serie: 1, numero: 100, status: 'rascunho' });
      expect(r.nota.chave_acesso.slice(34, 35)).toBe('7');
      expect(m.recebidas.at(-1)!.ide).toMatchObject({ tpEmis: 7, dhCont: '2026-11-21T09:00:00.000Z', xJust: 'SEFAZ-AM fora do ar desde as 9h' });
      expect(m.conteudos.get(r.nota.id)?.contingencia).toEqual({ tpEmis: 7, dhCont: '2026-11-21T09:00:00.000Z', xJust: 'SEFAZ-AM fora do ar desde as 9h' });
    });

    it('RN-FAT-08: sem contingência aberta (ou só com a de outro ambiente) a nota segue inalterada: tpEmis 1, sem dhCont nem xJust', async () => {
      const m = montar();
      const c = contingenciaFake();
      await c.repo.abrir(tx, { filial_id: IDS.filial, ambiente: 'homologacao', modalidade: 'svc_rs', motivo: 'SEFAZ-AM fora do ar desde as 9h', inicio_em: inicio, ligada_por: uuid(1) });
      const r = await criarServicoEmissao({ ...m.deps, contingencia: c.repo }).emitirNota(tx, TENANT, entrada());
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      expect(r.nota.tp_emis).toBe(1);
      expect(r.nota.chave_acesso.slice(34, 35)).toBe('1');
      expect(m.recebidas.at(-1)!.ide).not.toHaveProperty('dhCont');
      expect(m.conteudos.get(r.nota.id)?.contingencia).toBeUndefined();
    });

    it('RN-FAT-05: SVC que não é a da UF da filial (AM é SVC-RS) é violação ANTES de reservar o número: a série não anda', async () => {
      const m = montar();
      const { svc } = await abrir('svc_an', m);
      const r = await svc.emitirNota(tx, TENANT, entrada());
      expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-FAT-05', campo: 'contingencia' });
      expect(m.estado.reservas).toBe(0);
    });

    it('RN-FAT-05/08: com a EPEC aberta a nota nasce com tpEmis 4 (chave, coluna, ide), dhCont e xJust, na mesma série e sequência; o envio do evento 110140 é do worker', async () => {
      const m = montar();
      const { svc } = await abrir('epec', m);
      const r = await svc.emitirNota(tx, TENANT, entrada());
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      expect(r.nota).toMatchObject({ tp_emis: 4, serie: 1, numero: 100, status: 'rascunho' });
      expect(r.nota.chave_acesso.slice(34, 35)).toBe('4');
      expect(m.conteudos.get(r.nota.id)?.contingencia).toEqual({ tpEmis: 4, dhCont: '2026-11-21T09:00:00.000Z', xJust: 'SEFAZ-AM fora do ar desde as 9h' });
    });

    it('RN-FAT-10: SVC aberta sem transporte capaz (svcDisponivel ausente ou false) recusa ANTES de reservar o número: a série não anda; a porta recebe filial, ambiente, UF e modo', async () => {
      const m = montar();
      const c = contingenciaFake();
      await c.repo.abrir(tx, { filial_id: IDS.filial, ambiente: 'producao', modalidade: 'svc_rs', motivo: 'SEFAZ-AM fora do ar desde as 9h', inicio_em: inicio, ligada_por: uuid(1) });
      const chamadas: unknown[] = [];
      for (const svcDisponivel of [undefined, () => false, (e: unknown) => { chamadas.push(e); return false; }]) {
        const r = await criarServicoEmissao({ ...m.deps, contingencia: c.repo, ...(svcDisponivel ? { svcDisponivel } : {}) }).emitirNota(tx, TENANT, entrada());
        expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-FAT-10', campo: 'contingencia', mensagem: 'A contingência SVC não está disponível neste ambiente.' });
      }
      expect(chamadas[0]).toEqual({ filialId: IDS.filial, ambiente: 'producao', uf: 'AM', modo: 'svc-rs' });
      expect(m.estado.reservas).toBe(0);
    });

    it('RN-FAT-05: contingência epec aberta com a EPEC desligada (padrão) recusa ANTES de reservar o número', async () => {
      const m = montar();
      const c = contingenciaFake();
      await c.repo.abrir(tx, { filial_id: IDS.filial, ambiente: 'producao', modalidade: 'epec', motivo: 'SEFAZ-AM fora do ar desde as 9h', inicio_em: inicio, ligada_por: uuid(1) });
      const r = await criarServicoEmissao({ ...m.deps, contingencia: c.repo, svcDisponivel: () => true }).emitirNota(tx, TENANT, entrada());
      expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-FAT-05', campo: 'contingencia' });
      expect(m.estado.reservas).toBe(0);
    });

    it('RN-FAT-07/08: o reenvio da rejeitada em SVC mantém o tpEmis, o dhCont e o xJust da nota (a chave leva o tpEmis), mesmo com a contingência já encerrada', async () => {
      const m = montar();
      const { c, svc } = await abrir('svc_rs', m);
      const r = await svc.emitirNota(tx, TENANT, entrada());
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      await m.repo.mudarStatus(tx, r.nota.id, 'rascunho', 'em_autorizacao');
      await m.svc.processarRetorno(tx, m.notas.get(r.nota.id)!, retorno('778', 'x'), opcoes);
      await c.repo.encerrar(tx, IDS.filial, 'producao', new Date('2026-11-21T10:00:00Z'), uuid(1));
      const re = await svc.reenviarNota(tx, m.notas.get(r.nota.id)!);
      expect(re.ok && re.nota).toMatchObject({ status: 'rejeitada', numero: 100, revisao: 2 });
      expect(m.recebidas.at(-1)!.ide).toMatchObject({ tpEmis: 7, dhCont: '2026-11-21T09:00:00.000Z' });
      expect(m.conteudos.get(r.nota.id)?.contingencia?.tpEmis).toBe(7);
    });
  });
});
