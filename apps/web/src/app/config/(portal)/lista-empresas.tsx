'use client';
import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { modulosLigados, nomeModulo } from '@/lib/config/modulos';
import { SeloSituacao } from './selo-situacao';

export function ListaEmpresas({ empresas, vazio }: { empresas: EmpresaPlataforma[]; vazio: string }) {
  const router = useRouter();
  const colunas: ColunaTabela<EmpresaPlataforma>[] = [
    { id: 'slug', titulo: 'Slug', celula: (e) => <span className="codigo">{e.slug}</span> },
    { id: 'nome', titulo: 'Nome', celula: (e) => e.nome },
    { id: 'situacao', titulo: 'Situação', celula: (e) => <SeloSituacao situacao={e.situacao} /> },
    { id: 'modulos', titulo: 'Módulos', celula: (e) => modulosLigados(e.modulos).map(nomeModulo).join(', ') || 'Só o core' },
  ];
  return (
    <div className="tabela-rolavel">
      <TabelaDensa
        colunas={colunas}
        linhas={empresas}
        chaveLinha={(e) => e.id}
        aoClicarLinha={(e) => router.push(`/config/empresas/${e.id}`)}
        rotuloLinha={(e) => `Abrir empresa ${e.slug}`}
        textoVazio={vazio}
        legenda="Empresas"
      />
    </div>
  );
}
