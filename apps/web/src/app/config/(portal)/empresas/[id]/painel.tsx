'use client';
import type { EmpresaPlataforma, ModuloId } from '@macuxierp/platform-sdk';
import { DialogoMotivo, FaixaPendencias, RegiaoErros } from '@macuxierp/ui';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { Resultado } from '@/lib/config/executar';
import { validarMotivo } from '@/lib/config/formularios';
import { alternar, ativosDe, dependentesLigados, linhasModulos, mudancasDe, nomeModulo, pendenciasDe, type Dependencia } from '@/lib/config/modulos';
import { alterarModulosAcao, criarAdminAcao, redefinirSenhaAcao, situacaoAcao } from '../acoes';

export interface ChavesPainel {
  admin: string;
  senha: string;
  situacao: string;
}

interface Comum {
  empresa: EmpresaPlataforma;
  aoErro: (tem: boolean) => void;
}

export function PainelEmpresa({ empresa, deps, chaves }: { empresa: EmpresaPlataforma; deps: Dependencia[]; chaves: ChavesPainel }) {
  const [temErro, setTemErro] = useState(false);
  const [mudou, setMudou] = useState(false);
  return (
    <>
      <RegiaoErros temErro={temErro} />
      <BlocoModulos empresa={empresa} deps={deps} aoErro={setTemErro} aoMudar={setMudou} />
      <BlocoAdmin empresa={empresa} chaves={chaves} aoErro={setTemErro} principal={!mudou} />
      <BlocoSituacao empresa={empresa} chave={chaves.situacao} aoErro={setTemErro} />
    </>
  );
}

function BlocoModulos({ empresa, deps, aoErro, aoMudar }: Comum & { deps: Dependencia[]; aoMudar: (m: boolean) => void }) {
  const [marcados, setMarcados] = useState<Set<ModuloId>>(() => ativosDe(empresa.modulos));
  const [desligar, setDesligar] = useState<{ modulo: ModuloId; dependentes: ModuloId[] } | null>(null);
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);
  const [pendente, iniciar] = useTransition();
  const mudancas = mudancasDe(empresa.modulos, marcados);
  const editavel = empresa.situacao !== 'encerrado';

  useEffect(() => aoMudar(mudancas.length > 0), [mudancas.length, aoMudar]);

  const aplicar = (m: ModuloId, ligar: boolean) => {
    setSalvo(false);
    setMarcados((atual) => alternar(m, ligar, atual, deps));
  };
  const marcar = (m: ModuloId, ligar: boolean) => {
    const dependentes = ligar ? [] : dependentesLigados(m, marcados, deps);
    if (dependentes.length > 0) setDesligar({ modulo: m, dependentes });
    else aplicar(m, ligar);
  };
  const salvar = () =>
    iniciar(async () => {
      const r = await alterarModulosAcao(empresa.id, mudancas);
      setErro(r.ok ? '' : r.erro);
      setCampos(r.ok ? {} : r.campos);
      aoErro(!r.ok);
      setSalvo(r.ok);
    });
  const pendencias = pendenciasDe(campos, marcados, deps);

  return (
    <section className="bloco" aria-labelledby="h-modulos">
      <h2 id="h-modulos">Módulos</h2>
      <FaixaPendencias itens={pendencias} />
      {erro && pendencias.length === 0 && <p className="erro">{erro}</p>}
      <ul className="lista-modulos">
        {linhasModulos(marcados, deps).map((l) => (
          <li key={l.modulo}>
            <label>
              <input type="checkbox" checked={l.marcado} disabled={l.desabilitado || !editavel || pendente} onChange={(e) => marcar(l.modulo, e.target.checked)} />
              {nomeModulo(l.modulo)}
            </label>
            {l.motivo && <span className="apoio"> {l.motivo}</span>}
          </li>
        ))}
      </ul>
      <button className={mudancas.length > 0 ? 'mx-botao' : 'mx-botao-secundario'} type="button" disabled={mudancas.length === 0 || pendente || !editavel} onClick={salvar}>
        {pendente ? 'Salvando…' : 'Salvar módulos'}
      </button>
      {salvo && <p className="apoio" role="status">Módulos salvos.</p>}
      {desligar && (
        <DialogoMotivo
          titulo={`Desligar ${nomeModulo(desligar.modulo)}?`}
          aviso={`Também serão desligados: ${desligar.dependentes.map(nomeModulo).join(', ')}.`}
          rotuloTexto="Observação"
          rotuloConfirmar="Desligar"
          rotuloFechar="Manter ligado"
          destrutivo
          aoConfirmar={() => {
            aplicar(desligar.modulo, false);
            setDesligar(null);
          }}
          aoCancelar={() => setDesligar(null)}
        />
      )}
    </section>
  );
}

const rotuloAdmin = (a: NonNullable<EmpresaPlataforma['primeiro_admin']>) => (a.bloqueado ? 'Bloqueado' : a.ativo ? 'Ativo' : 'Inativo');

function BlocoAdmin({ empresa, chaves, aoErro, principal }: Comum & { chaves: ChavesPainel; principal: boolean }) {
  const [senha, setSenha] = useState<string | null>(null); // só na memória desta tela: nunca em URL, armazenamento ou log
  const [copiado, setCopiado] = useState(false);
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('Administrador');
  const [chaveCriar, setChaveCriar] = useState(chaves.admin);
  const [chaveSenha, setChaveSenha] = useState(chaves.senha);
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [pendente, iniciar] = useTransition();
  const painel = useRef<HTMLDivElement>(null);
  const botaoRedefinir = useRef<HTMLButtonElement>(null);
  const admin = empresa.primeiro_admin;
  const editavel = empresa.situacao !== 'encerrado';

  useEffect(() => {
    if (senha) painel.current?.focus();
  }, [senha]);

  const resultado = (r: Resultado<{ senha: string }>, renovar: (k: string) => void) => {
    if (r.ok) {
      setErro('');
      setCampos({});
      setCopiado(false);
      setSenha(r.valor.senha);
      renovar(crypto.randomUUID());
    } else {
      setErro(r.erro);
      setCampos(r.campos);
      if (r.chaveNova) renovar(crypto.randomUUID());
    }
    aoErro(!r.ok);
  };
  const criar = () =>
    iniciar(async () => resultado(await criarAdminAcao(empresa.id, { email, nome }, chaveCriar), setChaveCriar));
  const redefinir = () => {
    setConfirmar(false);
    iniciar(async () => resultado(await redefinirSenhaAcao(empresa.id, chaveSenha), setChaveSenha));
  };
  const copiar = async () => {
    if (!senha) return;
    try {
      await navigator.clipboard.writeText(senha);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <section className="bloco" aria-labelledby="h-admin">
      <h2 id="h-admin">1º administrador</h2>
      {erro && <p className="erro">{erro}</p>}
      {admin ? (
        <>
          <p>Situação: <strong>{rotuloAdmin(admin)}</strong></p>
          <button ref={botaoRedefinir} className="mx-botao-secundario" type="button" disabled={pendente || !editavel} onClick={() => setConfirmar(true)}>Redefinir senha</button>
        </>
      ) : (
        <form
          className="formulario formulario-estreito"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            criar();
          }}
        >
          <label className="campo">
            <span>E-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={campos.email ? true : undefined} aria-describedby="erro-email" />
            {campos.email && <span id="erro-email" className="erro-campo">{campos.email}</span>}
          </label>
          <label className="campo">
            <span>Nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="off" aria-invalid={campos.nome ? true : undefined} aria-describedby="erro-nome-admin" />
            {campos.nome && <span id="erro-nome-admin" className="erro-campo">{campos.nome}</span>}
          </label>
          <button className={principal ? 'mx-botao' : 'mx-botao-secundario'} type="submit" disabled={pendente || !editavel}>{pendente ? 'Criando…' : 'Criar administrador'}</button>
        </form>
      )}
      {senha && (
        <div ref={painel} tabIndex={-1} className="painel-senha" role="group" aria-label="Senha provisória">
          <code className="senha-provisoria">{senha}</code>
          <div className="barra-acoes">
            <button className="mx-botao-secundario" type="button" onClick={copiar}>Copiar</button>
            <button className="mx-botao-secundario" type="button" onClick={() => { setSenha(null); setCopiado(false); }}>Já entreguei</button>
          </div>
          <p role="status" className="apoio">{copiado ? 'Copiado' : ''}</p>
          <p className="faixa-aviso">Esta senha não volta a aparecer. Entregue ao administrador por canal seguro.</p>
        </div>
      )}
      {confirmar && (
        <DialogoMotivo
          titulo="Redefinir a senha do administrador?"
          aviso="A trava é zerada e as sessões dele são encerradas."
          rotuloTexto="Observação"
          rotuloConfirmar="Redefinir"
          rotuloFechar="Cancelar"
          aoConfirmar={redefinir}
          aoCancelar={() => setConfirmar(false)}
        />
      )}
    </section>
  );
}

const AVISO_DADO_PESSOAL = 'Não escreva dado pessoal no motivo: ele fica registrado na auditoria.';

function BlocoSituacao({ empresa, chave, aoErro }: Comum & { chave: string }) {
  const [aberto, setAberto] = useState(false);
  const [chaveAtual, setChave] = useState(chave);
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const suspender = empresa.situacao === 'ativo';
  if (empresa.situacao === 'encerrado') {
    return (
      <section className="bloco" aria-labelledby="h-situacao">
        <h2 id="h-situacao">Situação</h2>
        <p>Empresa encerrada. O portal não altera empresas encerradas.</p>
      </section>
    );
  }
  const confirmar = (motivo: string) => {
    setAberto(false);
    iniciar(async () => {
      const r = await situacaoAcao(empresa.id, suspender ? 'suspenso' : 'ativo', motivo, chaveAtual);
      setErro(r.ok ? '' : r.erro || r.campos.motivo || '');
      aoErro(!r.ok);
      if (r.ok || r.chaveNova) setChave(crypto.randomUUID());
    });
  };
  const nome = empresa.nome;
  return (
    <section className="bloco" aria-labelledby="h-situacao">
      <h2 id="h-situacao">Situação</h2>
      {erro && <p className="erro">{erro}</p>}
      <button className="mx-botao-secundario" type="button" disabled={pendente} onClick={() => setAberto(true)}>{suspender ? 'Suspender empresa' : 'Reativar empresa'}</button>
      {aberto && (
        <DialogoMotivo
          titulo={`${suspender ? 'Suspender' : 'Reativar'} ${nome}?`}
          textoObrigatorio
          rotuloTexto="Motivo"
          aviso={suspender ? `Os usuários da empresa deixam de entrar. ${AVISO_DADO_PESSOAL}` : AVISO_DADO_PESSOAL}
          validar={(r) => validarMotivo(r.texto)}
          rotuloConfirmar={suspender ? 'Suspender' : 'Reativar'}
          rotuloFechar={suspender ? 'Manter ativa' : 'Cancelar'}
          destrutivo={suspender}
          aoConfirmar={(r) => confirmar(r.texto.trim())}
          aoCancelar={() => setAberto(false)}
        />
      )}
    </section>
  );
}
