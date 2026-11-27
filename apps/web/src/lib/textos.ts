import { MAX_BYTES_ARQUIVO_CARGA_PORTAL } from '@macuxierp/platform-sdk';


/** Textos do shell que mais de um arquivo usa: um texto por situação. */
export const SESSAO_EXPIRADA = 'Seu acesso expirou. Entre de novo.';
/** Falha sem texto da API, em todo o shell e no /config (RD-T1, v0.3.22: um texto só para "não concluiu"). */
export const FALHA = 'Não foi possível concluir agora. Tente de novo em instantes.';
export const SEM_RESPOSTA = 'Sem resposta do servidor. Tente de novo em instantes.';
export const INDISPONIVEL = 'Indisponível agora. Fale com a Macuxi.';
export const SEM_PERMISSAO = 'Seu perfil ou a licença da empresa não permitem esta ação.';
export const CARGA_GRANDE_DEMAIS = `O arquivo passa do limite de ${Math.floor(MAX_BYTES_ARQUIVO_CARGA_PORTAL / 1_048_576)} MB: divida em partes menores.`;
/** Retornos de ação no molde do README do resultado (`docs/design/resultado-acao`): "Não foi possível <ação>. <o que fazer>." */
export const ERRO_CAMPOS = 'Não foi possível salvar. Confira os campos marcados.';
export const ACAO_INDISPONIVEL = 'Não foi possível abrir esta ação. Recarregue a página.';
