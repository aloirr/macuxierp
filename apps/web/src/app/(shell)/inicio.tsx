import { MANIFESTOS } from '@/lib/manifestos';
import { atalhosDoInicio } from '@/lib/inicio';
import { montarMenu } from '@/lib/menu';
import { contexto } from '@/lib/sessao';
import { InicioVisao } from './inicio-visao';

/** Conteúdo do Início, dentro da Casca da raiz ("/"): atalhos pelas licenças e pelo perfil. */
export async function Inicio() {
  const { eu } = await contexto();
  return <InicioVisao atalhos={atalhosDoInicio(montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil))} />;
}
