/**
 * Rotas `/v1/cadastros` (desenho T-0002, seção 4). Perfil, tenant e licença são checados pela API antes do `executar`
 * (RN-CORE-02); aqui entram as regras do domain (a API sempre revalida), a auditoria das ações (A) e os eventos da outbox.
 */
import {
  ErroApi, cpfValido, definirRota, erros, pode,
  type Acao, type ContextoRota, type RotaModulo, type Sessao,
} from '@macuxierp/platform-sdk';
import { z } from 'zod';
import {
  ClienteAtualizacao, ClienteDados, type Cliente, CondicaoPagamentoAtualizacao, CondicaoPagamentoDados, Contato, ConsultaIeEntrada,
  EVENTOS, EnderecoCliente, EstoqueConsulta, FilialAtualizacao, FilialDados, ListaConsulta, MovimentoEstoque, PrecoItemConsulta, TrocaExternalId,
  OficialConsulta, PrecoLote, PrecoVigenteConsulta, type RegimePisCofins, ProdutoAtualizacao, ProdutoDados, TABELAS_OFICIAIS, TRABALHO_CONSULTAR_IE,
  TabelaPrecoAtualizacao, TabelaPrecoDados, TransferenciaCarteira, UnidadeDados, VendedorAtualizacao, VendedorDados,
  type NomeEventoCadastros,
} from '../contracts';
import {
  aplicarMovimento, bloqueiosDeInativacao, escopoDaCarteira, planejarTransferencia,
  validarCondicaoPagamento, completarParcelasCartao, validarFilial, validarFiscalProduto, validarLotePreco, validarVigenciaTabela,
  violacao, violacaoFracao, type Violacao,
} from '../domain';
import { rotaCarga, rotaModeloCarga } from './carga';
import { desativarCondicoesRecusadas, tratarCartaoSemParcelas } from './formas-recusadas';
import { comExternalIdAnterior, publicarPronto, republicarItensDaTabela, eventoCliente, eventoEstoque, eventoFilial, eventoPreco, eventoProduto, eventoSimples, eventoTabelaPreco, type EventoPronto } from './eventos';
import { agregadoEstoque } from './uuid';
import { consultarCnpj, sugestaoCep, sugestaoComCache } from './consultas';
import type { Dependencias, FiltroLista, RepoFilho, RepoSimples, Repositorios, TabelaChave } from './portas';
import { precosVigentesDe } from './precos-vigentes';
import { validarCliente, verificarMunicipioEndereco } from './validar-cliente';
import { dataIso, erroDeViolacoes, exigir, idDe, violacaoExternalId } from './util';

type Dict = Record<string, unknown>;
/** `external_id` de um cadastro (`null` se ausente). */
const extDe = (x: unknown): string | null => ((x as Dict).external_id as string | null | undefined) ?? null;
type Entidade = { id: string; inativo: boolean };

async function publicar(c: ContextoRota, nome: NomeEventoCadastros, agregadoId: string, payload: unknown): Promise<void> {
  const dados = EVENTOS[nome].parse(payload) as Dict;
  await c.publicar({ nome, agregado_id: agregadoId, versao: 1, // @deprecated no SDK, ignorada (T-0034), mas ainda exigida pelo tipo
    payload: dados });
}

/** Emissor de um cadastro: monta o evento pronto (de `eventos.ts`) e publica; serve de `emitir` do CRUD e de `aoGravar` do filho. */
const emitirCom =
  <E>(montar: (r: Repositorios, e: E) => EventoPronto | Promise<EventoPronto>) =>
  async (c: ContextoRota, r: Repositorios, e: E, antes?: unknown): Promise<void> =>
    publicarPronto(c, comExternalIdAnterior(await montar(r, e), e, antes));

const requisitoFilial = async (r: Repositorios, id: string | null, campo: string): Promise<Violacao[]> =>
  id === null || (await r.filiais.obter(id)) ? [] : [violacao('REF', campo, 'Filial inexistente')];

const violacoesDe = async (v: Promise<Violacao | null>): Promise<Violacao[]> => [(await v)].filter((x): x is Violacao => x !== null);

interface ConfigCrud<E extends Entidade, D extends Dict> {
  caminho: string;
  editar: Acao;
  dados: z.ZodType<D, z.ZodTypeDef, unknown>;
  atualizacao: z.ZodType<Partial<D>, z.ZodTypeDef, unknown>;
  entidade: string;
  /** Tabela do `external_id` (guarda da RD-0317). */
  tabela: TabelaChave;
  /** Ação marcada (A) no desenho: grava em `plataforma.auditoria`. */
  auditado: boolean;
  /** Campos marcados (A) numa entidade não auditada por inteiro: só a troca deles grava em `plataforma.auditoria` (sem dado pessoal). */
  camposAuditados?: readonly string[];
  repo(r: Repositorios): RepoSimples<E, D>;
  /** Publica o evento do cadastro na outbox (`antes` = estado anterior; `null` na criação). */
  emitir(c: ContextoRota, r: Repositorios, e: E, antes: E | null): Promise<void>;
  /** Preenche o que o domain deriva do corpo (criação e PATCH; ex.: prazos do cartão), antes de validar e gravar. */
  completar?(corpo: Dict, antes?: Dict): Dict;
  /** Regras do domain sobre o cadastro já completo (criação ou criação + alteração). */
  validar?(r: Repositorios, completo: Dict, parcial: Dict | null, agora: Date): Promise<Violacao[]>;
  /** Campos que exigem permissão a mais (limite de crédito). */
  campoRestrito?(sessao: Sessao, corpo: Dict, criacao: boolean): void;
  escopo?(r: Repositorios, sessao: Sessao): Promise<Partial<FiltroLista>>;
  visivel?(r: Repositorios, sessao: Sessao, e: E): Promise<boolean>;
  ocultar?(sessao: Sessao, e: E): E;
  padrao?(r: Repositorios): { desmarcarPadrao(exceto: string | null): Promise<void> };
  inativavel?: Parameters<typeof bloqueiosDeInativacao>[0];
}

function rotasCrud<E extends Entidade, D extends Dict>(deps: Dependencias, cfg: ConfigCrud<E, D>): RotaModulo[] {
  const R = (c: ContextoRota) => deps.repositorios(c.tx);
  const ocultar = (c: ContextoRota, e: E) => (cfg.ocultar ? cfg.ocultar(c.sessao, e) : e);
  const aud = async (c: ContextoRota, acao: string, id: string, antes: unknown, depois: unknown) => {
    if (cfg.auditado) await c.auditar({ acao: `${cfg.entidade}.${acao}`, entidade: cfg.entidade, entidade_id: id, antes, depois });
    for (const campo of cfg.camposAuditados ?? []) {
      const a = antes === null ? null : ((antes as Dict)[campo] ?? null);
      const d = (depois as Dict)[campo] ?? null;
      if (!cfg.auditado && JSON.stringify(a ?? 0) !== JSON.stringify(d ?? 0))
        await c.auditar({ acao: `${cfg.entidade}.${campo}.alterar`, entidade: cfg.entidade, entidade_id: id, antes: { [campo]: a }, depois: { [campo]: d } });
    }
  };
  const carregar = async (c: ContextoRota, r: Repositorios, id: string): Promise<E> => {
    const e = await cfg.repo(r).obter(id);
    if (!e || (cfg.visivel && !(await cfg.visivel(r, c.sessao, e)))) throw erros.naoEncontrado('Registro');
    return e;
  };

  return [
    definirRota({
      metodo: 'GET', caminho: cfg.caminho, acao: 'cadastros.ver', consulta: ListaConsulta,
      async executar(c, e) {
        const r = R(c);
        const escopo = cfg.escopo ? await cfg.escopo(r, c.sessao) : {};
        const p = await cfg.repo(r).listar({ ...e.consulta, ...escopo });
        return { corpo: { itens: p.itens.map((i) => ocultar(c, i)), proximo_cursor: p.proximo_cursor } };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: `${cfg.caminho}/:id`, acao: 'cadastros.ver',
      async executar(c, e) {
        return { corpo: ocultar(c, await carregar(c, R(c), idDe(e))) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: cfg.caminho, acao: cfg.editar, corpo: cfg.dados,
      async executar(c, e) {
        const r = R(c);
        const corpo = cfg.completar ? cfg.completar(e.corpo as Dict) : (e.corpo as Dict);
        const externo = typeof corpo.external_id === 'string' ? await cfg.repo(r).porExternalId(corpo.external_id) : null;
        if (externo) return { status: 200, corpo: ocultar(c, externo) }; // escrita idempotente (regra 4)
        // Guarda RD-0317 (ver domain/external-id.ts)
        exigir(await violacoesDe(violacaoExternalId(r, cfg.tabela, corpo.external_id)));
        cfg.campoRestrito?.(c.sessao, corpo, true);
        if (cfg.validar) exigir(await cfg.validar(r, corpo, null, c.agora));
        const padrao = cfg.padrao?.(r);
        if (padrao && corpo.padrao === true) await padrao.desmarcarPadrao(null);
        const criado = await cfg.repo(r).inserir(corpo as never);
        await cfg.emitir(c, r, criado, null);
        await aud(c, 'criar', criado.id, null, criado);
        return { status: 201, corpo: ocultar(c, criado) };
      },
    }),
    definirRota({
      metodo: 'PATCH', caminho: `${cfg.caminho}/:id`, acao: cfg.editar, corpo: cfg.atualizacao,
      async executar(c, e) {
        const r = R(c);
        const antes = await carregar(c, r, idDe(e));
        const parcial = cfg.completar ? cfg.completar(e.corpo as Dict, antes as unknown as Dict) : (e.corpo as Dict);
        // ADR 0010, item 3: preenchido, o external_id só muda pela troca controlada; para nulo, nunca
        const atual = extDe(antes);
        if (atual !== null && parcial.external_id !== undefined && parcial.external_id !== atual)
          exigir([violacao('RN-CORE-05', 'external_id', 'O external_id preenchido não muda por aqui: use a troca controlada (administrador)')]);
        // Guarda RD-0317 (ver domain/external-id.ts), só quando o valor muda
        if (parcial.external_id !== undefined && parcial.external_id !== atual) {
          exigir(await violacoesDe(violacaoExternalId(r, cfg.tabela, parcial.external_id)));
          // a adoção (nulo → valor) também não pode tomar o valor de outro registro
          const outro = await cfg.repo(r).porExternalId(parcial.external_id as string);
          if (outro && outro.id !== antes.id) throw erros.conflito('Já existe um cadastro com esse identificador externo');
        }
        cfg.campoRestrito?.(c.sessao, parcial, false);
        if (cfg.validar) exigir(await cfg.validar(r, { ...(antes as unknown as Dict), ...parcial }, parcial, c.agora));
        const padrao = cfg.padrao?.(r);
        if (padrao && parcial.padrao === true) await padrao.desmarcarPadrao(antes.id);
        const depois = await cfg.repo(r).atualizar(antes.id, parcial as never);
        if (!depois) throw erros.naoEncontrado('Registro');
        await cfg.emitir(c, r, depois, antes);
        await aud(c, 'alterar', depois.id, antes, depois);
        return { corpo: ocultar(c, depois) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: `${cfg.caminho}/:id/external-id`, acao: 'cadastros.external_id.trocar', corpo: TrocaExternalId,
      async executar(c, e) {
        const r = R(c);
        const antes = await carregar(c, r, idDe(e));
        const { external_id: novo, motivo } = e.corpo as { external_id: string; motivo: string };
        const anterior = extDe(antes);
        if (novo === anterior) return { corpo: ocultar(c, antes) }; // idempotente
        exigir(await violacoesDe(violacaoExternalId(r, cfg.tabela, novo))); // RD-0317
        const outro = await cfg.repo(r).porExternalId(novo);
        if (outro) throw erros.conflito('Já existe um cadastro com esse identificador externo');
        const depois = await cfg.repo(r).atualizar(antes.id, { external_id: novo } as unknown as Partial<D>);
        if (!depois) throw erros.naoEncontrado('Registro');
        await cfg.emitir(c, r, depois, antes);
        await c.auditar({ acao: `${cfg.entidade}.external_id.trocar`, entidade: cfg.entidade, entidade_id: depois.id, antes: { external_id: anterior }, depois: { external_id: novo, motivo } });
        return { corpo: ocultar(c, depois) };
      },
    }),
    definirRota({
      metodo: 'DELETE', caminho: `${cfg.caminho}/:id`, acao: cfg.editar,
      async executar(c, e) {
        const r = R(c);
        const antes = await carregar(c, r, idDe(e));
        if (cfg.inativavel) exigir(bloqueiosDeInativacao(cfg.inativavel, { padrao: (antes as unknown as Dict).padrao === true }));
        const depois = await cfg.repo(r).inativar(antes.id); // RN-CAD-08: inativa, nunca apaga
        if (!depois) throw erros.naoEncontrado('Registro');
        await cfg.emitir(c, r, depois, antes);
        await aud(c, 'inativar', depois.id, antes, depois);
        return { corpo: ocultar(c, depois) };
      },
    }),
  ];
}

/** Sub-recurso de um cadastro (endereços, contatos, unidades): lê com o escopo do pai e grava com a permissão dele. */
function rotasFilho<P extends Entidade, F extends { id: string }, D extends Dict>(
  deps: Dependencias,
  cfg: {
    caminho: string; // '/clientes/:id/enderecos'
    editar: Acao;
    dados: z.ZodType<D, z.ZodTypeDef, unknown>;
    atualizacao: z.ZodType<Partial<D>, z.ZodTypeDef, unknown>;
    pai(r: Repositorios): { obter(id: string): Promise<P | null> };
    filho(r: Repositorios): RepoFilho<F, D>;
    visivel?(r: Repositorios, sessao: Sessao, p: P): Promise<boolean>;
    /** Evento do pai refeito depois da escrita (o filho vai dentro do payload do pai). */
    aoGravar?(c: ContextoRota, r: Repositorios, pai: P, antes?: null): Promise<void>;
    validar?(r: Repositorios, dados: Dict, c: ContextoRota): Promise<Violacao[]>;
  },
): RotaModulo[] {
  const R = (c: ContextoRota) => deps.repositorios(c.tx);
  const pai = async (c: ContextoRota, r: Repositorios, id: string) => {
    const p = await cfg.pai(r).obter(id);
    if (!p || (cfg.visivel && !(await cfg.visivel(r, c.sessao, p)))) throw erros.naoEncontrado('Registro');
    return p;
  };
  const depois = async (c: ContextoRota, r: Repositorios, p: P) => {
    const atual = (await cfg.pai(r).obter(p.id)) ?? p;
    await cfg.aoGravar?.(c, r, atual);
  };
  return [
    definirRota({
      metodo: 'GET', caminho: cfg.caminho, acao: 'cadastros.ver',
      async executar(c, e) {
        const r = R(c);
        const p = await pai(c, r, idDe(e));
        return { corpo: { itens: await cfg.filho(r).listar(p.id) } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: cfg.caminho, acao: cfg.editar, corpo: cfg.dados,
      async executar(c, e) {
        const r = R(c);
        const p = await pai(c, r, idDe(e));
        if (cfg.validar) exigir(await cfg.validar(r, e.corpo, c));
        const criado = await cfg.filho(r).inserir(p.id, e.corpo);
        await depois(c, r, p);
        return { status: 201, corpo: criado };
      },
    }),
    definirRota({
      metodo: 'PATCH', caminho: `${cfg.caminho}/:filho_id`, acao: cfg.editar, corpo: cfg.atualizacao,
      async executar(c, e) {
        const r = R(c);
        const p = await pai(c, r, idDe(e));
        const atual = await cfg.filho(r).obter(p.id, idDe(e, 'filho_id'));
        if (!atual) throw erros.naoEncontrado('Registro');
        if (cfg.validar) exigir(await cfg.validar(r, { ...(atual as unknown as Dict), ...(e.corpo as Dict) }, c));
        const novo = await cfg.filho(r).atualizar(p.id, atual.id, e.corpo);
        if (!novo) throw erros.naoEncontrado('Registro');
        await depois(c, r, p);
        return { corpo: novo };
      },
    }),
    definirRota({
      metodo: 'DELETE', caminho: `${cfg.caminho}/:filho_id`, acao: cfg.editar,
      async executar(c, e) {
        const r = R(c);
        const p = await pai(c, r, idDe(e));
        const inativado = await cfg.filho(r).inativar(p.id, idDe(e, 'filho_id'));
        if (!inativado) throw erros.naoEncontrado('Registro');
        await depois(c, r, p);
        return { corpo: inativado };
      },
    }),
  ];
}

export function criarRotas(deps: Dependencias): RotaModulo[] {
  const R = (c: ContextoRota) => deps.repositorios(c.tx);
  const rotas: RotaModulo[] = [];

  // ---- Filiais (RF-CAD-08) ----
  rotas.push(...rotasCrud(deps, {
    tabela: 'filial', caminho: '/filiais', editar: 'cadastros.filial.editar', dados: FilialDados, atualizacao: FilialAtualizacao,
    entidade: 'filial', auditado: true, repo: (r) => r.filiais, emitir: emitirCom(eventoFilial),
    inativavel: 'filial', padrao: (r) => r.filiais,
    async validar(_r, f) {
      const end = f.endereco as FilialDados['endereco'];
      return validarFilial({
        uf: end.uf, municipio_ibge: end.municipio_ibge, ie: (f.ie as string | null) ?? null, emissora: f.emissora === true,
        nfe_serie: (f.nfe_serie as number | null) ?? null, nfe_numero_inicial: (f.nfe_numero_inicial as number | null) ?? null,
        crt: f.crt as FilialDados['crt'], regime_pis_cofins: (f.regime_pis_cofins as RegimePisCofins | null) ?? null,
      });
    },
  }));

  // ---- Clientes (RF-CAD-01) e a carteira do vendedor (D7) ----
  const clienteVisivel = async (r: Repositorios, s: Sessao, cli: Cliente): Promise<boolean> => {
    if (s.perfil !== 'vendedor') return true;
    const meus = await r.vendedores.idsDoUsuario(s.usuario_id);
    return cli.vendedor_id !== null && meus.includes(cli.vendedor_id);
  };
  rotas.push(...rotasCrud(deps, {
    tabela: 'cliente', caminho: '/clientes', editar: 'cadastros.cliente.editar', dados: ClienteDados, atualizacao: ClienteAtualizacao,
    entidade: 'cliente', auditado: false, camposAuditados: ['limite_credito_centavos'], repo: (r) => r.clientes, emitir: emitirCom(eventoCliente), inativavel: 'cliente',
    campoRestrito(s, corpo, criacao) {
      const mexe = criacao ? (corpo.limite_credito_centavos ?? 0) !== 0 : 'limite_credito_centavos' in corpo;
      if (mexe && !pode(s.perfil, 'cadastros.cliente.credito')) throw erros.perfilSemPermissao(); // limite de crédito: adm e gerente
    },
    async escopo(r, s) {
      const esc = escopoDaCarteira(s.perfil, s.perfil === 'vendedor' ? await r.vendedores.idsDoUsuario(s.usuario_id) : []);
      return esc.todos ? {} : { vendedor_ids: esc.vendedor_ids };
    },
    visivel: clienteVisivel,
    validar: (r, cli, parcial) => validarCliente(r, cli, parcial),
  }));
  rotas.push(...rotasFilho(deps, {
    caminho: '/clientes/:id/enderecos', editar: 'cadastros.cliente.editar', dados: EnderecoCliente, atualizacao: EnderecoCliente.partial(),
    pai: (r) => r.clientes, filho: (r) => r.clientes.enderecos, visivel: clienteVisivel, aoGravar: emitirCom(eventoCliente),
    validar: async (_r, d) => verificarMunicipioEndereco(d as { municipio_ibge: string; uf: string }, 'municipio_ibge'),
  }));
  rotas.push(...rotasFilho(deps, {
    caminho: '/clientes/:id/contatos', editar: 'cadastros.cliente.editar', dados: Contato, atualizacao: Contato.partial(),
    pai: (r) => r.clientes, filho: (r) => r.clientes.contatos, visivel: clienteVisivel,
  }));

  // ---- Produtos (RF-CAD-04, RN-CAD-04) ----
  rotas.push(...rotasCrud(deps, {
    tabela: 'produto', caminho: '/produtos', editar: 'cadastros.produto.editar', dados: ProdutoDados, atualizacao: ProdutoAtualizacao,
    entidade: 'produto', auditado: false, repo: (r) => r.produtos, emitir: emitirCom(eventoProduto),
    ocultar: (s, p) => (pode(s.perfil, 'cadastros.produto.editar') ? p : { ...p, custo_centavos: null }), // o custo não vai a vendedor nem a leitura
    async validar(r, p, parcial, agora) {
      if (parcial && !('ncm' in parcial) && !('cest' in parcial)) return [];
      const ncm = p.ncm as string;
      const cest = (p.cest as string | null) ?? null;
      const data = dataIso(agora);
      return validarFiscalProduto({
        ncm, cest, ncmVigente: await r.oficiais.ncmVigente(ncm, data), ncmExigeCest: await r.oficiais.ncmExigeCest(ncm, data),
        cestVigente: cest === null ? true : await r.oficiais.cestVigente(cest, data),
        cestCombinaComNcm: cest === null ? true : await r.oficiais.cestCombinaComNcm(cest, ncm, data),
      });
    },
  }));
  rotas.push(...rotasFilho(deps, {
    caminho: '/produtos/:id/unidades', editar: 'cadastros.produto.editar', dados: UnidadeDados, atualizacao: UnidadeDados.partial(),
    pai: (r) => r.produtos, filho: (r) => r.produtos.unidades, aoGravar: emitirCom(eventoProduto),
    // RN-CAD-17: fator fracionário só nas unidades KG e M (422 no campo `fator`)
    async validar(_r, d) {
      const v = violacaoFracao('fator', d.unidade as string, d.fator as number);
      return v ? [v] : [];
    },
  }));

  // ---- Tabelas de preço (RF-CAD-05, RN-CAD-06) ----
  rotas.push(...rotasCrud(deps, {
    tabela: 'tabela_preco', caminho: '/tabelas-preco', editar: 'cadastros.preco.editar', dados: TabelaPrecoDados, atualizacao: TabelaPrecoAtualizacao,
    entidade: 'tabela_preco', auditado: true, repo: (r) => r.tabelasPreco, inativavel: 'tabela_preco', padrao: (r) => r.tabelasPreco,
    /** O evento de preço é por item: mudou a vigência ou inativou a tabela, os itens vão de novo à outbox. */
    async emitir(c, r, t, antes) {
      await publicarPronto(c, comExternalIdAnterior(eventoTabelaPreco(t), t, antes)); // C-2: criação e alteração
      if (!antes || (antes.vigencia_inicio === t.vigencia_inicio && antes.vigencia_fim === t.vigencia_fim && antes.inativo === t.inativo)) return;
      await republicarItensDaTabela(c, r, t);
    },
    async validar(_r, t) {
      const vig = validarVigenciaTabela(t.vigencia_inicio as string, t.vigencia_fim as string | null);
      return vig.ok ? [] : [vig.violacao];
    },
  }));
  rotas.push(
    definirRota({
      metodo: 'GET', caminho: '/tabelas-preco/:id/itens', acao: 'cadastros.ver', consulta: PrecoItemConsulta,
      async executar(c, e) {
        const r = R(c);
        const t = await r.tabelasPreco.obter(idDe(e));
        if (!t) throw erros.naoEncontrado('Tabela de preço');
        return { corpo: await r.tabelasPreco.itens(t.id, e.consulta) };
      },
    }),
    definirRota({
      metodo: 'PUT', caminho: '/tabelas-preco/:id/itens', acao: 'cadastros.preco.editar', corpo: PrecoLote,
      async executar(c, e) {
        const r = R(c);
        const t = await r.tabelasPreco.obter(idDe(e));
        if (!t || t.inativo) throw erros.naoEncontrado('Tabela de preço');
        exigir(validarLotePreco(e.corpo.itens));
        const filiais = new Set<string>();
        const produtos = new Set<string>();
        for (const i of e.corpo.itens) { filiais.add(i.filial_id); produtos.add(i.produto_id); }
        const filiaisOk = await r.filiais.idsAtivos([...filiais]);
        if ([...filiais].some((f) => !filiaisOk.has(f))) throw erros.validacao({ filial_id: 'Filial inexistente' });
        const produtosOk = await r.produtos.idsAtivos([...produtos]);
        if ([...produtos].some((p) => !produtosOk.has(p))) throw erros.validacao({ produto_id: 'Produto inexistente' });
        const alterados = await r.tabelasPreco.gravarLote(t.id, e.corpo.itens);
        for (const i of alterados) await publicarPronto(c, eventoPreco(i, t));
        await c.auditar({ acao: 'tabela_preco.itens_lote', entidade: 'tabela_preco', entidade_id: t.id, depois: { recebidos: e.corpo.itens.length, alterados: alterados.length } });
        return { corpo: { recebidos: e.corpo.itens.length, alterados: alterados.length } };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/precos/vigente', acao: 'cadastros.ver', consulta: PrecoVigenteConsulta,
      async executar(c, e) {
        const r = R(c);
        const q = e.consulta;
        const res = await precosVigentesDe(r, { tabela_preco_id: q.tabela_preco_id, filial_id: q.filial_id, produto_ids: [q.produto_id], data: q.data ?? dataIso(c.agora) });
        const unico = res?.[0];
        if (!unico) throw erros.naoEncontrado('Tabela de preço');
        if (!unico.ok) throw new ErroApi(404, unico.motivo === 'sem_preco' ? 'SEM_PRECO' : 'FORA_DA_VIGENCIA', unico.motivo === 'sem_preco' ? 'Sem preço para o produto na tabela' : 'Tabela fora da vigência');
        return { corpo: unico.preco };
      },
    }),
  );

  // ---- Estoque (RF-CAD-06, RN-CAD-07) ----
  rotas.push(
    definirRota({
      metodo: 'GET', caminho: '/estoque', acao: 'cadastros.ver', consulta: EstoqueConsulta,
      async executar(c, e) {
        const p = await R(c).estoque.listar(e.consulta);
        return { corpo: { itens: p.itens, proximo_cursor: p.proximo_cursor } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/estoque/movimentos', acao: 'cadastros.estoque.movimentar', corpo: MovimentoEstoque,
      async executar(c, e) {
        const r = R(c);
        const m = e.corpo;
        if (!(await r.filiais.obter(m.filial_id))) throw erros.validacao({ filial_id: 'Filial inexistente' });
        const produto = await r.produtos.obter(m.produto_id);
        if (!produto) throw erros.validacao({ produto_id: 'Produto inexistente' });
        const fracao = violacaoFracao('quantidade', produto.unidade_comercial, m.quantidade); // RN-CAD-17
        if (fracao) throw erroDeViolacoes([fracao]);
        if (m.external_id) {
          const ja = await r.estoque.movimentoPorExternalId(m.external_id);
          if (ja) {
            const [s] = await r.estoque.saldos({ filial_id: m.filial_id, produto_id: m.produto_id });
            return { status: 200, corpo: { movimento_id: ja.id, filial_id: m.filial_id, produto_id: m.produto_id, quantidade: s?.quantidade ?? 0 } };
          }
        }
        const saldo = await r.estoque.saldoParaAtualizar(m.filial_id, m.produto_id);
        const res = aplicarMovimento({ saldo, tipo: m.tipo, quantidade: m.quantidade, podeNegativo: pode(c.sessao.perfil, 'cadastros.estoque.negativo') });
        if (!res.ok) throw erroDeViolacoes([res.violacao]);
        const mov = await r.estoque.gravarMovimento({ ...m, usuario_id: c.sessao.usuario_id }, res.saldo);
        await publicarPronto(c, eventoEstoque(agregadoEstoque(m.filial_id, m.produto_id), { filial_id: m.filial_id, produto_id: m.produto_id, quantidade: res.saldo }));
        return { status: 201, corpo: { movimento_id: mov.id, filial_id: m.filial_id, produto_id: m.produto_id, quantidade: res.saldo } };
      },
    }),
  );

  // ---- Condições de pagamento (RF-CAD-09) ----
  rotas.push(...rotasCrud(deps, {
    tabela: 'condicao_pagamento', caminho: '/condicoes-pagamento', editar: 'cadastros.condicao_pagamento.editar', dados: CondicaoPagamentoDados, atualizacao: CondicaoPagamentoAtualizacao,
    entidade: 'condicao_pagamento', auditado: false, repo: (r) => r.condicoesPagamento, emitir: emitirCom((_r, x: Entidade) => eventoSimples('cadastros.condicao_pagamento.alterada@1', x)),
    // RN-CAD-15: os dias são sempre digitados; `parcelas_cartao` (legado) é derivada dos prazos. O PATCH valida o cadastro MESCLADO (prazo médio ausente no PATCH mantém o gravado).
    completar: (corpo, antes) => completarParcelasCartao(corpo as never, antes as never) as Dict,
    validar: async (_r, c) => validarCondicaoPagamento({
      forma_tpag: c.forma_tpag as string, prazos_dias: c.prazos_dias as number[], parcelas_cartao: (c.parcelas_cartao ?? null) as number | null,
      prazo_medio_dias: (c.prazo_medio_dias ?? null) as number | null, descricao: c.descricao as string,
    }),
  }));
  // RN-CAD-09: comando do administrador (por tenant): desativa as condições ligadas a forma recusada e trata o cartão sem parcelas (preenche ou desativa). Idempotente.
  rotas.push(definirRota({
    metodo: 'POST', caminho: '/condicoes-pagamento/desativar-formas-recusadas', acao: 'cadastros.condicao_pagamento.desativar_recusadas', // só o administrador
    async executar(c) {
      const r = R(c);
      const recusadas = await desativarCondicoesRecusadas(c, r, (await r.carga.condicoesAtivasDeFormaRecusada()).filter((x) => !x.inativo));
      const cartao = await tratarCartaoSemParcelas(c, r, await r.carga.condicoesAtivasCartaoSemParcelas());
      return { corpo: { desativadas: { total: recusadas.length + cartao.desativadas.total, ids: [...recusadas, ...cartao.desativadas.ids] }, preenchidas: cartao.preenchidas } };
    },
  }));

  // ---- Vendedores (RF-CAD-07) e transferência de carteira (D7) ----
  rotas.push(...rotasCrud(deps, {
    tabela: 'vendedor', caminho: '/vendedores', editar: 'cadastros.vendedor.editar', dados: VendedorDados, atualizacao: VendedorAtualizacao,
    entidade: 'vendedor', auditado: false, repo: (r) => r.vendedores, emitir: emitirCom((_r, x: Entidade) => eventoSimples('cadastros.vendedor.alterado@1', x)),
    validar: async (r, v) => requisitoFilial(r, v.filial_id as string, 'filial_id'),
  }));
  rotas.push(definirRota({
    metodo: 'POST', caminho: '/carteira/transferir', acao: 'cadastros.carteira.transferir', corpo: TransferenciaCarteira,
    async executar(c, e) {
      const r = R(c);
      const { de, para } = e.corpo;
      for (const [campo, id] of [['de', de], ['para', para]] as const) {
        const v = await r.vendedores.obter(id);
        if (!v || v.inativo) throw erros.validacao({ [campo]: 'Vendedor inexistente ou inativo' });
      }
      const plano = planejarTransferencia({ de, para, cliente_ids: e.corpo.cliente_ids, carteira_de: await r.clientes.idsDaCarteira(de) });
      if (!plano.ok) throw erroDeViolacoes([plano.violacao]);
      await r.clientes.transferir(para, plano.cliente_ids);
      for (const id of plano.cliente_ids) {
        const cli = await r.clientes.obter(id);
        if (cli) await emitirCom(eventoCliente)(c, r, cli);
      }
      await publicar(c, 'cadastros.carteira.alterada@1', para, { de, para, cliente_ids: plano.cliente_ids });
      await c.auditar({ acao: 'carteira.transferir', entidade: 'vendedor', entidade_id: para, depois: { de, para, total: plano.cliente_ids.length } });
      return { corpo: { de, para, total: plano.cliente_ids.length, cliente_ids: plano.cliente_ids } };
    },
  }));

  // ---- Consultas externas (RF-CAD-02/03, RN-CAD-05): só sugestão, nunca gravam cadastro ----
  rotas.push(
    definirRota({
      metodo: 'GET', caminho: '/consultas/cnpj/:cnpj', acao: 'cadastros.consulta.externa',
      async executar(c, e) {
        const r = await consultarCnpj({ cnpj: e.params.cnpj ?? '', agora: c.agora, repos: R(c), fontes: deps.fontes.cnpj });
        if (!r.ok) throw erroDeViolacoes([r.violacao]);
        return { corpo: r.resultado };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/consultas/cep/:cep', acao: 'cadastros.consulta.externa',
      async executar(c, e) {
        const cep = (e.params.cep ?? '').replace(/\D/g, '');
        if (!/^\d{8}$/.test(cep)) throw erros.validacao({ cep: 'CEP deve ter 8 dígitos' });
        return {
          corpo: await sugestaoComCache({
            tipo: 'cep', chave: cep, agora: c.agora, repo: R(c).consultaExterna, fontes: deps.fontes.cep,
            montar: (fonte, bruto) => sugestaoCep(fonte, bruto, cep),
          }),
        };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/consultas/ie', acao: 'cadastros.consulta.externa', corpo: ConsultaIeEntrada,
      async executar(c, e) {
        const r = R(c);
        const { filial_id, uf, documento } = e.corpo;
        if (cpfValido(documento)) throw erros.validacao({ documento: 'A consulta de IE não aceita CPF' });
        if (!/^[0-9A-Z]{2,14}$/.test(documento)) throw erros.validacao({ documento: 'Informe a IE ou o CNPJ' });
        if (!(await r.filiais.obter(filial_id))) throw erros.validacao({ filial_id: 'Filial inexistente' });
        if (!(await deps.certificados.filialTemA1Valido(c.tx, filial_id, c.agora))) {
          throw erros.regra('RN-CORE-06', 'A filial não tem certificado A1 válido para consultar a SEFAZ', { filial_id: 'Sem A1 válido' });
        }
        const trabalho = await c.enfileirar({ tipo: TRABALHO_CONSULTAR_IE, payload: { filial_id, uf, documento } });
        await r.consultaExterna.gravar({
          tipo: 'ie', chave: `${uf}:${documento}`, resposta: { estado: 'pendente' }, fonte: 'sefaz', consultado_em: c.agora, expira_em: c.agora, external_id: trabalho.id,
        });
        return { status: 202, corpo: { id: trabalho.id, estado: 'pendente', resultado: null } };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/consultas/ie/:id', acao: 'cadastros.consulta.externa',
      async executar(c, e) {
        const id = idDe(e);
        const g = await R(c).consultaExterna.porExternalId('ie', id);
        if (!g) throw erros.naoEncontrado('Consulta');
        const estado = (g.resposta.estado as string | undefined) ?? 'concluida';
        return { corpo: { id, estado, resultado: estado === 'concluida' ? { ...(g.resposta.resultado as Dict | undefined), consultado_em: g.consultado_em.toISOString() } : null } };
      },
    }),
  );

  // ---- Tabelas oficiais (RF-CAD-10): só leitura ----
  rotas.push(definirRota({
    metodo: 'GET', caminho: '/oficiais/:tabela', acao: 'cadastros.ver', consulta: OficialConsulta,
    async executar(c, e) {
      const tabela = TABELAS_OFICIAIS.find((t) => t === e.params.tabela);
      if (!tabela) throw erros.naoEncontrado('Tabela oficial');
      return { corpo: await R(c).oficiais.listar(tabela, e.consulta) };
    },
  }));

  rotas.push(rotaCarga(deps), rotaModeloCarga());

  return rotas;
}
