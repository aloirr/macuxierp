import { lerSituacaoEsqueci } from '@/lib/esqueci-api';
import { FormularioLogin } from './formulario';

/** Login único (T-0076), agora na raiz (v0.3.27): empresa e superadmin na mesma tela. O "Esqueci a senha" só existe se a API diz que o e-mail está configurado. */
export async function TelaLogin() {
  return (
    <main className="cartao-central">
      <FormularioLogin esqueciDisponivel={await lerSituacaoEsqueci()} />
    </main>
  );
}
