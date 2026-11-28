/**
 * Rotas `/v1/fiscal/regras` e `/v1/fiscal/catalogo` (T-0127). Perfil (`fiscal.ver` / `fiscal.regra.editar`), tenant (RLS na `tx`) e licença do módulo
 * `fiscal` são checados pela API antes do `executar`. Aqui entram as regras do domain (a API sempre revalida), a auditoria e o evento
 * `fiscal.regra.alterada@1`, na mesma transação da escrita. O catálogo nunca é aplicado sozinho: só `POST /catalogo/:id/aplicar`, por quem edita regra.
 */
import { csvDaLista, definirRota, erros, fusoDaRota, paginar, type ContextoRota, type RotaModulo } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { AplicarCatalogoEntrada, Crt, CatalogoLinha, RegraAlteradaV1, RegraEntrada, TipoContribuinte, NOME_EVENTO_REGRA_ALTERADA, type CatalogoRegra, type RegraDetalhe } from '../contracts';
import { catalogoAplicavel, resolverRegra, validarRegraParaCadastro, type ProblemaRegra } from '../domain';
import { paginaCatalogo, paginaRegras } from '../web/paginas';
import type { DependenciasRegras } from './regras-portas';
import { repositorioFiscalSql } from './sql';

/** Teto de linhas do CSV; a lista paginada não tem teto. */
const MAXIMO_LINHAS_CSV = 10_000;

/** Data civil de hoje no fuso do tenant (regra 4: o banco guarda UTC; a vigência é data civil). */
export function hojeNoFuso(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

const Id = z.string().uuid();
const idDe = (params: Record<string, string>): string => {
  const r = Id.safeParse(params.id);
  if (!r.success) throw erros.naoEncontrado('Regra');
  return r.data;
};

/** If-Match = o `updated_at` da regra (com ou sem aspas e `W/`). */
const tokenIfMatch = (cabecalhos: Readonly<Record<string, string>>): string => {
  const v = cabecalhos['if-match']?.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  if (!v) throw erros.validacao({ 'if-match': 'cabeçalho obrigatório: o updated_at da regra' });
  return v;
};

/** Problema do domain vira 422 com a RN; o campo vai junto para o formulário. Primeiro problema define o código; todos entram em `campos`. */
function recusar(problemas: readonly ProblemaRegra[]): never {
  const campos = Object.fromEntries(problemas.map((p) => [p.campo, p.mensagem]));
  const primeiro = problemas[0] as ProblemaRegra;
  throw erros.regra(primeiro.rn, primeiro.mensagem, campos, { codigo: primeiro.codigo });
}

const ConsultaResolver = z.object({
  ncm: z.string().regex(/^\d{8}$/),
  cfop: z.string().regex(/^\d{4}$/),
  uf_origem: z.string().regex(/^[A-Z]{2}$/),
  uf_destino: z.string().regex(/^[A-Z]{2}$/),
  tipo_cliente: TipoContribuinte,
  crt: z.coerce.number().int().pipe(Crt),
  data_emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function criarRotasRegras(deps: DependenciasRegras): RotaModulo[] {
  const candidatas = deps.candidatas ?? repositorioFiscalSql.regras;

  const efeito = async (c: ContextoRota, acao: 'criada' | 'alterada' | 'excluida' | 'aplicada_do_catalogo', r: RegraDetalhe, antes: RegraDetalhe | null, catalogoId: string | null): Promise<void> => {
    const payload = RegraAlteradaV1.parse({
      regra_id: r.id, acao, tributo: r.tributo, ncm_prefixo: r.ncm_prefixo, versao: r.versao, vigencia_inicio: r.vigencia_inicio, vigencia_fim: r.vigencia_fim, catalogo_id: catalogoId,
    });
    await c.publicar({ nome: NOME_EVENTO_REGRA_ALTERADA, agregado_id: r.id, payload });
    await c.auditar({ acao: `fiscal.regra.${acao}`, entidade: 'regra_tributaria', entidade_id: r.id, antes: antes ?? null, depois: acao === 'excluida' ? null : r });
  };

  const hoje = (c: ContextoRota): string => hojeNoFuso(c.agora, fusoDaRota(c));

  return [
    definirRota({
      metodo: 'GET', caminho: '/regras', acao: 'fiscal.ver', consulta: paginaRegras.consulta,
      async executar(c, e) {
        const { limite, ...f } = e.consulta;
        const linhas = await deps.regras(c.tx).listar({ ...f, limite, hoje: hoje(c) });
        return { corpo: paginar(linhas, limite) };
      },
    }),
    // Rotas fixas antes de `/:id`: o caminho fixo vence o parâmetro.
    definirRota({
      metodo: 'GET', caminho: '/regras/exportar', acao: 'fiscal.ver', consulta: paginaRegras.consulta,
      async executar(c, e) {
        const { limite: _l, cursor: _c, ...f } = e.consulta;
        const linhas = await deps.regras(c.tx).listarTodos({ ...f, hoje: hoje(c) }, MAXIMO_LINHAS_CSV);
        return csvDaLista(paginaRegras, c.sessao.perfil, linhas);
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/regras/resolver', acao: 'fiscal.ver', consulta: ConsultaResolver,
      async executar(c, e) {
        const q = e.consulta;
        const data = q.data_emissao ?? hoje(c);
        const regras = await candidatas(c.tx, { data_emissao: data, uf_origem: q.uf_origem, uf_destino: q.uf_destino, crt: q.crt, ncms: [q.ncm] });
        const r = resolverRegra(regras, { ncm: q.ncm, cfop: q.cfop, uf_origem: q.uf_origem, uf_destino: q.uf_destino, tipo_cliente: q.tipo_cliente, crt: q.crt, data_emissao: data });
        const por = (x: (typeof r)['icms']) => (x.ok ? { ok: true, regra_id: x.valor.id, versao: x.valor.versao, fonte: x.valor.fonte } : { ok: false, erros: x.erros });
        return { corpo: { data_emissao: data, icms: por(r.icms), ipi: por(r.ipi), pis: por(r.pis), cofins: por(r.cofins) } };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/regras/:id', acao: 'fiscal.ver',
      async executar(c, e) {
        const r = await deps.regras(c.tx).obter(idDe(e.params), hoje(c));
        if (!r) throw erros.naoEncontrado('Regra');
        return { corpo: r, cabecalhos: { etag: `"${r.updated_at}"` } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/regras', acao: 'fiscal.regra.editar', corpo: RegraEntrada, idempotencia: 'opcional',
      async executar(c, e) {
        const problemas = validarRegraParaCadastro(e.corpo);
        if (problemas.length > 0) recusar(problemas);
        const criada = await deps.regras(c.tx).inserir(e.corpo, hoje(c));
        await efeito(c, 'criada', criada, null, null);
        return { status: 201, corpo: criada, cabecalhos: { etag: `"${criada.updated_at}"` } };
      },
    }),
    definirRota({
      metodo: 'PUT', caminho: '/regras/:id', acao: 'fiscal.regra.editar', corpo: RegraEntrada,
      async executar(c, e) {
        const id = idDe(e.params);
        const token = tokenIfMatch(e.cabecalhos);
        const problemas = validarRegraParaCadastro(e.corpo);
        if (problemas.length > 0) recusar(problemas);
        const repo = deps.regras(c.tx);
        const antes = await repo.obter(id, hoje(c));
        if (!antes) throw erros.naoEncontrado('Regra');
        const nova = await repo.atualizar(id, e.corpo, token, hoje(c));
        if (nova === null) throw erros.naoEncontrado('Regra');
        if (nova === 'conflito') throw erros.conflito('A regra mudou depois de aberta: recarregue e confira antes de salvar');
        await efeito(c, 'alterada', nova, antes, null);
        return { corpo: nova, cabecalhos: { etag: `"${nova.updated_at}"` } };
      },
    }),
    definirRota({
      metodo: 'DELETE', caminho: '/regras/:id', acao: 'fiscal.regra.editar',
      async executar(c, e) {
        const id = idDe(e.params);
        const antes = await deps.regras(c.tx).excluir(id, hoje(c));
        if (!antes) throw erros.naoEncontrado('Regra');
        await efeito(c, 'excluida', antes, antes, null);
        return { status: 204 };
      },
    }),

    definirRota({
      metodo: 'GET', caminho: '/catalogo', acao: 'fiscal.ver', consulta: paginaCatalogo.consulta,
      async executar(c, e) {
        const { limite, ...f } = e.consulta;
        const linhas = await deps.catalogo(c.tx).listar({ ...f, limite });
        const itens = linhas.map((m): CatalogoLinha => {
          const p = catalogoAplicavel(m);
          return {
            id: m.id, chave: m.chave, titulo: m.titulo, tributo: m.tributo, codigo: m.codigo, crt: m.crt, uf_origem: m.uf_origem, uf_destino: m.uf_destino,
            ncm_prefixo: m.ncm_prefixo, fonte: m.fonte, versao: m.versao, vigencia_inicio: m.vigencia_inicio, vigencia_fim: m.vigencia_fim, aplicavel: p.length === 0, motivo_nao_aplicavel: p[0]?.mensagem ?? null,
          };
        });
        return { corpo: paginar(itens, limite) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/catalogo/exportar', acao: 'fiscal.ver', consulta: paginaCatalogo.consulta,
      async executar(c, e) {
        const linhas = await deps.catalogo(c.tx).listar({ busca: e.consulta.busca, tributo: e.consulta.tributo, limite: MAXIMO_LINHAS_CSV });
        const itens = linhas.slice(0, MAXIMO_LINHAS_CSV).map((m) => {
          const p = catalogoAplicavel(m);
          return { id: m.id, chave: m.chave, titulo: m.titulo, tributo: m.tributo, codigo: m.codigo, crt: m.crt, uf_origem: m.uf_origem, uf_destino: m.uf_destino, ncm_prefixo: m.ncm_prefixo, fonte: m.fonte, versao: m.versao, vigencia_inicio: m.vigencia_inicio, vigencia_fim: m.vigencia_fim, aplicavel: p.length === 0, motivo_nao_aplicavel: p[0]?.mensagem ?? null };
        });
        return csvDaLista(paginaCatalogo, c.sessao.perfil, itens);
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/catalogo/:id/aplicar', acao: 'fiscal.regra.editar', corpo: AplicarCatalogoEntrada, idempotencia: 'opcional',
      async executar(c, e) {
        const id = Id.safeParse(e.params.id);
        const modelo: CatalogoRegra | null = id.success ? await deps.catalogo(c.tx).obter(id.data) : null;
        if (!modelo) throw erros.naoEncontrado('Modelo do catálogo');
        const bloqueios = catalogoAplicavel(modelo);
        if (bloqueios.length > 0) recusar(bloqueios);
        const { id: _id, chave: _ch, titulo: _ti, descricao: _de, ...campos } = modelo;
        const entrada = RegraEntrada.parse(campos);
        // A regra aplicada passa pelas mesmas conferências do cadastro à mão (vigência, código do CRT, ST).
        const problemas = validarRegraParaCadastro(entrada);
        if (problemas.length > 0) recusar(problemas);
        const criada = await deps.regras(c.tx).inserir(entrada, hoje(c), modelo.id);
        await efeito(c, 'aplicada_do_catalogo', criada, null, modelo.id);
        return { status: 201, corpo: criada };
      },
    }),
  ];
}
