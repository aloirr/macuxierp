import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { codigoExibido, destinoErroEmpresa } from '@/lib/config/empresa';
import { lerEmpresa, lerIntegracaoFdv, lerMonitorFdv } from '@/lib/config/api';
import { lerCargas } from '@/lib/config/cargas-api';
import { ConfigNaoAutenticado } from '@/lib/config/erros';
import { exigirTokenConfig, ROTA_ENCERRAR, ROTA_SENHA } from '@/lib/config/sessao';
import { MANIFESTOS } from '@/lib/manifestos';
import { SeloSituacao } from '../../selo-situacao';
import { AbaDados } from './aba-dados';
import { AbaIntegracao } from './aba-integracao';
import { PainelEmpresa } from './painel';

export const metadata: Metadata = { title: 'Empresa' };

export default async function Empresa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string; aba?: string }> }) {
  const { id } = await params;
  const { criada, aba } = await searchParams;
  const naIntegracao = aba === 'integracao';
  const naCarga = aba === 'dados' || aba === 'cargas'; // 'cargas' é o nome antigo da aba
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
  /** Leitura de apoio da aba: sessão vencida encerra; qualquer outra falha deixa a aba seguir sem o dado (Monitor, integração, cargas). */
  const lerOuNada = async <T,>(ler: () => Promise<T>): Promise<T | null> => {
    try {
      return await ler();
    } catch (e) {
      if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
      return null;
    }
  };
  const integracao = naIntegracao || naCarga ? await lerOuNada(() => lerIntegracaoFdv(token, id)) : null;
  const monitor = naIntegracao ? await lerOuNada(() => lerMonitorFdv(token, id)) : null;
  const cargas = naCarga ? await lerOuNada(() => lerCargas(token, id)) : null;
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
        <a href={`${base}?aba=dados`} aria-current={naCarga ? 'page' : undefined}>Dados</a>
      </nav>
      {naCarga ? (
        <AbaDados empresaId={empresa.id} dados={cargas} fuso={empresa.fuso} integracao={integracao} />
      ) : naIntegracao ? (
        integracao ? (
          <AbaIntegracao empresaId={empresa.id} dados={integracao} fuso={empresa.fuso} monitor={monitor} />
        ) : (
          <>
            <p className="erro" role="alert">Não foi possível carregar a integração. Tente de novo.</p>
            <a className="mx-botao-secundario" href={`${base}?aba=integracao`}>Tentar de novo</a>
          </>
        )
      ) : (
        <PainelEmpresa
          empresa={empresa}
          ficha={empresa.ficha}
          deps={deps}
          chaves={{ admin: randomUUID(), senha: randomUUID(), situacao: randomUUID() }}
        />
      )}
    </>
  );
}
