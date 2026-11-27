import { MANIFESTOS } from '@/lib/manifestos';
import { atalhosDoInicio } from '@/lib/inicio';
import { montarMenu } from '@/lib/menu';
import { contexto } from '@/lib/sessao';
import { InicioVisao } from './inicio-visao';

export default async function Inicio() {
  const { eu } = await contexto();
  return <InicioVisao nome={eu.usuario.nome} atalhos={atalhosDoInicio(montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil))} />;
}
