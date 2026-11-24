import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { codigoExibido, destinoErroEmpresa } from '@/lib/config/empresa';
import { lerEmpresa, lerIntegracaoFdv } from '@/lib/config/api';
import { lerCargas } from '@/lib/config/cargas-api';
import { ConfigNaoAutenticado } from '@/lib/config/erros';
import { exigirTokenConfig, ROTA_ENCERRAR, ROTA_SENHA } from '@/lib/config/sessao';
import { MANIFESTOS } from '@/lib/manifestos';
import { SeloSituacao } from '../../selo-situacao';
import { AbaCargas } from './aba-cargas';
import { AbaIntegracao } from './aba-integracao';
import { PainelEmpresa } from './painel';

export const metadata: Metadata = { title: 'Empresa' };

export default async function Empresa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string; aba?: string }> }) {
  const { id } = await params;
  const { criada, aba } = await searchParams;
  const naIntegracao = aba === 'integracao';
  const naCarga = aba === 'cargas';
  const token = await exigirTokenConfig();
  let empresa;
  try {
    empresa = await lerEmpresa(token, id);
  } catch (e) {
    if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
    const d = destinoErroEmpresa(e);
    if (d.tipo === 'senha') redirect(ROTA_SENHA);
    const naoAchou = d.naoAchou;
    return (
      <>
        <h1>Empresa</h1>
        <p className="erro">{d.texto}</p>
        <a className="mx-botao-secundario" href={naoAchou ? '/config' : `/config/empresas/${encodeURIComponent(id)}`}>{naoAchou ? 'Voltar às empresas' : 'Tentar de novo'}</a>
      </>
    );
  }
  let integracao: Awaited<ReturnType<typeof lerIntegracaoFdv>> | null = null;
  if (naIntegracao) {
    try {
      integracao = await lerIntegracaoFdv(token, id);
    } catch (e) {
      if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
    }
  }
  let cargas: Awaited<ReturnType<typeof lerCargas>> | null = null;
  if (naCarga) {
    try {
      cargas = await lerCargas(token, id);
    } catch (e) {
      if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
    }
  }
  const base = `/config/empresas/${encodeURIComponent(id)}`;
  const deps = MANIFESTOS.map((m) => ({ id: m.id, depende: m.depende }));
  return (
    <>
      <p className="apoio"><a href="/config">Empresas</a></p>
      <div className="titulo-selo">
        <h1>{empresa.nome}</h1>
        <SeloSituacao situacao={empresa.situacao} />
      </div>
      <p className="apoio">Código: <span className="codigo">{codigoExibido(empresa)}</span></p>
      {criada === '1' && <p className="faixa-aviso" role="status">Empresa criada. Ligue os módulos e crie o 1º administrador.</p>}
      <nav className="abas-texto" aria-label="Abas da empresa">
        <a href={base} aria-current={naIntegracao || naCarga ? undefined : 'page'}>Empresa</a>
        <a href={`${base}?aba=integracao`} aria-current={naIntegracao ? 'page' : undefined}>Integração</a>
        <a href={`${base}?aba=cargas`} aria-current={naCarga ? 'page' : undefined}>Cargas</a>
      </nav>
      {naCarga ? (
        <AbaCargas empresaId={empresa.id} dados={cargas} fuso={empresa.fuso} />
      ) : naIntegracao ? (
        integracao ? (
          <AbaIntegracao empresaId={empresa.id} dados={integracao} fuso={empresa.fuso} />
        ) : (
          <>
            <p className="erro" role="alert">Não foi possível carregar a integração. Tente de novo.</p>
            <a className="mx-botao-secundario" href={`${base}?aba=integracao`}>Tentar de novo</a>
          </>
        )
      ) : (
        <PainelEmpresa
          empresa={empresa}
          deps={deps}
          chaves={{ admin: randomUUID(), senha: randomUUID(), situacao: randomUUID() }}
        />
      )}
    </>
  );
}
