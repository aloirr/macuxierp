import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { lerEmpresa } from '@/lib/config/api';
import { ConfigNaoAutenticado, ErroPlataforma } from '@/lib/config/erros';
import { exigirTokenConfig, ROTA_ENCERRAR } from '@/lib/config/sessao';
import { MANIFESTOS } from '@/lib/manifestos';
import { SeloSituacao } from '../../selo-situacao';
import { PainelEmpresa } from './painel';

export const metadata: Metadata = { title: 'Empresa' };

export default async function Empresa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string }> }) {
  const { id } = await params;
  const { criada } = await searchParams;
  const token = await exigirTokenConfig();
  let empresa;
  try {
    empresa = await lerEmpresa(token, id);
  } catch (e) {
    if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
    const naoAchou = e instanceof ErroPlataforma && e.status === 404;
    return (
      <>
        <h1>Empresa</h1>
        <p className="erro">{naoAchou ? 'Empresa não encontrada. Volte à lista.' : 'Não foi possível carregar. Tente de novo.'}</p>
        <a className="mx-botao-secundario" href={naoAchou ? '/config' : `/config/empresas/${encodeURIComponent(id)}`}>{naoAchou ? 'Voltar às empresas' : 'Tentar de novo'}</a>
      </>
    );
  }
  const deps = MANIFESTOS.map((m) => ({ id: m.id, depende: m.depende }));
  return (
    <>
      <p className="apoio"><a href="/config">Empresas</a></p>
      <div className="titulo-linha">
        <h1>{empresa.nome}</h1>
        <SeloSituacao situacao={empresa.situacao} />
      </div>
      <p className="apoio">Código: <span className="codigo">{empresa.slug}</span></p>
      {criada === '1' && <p className="faixa-aviso" role="status">Empresa criada com o core ligado. Ligue os módulos e crie o 1º administrador.</p>}
      <PainelEmpresa
        empresa={empresa}
        deps={deps}
        chaves={{ admin: randomUUID(), senha: randomUUID(), situacao: randomUUID() }}
      />
    </>
  );
}
