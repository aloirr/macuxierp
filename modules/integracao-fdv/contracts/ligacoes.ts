/** C-6 (T-0131): leitura da ligação ERP → Macuxi FDV na Config (contadores, histórico de envios e cabeçalho do Contato). Aditivo. */
import { z } from 'zod';
import { AmbienteIntegracaoFdv, SituacaoConectorFdv } from '@macuxierp/platform-sdk';
import { EntidadeHub } from './hub';
import { EstadoLote } from './monitor';

const Instante = z.string().datetime().nullable();

/** Enviados = registros dos lotes mandados ao Hub; Aceitos = os que o Hub aceitou (RN-INF-13). Sem "Gravados". */
export const ContadoresLigacao = z.object({ enviados: z.number().int().min(0), aceitos: z.number().int().min(0) });
export type ContadoresLigacao = z.infer<typeof ContadoresLigacao>;

/** Cabeçalho do Contato, só leitura. Sem credencial: tudo nulo e `situacao: 'desativado'`. */
export const ContatoLigacao = z.object({
  conector_id: z.string().nullable(),
  ambiente: AmbienteIntegracaoFdv.nullable(),
  chave_prefixo: z.string().max(8).nullable(),
  situacao: SituacaoConectorFdv,
  /** Último sinal aceito pelo Hub. */
  ultimo_contato_em: Instante,
});
export type ContatoLigacao = z.infer<typeof ContatoLigacao>;

/** Um envio do histórico (lote mandado ao Hub; sem o repetido). */
export const EnvioLigacao = z.object({
  id: z.string().uuid(),
  entidade: EntidadeHub,
  estado: EstadoLote,
  registros: z.number().int().min(0),
  aceitos: z.number().int().min(0).nullable(),
  com_erro: z.number().int().min(0).nullable(),
  enviado_em: Instante,
  concluido_em: Instante,
});
export type EnvioLigacao = z.infer<typeof EnvioLigacao>;

export const LIMITE_ENVIOS_LIGACAO = 50;

export const LigacaoSaida = z.object({
  contato: ContatoLigacao,
  contadores: ContadoresLigacao,
  /** Do mais novo ao mais antigo, até `LIMITE_ENVIOS_LIGACAO`. */
  envios: z.array(EnvioLigacao).max(LIMITE_ENVIOS_LIGACAO),
  /** Há mais envios além dos devolvidos. */
  envios_cortados: z.boolean(),
});
export type LigacaoSaida = z.infer<typeof LigacaoSaida>;

/** `GET /v1/integracao-fdv/ligacoes`. Hoje só a saída (ERP → Macuxi FDV); a entrada é do portal de entrada. */
export const LigacoesResposta = z.object({ saida: LigacaoSaida });
export type LigacoesResposta = z.infer<typeof LigacoesResposta>;
