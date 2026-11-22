/**
 * Rotas `/v1/integracao-fdv` (C-7; RF-INF-04 e RF-INF-05). Perfil, tenant e licença do módulo são checados pela API antes do
 * `executar` (RN-CORE-02; sem licença, 403 `MODULO_INATIVO`); aqui entram as regras do `domain` (a API sempre revalida), a
 * auditoria das ações (A) e os eventos da outbox. Sempre `tenant_id` explícito, sem `SELECT *` nem `RETURNING *` na credencial
 * (o app nem tem permissão de ler `chave_cifrada`).
 *
 * A chave do conector entra, é cifrada na hora (`cifrarCampo`, AAD = tenant) e some: não vai a resposta, log, evento nem auditoria.
 * A chave mestra (`MACUXIERP_CHAVE_INTEGRACAO`) é lida e injetada pelo `apps/api`; o módulo nunca lê variável de ambiente.
 *
 * Ordem dos bloqueios (sem ciclo): `sinal` -> `credencial` -> `cursor_entidade`. `PUT /credencial` começa pela linha de `sinal`
 * (serializa as trocas simultâneas do tenant); as demais escritas travam a `credencial` e depois o cursor; o `testar` só toca `sinal`.
 *
 * Regra da agenda: o app só ADIANTA (`least` para agora: `anteciparEntidades`, `anteciparSinal`, `garantirLinhaDoSinal`); nunca segura a
 * posse nem grava data futura em `proximo*_em` (quem adia é o worker, preso à posse da reserva). Vale para a carga completa, o
 * retomar, o testar, a configuração e a troca da credencial; o único `INSERT` de cursor usa o `proximo_em` padrão do banco (agora).
 *
 * Premissa do "Testar conexão": o `ExecutorTrabalho` do SDK roda dentro de uma transação e não tem a porta HTTP do Hub nem a chave,
 * então o trabalho não caberia. A rota responde 202 com `pedido_em` e antecipa o `sinal.proximo_sinal_em`: a agenda do conector
 * manda o `POST /sinal` em segundos e o resultado aparece no monitor (último sinal aceito, a partir de `pedido_em`).
 */
import { randomUUID } from 'node:crypto';
import { ErroApi, cifrarCampo, csvDaLista, definirRota, erros, type ContextoRota, type RotaModulo } from '@macuxierp/platform-sdk';
import { ConsultaPaginada } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import {
  CredencialEntrada, ConfiguracaoEntrada, ENTIDADES_CARGA_INICIAL, ENTIDADES_HUB_F2, EVENTOS, EVENTO_CARGA_INICIAL, EntidadeHub, LIMITE_REGISTROS_LOTE,
  type MotivoPausa, type RespostaAceito, type RespostaRetomada, type RespostaTestar,
} from '../contracts';
import { decidirCargaCompleta, decidirRetomar, planejarTrocaCredencial, prefixoExibido, validarConfiguracao } from '../domain';
import { paginaLotes } from '../web/paginas';
import { ESTADOS_EM_VOO, anteciparEntidades, anteciparSinal, garantirLinhaDoSinal } from './conector-comum';
import { lerCredencialResumo, lerMonitor, listarErrosDoLote, listarLotes, loteExiste, resumoDaCredencial } from './monitor';

export interface DependenciasRotas {
  /**
   * `MACUXIERP_CHAVE_INTEGRACAO` já lida pelo `apps/api` (`lerChaveIntegracao`): 32 bytes. Nunca vai a log nem a resposta.
   * `null` = a variável não está configurada: o `PUT /credencial` responde 503 (as demais rotas seguem). Outro tamanho é erro na montagem.
   */
  chaveMestra: Buffer | null;
  /** Versão gravada em `credencial.chave_mestra_versao` (o worker abre pela versão). Padrão 1. */
  chaveVersao?: number;
}

/** Máximo de linhas do CSV dos lotes. */
const MAXIMO_LINHAS_CSV = 10_000;
const Uuid = z.string().uuid();

const ParamEntidade = (valor: string | undefined): EntidadeHub => {
  const e = EntidadeHub.safeParse(valor);
  if (!e.success || !(ENTIDADES_HUB_F2 as readonly string[]).includes(e.data)) throw erros.validacao({ entidade: 'Cadastro desconhecido' });
  return e.data;
};
const ParamUuid = (valor: string | undefined, campo: string): string => {
  const u = Uuid.safeParse(valor);
  if (!u.success) throw erros.validacao({ [campo]: 'Identificador inválido' });
  return u.data;
};

const CHAVE_AUSENTE = (): ErroApi =>
  new ErroApi(503, 'CHAVE_INTEGRACAO_AUSENTE', 'O cadastro da credencial está indisponível: a chave de criptografia do servidor não foi configurada. Fale com o suporte.');

/** Valida os 32 bytes logo na montagem e guarda uma cópia: quem montou não muda a chave depois. O erro nunca cita o valor. */
function copiarChaveMestra(chave: Buffer | null): Buffer | null {
  if (chave === null) return null;
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new Error('chaveMestra da integração-fdv deve ter 32 bytes');
  return Buffer.from(chave);
}

export function criarRotas(deps: DependenciasRotas): RotaModulo[] {
  const versaoDaChave = deps.chaveVersao ?? 1;
  const chaveMestra = copiarChaveMestra(deps.chaveMestra);
  const tenant = (c: ContextoRota): string => c.sessao.tenant_id;

  /** Credencial ativa ou 409: as ações de configuração dependem dela. Lê com `FOR UPDATE` (as escritas se serializam), salvo `bloquear: false`. */
  const exigirCredencial = async (c: ContextoRota, bloquear = true) => {
    const cred = await lerCredencialResumo(c.tx, tenant(c), { bloquear });
    if (!cred) throw erros.conflito('Cadastre a credencial do FDV antes');
    return cred;
  };

  return [
    definirRota({
      metodo: 'GET', caminho: '/monitor', acao: 'integracao-fdv.ver',
      async executar(c) {
        return { corpo: await lerMonitor(c.tx, tenant(c)) };
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

    // Sem `Idempotency-Key` de propósito: o hash do corpo guardado em `plataforma.idempotencia` levaria a chave do conector. A troca
    // é idempotente por si (mesma chave, mesmo conector e ambiente = só uma linha nova de credencial) e a rota se serializa pela linha de `sinal`.
    definirRota({
      metodo: 'PUT', caminho: '/credencial', acao: 'integracao-fdv.configurar', corpo: CredencialEntrada,
      async executar(c, e) {
        const t = tenant(c);
        if (!chaveMestra) throw CHAVE_AUSENTE();
        const entrada = e.corpo;
        // 1. a linha única de `sinal` do tenant: a segunda chamada simultânea espera aqui (e não cai na unicidade da credencial ativa)
        await garantirLinhaDoSinal(c.tx, t, c.agora, { anteciparSinal: true });
        const anterior = await lerCredencialResumo(c.tx, t, { bloquear: true });
        const plano = planejarTrocaCredencial(anterior, { conector_id: entrada.conector_id, ambiente: entrada.ambiente });
        // a ativa sai antes da nova entrar (índice: uma ativa por tenant); a configuração do envio é copiada
        if (anterior) await c.tx.consultar('UPDATE integracao_fdv.credencial SET substituida_em = $3 WHERE tenant_id = $1 AND id = $2', [t, anterior.id, c.agora]);
        const cifrada = cifrarCampo({ chave: chaveMestra, tenantId: t, claro: entrada.chave });
        // primeira credencial: as entidades da F2 e o limite do contrato, explícitos (não dependem do padrão do banco)
        const [nova] = await c.tx.consultar<{ id: string }>(
          `INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo, chave_mestra_versao, criada_por, entidades_habilitadas, limite_registros_lote)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[]::integracao_fdv.entidade_hub[], $9) RETURNING id`,
          [
            t, entrada.conector_id, entrada.ambiente, cifrada, prefixoExibido(entrada.chave), versaoDaChave, c.sessao.usuario_id,
            anterior ? anterior.entidades_habilitadas : [...ENTIDADES_HUB_F2], anterior ? anterior.limite_registros_lote : LIMITE_REGISTROS_LOTE,
          ],
        );
        if (plano.zerarEspelho) {
          // outro conector ou ambiente = outro tenant do FDV: o cursor e o que o Hub confirmou deixam de valer. Só onde há payload
          // (a linha de payload anulado exige `hash_confirmado`, CHECK `registro_publicado_payload_anulado`; recado R-20261121-221350)
          const zerados = await c.tx.consultar<{ entidade: string }>(
            `UPDATE integracao_fdv.cursor_entidade SET cursor_alterado_em = NULL, cursor_external_id = NULL, sessao_aberta_id = NULL
              WHERE tenant_id = $1 AND deleted_at IS NULL RETURNING entidade::text AS entidade`,
            [t],
          );
          await anteciparEntidades(c.tx, t, zerados.map((z) => z.entidade), c.agora);
          await c.tx.consultar(
            `UPDATE integracao_fdv.registro_publicado SET hash_confirmado = NULL, confirmado_em = NULL
              WHERE tenant_id = $1 AND payload IS NOT NULL AND (hash_confirmado IS NOT NULL OR confirmado_em IS NOT NULL)`,
            [t],
          );
        }
        // chave nova: a pausa por credencial recusada (a antiga) sai e as entidades voltam a ser avaliadas já
        const liberadas = await c.tx.consultar<{ entidade: string }>(
          `UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = NULL, pausada_em = NULL
            WHERE tenant_id = $1 AND pausada_motivo = 'credencial' AND deleted_at IS NULL RETURNING entidade::text AS entidade`,
          [t],
        );
        await anteciparEntidades(c.tx, t, liberadas.map((l) => l.entidade), c.agora);
        if (plano.pedirCargaInicial) {
          await c.publicar({ nome: EVENTO_CARGA_INICIAL, agregado_id: nova!.id, payload: EVENTOS[EVENTO_CARGA_INICIAL].parse({ entidades: [...ENTIDADES_CARGA_INICIAL] }) });
        }
        // auditoria: só identificação (nunca a chave, o prefixo ou o cifrado)
        await c.auditar({
          acao: plano.primeira ? 'integracao-fdv.credencial.criar' : 'integracao-fdv.credencial.trocar',
          entidade: 'credencial',
          entidade_id: nova!.id,
          antes: anterior ? { conector_id: anterior.conector_id, ambiente: anterior.ambiente } : null,
          depois: { conector_id: entrada.conector_id, ambiente: entrada.ambiente, zerou_espelho: plano.zerarEspelho },
        });
        if (liberadas.length > 0) {
          await c.auditar({
            acao: 'integracao-fdv.credencial.liberar_pausa', entidade: 'credencial', entidade_id: nova!.id,
            antes: { pausada_motivo: 'credencial', entidades: liberadas.map((l) => l.entidade) }, depois: { pausada_motivo: null },
          });
        }
        return { status: plano.primeira ? 201 : 200, corpo: resumoDaCredencial((await lerCredencialResumo(c.tx, t))!) };
      },
    }),

    definirRota({
      metodo: 'POST', caminho: '/credencial/testar', acao: 'integracao-fdv.configurar',
      async executar(c) {
        const t = tenant(c);
        const cred = await exigirCredencial(c, false); // só lê: quem toca a credencial é o PUT; aqui o único bloqueio é o da linha de `sinal`
        await anteciparSinal(c.tx, t, c.agora);
        await c.auditar({ acao: 'integracao-fdv.credencial.testar', entidade: 'credencial', entidade_id: cred.id, depois: { conector_id: cred.conector_id, ambiente: cred.ambiente } });
        const corpo: RespostaTestar = { aceito: true, pedido_em: c.agora.toISOString() };
        return { status: 202, corpo };
      },
    }),

    definirRota({
      metodo: 'PUT', caminho: '/configuracao', acao: 'integracao-fdv.configurar', corpo: ConfiguracaoEntrada,
      async executar(c, e) {
        const t = tenant(c);
        const nova = e.corpo;
        const violacoes = validarConfiguracao(nova); // a API revalida o que o Zod já barrou
        if (violacoes.length > 0) throw erros.regra(violacoes[0]!.rn, violacoes[0]!.mensagem, Object.fromEntries(violacoes.map((v) => [v.campo, v.mensagem])));
        const cred = await exigirCredencial(c);
        await c.tx.consultar(
          `UPDATE integracao_fdv.credencial SET entidades_habilitadas = $3::text[]::integracao_fdv.entidade_hub[], limite_registros_lote = $4 WHERE tenant_id = $1 AND id = $2`,
          [t, cred.id, nova.entidades_habilitadas, nova.limite_registros_lote],
        );
        const novas = nova.entidades_habilitadas.filter((x) => !cred.entidades_habilitadas.includes(x as EntidadeHub));
        await anteciparEntidades(c.tx, t, novas, c.agora);
        await c.auditar({
          acao: 'integracao-fdv.configuracao.alterar',
          entidade: 'credencial',
          entidade_id: cred.id,
          antes: { entidades_habilitadas: cred.entidades_habilitadas, limite_registros_lote: cred.limite_registros_lote },
          depois: { entidades_habilitadas: nova.entidades_habilitadas, limite_registros_lote: nova.limite_registros_lote },
        });
        return { corpo: { entidades_habilitadas: nova.entidades_habilitadas, limite_registros_lote: nova.limite_registros_lote } };
      },
    }),

    definirRota({
      metodo: 'POST', caminho: '/entidades/:entidade/carga-completa', acao: 'integracao-fdv.configurar',
      async executar(c, e) {
        const t = tenant(c);
        const entidade = ParamEntidade(e.params.entidade);
        const cred = await exigirCredencial(c);
        // 1. o upsert do cursor trava a linha (o `montarLoteNoBanco` do envio também a trava): só depois se confere o lote em voo, e quem
        // vier atrás enxerga o que esta transação decidiu. Se a decisão for negativa, o erro desfaz o upsert. Sessão já aberta (carga
        // repetida): continua a mesma, com o cursor da sessão como está; sem sessão: abre uma nova e zera o cursor local (o envio monta o modo completo).
        const [linha] = await c.tx.consultar<{ id: string }>(
          `INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, sessao_aberta_id) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, entidade) DO UPDATE
              SET cursor_alterado_em = CASE WHEN integracao_fdv.cursor_entidade.sessao_aberta_id IS NULL THEN NULL ELSE integracao_fdv.cursor_entidade.cursor_alterado_em END,
                  cursor_external_id = CASE WHEN integracao_fdv.cursor_entidade.sessao_aberta_id IS NULL THEN NULL ELSE integracao_fdv.cursor_entidade.cursor_external_id END,
                  sessao_aberta_id = coalesce(integracao_fdv.cursor_entidade.sessao_aberta_id, EXCLUDED.sessao_aberta_id)
           RETURNING id`,
          [t, entidade, randomUUID()],
        );
        const emVoo = await c.tx.consultar(
          `SELECT 1 FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND entidade = $2 AND estado = ANY($3::text[]) AND deleted_at IS NULL LIMIT 1`,
          [t, entidade, [...ESTADOS_EM_VOO]],
        );
        const decisao = decidirCargaCompleta({ habilitada: cred.entidades_habilitadas.includes(entidade), loteEmVoo: emVoo.length > 0 });
        if (!decisao.ok) {
          if (decisao.codigo === 'lote_em_voo') throw erros.conflito(decisao.mensagem);
          throw erros.regra('RN-INF-02', decisao.mensagem, { entidade: decisao.mensagem }, { codigo: decisao.codigo });
        }
        await anteciparEntidades(c.tx, t, [entidade], c.agora);
        await c.auditar({ acao: 'integracao-fdv.entidade.carga_completa', entidade: 'cursor_entidade', entidade_id: linha!.id, depois: { entidade } });
        const corpo: RespostaAceito = { aceito: true };
        return { status: 202, corpo };
      },
    }),

    definirRota({
      metodo: 'POST', caminho: '/entidades/:entidade/retomar', acao: 'integracao-fdv.configurar',
      async executar(c, e) {
        const t = tenant(c);
        const entidade = ParamEntidade(e.params.entidade);
        const [atual] = await c.tx.consultar<{ id: string; pausada_motivo: MotivoPausa | null }>(
          `SELECT id, pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2 AND deleted_at IS NULL FOR UPDATE`,
          [t, entidade],
        );
        if (!atual || decidirRetomar(atual.pausada_motivo).acao === 'nada') {
          const nada: RespostaRetomada = { retomada: false };
          return { corpo: nada };
        }
        await c.tx.consultar(`UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = NULL, pausada_em = NULL WHERE tenant_id = $1 AND id = $2`, [t, atual.id]);
        await anteciparEntidades(c.tx, t, [entidade], c.agora);
        await c.auditar({ acao: 'integracao-fdv.entidade.retomar', entidade: 'cursor_entidade', entidade_id: atual.id, antes: { entidade, pausada_motivo: atual.pausada_motivo }, depois: { entidade, pausada_motivo: null } });
        const retomada: RespostaRetomada = { retomada: true };
        return { corpo: retomada };
      },
    }),
  ];
}
