import type { Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { calc, IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { type PedidoFaturavel, type SituacaoPedido } from '../domain';
import type { Ambiente, StatusNota } from '../contracts';
import { criarServicoEmissao, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_REJEITADA, type DepsEmissao } from './emissao';
import type { NotaRegistro, NovaNota, RespostaSefaz, SefazTransporte } from './portas';

const tx = {} as Transacao;
const TENANT = IDS.tenant;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Repositório em memória: `log` guarda a ordem das escritas (a mesma tx). */
function repoFake() {
  const notas = new Map<string, NotaRegistro>();
  const xmls: { id: string; tipo: string; conteudo: string }[] = [];
  const eventos: { nome: string; payload: Record<string, unknown> }[] = [];
  const log: string[] = [];
  const estado = { proximo: 0, reservas: 0, falharGuarda: false };
  const repo: DepsEmissao['notas'] = {
    async buscarPorIdempotencia(_t, _tenant, idem) {
      return [...notas.values()].find((n) => n.idempotencia === idem) ?? null;
    },
    async lerXml(_t, id) {
      return xmls.filter((x) => x.id === id && x.tipo === 'assinado').at(-1)?.conteudo ?? null;
    },
    async atualizarConteudo(_t, id, d) {
      const n = notas.get(id) as NotaRegistro;
      if (n.status !== 'rejeitada' && n.status !== 'rascunho') throw new Error(`status ${n.status} não aceita novo conteúdo`);
      notas.set(id, { ...n, total_centavos: d.total_centavos, itens: d.itens });
      xmls.push({ id, tipo: 'assinado', conteudo: d.xml });
      log.push('conteudo');
    },
    async reservarNumero(_t, _tenant, _filial, _serie, inicial) {
      estado.reservas++;
      estado.proximo = estado.proximo === 0 ? inicial : estado.proximo + 1;
      log.push(`numero:${estado.proximo}`);
      return estado.proximo;
    },
    async gravarNota(_t, n: NovaNota) {
      const nota: NotaRegistro = { ...n, id: uuid(notas.size + 1), status: 'rascunho', protocolo: null };
      notas.set(nota.id, nota);
      log.push('gravar');
      return nota;
    },
    async mudarStatus(_t, id, de, para, dados) {
      const n = notas.get(id) as NotaRegistro;
      if (n.status !== de) throw new Error(`status atual ${n.status}, esperado ${de}`);
      notas.set(id, { ...n, status: para, protocolo: dados?.protocolo ?? n.protocolo });
      log.push(`status:${para}`);
    },
    async guardarXml(_t, id, xml) {
      if (xml.tipo === 'autorizado' && estado.falharGuarda) throw new Error('falha de armazenamento');
      xmls.push({ id, tipo: xml.tipo, conteudo: xml.conteudo });
      log.push(`xml:${xml.tipo}`);
    },
    async publicarEvento(_t, e) {
      eventos.push({ nome: e.nome, payload: e.payload });
      log.push(`evento:${e.nome}`);
    },
  };
  return { repo, notas, xmls, eventos, log, estado };
}

function montar(opc: { ambiente?: Ambiente; status?: string; sefaz?: Partial<SefazTransporte> } = {}) {
  const r = repoFake();
  const pedido: PedidoFaturavel = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)]);
  const situacao: SituacaoPedido = {
    status: opc.status ?? 'aprovado',
    itens: [
      { sequencia: 1, quantidade: 20_000, quantidade_faturada: 0 },
      { sequencia: 2, quantidade: 10_000, quantidade_faturada: 0 },
    ],
  };
  const chamadasSefaz: string[] = [];
  const sefaz: SefazTransporte = {
    autorizar: async () => ({ cStat: '103', xMotivo: 'Lote recebido', nRec: '131000000000001' }),
    consultarRecibo: async () => ({ cStat: '100', xMotivo: 'Autorizado o uso da NF-e', nProt: '113260000000001', xml: '<nfeProc>autorizado</nfeProc>' }),
    consultarProtocolo: async () => {
      chamadasSefaz.push('consultarProtocolo');
      return { cStat: '100', xMotivo: 'Autorizado o uso da NF-e', nProt: '113260000000001', xml: '<nfeProc>autorizado</nfeProc>' };
    },
    statusServico: async () => ({ cStat: '107', xMotivo: 'Em operação' }),
    cancelar: async () => ({ cStat: '135', xMotivo: 'ok' }),
    cartaCorrecao: async () => ({ cStat: '135', xMotivo: 'ok' }),
    inutilizar: async () => ({ cStat: '102', xMotivo: 'ok' }),
    ...opc.sefaz,
  };
  const deps: DepsEmissao = {
    pedidos: { obter: async () => pedido },
    situacao: { situacao: async () => situacao },
    cadastros: {
      filial: async () => ({
        id: IDS.filial,
        cnpj: '11.222.333/0001-81',
        razao_social: 'EMITENTE LTDA',
        nome_fantasia: null,
        ie: '012345679',
        crt: 3,
        endereco: { logradouro: 'Rua E', numero: '1', bairro: 'Centro', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69000-000' },
        emissora: true,
        nfe_serie: 1,
      }),
      cliente: async () => null,
      municipioNome: async () => 'Manaus',
      numeroInicial: async () => 100,
    },
    calculo: {
      calcular: async (_t, e) => ({
        ok: true,
        cfops: Object.fromEntries(e.itens.map((i) => [i.sequencia, '5102'])),
        saida: {
          operacao: 'interna',
          itens: e.itens.map((i) => calc(i.sequencia, { icms: { orig: '0', cst: '00', mod_bc: 3, v_bc: i.valor_centavos, p_icms: 200_000, v_icms: Math.round(i.valor_centavos * 0.2) } }).resultado),
          totais: { v_bc: 0, v_icms: 0, v_bc_st: 0, v_st: 0, v_fcp: 0, v_fcp_st: 0, v_prod: 0, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_nf: e.itens.reduce((a, i) => a + i.valor_centavos - i.desconto_centavos + i.frete_centavos + i.outras_centavos, 0), v_cred_icms_sn: 0 },
        },
      }),
    },
    ambiente: { ambiente: async () => opc.ambiente ?? 'producao' },
    notas: r.repo,
    assinador: { assinar: async (_c, xml) => `<assinado>${xml}</assinado>` },
    sefaz: () => sefaz,
    agora: () => new Date('2026-11-21T14:30:00Z'),
    sorteio: () => 12_345_678,
  };
  return { ...r, svc: criarServicoEmissao(deps), chamadasSefaz, deps };
}

const entrada = (idempotencia = 'idem-0000001') => ({ pedido_id: IDS.pedido, idempotencia });
const resp = (cStat: string, xMotivo = 'x', extra: Partial<RespostaSefaz> = {}): RespostaSefaz => ({ cStat, xMotivo, ...extra });
const autorizada = resp('100', 'Autorizado o uso da NF-e', { nProt: '113260000000001', xml: '<nfeProc>autorizado</nfeProc>' });

async function emitir(m: ReturnType<typeof montar>, idem?: string): Promise<NotaRegistro> {
  const r = await m.svc.emitirNota(tx, TENANT, entrada(idem));
  if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
  return r.nota;
}

describe('emissão da NF-e (serviço de aplicação, portas em memória)', () => {
  it('RN-FAT-01: reserva o número na mesma tx, gera chave e XML assinado e vai a em_autorizacao', async () => {
    const m = montar();
    const nota = await emitir(m);
    expect(nota).toMatchObject({ numero: 100, serie: 1, status: 'em_autorizacao', ambiente: 'producao', total_centavos: 4500 });
    expect(nota.chave_acesso).toMatch(/^13261111222333000181550010000001001\d{9}$/);
    expect(m.log).toEqual(['numero:100', 'gravar', 'xml:assinado', 'status:em_autorizacao']);
    expect(m.xmls[0]?.conteudo).toContain(`Id="NFe${nota.chave_acesso}"`);
    expect((await emitir(m, 'idem-0000002')).numero).toBe(101); // sem buraco
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
    const h = montar({ ambiente: 'homologacao' });
    const rh = await h.svc.emitirNota(tx, TENANT, entrada());
    if (!rh.ok) throw new Error('esperava ok');
    expect(rh.nota).toMatchObject({ ambiente: 'homologacao', vai_ao_fdv: false });
    const p = await emitir(montar({ ambiente: 'producao' }));
    expect(p.vai_ao_fdv).toBe(true);
  });

  it('RN-PED-02: pedido que não pode ser faturado devolve violação e NÃO reserva número', async () => {
    const m = montar({ status: 'cancelado' });
    const r = await m.svc.emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]?.rn).toBe('RN-PED-02');
    expect(m.estado.reservas).toBe(0);
  });

  it('RN-FAT-01: XML que a SEFAZ rejeitaria (CFOP ausente) falha antes da reserva do número', async () => {
    const m = montar();
    const calcular = m.deps.calculo.calcular;
    m.deps.calculo.calcular = async (t, e) => {
      const r = await calcular(t, e);
      return r.ok ? { ...r, cfops: {} } : r;
    };
    const svc = criarServicoEmissao(m.deps);
    const r = await svc.emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]?.campo).toBe('itens.1.cfop');
    expect(m.estado.reservas).toBe(0);
  });

  it('RN-FIS-01: erro do cálculo fiscal vira violação com a RN do fiscal, sem reservar número', async () => {
    const m = montar();
    m.deps.calculo.calcular = async () => ({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA', mensagem: 'Sem regra para o NCM.', item_id: '2' }] });
    const r = await criarServicoEmissao(m.deps).emitirNota(tx, TENANT, entrada());
    expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-FIS-01', campo: 'itens.2.calculo' });
    expect(m.estado.reservas).toBe(0);
  });

  it('RN-FAT-03: autorizada guarda o XML autorizado ANTES de passar a autorizada e publicar o evento', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.log.length = 0;
    const r = await m.svc.processarRetorno(tx, nota, autorizada);
    expect(r.resultado).toBe('autorizada');
    expect(m.log).toEqual(['status:autorizada_guarda_pendente', 'xml:autorizado', 'status:autorizada', `evento:${EVENTO_NOTA_AUTORIZADA}`]);
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'autorizada', protocolo: '113260000000001' });
    expect(m.xmls.at(-1)).toMatchObject({ tipo: 'autorizado', conteudo: '<nfeProc>autorizado</nfeProc>' });
    expect(m.eventos[0]?.payload).toMatchObject({ ambiente: 'producao', pedido_id: IDS.pedido, nota: { numero: 100, protocolo: '113260000000001' } });
  });

  it('RN-FAT-03: falha na guarda deixa a nota em autorizada_guarda_pendente e nenhum evento sai', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.estado.falharGuarda = true;
    const r = await m.svc.processarRetorno(tx, nota, autorizada);
    expect(r.resultado).toBe('guarda_pendente');
    expect(m.notas.get(nota.id)?.status).toBe('autorizada_guarda_pendente');
    expect(m.eventos).toEqual([]);
    // reprocessamento (consultarProtocolo) com a guarda restabelecida fecha o ciclo
    m.estado.falharGuarda = false;
    const de = m.notas.get(nota.id) as NotaRegistro;
    expect((await m.svc.processarRetorno(tx, de, autorizada)).resultado).toBe('autorizada');
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
  });

  it('RN-FAT-03: autorizada sem o XML do nfeProc na resposta também não publica evento', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, resp('100', 'Autorizado', { nProt: '113260000000001' }));
    expect(r.resultado).toBe('guarda_pendente');
    expect(m.eventos).toEqual([]);
  });

  it('RN-FAT-07: rejeitada publica nota.rejeitada@1 e o reenvio mantém série, número e chave, sem reservar outro', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, resp('778', 'Rejeicao: NCM inexistente'));
    expect(r).toMatchObject({ resultado: 'rejeitada', codigo: '778' });
    expect(m.eventos[0]).toMatchObject({ nome: EVENTO_NOTA_REJEITADA, payload: { codigo: '778', nota: { protocolo: null, numero: 100 } } });
    const rejeitada = m.notas.get(nota.id) as NotaRegistro;
    expect(rejeitada.status).toBe('rejeitada');
    const reservasAntes = m.estado.reservas;
    const re = await m.svc.reenviarNota(tx, rejeitada);
    if (!re.ok) throw new Error(JSON.stringify(re.violacoes));
    expect(re.nota).toMatchObject({ numero: 100, serie: 1, chave_acesso: nota.chave_acesso, status: 'em_autorizacao' });
    expect(m.estado.reservas).toBe(reservasAntes);
    expect(m.notas.size).toBe(1);
  });

  it('RN-FAT-07: só a rejeitada pode ser reenviada', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.reenviarNota(tx, nota);
    expect(!r.ok && r.violacoes[0]?.rn).toBe('RN-FAT-07');
  });

  it('RN-FAT-07: duplicidade (204) devolve consultar_protocolo sem consultar dentro da tx; a resposta da consulta autoriza e NÃO publica rejeição', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, resp('204', 'Duplicidade de NF-e'));
    expect(r.resultado).toBe('consultar_protocolo');
    expect(m.chamadasSefaz).toEqual([]);
    expect(m.eventos).toEqual([]);
    const consulta = await m.deps.sefaz({ tenant_id: TENANT, filial_id: IDS.filial, ambiente: 'producao' }).consultarProtocolo({ chNFe: nota.chave_acesso });
    const fim = await m.svc.processarRetorno(tx, nota, consulta, true);
    expect(fim.resultado).toBe('autorizada');
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
  });

  it('RN-FAT-07: duplicidade que a consulta não resolveu não muda o status nem publica evento', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.svc.processarRetorno(tx, nota, resp('539', 'Duplicidade com diferença na chave'), true);
    expect(r.resultado).toBe('duplicidade');
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
    expect(m.eventos).toEqual([]);
  });

  it('RN-FAT-02: denegada não é reenviável e não publica evento; em processamento nada muda', async () => {
    const m = montar();
    const nota = await emitir(m);
    expect((await m.svc.processarRetorno(tx, nota, resp('105', 'Lote em processamento'))).resultado).toBe('aguardando');
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
    expect((await m.svc.processarRetorno(tx, nota, resp('301', 'Uso Denegado'))).resultado).toBe('denegada');
    expect(m.notas.get(nota.id)?.status).toBe('denegada');
    expect(m.eventos).toEqual([]);
    const d = m.notas.get(nota.id) as NotaRegistro;
    expect((await m.svc.reenviarNota(tx, d)).ok).toBe(false);
  });

  it('RN-FAT-02: retorno repetido de nota já autorizada é ignorado (idempotente, um só evento)', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r1 = await m.svc.processarRetorno(tx, nota, autorizada);
    if (r1.resultado !== 'autorizada') throw new Error('esperava autorizada');
    expect((await m.svc.processarRetorno(tx, r1.nota, autorizada)).resultado).toBe('ja_processada');
    expect(m.eventos).toHaveLength(1);
  });

  it('RF-FAT-08: transmitir envia o XML assinado e devolve o resultado do recibo', async () => {
    const m = montar();
    const r = await emitir(m);
    const resposta = await m.svc.transmitir(r, '<assinado/>');
    expect(resposta.cStat).toBe('100');
    const status: StatusNota = m.notas.get(r.id)?.status ?? 'rascunho';
    expect(status).toBe('em_autorizacao'); // transmitir não muda status; quem muda é processarRetorno
  });

  it('RN-FAT-07: rejeitada → corrige a IE e o preço → reenvia → o evento autorizado leva o total novo, igual ao vNF do XML', async () => {
    const m = montar();
    const nota = await emitir(m);
    await m.svc.processarRetorno(tx, nota, resp('778', 'Rejeicao: IE do emitente'));
    const rejeitada = m.notas.get(nota.id) as NotaRegistro;
    expect(rejeitada.total_centavos).toBe(4500);
    const novoPedido = pedidoAprovado([itemPedido(1, 20_000, 1100), itemPedido(2, 10_000, 2500)]);
    m.deps.pedidos.obter = async () => novoPedido;
    const filial = await m.deps.cadastros.filial(tx, IDS.filial);
    m.deps.cadastros.filial = async () => (filial ? { ...filial, ie: '012345680' } : null);
    const re = await criarServicoEmissao(m.deps).reenviarNota(tx, rejeitada);
    if (!re.ok) throw new Error(JSON.stringify(re.violacoes));
    expect(re.nota).toMatchObject({ total_centavos: 4700, numero: 100, chave_acesso: nota.chave_acesso });
    expect(m.log.indexOf('conteudo')).toBeGreaterThan(m.log.indexOf('status:rejeitada'));
    expect(m.notas.get(nota.id)?.total_centavos).toBe(4700);
    expect(re.xmlAssinado).toContain('<vNF>47.00</vNF>');
    const aut = await criarServicoEmissao(m.deps).processarRetorno(tx, m.notas.get(nota.id) as NotaRegistro, autorizada);
    expect(aut.resultado).toBe('autorizada');
    expect(m.eventos.at(-1)?.payload).toMatchObject({ nota: { total_centavos: 4700 } });
  });

  it('RN-CORE-05: a repetição devolve o XML assinado já gravado', async () => {
    const m = montar();
    const a = await m.svc.emitirNota(tx, TENANT, entrada());
    const r = await m.svc.emitirNota(tx, TENANT, entrada());
    expect(a.ok && r.ok && r.repetida && r.xmlAssinado === a.xmlAssinado && r.xmlAssinado !== null).toBe(true);
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
    expect(m.estado.reservas).toBe(0);
  });
});
