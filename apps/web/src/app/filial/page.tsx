import { CabecalhoCartao } from '../cabecalho-cartao';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { formatarCnpj } from '@/lib/cnpj';
import { contexto, COOKIE_FILIAL, opcoesLongas } from '@/lib/sessao';

export const metadata: Metadata = { title: 'Selecionar filial' };

async function escolher(dados: FormData) {
  'use server';
  const { eu } = await contexto();
  const id = String(dados.get('filial') ?? '');
  if (!eu.filiais.some((f) => f.id === id)) redirect('/filial');
  (await cookies()).set(COOKIE_FILIAL, id, opcoesLongas);
  redirect('/');
}

export default async function SelecionarFilial() {
  const { eu, filial } = await contexto();
  return (
    <main className="cartao-central">
      <CabecalhoCartao titulo="Selecionar filial" />
      <p className="apoio">Empresa: {eu.empresa.razao_social}</p>
      <form action={escolher}>
        <ul className="lista-escolha">
          {eu.filiais.map((f) => (
            <li key={f.id}>
              <label>
                <input type="radio" name="filial" value={f.id} defaultChecked={f.id === filial?.id} required /> {f.nome} (<span className="num">{formatarCnpj(f.cnpj)}</span>)
              </label>
            </li>
          ))}
        </ul>
        <button className="btn" type="submit">Continuar</button>
      </form>
    </main>
  );
}
