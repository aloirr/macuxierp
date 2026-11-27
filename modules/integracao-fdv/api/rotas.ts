/**
 * Rotas `/v1/integracao-fdv`, só leitura (RF-INF-04; ADR 0013 seção 6). Perfil, tenant e licença do módulo são checados pela API
 * antes do `executar` (RN-CORE-02; sem licença, 403 `MODULO_INATIVO`). Sempre `tenant_id` explícito, sem `SELECT *`; a `credencial`
 * nunca lê `chave_cifrada`.
 *
 * A credencial, a configuração do envio, a carga completa e o retomar saíram daqui (T-0056): são do superadmin, no portal
 * `/config` (`plugin de plataforma`, `plataforma.ts`); as cinco rotas de escrita antigas respondem 404. O tenant vê só
 * `GET /status` (ligada ou desligada por cadastro, último envio e falha), o monitor, a lista de lotes (e o CSV) e os erros por linha.
 *
 * Regra da agenda (vale para o portal, via funções `portal_*`): o app só ADIANTA `proximo*_em`; quem adia é o worker.
 */
import { ConsultaClientesRecebidosFdv, LIMITE_ERROS_LOG_FDV, LIMITE_RECEBIDOS_LOG_FDV, csvDaLista, definirRota, erros, fusoDaRota, type RotaModulo, type SituacaoClienteRecebidoFdv } from '@macuxierp/platform-sdk';
import { ConsultaPaginada, paraCsv, respostaCsv, type ColunaCsv } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import { ENTIDADE_COM_RECEBIDOS_NO_LOG, itemDoLogTenant, montarLogTenant } from '../domain';
import { NOME_CSV_RECEBIDOS_LOG, csvDeRecebidosLog, nomeDoCsvDoLog, textoRecebidosCortados } from '../web/log';
import { paginaLotes, paginaLotesNoFuso } from '../web/paginas';
import { MAXIMO_LINHAS_CSV, contarClientesRecebidos, lerLinhasClientesRecebidos, lerRecebidosParaExportar, listarClientesRecebidos } from './clientes-recebidos';
import { entidadeDaRota, lerInsumosLog } from './operacao';
import { lerMonitor, listarErrosDoLote, listarLotes, loteExiste } from './monitor';
import { lerStatus } from './status';

const Uuid = z.string().uuid();

const ParamUuid = (valor: string | undefined, campo: string): string => {
  const u = Uuid.safeParse(valor);
  if (!u.success) throw erros.validacao({ [campo]: 'Identificador inválido' });
  return u.data;
};

/** Caminhos do Log, relativos ao prefixo `/v1/integracao-fdv`; o teste prova que batem com `CAMINHOS_INTEGRACAO_FDV_TENANT` do SDK. */
export const CAMINHO_LOG = '/entidades/:entidade/log';
export const CAMINHO_LOG_CSV = '/entidades/:entidade/log.csv';

/**
 * CSV cortado no teto (`MAXIMO_LINHAS_CSV`): o aviso vai na última linha e o cabeçalho `x-linhas-cortadas` traz a quantidade de linhas que ficaram de fora.
 */
function csvCortado(nome: string, csv: string, aviso: string, cortadas: number): ReturnType<typeof respostaCsv> {
  const r = respostaCsv(nome, `${csv}${aviso}\r\n`);
  return { ...r, cabecalhos: { ...r.cabecalhos, 'x-linhas-cortadas': String(cortadas) } };
}

/** "Baixar erros (.csv)": as colunas do `LogCadastroFdvTenant.erros`, na ordem da tela. */
const COLUNAS_CSV_LOG: readonly ColunaCsv<ReturnType<typeof itemDoLogTenant>>[] = [
  { titulo: 'Registro', valor: (l) => l.registro_external_id },
  { titulo: 'Nome', valor: (l) => l.nome_curto },
  { titulo: 'Campo', valor: (l) => l.campo },
  { titulo: 'Código do erro', valor: (l) => l.codigo },
  { titulo: 'Motivo', valor: (l) => l.motivo_texto },
  { titulo: 'O que fazer', valor: (l) => l.acao_texto },
  { titulo: 'Corrigir em', valor: (l) => l.corrigir_href },
];

export function criarRotas(): RotaModulo[] {
  const tenant = (c: { sessao: { tenant_id: string } }): string => c.sessao.tenant_id;

  return [
    definirRota({
      metodo: 'GET', caminho: '/monitor', acao: 'integracao-fdv.ver',
      async executar(c) {
        return { corpo: await lerMonitor(c.tx, tenant(c)) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/status', acao: 'integracao-fdv.ver',
      async executar(c) {
        return { corpo: await lerStatus(c.tx, tenant(c)) };
      },
    }),
    // Log por cadastro do BKO (T-0086 §4): completo (registro, nome curto, motivo e ação do catálogo). O `/config` tem o seu, só com códigos.
    definirRota({
      metodo: 'GET', caminho: CAMINHO_LOG, acao: 'integracao-fdv.ver',
      async executar(c, e) {
        const entidade = entidadeDaRota(e.params.entidade);
        const i = await lerInsumosLog(c.tx, tenant(c), entidade, LIMITE_ERROS_LOG_FDV);
        // RN-INF-09: na entidade 'cliente' o Log leva os pré-cadastros recebidos (mesma transação e tenant; documento só mascarado).
        const recebidos = entidade === ENTIDADE_COM_RECEBIDOS_NO_LOG
          ? { linhas: await lerLinhasClientesRecebidos(c.tx, tenant(c), { limite: LIMITE_RECEBIDOS_LOG_FDV }), totalNoBanco: await contarClientesRecebidos(c.tx, tenant(c)) }
          : undefined;
        return { corpo: montarLogTenant({ entidade, lidoEm: c.agora, envios: i.envios, erros: i.erros, totalErros: i.total_erros, motivo: i.motivo?.motivo ?? null, recebidos }) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: CAMINHO_LOG_CSV, acao: 'integracao-fdv.ver',
      async executar(c, e) {
        const entidade = entidadeDaRota(e.params.entidade);
        const i = await lerInsumosLog(c.tx, tenant(c), entidade, MAXIMO_LINHAS_CSV);
        const csv = paraCsv(COLUNAS_CSV_LOG, i.erros.map(itemDoLogTenant));
        if (i.total_erros <= i.erros.length) return respostaCsv(nomeDoCsvDoLog(entidade), csv);
        const aviso = `Aviso: arquivo cortado em ${i.erros.length} de ${i.total_erros} erros abertos. Corrija estes e baixe de novo.`;
        return csvCortado(nomeDoCsvDoLog(entidade), csv, aviso, i.total_erros - i.erros.length);
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/lotes', acao: 'integracao-fdv.ver', consulta: paginaLotes.consulta,
      async executar(c, e) {
        const q = e.consulta as { entidade?: string; estado?: string; cursor?: string; limite: number };
        return { corpo: await listarLotes(c.tx, tenant(c), q) };
      },
    }),
    // Caminho fixo antes de `/lotes/:id/erros` (tamanhos diferentes, mas mantém a ordem de leitura).
    definirRota({
      metodo: 'GET', caminho: '/lotes/exportar', acao: 'integracao-fdv.ver', consulta: paginaLotes.consulta,
      async executar(c, e) {
        const { entidade, estado } = e.consulta as { entidade?: string; estado?: string };
        const p = await listarLotes(c.tx, tenant(c), { entidade, estado, limite: MAXIMO_LINHAS_CSV });
        return csvDaLista(paginaLotesNoFuso(fusoDaRota(c)), c.sessao.perfil, p.itens);
      },
    }),
    // T-0059 §5.5: Log do cadastro de cliente (RN-INF-09) e rota /clientes-recebidos. Documento só mascarado; o payload nunca é lido.
    definirRota({
      metodo: 'GET', caminho: '/clientes-recebidos', acao: 'integracao-fdv.ver', consulta: ConsultaClientesRecebidosFdv,
      async executar(c, e) {
        const q = e.consulta as { situacao?: SituacaoClienteRecebidoFdv; cursor?: string; limite: number };
        return { corpo: await listarClientesRecebidos(c.tx, tenant(c), q) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/clientes-recebidos/exportar', acao: 'integracao-fdv.ver', consulta: ConsultaClientesRecebidosFdv,
      async executar(c, e) {
        const { situacao } = e.consulta as { situacao?: SituacaoClienteRecebidoFdv };
        const p = await lerRecebidosParaExportar(c.tx, tenant(c), { situacao });
        const csv = csvDeRecebidosLog(p.itens, fusoDaRota(c));
        if (!p.cortado) return respostaCsv(NOME_CSV_RECEBIDOS_LOG, csv);
        const total = await contarClientesRecebidos(c.tx, tenant(c), situacao);
        return csvCortado(NOME_CSV_RECEBIDOS_LOG, csv, textoRecebidosCortados(p.itens.length), Math.max(total - p.itens.length, 1));
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/lotes/:id/erros', acao: 'integracao-fdv.ver', consulta: ConsultaPaginada,
      async executar(c, e) {
        const id = ParamUuid(e.params.id, 'id');
        if (!(await loteExiste(c.tx, tenant(c), id))) throw erros.naoEncontrado('Envio');
        return { corpo: await listarErrosDoLote(c.tx, tenant(c), id, e.consulta as { cursor?: string; limite: number }) };
      },
    }),
  ];
}
