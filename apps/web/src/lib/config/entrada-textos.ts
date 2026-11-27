/**
 * Textos da ligação "Sistema do cliente → ERP" do /config (v0.3.24, docs/design/integracao-duas-ligacoes; era "Integração via API", T-0057 A1).
 * Só texto fixo: nunca a chave, o corpo de erro da API nem dado do cliente. Sem imports, para o `erros.ts` poder usar.
 */

export const AJUDA_CODIGO_LIVRE = 'Letras, números, ponto, hífen e sublinhado. Até 100.';
export const ERRO_CODIGO_VAZIO = 'Informe o código.';
/** Chave vazia ao salvar ou trocar a chave do Macuxi FDV (#840, decisão B da PO). */
export const ERRO_CHAVE_VAZIA = 'Informe a chave.';
export const ERRO_CODIGO_REGRA = 'Use só letras, números, ponto, hífen e sublinhado, até 100 caracteres.';
export const ERRO_CODIGO_EM_USO = 'Este código já está em uso. Escolha outro.';

/** Rótulos das ações da chave: uma fonte só para os botões e os diálogos. */
export const ROTULOS_ENTRADA = { gerar: 'Gerar chave', trocar: 'Trocar chave', revogar: 'Revogar chave' } as const;
export const RETORNO_REVOGADA = 'Chave revogada.';


export const ERRO_PEPPER_AUSENTE = 'O servidor ainda não está preparado para gerar chaves. Avise o responsável pelo servidor.';
export const ERRO_GERAR_INCERTO = 'Não foi possível confirmar a chave. Gere de novo: a chave nova substitui a anterior.';
export const ERRO_REVOGAR = 'Não foi possível revogar a chave. Tente de novo.';

export const TITULO_TROCAR = 'Trocar a chave do sistema do cliente?';
export const AVISO_TROCAR = 'A chave atual deixa de funcionar agora. Quem usa a chave antiga fica sem enviar até receber a nova.';
export const TITULO_REVOGAR = 'Revogar a chave do sistema do cliente?';
export const AVISO_REVOGAR = 'A chave atual deixa de funcionar agora. Para voltar a enviar, gere uma chave nova.';

export const TITULO_CHAVE = 'Chave do sistema do cliente';
export const AVISO_CHAVE = 'Esta chave não aparece de novo. Guarde agora.';
export const AJUDA_CHAVE = 'Use a chave no cabeçalho de autorização das chamadas.';
export const COPIADA = 'Copiada';
export const COPIA_FALHOU = 'Não foi possível copiar. Selecione a chave e copie à mão.';

export const TITULO_FECHAR_SEM_COPIAR = 'Fechar sem copiar a chave?';
export const AVISO_FECHAR_SEM_COPIAR = 'A chave não aparece de novo. Você terá de trocá-la.';

