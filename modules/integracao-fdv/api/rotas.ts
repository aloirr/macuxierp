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
import { csvDaLista, definirRota, erros, type RotaModulo } from '@macuxierp/platform-sdk';
import { ConsultaPaginada } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import { paginaLotes } from '../web/paginas';
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
