import { PAGINA_CARGA } from '@macuxierp/cadastros/web';

/** Textos do shell que mais de um arquivo usa: um texto por situação. */
export const SESSAO_EXPIRADA = 'Seu acesso expirou. Entre de novo.';
export const SEM_PERMISSAO_CARGA = 'Seu perfil não pode executar a carga de cadastros.';
export const CARGA_TEMPO_ESGOTADO = 'A carga passou do tempo. Divida o arquivo em partes menores e envie de novo.';
export const CARGA_NAO_CONCLUIDA = 'A carga não pôde ser concluída agora. Tente de novo em instantes.';
export const FALHA = 'Não foi possível concluir agora. Tente de novo em instantes.';
export const SEM_RESPOSTA = 'Sem resposta do servidor. Tente de novo em instantes.';
export const INDISPONIVEL = 'Indisponível agora. Fale com a Macuxi.';
export const SEM_PERMISSAO = 'Seu perfil ou a licença da empresa não permitem esta ação.';
export const CARGA_GRANDE_DEMAIS = `O arquivo passa do limite de ${Math.floor(PAGINA_CARGA.maxBytes / 1_048_576)} MB: divida em partes menores.`;
