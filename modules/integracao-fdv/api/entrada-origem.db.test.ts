/**
 * T-0057 §9 linha 4 (E2): cadastro que chega pela origem "entrada" (`/entrada/v1`, cenário B, ADR 0014) publica para o Hub
 * exatamente como a gravação do BKO: mesmo evento `cadastros.<entidade>.<fato>@vN`, mesmo canônico (`registro_publicado`) e
 * mesmo lote do `envio-lote`. O consumidor `publicar-cadastros` só enxerga o envelope: não há ramo por origem (o envelope não
 * leva origem). Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import type { EnvelopeEvento } from '@macuxierp/platform-sdk';
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { criarConsumidorPublicarCadastros } from './consumidor-cadastros';
import { AGORA, admSql, cadFilial, cadProduto, ciclo, criarCredencial, evento, hubDuble, licenciadas, ok, U } from './apoio-conector-teste';

type Origem = 'bko' | 'entrada';
interface Gravado {
  nome: string;
  agregado: string;
  payload: Record<string, unknown>;
}

/**
 * Dublê da gravação de cadastro por origem: devolve o evento que o cadastros emitiria. A regra é do cadastros: a mesma gravação,
 * venha do BKO ou da entrada, emite o mesmo evento (só o ator muda: usuário do BKO x `sistema`).
 * TODO T-0057 §9-3: trocar o dublê pelo gravarLinhas do cadastros
 */
function gravarCadastroPelaOrigem(origem: Origem, t: string, ids: { filial: string; produto: string; unidade: string }): { eventos: EnvelopeEvento[]; ator: string } {
  const ator = origem === 'bko' ? U() : 'sistema';
  const cadastros: Gravado[] = [
    { nome: 'cadastros.filial.alterada@1', agregado: ids.filial, payload: cadFilial(ids.filial, { external_id: 'FIL-ENT' }) },
    { nome: 'cadastros.produto.alterado@1', agregado: ids.produto, payload: cadProduto(ids.produto, [{ id: ids.unidade, unidade: 'CX', fator: 1, ean: null }], { external_id: 'PRD-ENT' }) },
  ];
  const eventos = cadastros.map((c, i) => ({ ...evento(t, c.nome, c.agregado, c.payload, `2026-11-22T09:0${i}:00.000Z`), ator }));
  return { eventos, ator };
}

const IDS = { filial: U(), produto: U(), unidade: U() };

describe.skipIf(!PG_DISPONIVEL)('origem entrada x BKO publicam igual para o Hub', { timeout: 30_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const consumidor = criarConsumidorPublicarCadastros({ licencas: licenciadas('integracao-fdv'), agora: () => AGORA });
  const agenda = criarAgendaConector({ outbox: new OutboxPg() });

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 4);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  async function rodar(origem: Origem) {
    const t = await criarTenant(efemero.admin, `orig-${origem}`, ['integracao-fdv']);
    await criarCredencial(efemero.admin, t, { conector: `conector-${origem}` });
    const ids = IDS; // mesmos UUIDs do cadastro nas duas origens (tenants distintos)
    const { eventos } = gravarCadastroPelaOrigem(origem, t, ids);
    for (const e of eventos) await banco.comTenant(t, (tx) => consumidor.tratar(e, tx));
    const cursores = Object.fromEntries(['filial', 'produto', 'produto_unidade'].map((e) => [`GET /cursores/${e}`, [ok({ entidade: e, cursor: null, atualizado_em: null }, false, 200)]]));
    const hub = hubDuble({
      ...cursores,
      'POST /sinal': [ok({ politica_versao: null }, false, 200)],
      'POST /lotes': [
        (p: { corpo?: unknown }) => {
          const c = p.corpo as { entidade: string; modo: string; registros: unknown[] };
          return ok({ lote_id: U(), status: 'recebido', entidade: c.entidade, modo: c.modo, recebidos: c.registros.length, repetido: false, consulta: '/integracao/v1/lotes/x' });
        },
      ],
    });
    await ciclo(banco, agenda, hub, AGORA, [t]);
    const espelho = await adm('SELECT entidade, registro_external_id, payload, hash, ativo, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 ORDER BY entidade, registro_external_id', [t]);
    const lotes = hub.chamadas
      .filter((c) => c.pedido.metodo === 'POST' && c.pedido.caminho === '/lotes')
      .map((c) => {
        const { sessao: _sessao, ...resto } = c.pedido.corpo as Record<string, unknown> & { sessao?: unknown };
        return resto;
      })
      .sort((a, b) => String(a.entidade).localeCompare(String(b.entidade)));
    return { t, espelho, lotes };
  }

  it('mesmo canônico no espelho e mesmo lote enviado ao Hub, venha o cadastro do BKO ou da entrada', async () => {
    const bko = await rodar('bko');
    const entrada = await rodar('entrada');
    expect(bko.espelho.map((r) => r.entidade)).toEqual(['filial', 'produto', 'produto_unidade']);
    expect(entrada.espelho).toEqual(bko.espelho);
    expect(bko.lotes.map((l) => l.entidade)).toEqual(['filial', 'produto', 'produto_unidade']);
    expect(entrada.lotes).toEqual(bko.lotes);
    expect(entrada.lotes.filter((l) => l.entidade !== "produto_unidade").map((l) => [l.entidade, l.modo, (l.registros as unknown[]).length])).toEqual([["filial", "completo", 1], ["produto", "completo", 1]]); // unidade só sai depois do produto confirmado (RN-INF-02), igual nas duas origens
  });
});
