'use client';
import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { acumularPagina } from '@macuxierp/ui/paginacao';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { modulosLigados, nomeModulo } from '@/lib/config/modulos';
import { maisEmpresasAcao } from './empresas/acoes';
import { SeloSituacao } from './selo-situacao';

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
    { id: 'slug', titulo: 'Slug', celula: (e) => (
        <Link href={`/config/empresas/${e.id}`} className="codigo" onClick={(ev) => ev.stopPropagation()}>
          {e.slug}
        </Link>
      ),
    },
    { id: 'nome', titulo: 'Nome', celula: (e) => e.nome },
    { id: 'situacao', titulo: 'Situação', celula: (e) => <SeloSituacao situacao={e.situacao} /> },
    { id: 'modulos', titulo: 'Módulos', celula: (e) => modulosLigados(e.modulos).map(nomeModulo).join(', ') || 'Só o core' },
  ];
  return (
    <>
    <div className="tabela-rolavel com-sinal-rolagem">
      <TabelaDensa
        colunas={colunas}
        linhas={linhas}
        chaveLinha={(e) => e.id}
        aoClicarLinha={(e) => router.push(`/config/empresas/${e.id}`)}
        rotuloLinha={(e) => `Abrir empresa ${e.slug}`}
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
