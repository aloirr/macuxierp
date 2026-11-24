/**
 * Rotas do portal `/config` para a carga de cadastros (T-0058, v0.3.5a; ADR 0013, adendo de 23/11/2026): `transacoes:
 * 'por_etapa'`, sem Idempotency-Key (a concorrência é o MXC01 do `portal_carga_iniciar`; a carga é tudo ou nada na tx do tenant).
 *
 * `gravar`, uma transação de cada vez:
 *  1. `comPlataforma`: `cadastros.portal_carga_iniciar` (sessão, empresa ativa, licença, MXC01, auditoria do superadmin);
 *  2. `comTenant(:id)`: `gravarCargaPortal` (executarCarga + planoSubstituicao + inativarEmLote + eventos na outbox);
 *  3. `comPlataforma`: `cadastros.portal_carga_concluir` com `concluida` ou `falhou` (também quando a etapa 2 falha: o
 *     erro original é o que sobe).
 * `validar`: lê a situação (confere sessão, empresa e licença) e roda o `validarCargaPortal` no tenant; não abre execução.
 *
 * O `executarCarga` pede um `ContextoRota`: o do portal tem o superadmin como autor, perfil `administrador` (a regra de
 * perfil por entidade é do BKO) e `auditar` vazio (a auditoria do portal é a das tx1 e tx3, pelas funções do banco).
 * Nada de valor de célula nem dado pessoal em erro ou auditoria: só contagens.
 */
import {
  CADASTROS_CARGA_PORTAL, CAMPO_ARQUIVO_CARGA_PORTAL, situacaoCarga, SituacaoCargasPlataforma, CadastroCargaPortal, GravarCargaPlataformaEntrada, MAX_BYTES_ARQUIVO_CARGA_PORTAL, MENSAGENS_CARGA_PORTAL,
  MENSAGEM_SUBSTITUIR_NAO_PERMITIDO, ModoCargaQuery, TEMPO_MAXIMO_ROTA_MS, CAMINHOS_CARGAS_PLATAFORMA, criarEvento, definirPluginPlataforma,
  definirRotaPlataforma, erros, nomeErrosCarga, nomeModeloCarga, paraCsv, respostaCsv, substituirPermitido, type ArquivoRecebido, type ContextoPlataformaPorEtapa, type ContextoRota, type EntradaChamada,
  type ModoGravarCarga, type Outbox, type PluginPlataforma, type Transacao,
} from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { modeloCsv } from '../domain';
import { EntidadeCarga } from '../contracts';
import { errosCargaPortal, exigirFraseSubstituir, gravarCargaPortal, validarCargaPortal } from './carga-portal';
import type { Dependencias } from './portas';

export interface DependenciasPlataformaCadastros {
  /** As mesmas do plugin do BKO (`repositoriosSql`, `fontesHttp()`, `certificados` e o `usoCadastros`). */
  deps: Dependencias;
  /** Outbox da API: os eventos `cadastros.*.alterado@1` saem na transação do tenant, como no BKO. */
  outbox: Outbox;
}

const CamposCarga = z.object({ frase: z.string().optional() });
const MULTIPART = {
  arquivos: [{ campo: CAMPO_ARQUIVO_CARGA_PORTAL, tamanhoMaximo: MAX_BYTES_ARQUIVO_CARGA_PORTAL, quantidadeMaxima: 1 }],
  tamanhoMaximoTotal: MAX_BYTES_ARQUIVO_CARGA_PORTAL,
};

/** `:cadastro` da rota (400 `VALIDACAO` fora dos 8) e `substituir_tudo` só onde o SDK permite (400 no campo `modo`). */
function cadastroEModo(params: Record<string, string>, modo: ModoGravarCarga): CadastroCargaPortal {
  const c = CadastroCargaPortal.safeParse(params.cadastro);
  if (!c.success) throw erros.validacao({ cadastro: 'Cadastro desconhecido' });
  if (modo === 'substituir_tudo' && !substituirPermitido(c.data)) throw erros.validacao({ modo: MENSAGEM_SUBSTITUIR_NAO_PERMITIDO });
  return c.data;
}

/** O arquivo vem do multipart; a rota só aceita um (campo `arquivo`). */
function arquivoDaEntrada(e: EntradaChamada<unknown, unknown>): ArquivoRecebido {
  const arquivo = (e.todosArquivos?.[CAMPO_ARQUIVO_CARGA_PORTAL] ?? [])[0];
  if (!arquivo) throw erros.validacao({ [CAMPO_ARQUIVO_CARGA_PORTAL]: 'arquivo obrigatório' });
  return arquivo;
}

/** `ContextoRota` do portal sobre a transação do tenant (ver o cabeçalho). */
function contextoDoPortal(c: ContextoPlataformaPorEtapa, tenant: string, tx: Transacao, outbox: Outbox): ContextoRota {
  return {
    sessao: { usuario_id: c.sessao.superadmin_id, tenant_id: tenant, perfil: 'administrador', filial_ids: [] },
    tx, request_id: c.request_id, agora: c.agora,
    publicar: async (ev) => {
      const { versao: _ignorada, ...dados } = ev;
      const evento = criarEvento({ ...dados, tenant_id: tenant, ator: c.sessao.superadmin_id, request_id: c.request_id }, c.agora);
      return { ...evento, versao: await outbox.gravar(tx, evento) };
    },
    auditar: async () => undefined, // exigido pelo ContextoRota; a auditoria da carga é a do portal_carga_concluir (o gravarCargaPortal não audita)
    enfileirar: async () => { throw new Error('carga do portal: sem trabalho em fila'); },
  };
}

/** O banco devolve a situação crua (`ativos`, `erros`, `ultima_carga`); número, situação, dependência e `liberado` saem das funções puras do SDK. */
const SituacaoCrua = z.object({
  empresa_id: z.string(), modulo_licenciado: z.boolean(),
  cadastros: z.array(z.object({ cadastro: CadastroCargaPortal, ativos: z.number().int().min(0), erros: z.number().int().min(0), ultima_carga: z.object({ em: z.string(), quantidade: z.number().int().min(0) }).nullable() })),
});
/**
 * Resposta da aba, no cálculo do SDK: `situacaoCarga` deriva a situação (`liberado` é sempre true desde a v0.3.6);
 * o `SituacaoCargasPlataforma` do SDK valida a ordem, o número, e o `opcional`. A montagem é pelo nome do
 * cadastro (o retorno do banco pode vir fora de ordem).
 */
export function situacaoDaAba(bruta: unknown): SituacaoCargasPlataforma {
  const r = SituacaoCrua.parse(bruta);
  const porNome = new Map(r.cadastros.map((x) => [x.cadastro, x]));
  const linhas = CADASTROS_CARGA_PORTAL.map((def) => {
    const x = porNome.get(def.cadastro);
    if (!x) throw new RangeError(`situacaoDaAba: o banco não devolveu o cadastro "${def.cadastro}"`);
    return { def, x, situacao: situacaoCarga(x) };
  });
  return SituacaoCargasPlataforma.parse({
    empresa_id: r.empresa_id, modulo_licenciado: r.modulo_licenciado,
    cadastros: linhas.map(({ def, x, situacao }) => ({
      numero: def.numero, cadastro: def.cadastro, situacao, erros: x.erros, ultima_carga: x.ultima_carga, liberado: true, opcional: def.opcional,
    })),
  });
}

type Resultado = 'concluida' | 'falhou';

export function criarPluginPlataformaCadastros(d: DependenciasPlataformaCadastros): PluginPlataforma {
  const concluir = (c: ContextoPlataformaPorEtapa, tenant: string, execucao: string, r: Resultado, n: { gravadas: number; com_erro: number; inativadas: number | null; enderecos_inativados: number | null }) =>
    c.comPlataforma((tx) => tx.consultar('SELECT cadastros.portal_carga_concluir($1, $2, $3, $4, $5, $6, $7, $8)', [tenant, execucao, r, n.gravadas, n.com_erro, n.inativadas, c.request_id, n.enderecos_inativados]));

  return definirPluginPlataforma([
    // RF-CAD-11: as 8 linhas da aba Cargas (a função do banco confere sessão, empresa e licença); o Zod do SDK fecha o formato.
    definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'GET', caminho: CAMINHOS_CARGAS_PLATAFORMA.situacao, acao: 'plataforma.cadastros.carga',
      async executar(c, e) {
        const [linha] = await c.comPlataforma((tx) => tx.consultar<{ situacao: unknown }>('SELECT cadastros.portal_carga_situacao($1) AS situacao', [e.params.id]));
        return { corpo: situacaoDaAba(linha?.situacao) };
      },
    }),
    // RF-CAD-11: o CSV modelo (só o cabeçalho), o mesmo do BKO. Cadastro fora dos 10 é 404.
    definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'GET', caminho: CAMINHOS_CARGAS_PLATAFORMA.modelo, acao: 'plataforma.cadastros.carga',
      async executar(_c, e) {
        const k = CadastroCargaPortal.safeParse(e.params.cadastro);
        if (!k.success) throw erros.naoEncontrado('Modelo');
        const entidade = EntidadeCarga.safeParse(k.data);
        if (!entidade.success) throw erros.naoEncontrado('Modelo');
        return respostaCsv(nomeModeloCarga(k.data), modeloCsv(entidade.data));
      },
    }),
    // RF-CAD-11: valida o mesmo arquivo (nada fica guardado) e devolve o CSV dos erros do relatório (com o teto MAX_ERROS_RELATORIO), sem o valor da célula (D9).
    definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'POST', caminho: CAMINHOS_CARGAS_PLATAFORMA.erros, acao: 'plataforma.cadastros.carga',
      corpo: CamposCarga, consulta: ModoCargaQuery, multipart: MULTIPART, tempoMaximoMs: TEMPO_MAXIMO_ROTA_MS,
      async executar(c, e) {
        const tenant = e.params.id!;
        const cadastro = cadastroEModo(e.params, e.consulta.modo);
        const arquivo = arquivoDaEntrada(e);
        const [situacao] = await c.comPlataforma((tx) => tx.consultar<{ ok: boolean }>('SELECT (cadastros.portal_carga_situacao($1)->>\'modulo_licenciado\')::boolean AS ok', [tenant]));
        if (!situacao?.ok) throw erros.regra('RN-CORE-02', MENSAGENS_CARGA_PORTAL.semLicenca, undefined, { codigo: 'modulo_desligado' });
        const lista = await c.comTenant(tenant, (tx) => errosCargaPortal(d.deps, contextoDoPortal(c, tenant, tx, d.outbox), { cadastro, modo: e.consulta.modo, arquivo }));
        const csv = paraCsv(
          [
            { titulo: 'linha', valor: (x: (typeof lista)[number]) => x.linha ?? '' }, { titulo: 'campo', valor: (x) => x.campo ?? '' },
            { titulo: 'codigo', valor: (x) => x.codigo }, { titulo: 'motivo', valor: (x) => x.motivo },
          ],
          lista,
        );
        return respostaCsv(nomeErrosCarga(cadastro), csv);
      },
    }),
    definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'POST', caminho: CAMINHOS_CARGAS_PLATAFORMA.validar, acao: 'plataforma.cadastros.carga',
      corpo: CamposCarga, consulta: ModoCargaQuery, multipart: MULTIPART, tempoMaximoMs: TEMPO_MAXIMO_ROTA_MS,
      async executar(c, e) {
        const tenant = e.params.id!;
        const cadastro = cadastroEModo(e.params, e.consulta.modo);
        const arquivo = arquivoDaEntrada(e);
        // Etapa de plataforma (sessão, empresa visível, licença): é ela que libera o `comTenant`. Não abre execução.
        const [situacao] = await c.comPlataforma((tx) => tx.consultar<{ ok: boolean }>('SELECT (cadastros.portal_carga_situacao($1)->>\'modulo_licenciado\')::boolean AS ok', [tenant]));
        if (!situacao?.ok) throw erros.regra('RN-CORE-02', MENSAGENS_CARGA_PORTAL.semLicenca, undefined, { codigo: 'modulo_desligado' });
        const corpo = await c.comTenant(tenant, (tx) => validarCargaPortal(d.deps, contextoDoPortal(c, tenant, tx, d.outbox), { cadastro, modo: e.consulta.modo, arquivo }));
        return { corpo };
      },
    }),
    definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'POST', caminho: CAMINHOS_CARGAS_PLATAFORMA.gravar, acao: 'plataforma.cadastros.carga',
      corpo: CamposCarga, consulta: ModoCargaQuery, multipart: MULTIPART, tempoMaximoMs: TEMPO_MAXIMO_ROTA_MS,
      async executar(c, e) {
        const tenant = e.params.id!;
        const modo = e.consulta.modo;
        const cadastro = cadastroEModo(e.params, modo);
        const arquivo = arquivoDaEntrada(e);
        // RN-CAD-10: frase errada é 422 e nada é aberto; só então vale o contrato (que a revalida em 400, sem nunca chegar a ele).
        if (modo === 'substituir_tudo') exigirFraseSubstituir(e.corpo.frase);
        const entrada = GravarCargaPlataformaEntrada.parse({ cadastro, modo, ...(e.corpo.frase !== undefined ? { frase: e.corpo.frase } : {}) });

        const [aberta] = await c.comPlataforma((tx) =>
          tx.consultar<{ id: string }>('SELECT cadastros.portal_carga_iniciar($1, $2, $3, $4) AS id', [tenant, entrada.cadastro, entrada.modo, c.request_id]));
        if (!aberta) throw new Error('portal_carga_iniciar não devolveu a execução');
        let resposta;
        try {
          resposta = await c.comTenant(tenant, (tx) =>
            gravarCargaPortal(d.deps, contextoDoPortal(c, tenant, tx, d.outbox), { cadastro: entrada.cadastro, modo: entrada.modo, frase: entrada.frase, arquivo }));
        } catch (erro) {
          // A execução não pode ficar aberta: o erro da etapa do tenant é o que sobe (se o concluir também falhar, ela vira abandonada em 15 min).
          await concluir(c, tenant, aberta.id, 'falhou', { gravadas: 0, com_erro: 0, inativadas: null, enderecos_inativados: null }).catch(() => undefined);
          throw erro;
        }
        try {
          await concluir(c, tenant, aberta.id, 'concluida', { gravadas: resposta.gravadas, com_erro: resposta.com_erro, inativadas: resposta.inativadas ?? null, enderecos_inativados: resposta.enderecos_inativados ?? null });
        } catch (erro) {
          // A carga do tenant JÁ foi commitada: o registro técnico (sem dado pessoal) diz qual execução ficou aberta (vira abandonada em 15 min).
          console.error(JSON.stringify({ nivel: 'error', evento: 'cadastros.portal_carga.concluir_falhou', request_id: c.request_id, execucao: aberta.id }));
          throw erro;
        }
        return { corpo: resposta };
      },
    }),
  ]);
}
