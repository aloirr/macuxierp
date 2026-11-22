/**
 * Rotas `/v1/faturamento` (RF-FAT-01, RF-FAT-08). Perfil, tenant e licença do módulo `faturamento` são checados pela API antes do
 * `executar` (RN-CORE-02; sem licença, 403 `MODULO_INATIVO`); aqui entram as regras do domain (a API sempre revalida), a auditoria e
 * o enfileiramento. A SEFAZ NUNCA é chamada daqui e o A1 não é lido: o worker assina e transmite (`transmissor.ts`, ADR 0005 item 4).
 * `vendedor` não acessa as notas na v1 (a carteira por vendedor entra com o BKO): 403.
 */
import { definirRota, erros, type ContextoRota, type RotaModulo } from '@macuxierp/platform-sdk';
import {
  CancelarNotaEntrada, CartaCorrecaoEntrada, EmitirNotaEntrada, FiltroNotas, FiltroRejeicoes, InutilizarEntrada, TRABALHO_CONSULTAR_NOTA, TRABALHO_PROCESSAR_EVENTO,
  TRABALHO_PROCESSAR_INUTILIZACAO, TRABALHO_TRANSMITIR_NOTA,
} from '../contracts';
import type { EventoNotaResumo } from '../contracts';
import type { EventoRegistro } from './portas';
import { criarServicoEmissao, type DepsEmissao } from './emissao';
import { criarServicoEventos, type DepsEventos } from './eventos';
import { traduzirErroBanco } from './sql';
import { erroDeViolacoes, idDe } from './util';

const semDhEvento = ({ dh_evento: _d, ...resto }: EventoRegistro): EventoNotaResumo => resto;

const SEM_VENDEDOR = (c: ContextoRota): void => {
  if (c.sessao.perfil === 'vendedor') throw erros.perfilSemPermissao();
};

/** Emissão mais os eventos: a API só grava o pedido e confere o A1 pelos metadados (`temA1Ativo`); nunca lê o A1 decifrado nos eventos (ADR 0005 item 4). */
export type DepsRotas = DepsEmissao & Pick<DepsEventos, 'eventos'>;

export function criarRotas(deps: DepsRotas): RotaModulo[] {
  const servico = criarServicoEmissao(deps);
  const eventosSvc = criarServicoEventos({ eventos: deps.eventos, cadastros: deps.cadastros, ambiente: deps.ambiente, certificado: deps.certificado, agora: deps.agora });
  const notas = deps.notas;

  const enfileirar = (c: ContextoRota, nota_id: string, reenvio: boolean) =>
    c.enfileirar({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id }, external_id: reenvio ? `${nota_id}:${c.request_id}` : nota_id });

  const enfileirarEvento = (c: ContextoRota, evento_id: string, dh_evento: string) =>
    c.enfileirar({ tipo: TRABALHO_PROCESSAR_EVENTO, payload: { evento_id }, external_id: `${evento_id}:${dh_evento}` });

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
        } else if (r.nota.status === 'rascunho') {
          // Repetição com a nota ainda em rascunho (trabalho perdido ou worker sem A1): enfileira de novo; o worker é idempotente (RN-FAT-03).
          await enfileirar(c, r.nota.id, true);
        }
        const detalhe = await notas.detalhar(c.tx, r.nota.id);
        return { status: r.repetida ? 200 : 201, corpo: detalhe };
      },
    }),
    // RN-FAT-07: reenvio da rejeitada (ou do rascunho não assinado) com o MESMO número; a API refaz o conteúdo; o worker reassina e transmite.
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
    // ---- Eventos (lote 2): a API grava o pedido `pendente` e enfileira; o worker chama a SEFAZ (processador-eventos.ts). 202 = aceito para processar. ----
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/cancelar', acao: 'faturamento.nota.emitir', corpo: CancelarNotaEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params), { travar: true });
        if (!nota) throw erros.naoEncontrado('Nota');
        const r = await eventosSvc.pedirCancelamento(c.tx, nota, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        if (!r.repetido) {
          await c.auditar({ acao: 'faturamento.nota.cancelar', entidade: 'nota', entidade_id: nota.id, depois: { evento_id: r.evento.id, serie: nota.serie, numero: nota.numero } });
          await enfileirarEvento(c, r.evento.id, r.evento.dh_evento);
        }
        return { status: 202, corpo: semDhEvento(r.evento) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/carta-correcao', acao: 'faturamento.nota.emitir', corpo: CartaCorrecaoEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params), { travar: true });
        if (!nota) throw erros.naoEncontrado('Nota');
        const r = await eventosSvc.pedirCartaCorrecao(c.tx, nota, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        if (!r.repetido) {
          await c.auditar({ acao: 'faturamento.nota.carta_correcao', entidade: 'nota', entidade_id: nota.id, depois: { evento_id: r.evento.id, n_seq_evento: r.evento.n_seq_evento } });
          await enfileirarEvento(c, r.evento.id, r.evento.dh_evento);
        }
        return { status: 202, corpo: { evento: semDhEvento(r.evento), avisos: r.avisos } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/inutilizacoes', acao: 'faturamento.nota.emitir', corpo: InutilizarEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        const r = await eventosSvc.pedirInutilizacao(c.tx, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        const i = r.inutilizacao;
        await c.auditar({ acao: 'faturamento.inutilizacao.pedir', entidade: 'inutilizacao', entidade_id: i.id, depois: { filial_id: i.filial_id, serie: i.serie, numero_inicial: i.numero_inicial, numero_final: i.numero_final } });
        await c.enfileirar({ tipo: TRABALHO_PROCESSAR_INUTILIZACAO, payload: { inutilizacao_id: i.id }, external_id: i.id });
        return { status: 202, corpo: i };
      },
    }),
    // Consulta de protocolo (reconcilia o status sem editar a nota autorizada): enfileira; a SEFAZ é chamada pelo worker.
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/consultar', acao: 'faturamento.nota.emitir', idempotencia: 'opcional',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params));
        if (!nota) throw erros.naoEncontrado('Nota');
        await c.auditar({ acao: 'faturamento.nota.consultar', entidade: 'nota', entidade_id: nota.id });
        await c.enfileirar({ tipo: TRABALHO_CONSULTAR_NOTA, payload: { nota_id: nota.id }, external_id: `${nota.id}:${c.request_id}` });
        return { status: 202, corpo: { nota_id: nota.id, enfileirada: true } };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/notas/:id/eventos', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const id = idDe(e.params);
        if (!(await notas.obter(c.tx, id))) throw erros.naoEncontrado('Nota');
        return { corpo: { itens: (await deps.eventos.listarEventos(c.tx, id)).map(semDhEvento) } };
      },
    }),
  ];
}
