import { TEXTO_INDISPONIVEL } from '@/lib/telas/comum';
import { CodigoDoErro } from './codigo-do-erro';

/** Tela de "indisponível" do BKO (API fora do ar): título opcional, texto único e o código para o suporte quando há. */
export function FalhaIndisponivel({ requestId, titulo }: { requestId: string | undefined; titulo?: string }) {
  return <>{titulo && <h1>{titulo}</h1>}<p className="erro" role="alert">{TEXTO_INDISPONIVEL}</p><CodigoDoErro id={requestId} /></>;
}
