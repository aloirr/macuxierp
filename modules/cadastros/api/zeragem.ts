/**
 * Plugin de plataforma "Zerar dados" do portal `/config` (RN-CAD-10, T-0058, ADR 0012 §4 e 0013). Só superadmin.
 * Decisão no domain (`planoZeragem`), efeito nas funções do banco, tudo na mesma transação do `comPlataforma`:
 *   fatos (`cadastros.portal_zeragem_fatos`) + usos (porta) + lote em voo (porta) → plano → `cadastros.portal_zerar`, que já
 * deixa inativo e pendente no espelho do FDV o que sai e foi publicado (0053), devolvendo `inativacao_fdv` por entidade.
 * A auditoria (só contagens e superadmin_id) é gravada pela função do banco, então a rota não chama `c.auditar`.
 * O erro `MXC03` (o estado mudou entre o plano e o efeito) sobe cru para o mapa de erros da apps/api.
 */
import {
  CADASTROS_ZERAR_PORTAL,
  CAMINHOS_CARGAS_PLATAFORMA,
  CODIGO_ZERAGEM_BLOQUEADA,
  FRASE_ZERAR_DADOS,
  MENSAGEM_FRASE_ZERAR,
  ENTIDADES_ENVIO_FDV,
  InativacaoZerarFdv,
  PreviaZerarPlataformaEntrada,
  TabelaZeragem,
  ZeragemPlataformaResposta,
  definirPluginPlataforma,
  definirRotaPlataforma,
  erros,
  fraseConfere,
  type CadastroZerarPortal,
  type ContextoPlataforma,
  type PluginPlataforma,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { CODIGO_FRASE_NAO_CONFERE, ZerarCadastrosCorpo } from '../contracts';
import { ANULAVEIS, CADASTRO_DA_TABELA, contagens, planoZeragem, type FatosZeragem, type MotivoUso, type PlanoZeragem } from '../domain';
import { TABELAS_DE_USO, type DependenciasZeragemPlataforma, type EstadoEntidadeIntegracao, type RefsUso, type UsoDaTabela } from './zeragem-portas';

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

/** `em_uso` das duas funções de uso (pedido e faturamento) → `usos[cadastro][motivo]` do domain. */
export function usosDeEmUso(emUso: readonly UsoDaTabela[]): FatosZeragem['usos'] {
  const usos: Partial<Record<CadastroZerarPortal, Partial<Record<MotivoUso, string[]>>>> = {};
  for (const u of emUso) {
    const cad = CADASTRO_DA_TABELA[u.tabela];
    const por = (usos[cad] ??= {});
    (por[u.motivo] ??= []).push(...u.ids);
  }
  return usos;
}

/** Cadastro → entidades do Hub. Cadastro sem entrada não gera bloqueio de integração. */
export const ENTIDADES_DO_CADASTRO: Partial<Record<CadastroZerarPortal, readonly (typeof ENTIDADES_ENVIO_FDV)[number][]>> = {
  filial: ['filial'],
  vendedor: ['vendedor'],
  condicao_pagamento: ['forma_pagamento', 'prazo_pagamento'],
  produto: ['produto'],
  produto_unidade: ['produto_unidade'],
  preco: ['preco'],
  estoque: ['estoque'],
  cliente: ['cliente', 'cliente_endereco'],
};

const ENTIDADES_ZERAR: string[] = [...new Set(CADASTROS_ZERAR_PORTAL.flatMap((c) => ENTIDADES_DO_CADASTRO[c] ?? []))];

async function lerFatos(tx: Transacao, tenant: string): Promise<z.infer<typeof FatosBanco>> {
  const [l] = await tx.consultar<{ r: unknown }>('SELECT cadastros.portal_zeragem_fatos($1::uuid, $2::text[]) AS r', [tenant, [...CADASTROS_ZERAR_PORTAL]]);
  if (!l) throw new Error('portal_zeragem_fatos sem retorno');
  return FatosBanco.parse(l.r);
}

const lerEstado = (c: ContextoPlataforma, tenant: string, deps: DependenciasZeragemPlataforma) =>
  deps.integracao.estado(c.tx, tenant, ENTIDADES_ZERAR);

const integracaoDe = (estado: readonly EstadoEntidadeIntegracao[]) =>
  CADASTROS_ZERAR_PORTAL.map((cadastro) => {
    const es = estado.filter((e) => (ENTIDADES_DO_CADASTRO[cadastro] ?? []).some((x) => x === e.entidade));
    return { cadastro, lote_em_voo: es.some((e) => e.lote_em_voo) };
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

/** Retorno do `cadastros.portal_zerar` (0053). `inativacao_fdv` só vem quando há espelho pendente; vazio é omitido. */
const ResultadoZerar = z.object({
  apagados: z.array(z.object({ tabela: TabelaZeragem, quantidade: z.number().int().min(0) })),
  anulados: z.array(z.object({ tabela: z.literal('cliente'), coluna: z.enum(ANULAVEIS.map((a) => a.coluna) as [string, ...string[]]), quantidade: z.number().int().min(0) })),
  inativacao_fdv: InativacaoZerarFdv.optional(),
});

function resposta(tenant: string, plano: PlanoZeragem, simulado: boolean, efeito?: z.infer<typeof ResultadoZerar>) {
  const { inativacao_fdv, ...contados } = efeito ?? { ...contagens(plano), inativacao_fdv: undefined };
  return ZeragemPlataformaResposta.parse({
    empresa_id: tenant,
    simulado,
    efetivos: plano.efetivos,
    ...contados,
    ...(inativacao_fdv?.length ? { inativacao_fdv } : {}),
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
      corpo: ZerarCadastrosCorpo,
      idempotencia: 'obrigatoria',
      async executar(c, { corpo, params }) {
        if (!fraseConfere(corpo.frase, FRASE_ZERAR_DADOS)) throw erros.regra('RN-CAD-10', MENSAGEM_FRASE_ZERAR, undefined, { codigo: CODIGO_FRASE_NAO_CONFERE });
        const tenant = idDaRota(params);
        const escolhidos = corpo.cadastros as CadastroZerarPortal[];
        const bloqueado = (plano: PlanoZeragem) => {
          if (plano.bloqueios.length === 0) return;
          throw erros.regra('RN-CAD-10', 'Há cadastros com lote de integração em andamento', undefined, {
            codigo: CODIGO_ZERAGEM_BLOQUEADA,
            bloqueios: plano.bloqueios.map((b) => `${b.cadastro}:${b.motivo}`),
          });
        };
        // Ordem do efeito (README do banco, T-0058, 0053): 1) estado da integração (lote em voo); 2) fatos do cadastros;
        // 3) usos (pedido, faturamento, core); 4) tirar as filiais dos usuários; 5) cadastros.portal_zerar (revalida com
        // FOR UPDATE; MXC03 se mudou; inativa o espelho antes do DELETE). Tudo na mesma transação: erro desfaz tudo.
        const estado = await lerEstado(c, tenant, deps);
        const previo = planoZeragem(escolhidos, { existentes: {}, integracao: integracaoDe(estado) });
        bloqueado(previo);
        const plano = planoZeragem(escolhidos, await montarFatos(c, tenant, deps, estado));
        bloqueado(plano); // bloqueio só pela cascata (cadastro tocado)
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
