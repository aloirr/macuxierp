/**
 * Plugin de plataforma "Zerar dados" do portal `/config` (RN-CAD-10, T-0058, ADR 0012 §4 e 0013). Só superadmin.
 * Decisão no domain (`planoZeragem`), efeito nas funções do banco, tudo na mesma transação do `comPlataforma`:
 *   fatos (`cadastros.portal_zeragem_fatos`) + usos (porta) + estado da integração (porta) → plano → espelho → `cadastros.portal_zerar`.
 * A auditoria (só contagens e superadmin_id) é gravada pela função do banco, então a rota não chama `c.auditar`.
 * O erro `MXC03` (o estado mudou entre o plano e o efeito) sobe cru para o mapa de erros da apps/api.
 */
import {
  CADASTROS_ZERAR_PORTAL,
  CAMINHOS_CARGAS_PLATAFORMA,
  CODIGO_ZERAGEM_BLOQUEADA,
  ENTIDADES_ENVIO_FDV,
  PreviaZerarPlataformaEntrada,
  TabelaZeragem,
  ZerarDadosPlataformaEntrada,
  ZeragemPlataformaResposta,
  definirPluginPlataforma,
  definirRotaPlataforma,
  erros,
  type CadastroZerarPortal,
  type ContextoPlataforma,
  type PluginPlataforma,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { CADASTRO_DA_TABELA, planoZeragem, type CadastroZerar, type FatosZeragem, type MotivoUso, type PlanoZeragem } from '../domain';
import type { DependenciasZeragemPlataforma, EstadoEntidadeIntegracao, RefsUso, UsoDaTabela } from './zeragem-portas';

const Uuid = z.string().uuid();

/** O jsonb de `cadastros.portal_zeragem_fatos` (0043): `{tabelas: [{tabela, linhas: [{id, refs, com_chave}]}]}`. */
const LinhaFato = z.object({
  id: z.string().min(1),
  refs: z.record(TabelaZeragem, z.string()).optional(),
  com_chave: z.boolean(),
});
export const FatosBanco = z.object({ tabelas: z.array(z.object({ tabela: TabelaZeragem, linhas: z.array(LinhaFato) })) });

/** Formato do domain (`existentes` por tabela). */
export const existentesDoBanco = (b: z.infer<typeof FatosBanco>): FatosZeragem['existentes'] => {
  const r: Record<string, z.infer<typeof LinhaFato>[]> = {};
  for (const t of b.tabelas) (r[t.tabela] ??= []).push(...t.linhas);
  return r;
};

/** Tabelas que o `p_refs` das funções de uso aceita (0043); as outras (item de preço, saldo etc.) não têm uso próprio. */
const TABELAS_DE_USO = ['filial', 'vendedor', 'condicao_pagamento', 'tabela_preco', 'produto', 'cliente'] as const;

/** `em_uso` das duas funções de uso (pedido e faturamento) → `usos[cadastro][motivo]` do domain. */
export function usosDeEmUso(emUso: readonly UsoDaTabela[]): FatosZeragem['usos'] {
  const usos: Partial<Record<CadastroZerar, Partial<Record<MotivoUso, string[]>>>> = {};
  for (const u of emUso) {
    const cad = CADASTRO_DA_TABELA[u.tabela];
    const por = (usos[cad] ??= {});
    (por[u.motivo] ??= []).push(...u.ids);
  }
  return usos;
}

/** Cadastro → entidades do Hub. Cadastro sem entrada não gera bloqueio de integração. */
export const ENTIDADES_DO_CADASTRO: Partial<Record<CadastroZerar, readonly (typeof ENTIDADES_ENVIO_FDV)[number][]>> = {
  filial: ['filial'],
  vendedor: ['vendedor'],
  forma_prazo: ['forma_pagamento', 'prazo_pagamento'],
  produto: ['produto'],
  produto_unidade: ['produto_unidade'],
  preco: ['preco'],
  estoque: ['estoque'],
  cliente: ['cliente'],
  cliente_endereco: ['cliente_endereco'],
};

const entidadesDe = (cadastros: readonly CadastroZerar[]): string[] => [...new Set(cadastros.flatMap((c) => ENTIDADES_DO_CADASTRO[c] ?? []))];

async function lerFatos(tx: Transacao, tenant: string): Promise<z.infer<typeof FatosBanco>> {
  const [l] = await tx.consultar<{ r: unknown }>('SELECT cadastros.portal_zeragem_fatos($1::uuid, $2::text[]) AS r', [tenant, [...CADASTROS_ZERAR_PORTAL]]);
  if (!l) throw new Error('portal_zeragem_fatos sem retorno');
  return FatosBanco.parse(l.r);
}

const lerEstado = (c: ContextoPlataforma, tenant: string, deps: DependenciasZeragemPlataforma) =>
  deps.integracao.estado(c.tx, tenant, entidadesDe(CADASTROS_ZERAR_PORTAL));

const integracaoDe = (estado: readonly EstadoEntidadeIntegracao[]) =>
  CADASTROS_ZERAR_PORTAL.map((cadastro) => {
    const es = estado.filter((e) => (ENTIDADES_DO_CADASTRO[cadastro] ?? []).some((x) => x === e.entidade));
    return { cadastro, ligada: es.some((e) => e.ligada), lote_em_voo: es.some((e) => e.lote_em_voo) };
  });

/** Fatos do banco + usos + integração, no formato do domain. Os fatos sempre cobrem todos os cadastros (a cascata precisa). */
async function montarFatos(c: ContextoPlataforma, tenant: string, deps: DependenciasZeragemPlataforma, estadoLido?: EstadoEntidadeIntegracao[]): Promise<FatosZeragem> {
  const banco = await lerFatos(c.tx, tenant);
  const existentes = existentesDoBanco(banco);
  const refs: RefsUso = {};
  for (const t of TABELAS_DE_USO) {
    const ids = (existentes[t] ?? []).map((x) => x.id);
    if (ids.length > 0) refs[t] = ids;
  }
  const u = await deps.usos.usos(c.tx, tenant, refs);
  const estado = estadoLido ?? (await lerEstado(c, tenant, deps));
  const integracao = integracaoDe(estado);
  return { existentes, usos: usosDeEmUso(u.emUso), filiaisComNota: u.filiaisComNota, integracao };
}

const ResultadoZerar = z.object({
  apagados: z.array(z.object({ tabela: TabelaZeragem, quantidade: z.number().int().min(0) })),
  anulados: z.array(z.object({ tabela: z.literal('cliente'), coluna: z.enum(['vendedor_id', 'tabela_preco_id', 'condicao_pagamento_id']), quantidade: z.number().int().min(0) })),
});

function resposta(tenant: string, plano: PlanoZeragem, simulado: boolean, efeito?: z.infer<typeof ResultadoZerar>) {
  return ZeragemPlataformaResposta.parse({
    empresa_id: tenant,
    simulado,
    efetivos: plano.efetivos,
    apagados: efeito ? efeito.apagados : plano.apagar.map((a) => ({ tabela: a.tabela, quantidade: a.ids.length })),
    anulados: efeito ? efeito.anulados : plano.anular.map((a) => ({ tabela: a.tabela, coluna: a.coluna, quantidade: a.ids.length })),
    mantidos: plano.mantidos,
    bloqueios: plano.bloqueios,
    sem_chave: plano.sem_chave,
  });
}

const idDaRota = (params: Record<string, string>): string => {
  const r = Uuid.safeParse(params.id);
  if (!r.success) throw erros.validacao({ id: 'UUID inválido' });
  return r.data;
};

export function criarPluginPlataformaCadastrosZerar(deps: DependenciasZeragemPlataforma): PluginPlataforma {
  const C = CAMINHOS_CARGAS_PLATAFORMA;
  return definirPluginPlataforma([
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.previa,
      acao: 'plataforma.cadastros.zerar',
      corpo: PreviaZerarPlataformaEntrada,
      async executar(c, { corpo, params }) {
        const tenant = idDaRota(params);
        const plano = planoZeragem(corpo.cadastros, await montarFatos(c, tenant, deps));
        return { corpo: resposta(tenant, plano, true) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.zerar,
      acao: 'plataforma.cadastros.zerar',
      corpo: ZerarDadosPlataformaEntrada,
      idempotencia: 'obrigatoria',
      async executar(c, { corpo, params }) {
        const tenant = idDaRota(params);
        const escolhidos = corpo.cadastros as CadastroZerarPortal[];
        const bloqueado = (plano: PlanoZeragem) => {
          if (plano.bloqueios.length === 0) return;
          throw erros.regra('RN-CAD-10', 'Há cadastros com a integração FDV ligada ou com lote em andamento', undefined, {
            codigo: CODIGO_ZERAGEM_BLOQUEADA,
            bloqueios: plano.bloqueios.map((b) => `${b.cadastro}:${b.motivo}`),
          });
        };
        // Ordem do efeito (README do banco, T-0058): 1) integracao_fdv (estado e espelho das entidades dos efetivos, que só
        // dependem do pedido); 2) fatos do cadastros; 3) usos (pedido, faturamento, core); 4) tirar as filiais dos usuários;
        // 5) cadastros.portal_zerar (revalida com FOR UPDATE; MXC03 se mudou). Tudo na mesma transação: erro desfaz o espelho.
        const estado = await lerEstado(c, tenant, deps);
        const previo = planoZeragem(escolhidos, { existentes: {}, integracao: integracaoDe(estado) });
        bloqueado(previo);
        await deps.integracao.zerarEspelho(c.tx, tenant, entidadesDe(previo.efetivos), c.request_id);
        const plano = planoZeragem(escolhidos, await montarFatos(c, tenant, deps, estado));
        bloqueado(plano); // bloqueio só pela cascata (cadastro tocado): o erro desfaz o espelho na mesma transação
        const filiaisApagadas = plano.apagar.filter((a) => a.tabela === 'filial').flatMap((a) => a.ids);
        if (filiaisApagadas.length > 0) await deps.usuarios.tirarFiliais(c.tx, tenant, filiaisApagadas);
        const [l] = await c.tx.consultar<{ r: unknown }>('SELECT cadastros.portal_zerar($1::uuid, $2::jsonb, $3) AS r', [
          tenant,
          JSON.stringify({ apagar: plano.apagar, anular: plano.anular, em_uso: plano.emUso }),
          c.request_id,
        ]);
        if (!l) throw new Error('portal_zerar sem retorno');
        return { corpo: resposta(tenant, plano, false, ResultadoZerar.parse(l.r)) };
      },
    }),
  ]);
}
