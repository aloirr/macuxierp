import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';

const SELOS = { ativo: ['selo-ativo', 'Ativo'], suspenso: ['selo-aviso', 'Suspenso'], encerrado: ['selo-inativo', 'Encerrado'] } as const;

/** Estado nunca só por cor: o texto vai junto. */
export function SeloSituacao({ situacao }: { situacao: EmpresaPlataforma['situacao'] }) {
  const [classe, texto] = SELOS[situacao];
  return <span className={`selo ${classe}`}>{texto}</span>;
}
