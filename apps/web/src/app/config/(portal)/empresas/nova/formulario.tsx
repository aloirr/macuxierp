'use client';
import { RegiaoErros } from '@macuxierp/ui';
import { useState, useTransition } from 'react';
import { criarEmpresaAcao } from '../acoes';

export function FormularioEmpresa({ chaveInicial }: { chaveInicial: string }) {
  const [chave, setChave] = useState(chaveInicial);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();

  const enviar = (f: FormData) => {
    const entrada = { slug: String(f.get('slug') ?? ''), nome: String(f.get('nome') ?? ''), fuso: String(f.get('fuso') ?? '') };
    iniciar(async () => {
      const r = await criarEmpresaAcao(entrada, chave); // sucesso redireciona para a empresa
      if (r.ok) return;
      setCampos(r.campos);
      setErro(r.erro);
      if (r.chaveNova) setChave(crypto.randomUUID());
    });
  };

  return (
    <form action={enviar} className="formulario formulario-estreito" noValidate>
      <RegiaoErros temErro={Object.keys(campos).length > 0 || erro !== ''} />
      {erro && <p className="erro">{erro}</p>}
      <label className="campo">
        <span>Código</span>
        <input name="slug" required autoCapitalize="none" autoComplete="off" aria-invalid={campos.slug ? true : undefined} aria-describedby="ajuda-slug erro-slug" />
        <span id="ajuda-slug" className="apoio">2 a 40 letras minúsculas, dígitos ou hífen, começando por letra ou dígito. Vira o endereço da empresa.</span>
        {campos.slug && <span id="erro-slug" className="erro-campo">{campos.slug}</span>}
      </label>
      <label className="campo">
        <span>Nome</span>
        <input name="nome" required maxLength={120} autoComplete="off" aria-invalid={campos.nome ? true : undefined} aria-describedby="erro-nome" />
        {campos.nome && <span id="erro-nome" className="erro-campo">{campos.nome}</span>}
      </label>
      <label className="campo">
        <span>Fuso</span>
        <input name="fuso" defaultValue="America/Manaus" autoComplete="off" aria-invalid={campos.fuso ? true : undefined} aria-describedby="erro-fuso" />
        {campos.fuso && <span id="erro-fuso" className="erro-campo">{campos.fuso}</span>}
      </label>
      <div className="barra-acoes">
        <button className="mx-botao" type="submit" disabled={pendente}>{pendente ? 'Criando…' : 'Criar empresa'}</button>
        <a className="mx-botao-secundario" href="/config">Cancelar</a>
      </div>
    </form>
  );
}
