'use client';
import { RegiaoErros } from '@macuxierp/ui';
import { useState, useTransition, type FormEvent } from 'react';
import { CriarEmpresaEntrada } from '@macuxierp/platform-sdk';
import { traduzirCriarEmpresa } from '@/lib/config/formularios';
import { criarEmpresaAcao } from '@/lib/acoes-cliente';

export function FormularioEmpresa({ chaveInicial }: { chaveInicial: string }) {
  const [chave, setChave] = useState(chaveInicial);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();

  const enviar = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault(); // sem o reset do <form action>: o que a pessoa digitou fica ao errar
    const f = new FormData(ev.currentTarget);
    const entrada = { codigo: String(f.get('codigo') ?? ''), nome: String(f.get('nome') ?? ''), fuso: String(f.get('fuso') ?? '') };
    const previa = CriarEmpresaEntrada.safeParse({ codigo: entrada.codigo.trim() || undefined, nome: entrada.nome, fuso: entrada.fuso.trim() || undefined });
    if (entrada.codigo.trim() === '' || !previa.success) {
      setCampos(traduzirCriarEmpresa(previa.success ? null : previa.error, entrada.codigo));
      setErro('');
      return;
    }
    setCampos({});
    setErro('');
    iniciar(async () => {
      const r = await criarEmpresaAcao(entrada, chave); // sucesso redireciona para a empresa
      if (r.ok) return;
      setCampos(r.campos);
      setErro(r.erro);
      if (r.chaveNova) setChave(crypto.randomUUID());
    });
  };

  return (
    <form method="post" onSubmit={enviar} className="formulario formulario-estreito" noValidate>
      <RegiaoErros temErro={Object.keys(campos).length > 0 || erro !== ''} />
      {erro && <p className="erro">{erro}</p>}
      <label className="campo">
        <span>Código do FDV</span>
        <input name="codigo" autoCapitalize="characters" autoComplete="off" maxLength={6} required aria-invalid={campos.codigo ? true : undefined} aria-describedby="ajuda-codigo erro-codigo" />
        <span id="ajuda-codigo" className="apoio">UF e 4 dígitos, como no FDV, por exemplo AM2808.</span>
        {campos.codigo && <span id="erro-codigo" className="erro-campo">{campos.codigo}</span>}
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
