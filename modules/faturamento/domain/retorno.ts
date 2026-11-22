/** Interpretação do retorno da SEFAZ por cStat (RN-FAT-07, RF-FAT-08). */
export type SituacaoRetorno = 'autorizada' | 'denegada' | 'processamento' | 'indisponivel' | 'lote_processado' | 'duplicidade' | 'rejeitada';

export interface RetornoInterpretado {
  situacao: SituacaoRetorno;
  codigo: string;
  mensagem: string;
  /** Ação sugerida ao faturista (painel de rejeições). Vazia quando autorizada. */
  acao: string;
}

const ACAO_PADRAO = 'Corrija o que a mensagem aponta e reenvie com o mesmo número (RN-FAT-07).';

/** Lista curta das rejeições mais comuns. Código fora dela cai na ação padrão. */
export const ACOES_REJEICAO: Readonly<Record<string, string>> = {
  206: 'Número já inutilizado: emita com um novo número.',
  225: 'Falha no schema do XML: confira o campo indicado na mensagem (tamanho, formato e obrigatórios).',
  228: 'Data de emissão muito atrasada: reemita com a data atual.',
  252: 'Ambiente do XML difere do da SEFAZ: confira o ambiente fiscal da filial emissora.',
  280: 'Certificado de transmissão inválido: confira o A1 da filial em Configurações.',
  281: 'Certificado de transmissão vencido: renove o A1 da filial.',
  290: 'Certificado de assinatura inválido: confira o A1 da filial.',
  778: 'NCM inexistente: corrija o NCM do produto no cadastro e reenvie.',
};

/**
 * Duplicidade (204 = NF-e já existe; 539 = duplicidade com diferença na chave). A nota pode JÁ estar autorizada na SEFAZ:
 * o chamador deve fazer `consultarProtocolo(chNFe)` e só então decidir. Nunca publicar `nota.rejeitada@1` nem mudar o status
 * por esta situação; se a consulta devolver 100, guardar o XML autorizado antes de qualquer outra coisa (regra 7, RN-FAT-03).
 */
const DUPLICIDADE: Readonly<Record<string, string>> = {
  204: 'Duplicidade: consulte o protocolo pela chave antes de qualquer mudança. Se já está autorizada, guarde o XML autorizado em vez de reenviar.',
  539: 'Duplicidade com diferença na chave: consulte o protocolo pela chave; confira série, número e código numérico só se não houver autorização.',
};

/** cStat 104 = "lote processado": só indica que o recibo foi processado. NÃO é rejeição nem autorização. */
const LOTE_PROCESSADO = '104';

const PROCESSAMENTO = new Set(['103', '105']);
const DENEGADA = new Set(['110', '301', '302', '303']);
const INDISPONIVEL = new Set(['108', '109']);
const AUTORIZADA = new Set(['100', '150']);

/**
 * `interpretarRetorno` vale para o cStat da consulta ou do `protNFe`. O cStat do envelope do lote (104) devolve
 * `lote_processado`: o resultado da nota vem do cStat do `protNFe` dentro do retorno (passe-o de novo por esta função).
 */
export function interpretarRetorno(cStat: string, xMotivo: string): RetornoInterpretado {
  const codigo = cStat.trim();
  const mensagem = xMotivo.trim();
  if (AUTORIZADA.has(codigo)) return { situacao: 'autorizada', codigo, mensagem, acao: '' };
  if (codigo === LOTE_PROCESSADO) {
    return { situacao: 'lote_processado', codigo, mensagem, acao: 'Lote processado não é resultado da nota: leia o cStat do protNFe e interprete-o.' };
  }
  const acaoDuplicidade = DUPLICIDADE[codigo];
  if (acaoDuplicidade) return { situacao: 'duplicidade', codigo, mensagem, acao: acaoDuplicidade };
  if (DENEGADA.has(codigo)) {
    return { situacao: 'denegada', codigo, mensagem, acao: 'Uso denegado: a nota não pode ser corrigida nem reenviada. Procure o fiscal para tratar o cadastro do emitente ou do destinatário.' };
  }
  if (PROCESSAMENTO.has(codigo)) {
    return { situacao: 'processamento', codigo, mensagem, acao: 'Lote em processamento: consulte o recibo ou a chave em instantes. Não reenvie.' };
  }
  if (INDISPONIVEL.has(codigo)) {
    return { situacao: 'indisponivel', codigo, mensagem, acao: 'SEFAZ indisponível: consulte o status do serviço; persistindo, avalie a contingência (RN-FAT-05).' };
  }
  return { situacao: 'rejeitada', codigo, mensagem, acao: ACOES_REJEICAO[codigo] ?? ACAO_PADRAO };
}
