import { regrasDescumpridas } from '@macuxierp/platform-sdk';

export const SENHAS_NAO_CONFEREM = 'As senhas não conferem. Digite a mesma senha nos dois campos.';

/** Aviso de sucesso da troca voluntária: o destino leva `?aviso=senha-trocada` (o shell mostra e a pessoa dispensa). */
export const AVISO_SENHA_TROCADA = 'senha-trocada';

/** Estado do formulário de troca: o envio só abre com a senha atual, as regras cumpridas, a confirmação igual e a senha nova diferente da atual. Pura, a mesma no cliente e na ação. */
export function estadoDaTroca(atual: string, nova: string, confirmacao: string): { regrasOk: boolean; difere: boolean; igualAtual: boolean; podeEnviar: boolean } {
  const regrasOk = regrasDescumpridas(nova).length === 0;
  const difere = nova !== confirmacao;
  const igualAtual = nova.length > 0 && nova === atual;
  return { regrasOk, difere, igualAtual, podeEnviar: atual.length > 0 && regrasOk && !difere && !igualAtual };
}
