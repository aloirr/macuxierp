import { sairAction } from './sair';

export function BotaoSair() {
  return <form action={sairAction}><button className="mx-botao-secundario" type="submit">Sair</button></form>;
}
