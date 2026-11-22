/**
 * Troca controlada do `external_id` (T-0016), descrita como dados puros: o shell (apps/web) monta o formulário, mostra o
 * aviso, pede a confirmação e chama `POST /v1/cadastros/<entidade>/:id/external-id`. A permissão só esconde o botão
 * (`podeTrocarExternalId`); a proteção real é a da API (RN-CORE-02). Os limites vêm do contrato `TrocaExternalId`.
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { TrocaExternalId } from '../contracts';

export interface CampoTroca {
  readonly chave: keyof TrocaExternalId;
  readonly rotulo: string;
  readonly max: number;
  readonly dica?: string;
}

export interface DescritorTrocaExternalId {
  /** Ação do SDK: só administrador. */
  readonly ver: 'cadastros.external_id.trocar';
  /** Caminho do envio; `entidade` é o segmento da rota em `/v1/cadastros` (ex.: `clientes`). */
  readonly api: (entidade: string, id: string) => string;
  readonly campos: readonly CampoTroca[];
  /** Mostrado antes de confirmar. */
  readonly aviso: string;
  /** Texto do botão de confirmar. */
  readonly confirmar: string;
}

/** Limite do contrato; sem `max` no contrato, falha cedo em vez de assumir um número. */
const maxDe = (campo: { readonly maxLength: number | null }): number => {
  if (campo.maxLength === null) throw new Error('TrocaExternalId: o contrato não define max para o campo');
  return campo.maxLength;
};

export const TROCA_EXTERNAL_ID: DescritorTrocaExternalId = {
  ver: 'cadastros.external_id.trocar',
  api: (entidade, id) => `/v1/cadastros/${entidade}/${id}/external-id`,
  campos: [
    { chave: 'external_id', rotulo: 'Nova chave de integração', max: maxDe(TrocaExternalId.shape.external_id) },
    {
      chave: 'motivo', rotulo: 'Motivo', max: maxDe(TrocaExternalId.shape.motivo),
      dica: 'Explique a troca em poucas palavras. Não escreva dado pessoal (nome, CPF, telefone, e-mail).',
    },
  ],
  aviso: 'Trocar a chave de integração faz o Macuxi FDV ver este cadastro como um registro novo. No Macuxi FDV, o cadastro com a chave antiga deixa de receber atualizações.',
  confirmar: 'Trocar a chave',
};

/** Mostra o botão "Trocar a chave de integração" só a quem a API deixaria usar (administrador). */
export const podeTrocarExternalId = (perfil: Perfil): boolean => pode(perfil, TROCA_EXTERNAL_ID.ver);
