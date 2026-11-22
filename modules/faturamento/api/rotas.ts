/**
 * Rotas `/v1/faturamento` (RF-FAT-01, RF-FAT-08). Perfil, tenant e licença do módulo `faturamento` são checados pela API antes do
 * `executar` (RN-CORE-02; sem licença, 403 `MODULO_INATIVO`); aqui entram as regras do domain (a API sempre revalida), a auditoria e
 * o enfileiramento da transmissão. A SEFAZ NUNCA é chamada daqui: o worker transmite (`transmissor.ts`).
 * `vendedor` não acessa as notas na v1 (a carteira por vendedor entra com o BKO): 403.
 */
import { definirRota, erros, type ContextoRota, type RotaModulo } from '@macuxierp/platform-sdk';
import { EmitirNotaEntrada, FiltroNotas, FiltroRejeicoes, TRABALHO_TRANSMITIR_NOTA } from '../contracts';
import { criarServicoEmissao, type DepsEmissao } from './emissao';
import { traduzirErroBanco } from './sql';
import { erroDeViolacoes, idDe } from './util';

const SEM_VENDEDOR = (c: ContextoRota): void => {
  if (c.sessao.perfil === 'vendedor') throw erros.perfilSemPermissao();
};

export function criarRotas(deps: DepsEmissao): RotaModulo[] {
  const servico = criarServicoEmissao(deps);
  const notas = deps.notas;

  const enfileirar = (c: ContextoRota, nota_id: string, reenvio: boolean) =>
    c.enfileirar({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id }, external_id: reenvio ? `${nota_id}:${c.request_id}` : nota_id });

  return [
    definirRota({
      metodo: 'GET', caminho: '/notas', acao: 'faturamento.ver', consulta: FiltroNotas,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await notas.listar(c.tx, e.consulta) };
      },
    }),
    // RF-FAT-08: painel de rejeições. Caminho fixo antes de `/notas/:id`.
    definirRota({
      metodo: 'GET', caminho: '/rejeicoes', acao: 'faturamento.ver', consulta: FiltroRejeicoes,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await notas.listarRejeicoes(c.tx, e.consulta) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/notas/:id', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const n = await notas.detalhar(c.tx, idDe(e.params));
        if (!n) throw erros.naoEncontrado('Nota');
        return { corpo: n };
      },
    }),
    // O XML tem dado do destinatário: só quem emite (administrador, faturista, fiscal) baixa. Só existe depois da guarda (RN-FAT-03).
    definirRota({
      metodo: 'GET', caminho: '/notas/:id/xml', acao: 'faturamento.nota.emitir',
      async executar(c, e) {
        const xml = await notas.lerXmlAutorizado(c.tx, idDe(e.params));
        if (!xml) throw erros.naoEncontrado('XML autorizado');
        return {
          corpo: xml.xml,
          cabecalhos: { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="NFe${xml.chave_acesso}.xml"`, 'cache-control': 'no-store' },
        };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/notas', acao: 'faturamento.nota.emitir', corpo: EmitirNotaEntrada,
      async executar(c, e) {
        const r = await servico.emitirNota(c.tx, c.sessao.tenant_id, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        if (!r.repetida) {
          await c.auditar({ acao: 'faturamento.nota.emitir', entidade: 'nota', entidade_id: r.nota.id, depois: { pedido_id: r.nota.pedido_id, serie: r.nota.serie, numero: r.nota.numero, ambiente: r.nota.ambiente } });
          await enfileirar(c, r.nota.id, false);
        }
        const detalhe = await notas.detalhar(c.tx, r.nota.id);
        return { status: r.repetida ? 200 : 201, corpo: detalhe };
      },
    }),
    // RN-FAT-07: reenvio da rejeitada com o MESMO número; a API refaz o XML e reassina; o worker transmite.
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/reenviar', acao: 'faturamento.nota.emitir',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params), { travar: true });
        if (!nota) throw erros.naoEncontrado('Nota');
        const r = await servico.reenviarNota(c.tx, nota).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        await c.auditar({ acao: 'faturamento.nota.reenviar', entidade: 'nota', entidade_id: nota.id, depois: { serie: nota.serie, numero: nota.numero } });
        await enfileirar(c, nota.id, true);
        return { corpo: await notas.detalhar(c.tx, nota.id) };
      },
    }),
  ];
}
