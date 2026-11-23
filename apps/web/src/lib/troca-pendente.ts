/** 403 `TROCAR_SENHA`: a senha provisória precisa ser trocada; quem captura leva a pessoa a `ROTA_SENHA` (redirect relativo). */
export class TrocarSenhaPendente extends Error {
  override readonly name = 'TrocarSenhaPendente' as const;
}
export const ROTA_SENHA = '/senha';
