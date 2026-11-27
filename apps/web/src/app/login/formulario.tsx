'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { CabecalhoCartao } from '../cabecalho-cartao';
import { ComEsqueciSenha } from '@/components/esqueci-senha';
import { CampoSenha, ResultadoAcao, useResultado, type Resultado } from '@macuxierp/ui';
import { resultadoErro } from '@/lib/resultado-acao';
import { TEXTOS_ESQUECI } from '@/lib/esqueci-resultado';
import { gravarCodigoDoLogin, lerCodigoSalvo } from '@/lib/codigo-salvo';
import { primeiroVazio, TEXTOS_BLOQUEIO, TEXTOS_LOGIN as T, validarCampos, type CampoLogin, type ErrosLogin } from '@/lib/login-regras';
import { entrarAction, type EstadoLogin } from './entrar';

const TEXTOS_LOGIN_TITULO = 'Acesse sua conta';
export interface ValoresLogin { empresa: string; email: string; senha: string }
const CAMPOS: readonly CampoLogin[] = ['empresa', 'email', 'senha'];

/** Parte visual pura (testável sem DOM). Código, e-mail e senha só no estado do formulário: nunca em URL nem storage (o código, só pelo `codigo-salvo`). */
export function VisaoLogin({ destino, valores, erros = {}, resultado, chave = 0, bloqueada = false, aoRecuperar, pendente = false, senhaVisivel = false, aoAlternarSenha = () => undefined, aoMudar, aoEnviar }: {
  destino: string;
  valores: ValoresLogin;
  erros?: ErrosLogin;
  /** Retorno do Entrar (erro de login), de `useResultado()`. */
  resultado?: Resultado | null;
  chave?: number;
  /** Conta bloqueada (T-0111): cartão de aviso, "Recuperar a senha" (se `aoRecuperar`) e "Entrar" desabilitado. */
  bloqueada?: boolean;
  aoRecuperar?: (() => void) | undefined;
  pendente?: boolean;
  senhaVisivel?: boolean;
  aoAlternarSenha?: () => void;
  aoMudar?: (campo: CampoLogin, valor: string) => void;
  aoEnviar?: (f: HTMLFormElement) => void;
}) {
  const campo = (c: 'empresa' | 'email', tipo: 'text' | 'email', auto: string) => (
    <label className="campo campo-login">
      <span>{T.rotulos[c]}</span>
      <input
        name={c}
        type={tipo}
        value={valores[c]}
        onChange={(e) => aoMudar?.(c, e.target.value)}
        autoComplete={auto}
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={erros[c] ? true : undefined}
        aria-describedby={erros[c] ? `login-erro-${c}` : undefined}
      />
      {erros[c] && <small className="erro-campo" id={`login-erro-${c}`}>{erros[c]}</small>}
    </label>
  );
  return (
    <form noValidate aria-busy={pendente} onSubmit={(e) => { e.preventDefault(); aoEnviar?.(e.currentTarget); }}>
      {bloqueada && (
        <>
          <div className="faixa-aviso" role="alert">
            <strong>{TEXTOS_BLOQUEIO.titulo}</strong>
            <p>{TEXTOS_BLOQUEIO.texto}</p>
          </div>
          {aoRecuperar && <button className="mx-botao botao-recuperar" type="button" onClick={aoRecuperar}>{TEXTOS_BLOQUEIO.botao}</button>}
        </>
      )}
      <input type="hidden" name="destino" value={destino} />
      {campo('empresa', 'text', 'organization')}
      {campo('email', 'email', 'username')}
      <div className="campo-senha-bloco"><CampoSenha id="login-senha" rotulo={T.rotulos.senha} nome="senha" valor={valores.senha} aoMudar={(v) => aoMudar?.('senha', v)} visivel={senhaVisivel} aoAlternar={aoAlternarSenha} erro={erros.senha} /></div>
      <button className="mx-botao" type="submit" disabled={pendente || bloqueada}>{pendente ? T.botaoEnviando : T.botao}</button>
      {/* 36 A: o erro do Entrar fica logo abaixo do botão */}
      <ResultadoAcao resultado={resultado ?? null} chave={chave} />
    </form>
  );
}

export function FormularioLogin({ destino, esqueciDisponivel = false }: { destino: string; esqueciDisponivel?: boolean }) {
  const [valores, setValores] = useState<ValoresLogin>({ empresa: '', email: '', senha: '' });
  const [erros, setErros] = useState<ErrosLogin>({});
  const [resultado, chave, mostrar, limpar] = useResultado();
  const [bloqueada, setBloqueada] = useState(false);
  const [pendente, comecar] = useTransition();
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const raiz = useRef<HTMLDivElement | null>(null);

  function focar(nome: CampoLogin | undefined) {
    if (nome) (raiz.current?.querySelector(`[name="${nome}"]`) as HTMLInputElement | null)?.focus();
  }
  // Volta com o código lembrado; o foco abre no primeiro campo vazio.
  useEffect(() => {
    const salvo = lerCodigoSalvo();
    if (salvo) setValores((v) => ({ ...v, empresa: v.empresa || salvo }));
    focar(primeiroVazio(['empresa', 'email'], { empresa: salvo ?? '', email: '' }));
  }, []);

  function aplicar(r: EstadoLogin) {
    if (r.entrou) {
      gravarCodigoDoLogin(r.entrou.destino, valores.empresa);
      window.location.assign(r.entrou.para);
      return;
    }
    if (r.erro) mostrar(resultadoErro(r.erro));
    else limpar();
    setErros(r.campos ?? {});
    setBloqueada(r.bloqueada === true);
    if (r.bloqueada) setValores((v) => ({ ...v, senha: '' }));
    else if (r.erro) {
      setValores((v) => ({ ...v, senha: '' })); // erro de login: senha limpa, foco nela
      requestAnimationFrame(() => focar('senha'));
    } else focar(CAMPOS.find((c) => r.campos?.[c]));
  }

  function enviar(f: HTMLFormElement) {
    const e = validarCampos(CAMPOS, valores);
    limpar();
    setErros(e);
    const primeiro = CAMPOS.find((c) => e[c]);
    if (primeiro) return focar(primeiro);
    const dados = new FormData(f);
    comecar(async () => aplicar(await entrarAction(dados)));
  }

  return (
    <div ref={raiz}>
      <ComEsqueciSenha disponivel={esqueciDisponivel} ocultarLink={bloqueada} empresaInicial={valores.empresa} emailInicial={valores.email} cabecalho={(aberto) => <CabecalhoCartao titulo={aberto ? TEXTOS_ESQUECI.tituloPainel : TEXTOS_LOGIN_TITULO} />}>
        {(abrir) => (
          <VisaoLogin destino={destino} valores={valores} erros={erros} resultado={resultado} chave={chave} bloqueada={bloqueada} aoRecuperar={esqueciDisponivel ? abrir : undefined} pendente={pendente} senhaVisivel={senhaVisivel} aoAlternarSenha={() => setSenhaVisivel((v) => !v)} aoMudar={(c, v) => { if (c !== 'senha') setBloqueada(false); setValores((x) => ({ ...x, [c]: v })); }} aoEnviar={enviar} />
        )}
      </ComEsqueciSenha>
    </div>
  );
}
