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
import { CAMINHOS_INTEGRACAO_FDV_TENANT, EntidadeEnvioFdv, LIMITE_ERROS_LOG_FDV, csvDaLista, definirRota, erros, type RotaModulo } from '@macuxierp/platform-sdk';
import { ConsultaPaginada, paraCsv, respostaCsv, type ColunaCsv } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import { itemDoLogTenant, montarLogTenant } from '../domain';
import { paginaLotes } from '../web/paginas';
import { lerInsumosLog } from './operacao';
import { lerMonitor, listarErrosDoLote, listarLotes, loteExiste } from './monitor';
import { lerStatus } from './status';

/** Máximo de linhas do CSV dos lotes. */
const MAXIMO_LINHAS_CSV = 10_000;
const Uuid = z.string().uuid();

const ParamUuid = (valor: string | undefined, campo: string): string => {
  const u = Uuid.safeParse(valor);
  if (!u.success) throw erros.validacao({ [campo]: 'Identificador inválido' });
  return u.data;
};

const EntidadeDaRota = (valor: string | undefined): EntidadeEnvioFdv => {
  const e = EntidadeEnvioFdv.safeParse(valor);
  if (!e.success) throw erros.validacao({ entidade: 'Cadastro desconhecido' });
  return e.data;
};

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
      metodo: 'GET', caminho: CAMINHOS_INTEGRACAO_FDV_TENANT.log.replace('/integracao-fdv', ''), acao: 'integracao-fdv.ver',
      async executar(c, e) {
        const entidade = EntidadeDaRota(e.params.entidade);
        const i = await lerInsumosLog(c.tx, tenant(c), entidade, LIMITE_ERROS_LOG_FDV);
        return { corpo: montarLogTenant({ entidade, lidoEm: c.agora, envios: i.envios, erros: i.erros, totalErros: i.total_erros, motivo: i.motivo?.motivo ?? null }) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: CAMINHOS_INTEGRACAO_FDV_TENANT.logCsv.replace('/integracao-fdv', ''), acao: 'integracao-fdv.ver',
      async executar(c, e) {
        const entidade = EntidadeDaRota(e.params.entidade);
        const i = await lerInsumosLog(c.tx, tenant(c), entidade, null);
        return respostaCsv(`erros-${entidade}.csv`, paraCsv(COLUNAS_CSV_LOG, i.erros.map(itemDoLogTenant)));
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
        return csvDaLista(paginaLotes, c.sessao.perfil, p.itens);
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
