/**
 * T-0057 (E1): prova do próprio arnês — o Conector simulado monta o envelope do Hub v1 que o Zod do contrato aceita,
 * manda os cabeçalhos do Conector 1.5.0, reenvia com a mesma chave e os mesmos bytes e não deixa a chave escapar.
 * O Zod é o do main (`modules/integracao-fdv/contracts/hub.ts`), igual ao do `hub-v1.ts` do SDK pela ADR 0014 §2.
 * TODO(T-0057): trocar o import pelo `@macuxierp/platform-sdk/hub-v1` quando o PR do engenheiro entrar.
 */
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  CorpoLote,
  LIMITE_REGISTROS_LOTE as LIMITE_CONTRATO,
} from '../../modules/integracao-fdv/contracts/hub';
import {
  CAMINHOS_ENTRADA_V1,
  ENTIDADES_F2,
  FORMATO_IDEMPOTENCIA,
  LIMITE_REGISTROS_LOTE,
  MAX_BYTES_LOTE_ENTRADA,
  caminho,
  criarConectorSimulado,
  type ConectorSimulado,
} from './apoio/conector-simulado';
import { criarEntradaFalsa } from './apoio/entrada-falsa';
import { cargaSemParte, montarMassaCenarioB } from './apoio/massa-cenario-b';

// chave fictícia gerada na hora (nunca fixa no código, nunca real)
const CHAVE = `cb_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
const CONECTOR = 'erp-cenario-b-teste';
const agora = () => new Date('2026-11-24T13:00:00.000Z');

function montar(extra: Partial<Parameters<typeof criarConectorSimulado>[0]> = {}) {
  const falsa = criarEntradaFalsa({ chave: CHAVE, conectorId: CONECTOR });
  let n = 0;
  const conector = criarConectorSimulado({
    url: 'https://erp.exemplo.invalid',
    conectorId: CONECTOR,
    chave: CHAVE,
    agora,
    fetch: falsa.fetch,
    novoId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    ...extra,
  });
  return { falsa, conector };
}

const corpoDe = (c: ConectorSimulado, i: number) => JSON.parse(c.fila[i]!.corpo) as unknown;

describe('conector simulado: envelope do Hub v1 (ADR 0014 §2)', () => {
  it('o limite do lote é o do contrato', () => {
    expect(LIMITE_REGISTROS_LOTE).toBe(LIMITE_CONTRATO);
  });

  it('a carga completa dos 10 cadastros da massa passa no CorpoLote do contrato', () => {
    const { conector } = montar();
    const massa = montarMassaCenarioB();
    for (const e of ENTIDADES_F2) conector.montarCargaCompleta(e, massa.registros[e]);
    expect(conector.fila).toHaveLength(10);
    conector.fila.forEach((_, i) => {
      const r = CorpoLote.safeParse(corpoDe(conector, i));
      expect(r.success, JSON.stringify(r.error?.issues.map((x) => x.path))).toBe(true);
    });
    expect(conector.fila.map((l) => l.entidade)).toEqual([...ENTIDADES_F2]);
  });

  it('a carga completa vira partes da mesma sessão; só a última tem ultimo=true', () => {
    const { conector } = montar({ limiteLote: 3 });
    const massa = montarMassaCenarioB({ produtos: 7 });
    const partes = conector.montarCargaCompleta('produto', massa.registros.produto);
    expect(partes.map((p) => p.envelope.sessao)).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', parte: 1, ultimo: false },
      { id: '00000000-0000-4000-8000-000000000001', parte: 2, ultimo: false },
      { id: '00000000-0000-4000-8000-000000000001', parte: 3, ultimo: true },
    ]);
    expect(partes.map((p) => p.envelope.registros.length)).toEqual([3, 3, 1]);
    for (const p of partes) expect(CorpoLote.safeParse(JSON.parse(p.corpo)).success).toBe(true);
  });

  it('carga completa vazia ainda manda uma parte (o último da sessão inativa o que sobrou)', () => {
    const { conector } = montar();
    const [p, ...resto] = conector.montarCargaCompleta('filial', []);
    expect(resto).toHaveLength(0);
    expect(p!.envelope.sessao).toMatchObject({ parte: 1, ultimo: true });
    expect(CorpoLote.safeParse(JSON.parse(p!.corpo)).success).toBe(true);
  });

  it('o delta vai sem sessão e com o cursor; o contrato recusa delta com sessão', () => {
    const { conector } = montar();
    const massa = montarMassaCenarioB();
    const cursor = { alterado_em: '2026-11-23T14:00:00.000Z', external_id: 'CB-FIL-0001' };
    const [d] = conector.montarDelta('vendedor', massa.registros.vendedor, cursor);
    expect(d!.envelope).not.toHaveProperty('sessao');
    expect(d!.envelope.cursor).toEqual(cursor);
    expect(CorpoLote.safeParse(JSON.parse(d!.corpo)).success).toBe(true);
    const comSessao = {
      ...d!.envelope,
      sessao: { id: '00000000-0000-4000-8000-000000000009', parte: 1, ultimo: true },
    };
    expect(CorpoLote.safeParse(comSessao).success).toBe(false);
  });

  it('as linhas inválidas vão só na primeira parte e passam no contrato', () => {
    const { conector } = montar({ limiteLote: 2 });
    const massa = montarMassaCenarioB();
    const partes = conector.montarCargaCompleta('cliente', massa.registros.cliente, [
      {
        external_id: 'CB-CLI-9999',
        codigo: 'campo_obrigatorio',
        campo: 'razao_social',
        mensagem: 'Razão social obrigatória.',
      },
    ]);
    expect(partes.map((p) => p.envelope.linhas_invalidas.length)).toEqual([1, 0]);
    for (const p of partes) expect(CorpoLote.safeParse(JSON.parse(p.corpo)).success).toBe(true);
  });
});

describe('conector simulado: cabeçalhos e idempotência (ADR 0014 §3)', () => {
  it('manda Authorization, X-Macuxi-Conector-Id e a Idempotency-Key no formato do Hub; a versão não vai em cabeçalho (P-1, P-3, P-4)', async () => {
    const vistos: Headers[] = [];
    const { falsa } = montar();
    const { conector } = montar({
      fetch: (u, i) => {
        vistos.push(new Headers(i?.headers));
        return falsa.fetch(u, i);
      },
    });
    const [lote] = conector.montarCargaCompleta('filial', montarMassaCenarioB().registros.filial);
    const r = await conector.enviar(lote!);
    expect(r.status).toBe(202);
    const h = vistos[0]!;
    expect(h.get('authorization')).toBe(`Bearer ${CHAVE}`);
    expect(h.get('x-macuxi-conector-id')).toBe(CONECTOR);
    expect(h.get('x-macuxi-conector-versao')).toBeNull();
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('idempotency-key')).toBe(lote!.chave);
    expect(lote!.chave).toMatch(FORMATO_IDEMPOTENCIA);
  });

  it('o reenvio manda os mesmos bytes com a mesma chave e recebe o mesmo lote_id', async () => {
    const { falsa, conector } = montar();
    const [lote] = conector.montarCargaCompleta('produto', montarMassaCenarioB().registros.produto);
    const a = await conector.enviar(lote!);
    const b = await conector.enviar(lote!);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect((b.corpo as { lote_id: string }).lote_id).toBe((a.corpo as { lote_id: string }).lote_id);
    expect(b.corpo).toEqual({ ...(a.corpo as object), repetido: true });
    expect(b.cabecalhos['idempotency-replayed']).toBe('true');
    expect(a.cabecalhos['idempotency-replayed']).toBeUndefined();
    expect(falsa.lotes.size).toBe(1);
    expect(conector.requisicoes.map((x) => x.chaveIdempotencia)).toEqual([lote!.chave, lote!.chave]);
  });

  it('o mesmo envelope dá a mesma chave; outro corpo dá outra; a mesma chave com outro corpo leva 409', async () => {
    const { conector } = montar();
    const massa = montarMassaCenarioB();
    const [a] = conector.montarDelta('preco', massa.registros.preco, null);
    const [b] = conector.montarDelta('preco', massa.registros.preco, null);
    const [c] = conector.montarDelta('preco', massa.registros.preco.slice(1), null);
    expect(b!.chave).toBe(a!.chave);
    expect(b!.corpo).toBe(a!.corpo);
    expect(c!.chave).not.toBe(a!.chave);
    expect((await conector.enviar(a!)).status).toBe(202);
    const conflito = await conector.enviarComChave(a!.chave, c!.envelope);
    expect(conflito.status).toBe(409);
    expect(conflito.corpo).toMatchObject({ codigo: 'CONFLITO', detalhes: { codigo: 'idempotencia_conflito' } });
  });

  it('o sinal leva a versao_conector no corpo, no molde do CorpoSinal (P-3)', () => {
    const { conector } = montar();
    const s = conector.montarSinal(['produto']);
    expect(s).toMatchObject({ versao_contrato: 'v1', conector_id: CONECTOR, versao_conector: '1.0.0' });
    expect(s.entidades).toEqual([
      { entidade: 'produto', fase: 'delta', ultimo_sucesso: null, bloqueada: false, lotes_na_fila: 0 },
    ]);
  });

  it('chave errada leva 401 (o arnês não "acerta" a credencial por conta própria)', async () => {
    const { falsa } = montar();
    const outro = criarConectorSimulado({
      url: 'https://erp.exemplo.invalid',
      conectorId: CONECTOR,
      chave: `${CHAVE}x`,
      agora,
      fetch: falsa.fetch,
    });
    const [lote] = outro.montarDelta('filial', [], null);
    expect((await outro.enviar(lote!)).status).toBe(401);
  });
});

describe('conector simulado: segredo e URL (ADR 0014 §3 e §6)', () => {
  it('a chave não aparece no JSON, no inspect, nas requisições registradas nem na fila', async () => {
    const { conector } = montar();
    const [lote] = conector.montarCargaCompleta('filial', montarMassaCenarioB().registros.filial);
    await conector.enviar(lote!);
    expect(JSON.stringify(conector)).not.toContain(CHAVE);
    expect(inspect(conector, { depth: 5 })).not.toContain(CHAVE);
    expect(JSON.stringify(conector.requisicoes)).not.toContain(CHAVE);
    expect(JSON.stringify(conector.fila)).not.toContain(CHAVE);
  });

  it('só HTTPS; HTTP só em localhost; o prefixo é configurável e o padrão é /entrada/v1', async () => {
    expect(() => montar({ url: 'http://erp.exemplo.invalid' })).toThrow(/só HTTPS/);
    expect(() => montar({ url: 'http://127.0.0.1:3000' })).not.toThrow();
    expect(() => montar({ conectorId: 'com espaço' })).toThrow(/conector_id/);
    expect(() => montar({ limiteLote: LIMITE_REGISTROS_LOTE + 1 })).toThrow(/limiteLote/);
    const urls: string[] = [];
    const { conector } = montar({
      fetch: async (u) => (urls.push(String(u)), new Response(null, { status: 404 })),
    });
    await conector.consultarCursor('cliente');
    await conector.consultarLote('00000000-0000-4000-8000-000000000001', 5500);
    expect(urls).toEqual([
      'https://erp.exemplo.invalid/entrada/v1/cursores/cliente',
      'https://erp.exemplo.invalid/entrada/v1/lotes/00000000-0000-4000-8000-000000000001?limite_erros=5500',
    ]);
  });

  it('os caminhos saem da constante única e os parâmetros vão codificados', () => {
    for (const c of Object.values(CAMINHOS_ENTRADA_V1)) expect(c.startsWith('/')).toBe(true);
    expect(caminho(CAMINHOS_ENTRADA_V1.notaRetorno, { chave: 'a/b c' })).toBe('/notas/a%2Fb%20c/retorno');
    expect(() => caminho(CAMINHOS_ENTRADA_V1.lote)).toThrow(/falta o parâmetro id/);
  });
});

describe('entrada falsa: trava de 30%, dono e teto (P-9, P-10, P-11)', () => {
  async function cargaEmDuasVezes(faltando: number) {
    const { falsa, conector } = montar();
    const produtos = montarMassaCenarioB({ produtos: 10 }).registros.produto;
    for (const l of conector.montarCargaCompleta('produto', produtos)) await conector.enviar(l);
    falsa.processar();
    const sem = cargaSemParte(produtos, faltando);
    const [lote] = conector.montarCargaCompleta('produto', sem.registros);
    const r = await conector.enviar(lote!);
    falsa.processar();
    const res = await conector.consultarLote((r.corpo as { lote_id: string }).lote_id);
    return { falsa, res: res.corpo as { inativacao: Record<string, unknown>; inativadas: number } };
  }

  it('acima de 30% (40%) fica aguardando_confirmacao e nada é inativado', async () => {
    const { falsa, res } = await cargaEmDuasVezes(4);
    expect(res.inativacao).toEqual({ situacao: 'aguardando_confirmacao', candidatos: 4, percentual: 40 });
    expect(res.inativadas).toBe(0);
    expect(falsa.ativos('padrao', 'produto')).toHaveLength(10);
  });

  it('30% exato aplica a inativação', async () => {
    const { falsa, res } = await cargaEmDuasVezes(3);
    expect(res.inativacao).toEqual({ situacao: 'aplicada', candidatos: 3, percentual: 30 });
    expect(res.inativadas).toBe(3);
    expect(falsa.ativos('padrao', 'produto')).toHaveLength(7);
  });

  it('entidade de dono erp = 422 entidade_dono_erp; fora da F2 = 422 entidade_fora_da_fase; acima de 8 MiB = 413', async () => {
    const falsa = criarEntradaFalsa({ chave: CHAVE, conectorId: CONECTOR, donoErp: ['cliente'] });
    const conector = criarConectorSimulado({ url: 'https://erp.exemplo.invalid', conectorId: CONECTOR, chave: CHAVE, agora, fetch: falsa.fetch });
    const [cli] = conector.montarDelta('cliente', [], null);
    expect((await conector.enviar(cli!)).corpo).toMatchObject({ detalhes: { codigo: 'entidade_dono_erp' } });
    const r = await conector.enviarComChave('cb:titulo:0001', { ...cli!.envelope, entidade: 'titulo' });
    expect([r.status, r.corpo]).toMatchObject([422, { detalhes: { codigo: 'entidade_fora_da_fase' } }]);
    const grande = await conector.requisitar('POST', CAMINHOS_ENTRADA_V1.lotes, 'x'.repeat(MAX_BYTES_LOTE_ENTRADA + 1), {
      'Idempotency-Key': 'cb:grande:0001',
    });
    expect(grande.status).toBe(413);
    expect(falsa.lotes.size).toBe(0);
  });
});
