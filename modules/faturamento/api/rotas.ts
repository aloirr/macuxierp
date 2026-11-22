/**
 * Rotas `/v1/faturamento` (RF-FAT-01, RF-FAT-08). Perfil, tenant e licença do módulo `faturamento` são checados pela API antes do
 * `executar` (RN-CORE-02; sem licença, 403 `MODULO_INATIVO`); aqui entram as regras do domain (a API sempre revalida), a auditoria e
 * o enfileiramento. A SEFAZ NUNCA é chamada daqui e o A1 não é lido: o worker assina e transmite (`transmissor.ts`, ADR 0005 item 4).
 * `vendedor` não acessa as notas na v1 (a carteira por vendedor entra com o BKO): 403.
 */
import { definirRota, erros, type ContextoRota, type RotaModulo } from '@macuxierp/platform-sdk';
import {
  BaixarTituloEntrada, CancelarNotaEntrada, ConfigurarFilialEntrada, CartaCorrecaoEntrada, EmitirNotaEntrada, FiltroNotas, FiltroPedidosAFaturar, FiltroRejeicoes, FiltroTitulos, InutilizarEntrada, TRABALHO_CONSULTAR_NOTA, TRABALHO_PROCESSAR_EVENTO,
  TRABALHO_PROCESSAR_INUTILIZACAO, TRABALHO_TRANSMITIR_NOTA,
} from '../contracts';
import type { EventoNotaResumo } from '../contracts';
import { podeBaixarTitulo } from '../domain';
import type { ConfiguracaoFaturamento, EventoRegistro, RepositorioTitulos } from './portas';
import { criarServicoTitulos } from './titulos';
import { criarServicoEmissao, type DepsEmissao } from './emissao';
import { criarServicoEventos, type DepsEventos } from './eventos';
import { traduzirErroBanco } from './sql';
import { erroDeViolacoes, idDe } from './util';

const semDhEvento = ({ dh_evento: _d, ...resto }: EventoRegistro): EventoNotaResumo => resto;

const SEM_VENDEDOR = (c: ContextoRota): void => {
  if (c.sessao.perfil === 'vendedor') throw erros.perfilSemPermissao();
};

/** Emissão mais os eventos: a API só grava o pedido e confere o A1 pelos metadados (`temA1Ativo`); nunca lê o A1 decifrado nos eventos (ADR 0005 item 4). */
export type DepsRotas = DepsEmissao & Pick<DepsEventos, 'eventos'> & { titulos: RepositorioTitulos; configuracao: ConfiguracaoFaturamento };

/** Baixa e estorno só para administrador, gerente e faturista (RN-FAT-06). A rota usa `faturamento.ver` (licença e tenant) e confere o perfil aqui, até existir ação própria no platform-sdk. */
const SO_QUEM_BAIXA = (c: ContextoRota): void => {
  if (!podeBaixarTitulo(c.sessao.perfil)) throw erros.perfilSemPermissao();
};

export function criarRotas(deps: DepsRotas): RotaModulo[] {
  const servico = criarServicoEmissao(deps);
  const eventosSvc = criarServicoEventos({ eventos: deps.eventos, cadastros: deps.cadastros, ambiente: deps.ambiente, certificado: deps.certificado, agora: deps.agora });
  const notas = deps.notas;
  const titulosSvc = criarServicoTitulos({ titulos: deps.titulos, notas: deps.notas }, deps.agora);

  const enfileirar = (c: ContextoRota, nota_id: string, reenvio: boolean) =>
    c.enfileirar({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id }, external_id: reenvio ? `${nota_id}:${c.request_id}` : nota_id });

  const enfileirarEvento = (c: ContextoRota, evento_id: string, dh_evento: string) =>
    c.enfileirar({ tipo: TRABALHO_PROCESSAR_EVENTO, payload: { evento_id }, external_id: `${evento_id}:${dh_evento}` });

  return [
    // RF-FAT-01: fila do BKO "Pedidos a faturar" (pedidos aprovados que ainda têm saldo). Só leitura; a emissão é o POST /notas.
    definirRota({
      metodo: 'GET', caminho: '/pedidos-a-faturar', acao: 'faturamento.ver', consulta: FiltroPedidosAFaturar,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await deps.pedidos.listar(c.tx, e.consulta) };
      },
    }),
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
    // ---- Títulos a receber (lote 5, RF-FAT-07). Baixa e estorno gravam em `titulo_baixa` (o gatilho do banco abate o saldo na mesma tx). ----
    definirRota({
      metodo: 'GET', caminho: '/titulos', acao: 'faturamento.ver', consulta: FiltroTitulos,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await deps.titulos.listar(c.tx, e.consulta) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/titulos/:id', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const t = await deps.titulos.detalhar(c.tx, idDe(e.params));
        if (!t) throw erros.naoEncontrado('Título');
        return { corpo: t };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/titulos/:id/baixas', acao: 'faturamento.ver', corpo: BaixarTituloEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        SO_QUEM_BAIXA(c);
        const id = idDe(e.params);
        const r = await titulosSvc.baixar(c.tx, id, e.corpo, c.sessao.usuario_id).catch(traduzirErroBanco);
        await c.auditar({ acao: 'faturamento.titulo.baixar', entidade: 'titulo', entidade_id: id, depois: { baixa_id: r.baixa.id, valor_centavos: r.baixa.valor_centavos, forma: r.baixa.forma, saldo_centavos: r.titulo.saldo_centavos } });
        return { status: 201, corpo: { baixa: r.baixa, titulo: r.titulo } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/titulos/:id/baixas/:baixa_id/estornar', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        SO_QUEM_BAIXA(c);
        const id = idDe(e.params);
        const baixa_id = idDe(e.params, 'baixa_id');
        const r = await titulosSvc.estornar(c.tx, id, baixa_id).catch(traduzirErroBanco);
        await c.auditar({ acao: 'faturamento.titulo.estornar', entidade: 'titulo', entidade_id: id, depois: { baixa_id, saldo_centavos: r.titulo.saldo_centavos } });
        return { corpo: { titulo: r.titulo } };
      },
    }),
    // ---- Bandeira por filial "faturamento real com NF-e simulada" (desligada por padrão; só o administrador liga). A nota segue de homologação no XML (regra 7). ----
    definirRota({
      metodo: 'GET', caminho: '/filiais/:id/configuracao', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const filial_id = idDe(e.params);
        return { corpo: { filial_id, faturamento_real_nfe_simulada: await deps.configuracao.faturamentoRealComNfeSimulada(c.tx, filial_id) } };
      },
    }),
    definirRota({
      metodo: 'PUT', caminho: '/filiais/:id/configuracao', acao: 'faturamento.ver', corpo: ConfigurarFilialEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        if (c.sessao.perfil !== 'administrador') throw erros.perfilSemPermissao();
        const filial_id = idDe(e.params);
        if (!(await deps.cadastros.filial(c.tx, filial_id))) throw erros.naoEncontrado('Filial');
        const antes = await deps.configuracao.faturamentoRealComNfeSimulada(c.tx, filial_id);
        await deps.configuracao.definir(c.tx, filial_id, e.corpo.faturamento_real_nfe_simulada, c.sessao.usuario_id);
        await c.auditar({ acao: 'faturamento.filial.configurar', entidade: 'filial', entidade_id: filial_id, antes: { faturamento_real_nfe_simulada: antes }, depois: { faturamento_real_nfe_simulada: e.corpo.faturamento_real_nfe_simulada } });
        return { corpo: { filial_id, faturamento_real_nfe_simulada: e.corpo.faturamento_real_nfe_simulada } };
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
