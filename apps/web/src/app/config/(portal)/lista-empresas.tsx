'use client';
import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { acumularPagina } from '@macuxierp/ui/paginacao';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { codigoExibido } from '@/lib/config/empresa';
import { modulosLigados, nomeModulo, resumoModulos } from '@/lib/config/modulos';
import { maisEmpresasAcao } from './empresas/acoes';
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

export function ListaEmpresas({ empresas, vazio, proximo = null, busca = '' }: { empresas: EmpresaPlataforma[]; vazio: string; proximo?: string | null; busca?: string }) {
  const router = useRouter();
  const [linhas, setLinhas] = useState(empresas);
  const [cursor, setCursor] = useState(proximo);
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const carregarMais = () => {
    if (!cursor) return;
    iniciar(async () => {
      const r = await maisEmpresasAcao(busca, cursor);
      if (r.ok) {
        setLinhas((atuais) => acumularPagina(atuais, r.valor.itens, (e) => e.id));
        setCursor(r.valor.proximo_cursor);
        setErro('');
      } else {
        setErro(r.erro || 'Não foi possível carregar mais. Tente de novo.');
      }
    });
  };
  const colunas: ColunaTabela<EmpresaPlataforma>[] = [
    { id: 'codigo', titulo: 'Código', celula: (e) => (
        <Link href={`/config/empresas/${e.id}`} className="codigo" onClick={(ev) => ev.stopPropagation()}>
          {codigoExibido(e)}
        </Link>
      ),
    },
    { id: 'nome', titulo: 'Nome', celula: (e) => e.nome },
    { id: 'situacao', titulo: 'Situação', celula: (e) => <SeloSituacao situacao={e.situacao} /> },
    { id: 'modulos', titulo: 'Módulos', celula: (e) => <CelulaModulos modulos={e.modulos} /> },
  ];
  return (
    <>
    <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
      <TabelaDensa
        colunas={colunas}
        linhas={linhas}
        chaveLinha={(e) => e.id}
        aoClicarLinha={(e) => router.push(`/config/empresas/${e.id}`)}
        rotuloLinha={(e) => `Abrir empresa ${codigoExibido(e)}`}
        textoVazio={vazio}
        legenda="Empresas"
        temMais={cursor !== null}
        carregandoMais={pendente}
        aoCarregarMais={carregarMais}
      />
    </div>
    {erro && <p className="erro" role="alert">{erro}</p>}
    </>
  );
}
