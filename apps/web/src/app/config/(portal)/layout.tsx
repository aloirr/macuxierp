import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { euPlataforma } from '@/lib/config/api';
import { ConfigNaoAutenticado, ErroPlataforma } from '@/lib/config/erros';
import { ROTA_ENCERRAR, ROTA_SENHA, exigirTokenConfig } from '@/lib/config/sessao';
import { TopoPlataforma } from './topo-plataforma';

/**
 * Guarda do grupo /config: sem cookie próprio ou com token recusado pela API, redireciona (o redirect do Next já sai com Location relativo; um proxy.ts não serve: o Next recusa Location relativo nele). Sem sessão de superadmin, `Location` relativo para o login;
 * o token do BKO nunca chega aqui (outro cookie, outro prefixo da API). Páginas e ações conferem de novo (a API sempre revalida).
 */
export default async function CascaPlataforma({ children }: { children: ReactNode }) {
  const token = await exigirTokenConfig();
  let eu;
  try {
    eu = await euPlataforma(token);
  } catch (e) {
    if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
    if (e instanceof ErroPlataforma && e.codigo === CODIGO_TROCAR_SENHA) redirect(ROTA_SENHA);
    throw e;
  }
  if (eu.deve_trocar_senha) redirect(ROTA_SENHA);
  return (
    <div className="casca-plataforma">
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <TopoPlataforma nome={eu.superadmin.nome} />
      <main id="conteudo" className="conteudo">{children}</main>
    </div>
  );
}
