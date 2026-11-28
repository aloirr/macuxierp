import { sairAction } from './sair';

export function BotaoSair() {
  return <form action={sairAction}><button className="link" type="submit">Sair</button></form>;
}
