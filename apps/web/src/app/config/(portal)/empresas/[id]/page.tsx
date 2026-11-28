import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { codigoExibido, destinoErroEmpresa, lerApoio, textoCriadaEm } from '@/lib/config/empresa';
import { lerEmpresa, lerIntegracaoFdv, lerMonitorFdv, lerSituacaoCnpj, listarUsuarios } from '@/lib/config/api';
import { lerCargas } from '@/lib/config/cargas-api';
import { lerEntrada } from '@/lib/config/entrada-api';
import { CodigoDoErro } from '@/components/codigo-do-erro';
import { ConfigNaoAutenticado } from '@/lib/config/erros';
import { exigirTokenConfig, ROTA_ENCERRAR, ROTA_SENHA } from '@/lib/config/sessao';
import { MANIFESTOS } from '@/lib/manifestos';
import { SeloSituacao } from '../../selo-situacao';
import { AbaIntegracao } from './aba-integracao';
import { PainelEmpresa } from './painel';

export const metadata: Metadata = { title: 'Empresa' };

export default async function Empresa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string; aba?: string }> }) {
  const { id } = await params;
  const { criada, aba } = await searchParams;
  // Config v4: duas abas, Empresa e Integrações. 'dados' e 'cargas' (nomes antigos) abrem Integrações, que agora traz os cadastros.
  const naIntegracao = aba === 'integracao' || aba === 'dados' || aba === 'cargas';
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
        <CodigoDoErro id={d.requestId} />
        <a className="mx-botao-secundario" href={naoAchou ? '/config' : `/config/empresas/${encodeURIComponent(id)}`}>{naoAchou ? 'Voltar às empresas' : 'Recarregar'}</a>
      </>
    );
  }
  /** Leitura de apoio da aba: sessão vencida encerra; qualquer outra falha deixa a aba seguir sem o dado, cada uma com o id da própria falha. */
  const ler = async <T,>(f: () => Promise<T>) => {
    const r = await lerApoio(f);
    if (r.naoAutenticado) redirect(ROTA_ENCERRAR);
    return r;
  };
  const { valor: integracao, requestId: idIntegracao } = naIntegracao ? await ler(() => lerIntegracaoFdv(token, id)) : { valor: null, requestId: undefined };
  const monitor = naIntegracao ? (await ler(() => lerMonitorFdv(token, id))).valor : null;
  // a entrada vale para as duas abas: a ficha da ligação (Integração) e os números do último lote (Dados, "Cadastros recebidos")
  const entrada = naIntegracao ? (await ler(() => lerEntrada(token, id))).valor : null;
  const cargas = naIntegracao ? (await ler(() => lerCargas(token, id))).valor : null;
  // RN-CORE-16: a aba Empresa sabe antes se o CNPJ pode ser trocado (sem a leitura, a troca fica fechada)
  const situacaoCnpj = !naIntegracao && empresa.cnpj ? (await ler(() => lerSituacaoCnpj(token, id))).valor : null;
  // Usuários da empresa (v0.3.29): a lista já vem com `acoes` e `ultimo_admin_ativo`; falha na leitura deixa o bloco com "Recarregar"
  const usuarios = !naIntegracao ? (await ler(() => listarUsuarios(token, id))).valor?.itens ?? null : null;
  const base = `/config/empresas/${encodeURIComponent(id)}`;
  const deps = MANIFESTOS.map((m) => ({ id: m.id, depende: m.depende }));
  return (
    <>
      <p className="apoio"><a href="/config">Empresas</a></p>
      <div className="titulo-selo">
        <h1>{empresa.nome}</h1>
        <SeloSituacao situacao={empresa.situacao} />
      </div>
      <p className="apoio">Código: <span className="codigo">{codigoExibido(empresa)}</span> · {textoCriadaEm(empresa)}</p>
      {criada === '1' && <p className="faixa-aviso" role="status">Empresa criada. Ligue os módulos e crie o 1º administrador.</p>}
      <nav className="abas-texto" aria-label="Abas da empresa">
        <a href={base} aria-current={naIntegracao ? undefined : 'page'}>Empresa</a>
        <a href={`${base}?aba=integracao`} aria-current={naIntegracao ? 'page' : undefined}>Integrações</a>
      </nav>
      {naIntegracao ? (
        integracao ? (
          <AbaIntegracao empresaId={empresa.id} dados={integracao} fuso={empresa.fuso} monitor={monitor} entrada={entrada} cargas={cargas} />
        ) : (
          <>
            <p className="erro" role="alert">Não foi possível carregar a integração.</p>
            <CodigoDoErro id={idIntegracao} />
            <a className="mx-botao-secundario" href={`${base}?aba=integracao`}>Recarregar</a>
          </>
        )
      ) : (
        <PainelEmpresa
          empresa={empresa}
          ficha={empresa.ficha}
          cnpj={situacaoCnpj}
          deps={deps}
          usuarios={usuarios}
          chaves={{ situacao: randomUUID() }}
        />
      )}
    </>
  );
}
