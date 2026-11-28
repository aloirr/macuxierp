'use client';
import { formatarDocumento, type EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { ResultadoAcao, TabelaDensa, useResultado, type ColunaTabela } from '@macuxierp/ui';
import { resultadoErro } from '@/lib/resultado-acao';
import { acumularPagina } from '@macuxierp/ui/paginacao';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AUSENTE, codigoExibido, dataCriacao, filtrarEmpresas } from '@/lib/config/empresa';
import { modulosLigados, nomeModulo, resumoModulos } from '@/lib/config/modulos';
import { maisEmpresasAcao } from '@/lib/acoes-cliente';
import { SeloSituacao } from './selo-situacao';

/** Acima de 480 px a lista completa; abaixo, "N módulos" (CSS em globals.css). A lista completa fica no title e no aria-label. */
function CelulaModulos({ modulos }: { modulos: EmpresaPlataforma['modulos'] }) {
  const ligados = modulosLigados(modulos);
  if (ligados.length === 0) return <span>{resumoModulos(0)}</span>;
  const lista = ligados.map(nomeModulo).join(', ');
  return (
    <span title={lista} aria-label={lista} className="modulos-celula">
      <span className="modulos-lista">{lista}</span>
      <span className="modulos-resumo" aria-hidden="true">{resumoModulos(ligados.length)}</span>
    </span>
  );
}

/**
 * Lista de Empresas do /config (simulação aprovada 124 A; RD-2360 a RD-2363): um título só, com a contagem, e a busca única na
 * mesma linha (colunas 1 a 8 e 9 a 12), que filtra ao digitar pelo código ou pelo nome; a tabela na largura toda e, logo abaixo,
 * a barra com "Nova empresa". Sem JS, o Enter manda a busca ao servidor (`?busca=`, pelo código).
 */
export function ListaEmpresas({ empresas, vazio, proximo = null, busca = '' }: { empresas: EmpresaPlataforma[]; vazio: string; proximo?: string | null; busca?: string }) {
  const router = useRouter();
  const [linhas, setLinhas] = useState(empresas);
  const [cursor, setCursor] = useState(proximo);
  const [termo, setTermo] = useState('');
  const [resultado, chaveResultado, mostrar, limpar] = useResultado(); // 36 A: abaixo da tabela, onde fica o "Carregar mais"
  const [pendente, iniciar] = useTransition();
  const visiveis = filtrarEmpresas(linhas, termo);
  const carregarMais = () => {
    if (!cursor) return;
    iniciar(async () => {
      const r = await maisEmpresasAcao(busca, cursor);
      if (r.ok) {
        setLinhas((atuais) => acumularPagina(atuais, r.valor.itens, (e) => e.id));
        setCursor(r.valor.proximo_cursor);
        limpar();
      } else {
        mostrar(resultadoErro(r.erro || 'Não foi possível carregar mais. Tente de novo.'));
      }
    });
  };
  const colunas: ColunaTabela<EmpresaPlataforma>[] = [
    { id: 'nome', titulo: 'Empresa', celula: (e) => <b>{e.nome}</b> },
    { id: 'codigo', titulo: 'Código', celula: (e) => (
        <Link href={`/config/empresas/${e.id}`} className="codigo" onClick={(ev) => ev.stopPropagation()}>
          {codigoExibido(e)}
        </Link>
      ),
    },
    { id: 'cnpj', titulo: 'CNPJ', celula: (e) => <span className="sem-quebra">{e.cnpj ? formatarDocumento(e.cnpj) : AUSENTE}</span> },
    { id: 'situacao', titulo: 'Situação', celula: (e) => <SeloSituacao situacao={e.situacao} /> },
    { id: 'modulos', titulo: 'Módulos', celula: (e) => <CelulaModulos modulos={e.modulos} /> },
    { id: 'criada', titulo: 'Criada em', celula: (e) => <span className="sem-quebra">{dataCriacao(e)}</span> },
  ];
  return (
    <>
    <div className="titulo-lista">
      <h1>Empresas <span className="contagem">· {visiveis.length}</span></h1>
      <form method="get" action="/config" role="search" className="busca-lista" onSubmit={(ev) => ev.preventDefault()}>
        <input
          type="search"
          name="busca"
          defaultValue={busca}
          maxLength={80}
          autoComplete="off"
          placeholder="Buscar por código ou nome"
          aria-label="Buscar por código ou nome"
          onChange={(ev) => setTermo(ev.target.value)}
        />
      </form>
    </div>
    <div className="cartao-tabela">
    <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
      <TabelaDensa
        colunas={colunas}
        linhas={visiveis}
        chaveLinha={(e) => e.id}
        aoClicarLinha={(e) => router.push(`/config/empresas/${e.id}`)}
        rotuloLinha={(e) => `Abrir empresa ${codigoExibido(e)}`}
        textoVazio={termo.trim() && linhas.length > 0 ? 'Nenhuma empresa encontrada.' : vazio}
        legenda="Empresas"
        temMais={cursor !== null}
        carregandoMais={pendente}
        aoCarregarMais={carregarMais}
      />
    </div>
    </div>
    <ResultadoAcao resultado={resultado} chave={chaveResultado} />
    <div className="barra-acoes rodape-lista">
      <Link className="mx-botao" href="/config/empresas/nova">Nova empresa</Link>
    </div>
    </>
  );
}
