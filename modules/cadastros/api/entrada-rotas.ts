/**
 * T-0057 C4 (ADR 0014 §3): os handlers da `/entrada/v1`, no mesmo contrato do Hub (`LoteAceito`, `LoteResultado`, `CursorEntidade`,
 * `RespostaSinal`; sempre `status`, nunca `estado`). A autenticação da máquina (HMAC), a licença do módulo (regra 6) e a transação no
 * tenant da credencial são do plugin da apps/api (`montarEntrada`); o "perfil" é o `conector_entrada`, sem sessão de usuário. Aqui:
 * recusa do envelope inteiro (422, sem lote), idempotência pela `Idempotency-Key` + hash do corpo, fila do worker e leitura do resultado.
 * Tipos só dos contratos do SDK. O dado dos registros fica só no `corpo` do lote, que o worker zera ao concluir (LGPD).
 */
import {
  CAMINHOS_ENTRADA, ENTIDADES_ENTRADA, ErroApi, PREFIXO_ENTRADA, TRABALHO_ENTRADA_LOTE, chaveDoPedido, definirRotaEntrada, erros, hashDoPedido,
  type RotaEntrada, type Transacao,
} from '@macuxierp/platform-sdk';
import {
  CorpoLote, CorpoSinal, LIMITE_ERROS_RESPOSTA_MAX, LIMITE_ERROS_RESPOSTA_PADRAO, type CursorEntidade, type LoteAceito, type RespostaSinal,
} from '@macuxierp/platform-sdk/hub-v1';
import { z } from 'zod';
import { recusarEnvelope, resultadoDoLote } from '../domain';
import { entradaSql, type LoteCriado, type RepositorioEntrada } from './entrada-sql';

interface DependenciasRotasEntrada {
  entrada(tx: Transacao): RepositorioEntrada;
}

const ConsultaLote = z.object({
  limite_erros: z.coerce.number().int().min(1).max(LIMITE_ERROS_RESPOSTA_MAX).default(LIMITE_ERROS_RESPOSTA_PADRAO),
});
const IdLote = z.string().uuid();

const aceito = (l: Omit<LoteCriado, 'hash_corpo'>, repetido: boolean): LoteAceito => ({
  lote_id: l.id, status: 'recebido', entidade: l.entidade as LoteAceito['entidade'], modo: l.modo, recebidos: l.recebidos,
  ...(repetido ? { repetido: true } : {}), consulta: `${PREFIXO_ENTRADA}${CAMINHOS_ENTRADA.lote.replace(':id', l.id)}`,
});

export function criarRotasEntrada(d: DependenciasRotasEntrada): RotaEntrada[] {
  return [
    definirRotaEntrada({
      metodo: 'POST', caminho: CAMINHOS_ENTRADA.lotes, corpo: CorpoLote,
      async executar(c, e) {
        const chave = chaveDoPedido(e.cabecalhos, 'obrigatoria') as string;
        const corpo = e.corpo;
        const recusa = recusarEnvelope(corpo);
        if (!recusa.ok) throw new ErroApi(recusa.status, recusa.codigo, recusa.motivo);
        const recebidos = corpo.registros.length + corpo.linhas_invalidas.length + corpo.linhas_invalidas_omitidas;
        if (recebidos < 1) throw erros.validacao({ registros: 'O lote precisa de ao menos um registro ou linha inválida' });
        const hash = hashDoPedido({ corpo, consulta: null, params: {}, todosArquivos: {} });
        const { lote, criado } = await d.entrada(c.tx).criarLote({
          credencial_id: c.conector.credencial_id, conector_id: c.conector.conector_id, entidade: corpo.entidade, modo: corpo.modo,
          idempotency_key: chave, hash_corpo: hash, corpo, recebidos,
        });
        if (!criado) {
          if (lote.hash_corpo !== hash) throw erros.conflito('Idempotency-Key já usada com outro corpo');
          return { status: 202, corpo: aceito(lote, true) };
        }
        await c.enfileirar({ tipo: TRABALHO_ENTRADA_LOTE, payload: { lote_id: lote.id }, external_id: lote.id });
        return { status: 202, corpo: aceito(lote, false) };
      },
    }),

    definirRotaEntrada({
      metodo: 'GET', caminho: CAMINHOS_ENTRADA.lote, consulta: ConsultaLote,
      async executar(c, e) {
        const id = IdLote.safeParse(e.params.id);
        const lote = id.success ? await d.entrada(c.tx).lerLote(c.conector.conector_id, id.data) : null;
        if (!lote) throw erros.naoEncontrado('Lote');
        return { corpo: resultadoDoLote(lote, e.consulta.limite_erros) };
      },
    }),

    definirRotaEntrada({
      metodo: 'GET', caminho: CAMINHOS_ENTRADA.cursor,
      async executar(c, e) {
        const entidade = ENTIDADES_ENTRADA.find((x) => x === e.params.entidade);
        if (!entidade) throw erros.naoEncontrado('Entidade');
        const lido = await d.entrada(c.tx).lerCursor(c.conector.conector_id, entidade);
        const corpo: CursorEntidade = { entidade, cursor: lido?.cursor ?? null, atualizado_em: lido?.atualizado_em ?? null };
        return { corpo };
      },
    }),

    definirRotaEntrada({
      metodo: 'POST', caminho: CAMINHOS_ENTRADA.sinal, corpo: CorpoSinal,
      async executar(c, e) {
        if (e.corpo.conector_id !== c.conector.conector_id) throw erros.validacao({ conector_id: 'Diferente do conector da credencial' });
        await d.entrada(c.tx).gravarSinal(c.conector.conector_id, { versao_conector: e.corpo.versao_conector, parado_por_versao: e.corpo.parado_por_versao ?? false }, c.agora);
        // Sem política de versão no ERP ainda: "sem restrição" (RespostaSinal.politica_versao ausente).
        const corpo: RespostaSinal = { conector_id: c.conector.conector_id, recebido_em: c.agora.toISOString() };
        return { corpo };
      },
    }),
  ];
}

/** As rotas com o adaptador SQL: o que a apps/api monta em `montarEntrada` (`DependenciasEntrada.rotas`). */
export const rotasEntrada: readonly RotaEntrada[] = criarRotasEntrada({ entrada: entradaSql });
