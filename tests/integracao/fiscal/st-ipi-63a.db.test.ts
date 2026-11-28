/**
 * T-0132 (decisão 63 A, RN-FIS-05): casos de borda do ICMS-ST e do IPI de ponta a ponta entre os módulos, condição do liberar
 * da v0.3.31 (PO). A cadeia é o código do `main`, sem dublê no meio:
 *   fiscal (`criarCalculoFiscal` com o repositório SQL, regras em `fiscal.regra_tributaria` no PostgreSQL real, RLS do tenant)
 *   → faturamento (`impostosDoItemEvento`, o mesmo do `resumoDoItemMontado`, e `baseEventoDaNota`)
 *   → pedido (`NotaAutorizadaLida` + `faturadoDaNota` + `PedidoFaturadoV1`)
 *   → integracao-fdv (`PayloadPedidoLido` + `retornoDoPedido` + `corpoComBandeira` + `RetornoErp`).
 * Só o emitente (porta do cadastros) é fixo no teste. Sem Postgres pula; com `MACUXI_PG_EXIGIR=1` falha (`bash db/scripts/pg-local.sh`).
 *
 * Casos: 0 com regra (o campo sai 0, nunca omitido); sem regra (omitido, nunca 0); item misto (o total é omitido); nota parcial
 * (o total soma só os itens da nota); emitente industrial sem regra de IPI na EMISSÃO dá REGRA_NAO_ENCONTRADA; o pedido não chama o
 * fiscal (não trava); bandeira TENANTS_ENVIA_ST_IPI desligada (payload igual ao de hoje) e ligada por injeção (com os campos).
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BancoPg } from '../../../packages/platform-sdk/src/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { criarCalculoFiscal, type EntradaCalculoDoFiscal } from '../../../modules/fiscal/api/calculo';
import type { EmitenteFiscal } from '../../../modules/fiscal/api/portas';
import type { ItemResultado } from '../../../modules/fiscal/contracts/index';
import { baseEventoDaNota } from '../../../modules/faturamento/api/eventos';
import type { NotaRegistro } from '../../../modules/faturamento/api/portas';
import { impostosDoItemEvento } from '../../../modules/faturamento/domain/index';
import { PedidoFaturadoV1, type StatusPedido } from '../../../modules/pedido/contracts/index';
import { faturadoDaNota } from '../../../modules/pedido/api/eventos';
import { NotaAutorizadaLida } from '../../../modules/pedido/api/leitores';
import type { PedidoGravado } from '../../../modules/pedido/api/portas';
import { RetornoErp } from '../../../modules/integracao-fdv/contracts/index';
import { enviaStIpi } from '../../../modules/integracao-fdv/domain/bandeiras';
import { PayloadPedidoLido, retornoDoPedido } from '../../../modules/integracao-fdv/domain/retorno-pedido';
import { corpoComBandeira } from '../../../modules/integracao-fdv/api/retorno-pedidos';
import { hashDoRetorno } from '../../../modules/integracao-fdv/api/util-pedidos';

const RAIZ = join(__dirname, '../../..');
const DATA = '2026-11-21';
const EMITIDA = '2026-11-21T18:00:00.000Z';
const CHAVE = '13261112345678000199550010000001231876543210';
/** NCMs da massa: cada um casa com uma regra de ICMS só (prefixo), e o IPI tem regra só nos dois primeiros. */
const NCM = { st: '22021000', stZero: '85044000', semSt: '33049900', mvaNula: '39241000' } as const;
const NORMAL: EmitenteFiscal = { uf: 'AM', crt: 3, regime_pis_cofins: 'cumulativo' };
const INDUSTRIAL: EmitenteFiscal = { ...NORMAL, industrial_ipi: true };
/** Valor × regra (Manual da NF-e, o IPI compõe a BC-ST): (1000,00 + 50,00 de IPI) × 1,40 = 1470,00; 18% × 1470,00 − 18% × 1000,00 = 264,60 − 180,00 = 84,60. */
const ST_INDUSTRIAL = 8460;

interface ItemMassa { sequencia: number; ncm: string; valor: number }

describe.skipIf(!PG_DISPONIVEL)('T-0132 (63 A): ICMS-ST e IPI do fiscal ao Hub do FDV, casos de borda (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;
  const FONTE = `'convenio', 'Convênio ICMS 142/2018', '2026.1', '2026-01-01'`;
  /**
   * Regra de ICMS (com PIS/COFINS na linha única, regime cumulativo). Desde a 0082 a coluna `ajustar_mva` não tem default
   * (nulo = "não informado", RN-FIS-05, T-0127): cada regra diz o valor de que o caso precisa.
   */
  const regraIcms = (ncm: string, o: { codigo: string; mva?: number; aliqDestino?: number; ajustarMva: boolean | null }) =>
    admin(
      `INSERT INTO fiscal.regra_tributaria (tenant_id, tributo, ncm_prefixo, codigo, aliquota_icms, mva_original, aliquota_interna_destino, ajustar_mva,
         cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, fonte_tipo, fonte_referencia, versao, vigencia_inicio)
       VALUES ($1, 'icms', $2, $3, 180000, $4, $5, $6, '01', 6500, '01', 30000, ${FONTE})`,
      [A, ncm, o.codigo, o.mva ?? null, o.aliqDestino ?? null, o.ajustarMva],
    );
  /** Regra de IPI: sem ST, `ajustar_mva` não se aplica e vai nulo explícito (sem default desde a 0082). */
  const regraIpi = (ncm: string, cst: string, aliquota: number | null) =>
    admin(
      `INSERT INTO fiscal.regra_tributaria (tenant_id, tributo, ncm_prefixo, cst_ipi, aliquota_ipi, c_enq, ajustar_mva, fonte_tipo, fonte_referencia, versao, vigencia_inicio)
       VALUES ($1, 'ipi', $2, $3, $4, '999', NULL, ${FONTE})`,
      [A, ncm, cst, aliquota],
    );

  /** fiscal.calculo@1 de verdade: lê as regras do tenant no banco (RLS) e calcula (modo padrão = emissão). */
  const calcular = (emitente: EmitenteFiscal, itens: ItemMassa[], ufDestino = 'AM') => {
    const calc = criarCalculoFiscal({ emitentes: { emitente: async () => emitente, producaoPropria: async () => new Set<string>() } });
    const entrada: EntradaCalculoDoFiscal = {
      filial_id: randomUUID(), data_emissao: DATA,
      pedido: { pedido: { cliente_retrato: { tipo_pessoa: 'PJ', ind_ie_dest: '1', endereco: { uf: ufDestino } } } },
      itens: itens.map((i) => ({
        sequencia: i.sequencia, produto_id: `p${i.sequencia}`, ncm: i.ncm, origem: '0', quantidade: 1, preco_unitario_centavos: i.valor,
        valor_centavos: i.valor, desconto_centavos: 0, frete_centavos: 0, outras_centavos: 0,
      })),
    };
    return app.comTenant(A, (tx) => calc.calcular(tx, entrada));
  };

  /**
   * Do cálculo ao corpo do retorno ao Hub. `naNota` = sequências faturadas nesta nota (parcial); o pedido tem todos os itens.
   * Devolve cada etapa para conferir o valor contra a regra em cada fronteira.
   */
  async function cadeia(emitente: EmitenteFiscal, itens: ItemMassa[], naNota: number[] = itens.map((i) => i.sequencia), ligada?: (t: string) => boolean) {
    const r = await calcular(emitente, itens);
    if (!r.ok) throw new Error(`cálculo recusado: ${JSON.stringify(r.erros)}`);
    const porSeq = new Map<number, ItemResultado>(r.saida.itens.map((it) => [Number(it.item_id), it]));
    const produto = new Map(itens.map((i) => [i.sequencia, randomUUID()]));
    const faturados = itens.filter((i) => naNota.includes(i.sequencia));
    const pedidoId = randomUUID();
    // faturamento: a nota guarda o item com `impostosDoItemEvento` (o mesmo do `resumoDoItemMontado` da emissão) e o evento sai por `baseEventoDaNota`.
    const nota = {
      id: randomUUID(), pedido_id: pedidoId, filial_id: randomUUID(), cliente_id: randomUUID(), vendedor_id: null, ambiente: 'producao',
      serie: 1, numero: 123, chave_acesso: CHAVE, emitida_em: EMITIDA, total_centavos: faturados.reduce((s, i) => s + i.valor, 0),
      itens: faturados.map((i) => ({ sequencia: i.sequencia, produto_id: produto.get(i.sequencia)!, quantidade: 10_000, valor_centavos: i.valor, ...impostosDoItemEvento(porSeq.get(i.sequencia)!) })),
    } as unknown as NotaRegistro;
    const eventoNota = baseEventoDaNota(nota, '113260000000001');
    // pedido: lê a nota autorizada pelo leitor real e monta o faturado@1.
    const status: StatusPedido = faturados.length === itens.length ? 'faturado' : 'faturado_parcial';
    const pedido = {
      id: pedidoId, numero: 42, origem: 'fdv', external_id: randomUUID(), status, filial_id: randomUUID(), cliente_id: randomUUID(), vendedor_id: null,
      total_centavos: itens.reduce((s, i) => s + i.valor, 0), itens: itens.map((i) => ({ sequencia: i.sequencia, produto_id: produto.get(i.sequencia)! })),
    } as unknown as PedidoGravado;
    const faturado = PedidoFaturadoV1.parse(faturadoDaNota(NotaAutorizadaLida.parse(eventoNota), pedido, status, 'aprovado'));
    // integracao-fdv: lê o evento, decide o retorno e passa pela bandeira (a mesma chamada do consumidor).
    const chaves = new Map([...produto].map(([seq, id]) => [id, `P-${seq}`]));
    const decisao = retornoDoPedido({ nome: 'pedido.pedido.faturado@1', ocorrido_em: EMITIDA, payload: PayloadPedidoLido.parse(faturado) }, 'integrado', chaves);
    if (decisao.acao !== 'enviar') throw new Error(`retorno não enviado: ${JSON.stringify(decisao)}`);
    // O corpo é o que o consumidor grava (sem reparse, que reordenaria as chaves); o contrato do Hub confere à parte.
    const corpo = corpoComBandeira(A, decisao.corpo, ligada);
    const contrato = RetornoErp.safeParse(corpo);
    if (!contrato.success) throw new Error(`corpo fora do RetornoErp: ${contrato.error.issues[0]?.message ?? ''}`);
    return { calculo: r.saida, eventoNota, faturado, corpoBruto: decisao.corpo, corpo };
  }
  const ligada = () => true;
  const itemHub = (c: RetornoErp, seq: number) => c.itens_faturados!.find((i) => i.sequencia === seq)! as Record<string, unknown>;

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'st-ipi-63a', ['fiscal']);
    await regraIcms(NCM.st, { codigo: '10', mva: 400000, aliqDestino: 180000, ajustarMva: false }); // MVA 40%: ST = 18% × 1,4 × v − 18% × v
    await regraIcms(NCM.stZero, { codigo: '10', mva: 0, aliqDestino: 180000, ajustarMva: false }); // MVA 0 e mesma alíquota: ST calculado = 0
    await regraIcms(NCM.semSt, { codigo: '00', ajustarMva: false });
    await regraIcms(NCM.mvaNula, { codigo: '10', mva: 400000, aliqDestino: 180000, ajustarMva: null }); // ST sem a decisão de ajustar a MVA
    await regraIpi(NCM.st, '50', 50000); // 5%
    await regraIpi(NCM.stZero, '50', 0); // alíquota 0: IPI calculado = 0
    // NCM.semSt sem regra de IPI (caso do emitente industrial)
  }, 180_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  describe('0 com regra: o campo sai 0, nunca omitido', () => {
    it('RN-FIS-05: ST com MVA 0 e IPI com alíquota 0 (industrial) saem 0 no item e no total, do fiscal ao Hub', async () => {
      const c = await cadeia(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.stZero, valor: 100000 }], [1], ligada);
      expect(c.calculo.itens[0]).toMatchObject({ regra_aplicada: { st: true, ipi: true }, calc_st: { v_valor: 0 }, calc_ipi: { v_bc: 100000, p_aliq: 0, v_valor: 0 } });
      expect(c.calculo.totais).toMatchObject({ calc_st: { v_valor: 0 }, calc_ipi: { v_valor: 0 } });
      expect(c.faturado.itens_faturados?.[0]).toMatchObject({ regra_aplicada: { st: true, ipi: true }, calc_st: { v_valor: 0 }, calc_ipi: { v_valor: 0 } });
      expect(itemHub(c.corpo, 1)).toMatchObject({ v_icms_st_cents: 0, v_ipi_cents: 0 });
      expect(c.corpo.nota).toMatchObject({ v_icms_st_cents: 0, v_ipi_cents: 0 });
    });
    it('RN-FIS-05: o 0 com regra é diferente de "sem regra": a chave existe no item e no total do Hub', async () => {
      const c = await cadeia(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.stZero, valor: 100000 }], [1], ligada);
      expect(Object.keys(itemHub(c.corpo, 1))).toEqual(expect.arrayContaining(['v_icms_st_cents', 'v_ipi_cents']));
      expect(Object.keys(c.corpo.nota!)).toEqual(expect.arrayContaining(['v_icms_st_cents', 'v_ipi_cents']));
    });
  });

  describe('sem regra: o campo é omitido, nunca 0', () => {
    it('RN-FIS-05: sem regra de ST (CST 00) e emitente não industrial, regra_aplicada é falsa e o Hub não recebe ST nem IPI', async () => {
      const c = await cadeia(NORMAL, [{ sequencia: 1, ncm: NCM.semSt, valor: 100000 }], [1], ligada);
      expect(c.calculo.itens[0]?.regra_aplicada).toEqual({ st: false, ipi: false });
      expect(c.calculo.itens[0]).not.toHaveProperty('calc_st');
      expect(c.calculo.itens[0]).not.toHaveProperty('calc_ipi');
      // O XML segue o Manual (vST/vIPI em 0 nos totais), mas o retorno ao FDV omite: o indicador manda, nunca o v_st.
      expect(c.calculo.totais).toMatchObject({ v_st: 0, v_ipi: 0 });
      expect(c.calculo.totais).not.toHaveProperty('calc_st');
      expect(c.faturado.itens_faturados?.[0]).not.toHaveProperty('calc_st');
      expect(c.faturado.nota).not.toHaveProperty('calc_st');
      expect(JSON.stringify(c.corpo)).not.toMatch(/v_icms_st_cents|v_ipi_cents/);
    });
  });

  describe('item misto: o total é omitido', () => {
    it('RN-FIS-05: um item com ST e outro sem; o item com regra leva o valor, o outro omite, e o total de ST da nota é omitido', async () => {
      const c = await cadeia(NORMAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }, { sequencia: 2, ncm: NCM.semSt, valor: 50000 }], [1, 2], ligada);
      // Valor × regra: BC-ST = 1000,00 × 1,40 = 1400,00; ST = 18% × 1400,00 − 18% × 1000,00 = 252,00 − 180,00 = 72,00.
      expect(c.calculo.itens.find((i) => i.item_id === '1')).toMatchObject({ regra_aplicada: { st: true }, calc_st: { v_bc: 140000, p_aliq: 180000, v_valor: 7200 } });
      expect(c.calculo.totais).not.toHaveProperty('calc_st');
      expect(c.faturado.nota).not.toHaveProperty('calc_st');
      expect(itemHub(c.corpo, 1).v_icms_st_cents).toBe(7200);
      expect(itemHub(c.corpo, 2)).not.toHaveProperty('v_icms_st_cents');
      expect(c.corpo.nota).not.toHaveProperty('v_icms_st_cents');
      expect(c.corpo.nota?.total_cents).toBe(150000);
    });
  });

  describe('nota parcial: o total soma só os itens da nota', () => {
    it('RN-FIS-05: pedido com 2 itens com ST, nota com o item 2: faturado_parcial, total = ST só do item 2', async () => {
      const c = await cadeia(NORMAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }, { sequencia: 2, ncm: NCM.st, valor: 50000 }], [2], ligada);
      expect(c.corpo.status).toBe('faturado_parcial');
      expect(c.corpo.itens_faturados?.map((i) => i.sequencia)).toEqual([2]);
      // 500,00 × 1,40 = 700,00; 18% × 700,00 − 18% × 500,00 = 126,00 − 90,00 = 36,00. O total do cálculo (dos 2 itens) seria 108,00.
      expect(c.calculo.totais.calc_st).toEqual({ v_bc: 210000, v_valor: 10800 });
      expect(itemHub(c.corpo, 2).v_icms_st_cents).toBe(3600);
      expect(c.faturado.nota).toMatchObject({ calc_st: { v_bc: 70000, v_valor: 3600 } });
      expect(c.corpo.nota?.v_icms_st_cents).toBe(3600);
    });
    it('RN-FIS-05: pedido misto com a nota só do item com regra: na nota todos têm regra, o total existe', async () => {
      const c = await cadeia(NORMAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }, { sequencia: 2, ncm: NCM.semSt, valor: 50000 }], [1], ligada);
      expect(c.calculo.totais).not.toHaveProperty('calc_st'); // no pedido inteiro é misto
      expect(c.corpo.nota?.v_icms_st_cents).toBe(7200);
    });
    it('RN-FIS-05: pedido com ST nos 2 itens e a nota só do item sem regra (misto invertido): o total é omitido', async () => {
      const c = await cadeia(NORMAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }, { sequencia: 2, ncm: NCM.semSt, valor: 50000 }], [2], ligada);
      expect(c.corpo.status).toBe('faturado_parcial');
      expect(JSON.stringify(c.corpo)).not.toMatch(/v_icms_st_cents|v_ipi_cents/);
    });
  });

  describe('emitente industrial sem regra de IPI na EMISSÃO', () => {
    it('RN-FIS-01: o cálculo da emissão (modo padrão do faturamento) recusa com REGRA_NAO_ENCONTRADA no IPI, lido do banco', async () => {
      const r = await calcular(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.semSt, valor: 100000 }]);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.erros).toEqual([expect.objectContaining({ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA', mensagem: expect.stringContaining('IPI') })]);
    });
    it('RN-FIS-01: item misto com um produto sem regra de IPI também recusa a nota inteira (sem omitir em silêncio)', async () => {
      const r = await calcular(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }, { sequencia: 2, ncm: NCM.semSt, valor: 50000 }]);
      expect(r).toMatchObject({ ok: false, erros: [expect.objectContaining({ codigo: 'REGRA_NAO_ENCONTRADA' })] });
    });
    it('RN-FIS-05: o mesmo emitente com regra de IPI calcula (5% de 1000,00 = 50,00) e o Hub recebe o IPI do item e do total', async () => {
      const c = await cadeia(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }], [1], ligada);
      expect(c.calculo.itens[0]).toMatchObject({ regra_aplicada: { st: true, ipi: true }, calc_ipi: { v_bc: 100000, p_aliq: 50000, v_valor: 5000 }, calc_st: { v_bc: 147000, v_valor: ST_INDUSTRIAL } });
      expect(itemHub(c.corpo, 1).v_ipi_cents).toBe(5000);
      expect(c.corpo.nota?.v_ipi_cents).toBe(5000);
    });
  });

  describe('ajustar_mva sem default (0082, T-0127): o ST interestadual exige a decisão', () => {
    it('RN-FIS-05: ST interestadual (AM → PA) com ajustar_mva nulo e sem MVA ajustada recusa com CODIGO_NAO_SUPORTADO, lido do banco', async () => {
      const [linha] = await admin(`SELECT ajustar_mva FROM fiscal.regra_tributaria WHERE tenant_id = $1 AND ncm_prefixo = $2 AND tributo = 'icms'`, [A, NCM.mvaNula]);
      expect(linha).toEqual({ ajustar_mva: null });
      const r = await calcular(NORMAL, [{ sequencia: 1, ncm: NCM.mvaNula, valor: 100000 }], 'PA');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.erros).toEqual([expect.objectContaining({ codigo: 'CODIGO_NAO_SUPORTADO', mensagem: expect.stringContaining('ajustar_mva nulo') })]);
    });
    it('RN-FIS-05: a mesma regra (ajustar_mva nulo) na operação interna (AM → AM) calcula o ST pela MVA original: (1000,00 × 1,40) × 18% − 180,00 = 72,00', async () => {
      const r = await calcular(NORMAL, [{ sequencia: 1, ncm: NCM.mvaNula, valor: 100000 }]);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.saida.itens[0]).toMatchObject({ calc_st: { v_bc: 140000, v_valor: 7200 } });
    });
    it('RN-FIS-05: com ajustar_mva false explícito o ST interestadual (AM → PA) calcula pela MVA original', async () => {
      const r = await calcular(NORMAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }], 'PA');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.saida.itens[0]).toMatchObject({ calc_st: { v_bc: 140000, v_valor: 7200 } });
    });
  });

  describe('o pedido não trava: não chama o fiscal', () => {
    /** Arquivos de produção do módulo pedido (sem testes nem apoio de teste). */
    const fontes = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const c = join(dir, n);
        if (statSync(c).isDirectory()) return n === 'node_modules' ? [] : fontes(c);
        return /\.tsx?$/.test(n) && !/\.test\.tsx?$|apoio-teste|fixtures/.test(n) ? [c] : [];
      });
    const PEDIDO = join(RAIZ, 'modules/pedido');

    it('T-0132: nenhum arquivo de produção do pedido importa o fiscal (nem contracts) nem chama o cálculo', () => {
      const arquivos = fontes(PEDIDO);
      expect(arquivos.length).toBeGreaterThan(10); // contra a varredura vazia
      const achados = arquivos.flatMap((f) => {
        const t = readFileSync(f, 'utf8');
        const a: string[] = [];
        if (/from\s+['"](@macuxierp\/fiscal|[./]+\/fiscal)(\/|['"])/.test(t) || /import\(\s*['"]@macuxierp\/fiscal/.test(t)) a.push(`${relative(RAIZ, f)}: importa o fiscal`);
        if (/criarCalculoFiscal|calcularDocumento|fiscal\.calculo@/.test(t)) a.push(`${relative(RAIZ, f)}: chama o cálculo fiscal`);
        return a;
      });
      expect(achados).toEqual([]);
      const pkg = JSON.parse(readFileSync(join(PEDIDO, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain('@macuxierp/fiscal');
    });
    it('T-0132: o faturado@1 com item de emissor antigo (sem regra_aplicada) e de emitente sem regra sai sem travar e sem os campos', () => {
      const pedidoId = randomUUID();
      const prod = randomUUID();
      const nota = NotaAutorizadaLida.parse({
        pedido_id: pedidoId, ambiente: 'producao', nota: { id: randomUUID(), numero: 1, serie: 1, chave_acesso: CHAVE, emitida_em: EMITIDA, total_centavos: 1000 },
        itens: [{ sequencia: 1, quantidade: 10_000, valor_centavos: 1000 }],
      });
      const pedido = { id: pedidoId, numero: 1, origem: 'fdv', external_id: randomUUID(), status: 'faturado', filial_id: randomUUID(), cliente_id: randomUUID(), vendedor_id: null, total_centavos: 1000, itens: [{ sequencia: 1, produto_id: prod }] } as unknown as PedidoGravado;
      const f = PedidoFaturadoV1.parse(faturadoDaNota(nota, pedido, 'faturado', 'aprovado'));
      expect(f.itens_faturados?.[0]).toEqual({ sequencia: 1, produto_id: prod, quantidade: 10_000, valor_centavos: 1000 });
      expect(f.nota).not.toHaveProperty('calc_st');
      expect(f.nota).not.toHaveProperty('calc_ipi');
    });
  });

  describe('bandeira TENANTS_ENVIA_ST_IPI', () => {
    it('T-0132: desligada (padrão do main), o tenant não está na lista e o payload ao Hub é igual ao de hoje (sem os campos, mesmo JSON)', async () => {
      expect(enviaStIpi(A)).toBe(false);
      const c = await cadeia(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }, { sequencia: 2, ncm: NCM.stZero, valor: 50000 }]);
      // o cálculo tem ST e IPI nos dois itens; com a bandeira desligada nada disso chega ao Hub
      expect(c.corpoBruto.nota).toMatchObject({ v_icms_st_cents: ST_INDUSTRIAL, v_ipi_cents: 5000 });
      expect(JSON.stringify(c.corpo)).not.toMatch(/v_icms_st_cents|v_ipi_cents/);
      // "Hoje" = o mesmo evento sem nenhum campo da T-0132 (o que o pedido publicava antes): o corpo é idêntico, chave a chave e na ordem.
      const f = c.faturado;
      const hoje = {
        ...f,
        nota: Object.fromEntries(Object.entries(f.nota!).filter(([k]) => !k.startsWith('calc_'))),
        itens_faturados: f.itens_faturados!.map(({ sequencia, produto_id, quantidade, valor_centavos }) => ({ sequencia, produto_id, quantidade, valor_centavos })),
      };
      const chaves = new Map(f.itens_faturados!.map((i) => [i.produto_id, `P-${i.sequencia}`]));
      const d = retornoDoPedido({ nome: 'pedido.pedido.faturado@1', ocorrido_em: EMITIDA, payload: PayloadPedidoLido.parse(hoje) }, 'integrado', chaves);
      if (d.acao !== 'enviar') throw new Error('retorno de hoje não enviado');
      expect(JSON.stringify(c.corpo)).toBe(JSON.stringify(d.corpo));
      expect(hashDoRetorno(c.corpo)).toBe(hashDoRetorno(d.corpo)); // o mesmo hash da chave idempotente (util-pedidos.ts)
    });
    it('T-0132: ligada por injeção, o payload sai com o ST e o IPI do item e do total, aceitos pelo contrato RetornoErp', async () => {
      const c = await cadeia(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }, { sequencia: 2, ncm: NCM.stZero, valor: 50000 }], [1, 2], (t) => t === A);
      expect(itemHub(c.corpo, 1)).toMatchObject({ v_icms_st_cents: ST_INDUSTRIAL, v_ipi_cents: 5000 });
      expect(itemHub(c.corpo, 2)).toMatchObject({ v_icms_st_cents: 0, v_ipi_cents: 0 });
      expect(c.corpo.nota).toMatchObject({ v_icms_st_cents: ST_INDUSTRIAL, v_ipi_cents: 5000 });
      expect(RetornoErp.safeParse(c.corpo).success).toBe(true);
    });
    it('T-0132: ligada para outro tenant só, este continua sem os campos', async () => {
      const c = await cadeia(INDUSTRIAL, [{ sequencia: 1, ncm: NCM.st, valor: 100000 }], [1], (t) => t === randomUUID());
      expect(JSON.stringify(c.corpo)).not.toMatch(/v_icms_st_cents|v_ipi_cents/);
    });
  });
});
