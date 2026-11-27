CSS="""
:root{--azul:var(--mx-cor-azul-noite);--fundo:var(--mx-cor-perola);--borda:var(--mx-cor-borda-tabela);--texto:var(--mx-cor-grafite);--sub:var(--mx-cor-texto-secundario);
--ok:var(--mx-cor-ativo-fundo);--okt:var(--mx-cor-ativo-texto);--al:var(--mx-cor-aviso-fundo);--alt:var(--mx-cor-aviso-texto);--erro:var(--mx-cor-erro-texto);--linha:var(--mx-cor-nevoa);
--cab:#E6EBF3;--alterna:#FBFAF8;
--campo:34px;--gap:12px;--pad:16px;--raio:8px;--f:var(--mx-tamanho-pequeno);--rot:var(--mx-tamanho-micro);--btn:var(--mx-tamanho-pequeno)}
*{box-sizing:border-box}body{margin:0;font:var(--f)/1.35 var(--mx-fonte-texto);color:var(--texto);background:var(--fundo)}
.topo{display:flex;align-items:center;gap:16px;background:var(--mx-cor-grafite);color:#fff;padding:0 24px;height:48px}.topo b{font-size:15px}.topo .mn{opacity:.75;font-size:var(--btn)}
.marca{margin-left:auto;background:var(--al);color:var(--alt);font-size:var(--rot);padding:2px 8px;border-radius:10px}.topo img{height:20px;margin-right:4px}.plat{border:1px solid var(--mx-cor-azul-claro);border-radius:10px;padding:2px 8px;font-size:var(--rot);font-weight:600}.topo a{color:#fff}
.pg{padding:16px 24px 16px}.cab{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px}.cab h1{font-size:20px;margin:0}.cab .meta{color:var(--sub);font-size:var(--btn)}
.selo{display:inline-flex;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--ok);color:var(--okt);white-space:nowrap}.selo.al{background:var(--al);color:var(--alt)}.selo.cz{background:var(--mx-cor-nevoa);color:var(--sub)}
.btn{height:var(--campo);padding:0 14px;border:1px solid var(--borda);background:#fff;border-radius:6px;font:600 var(--btn) var(--mx-fonte-texto);color:var(--texto);white-space:nowrap}.btn.p{background:var(--azul);color:#fff;border-color:var(--azul)}.btn.r{color:var(--erro);border-color:var(--erro)}
.abas{display:flex;gap:24px;border-bottom:1px solid var(--borda);margin-bottom:14px}.abas a{padding:8px 0;color:var(--sub);text-decoration:none;font-weight:600}.abas a.at{color:var(--texto);border-bottom:3px solid var(--azul)}
.g{display:grid;grid-template-columns:repeat(12,1fr);gap:var(--gap);align-items:start}
.sec{display:flex;flex-direction:column;gap:6px;min-width:0;height:100%}
.tit{display:flex;align-items:center;gap:8px;min-height:30px;margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--azul)}
.tit .n{font-weight:600;color:var(--sub);text-transform:none;letter-spacing:0}.tit .dir{margin-left:auto;display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0}
.card{background:#fff;border:1px solid var(--borda);border-radius:var(--raio);padding:var(--pad);flex:1}.card.t{padding:0;overflow:hidden}
.f{display:flex;flex-direction:column;gap:3px;min-width:0}.f label{font-size:var(--rot);color:var(--mx-cor-rotulo-destaque);font-weight:600}
.f input{height:var(--campo);border:1px solid var(--borda);border-radius:6px;padding:0 10px;font:var(--f) var(--mx-fonte-texto);width:100%}
.f .ro{height:var(--campo);display:flex;align-items:center;gap:8px;font-weight:600}
.s1{grid-column:span 1}.s2{grid-column:span 2}.s3{grid-column:span 3}.s4{grid-column:span 4}.s5{grid-column:span 5}.s6{grid-column:span 6}.s12{grid-column:span 12}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--borda);border-radius:6px;padding:4px 8px;font-size:12px;background:var(--mx-cor-nevoa)}.chip b{font-family:var(--mx-fonte-codigo);margin-right:4px}
.mods{display:flex;flex-direction:column;gap:7px}.mods label{display:flex;gap:6px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:var(--btn)}
th{background:var(--cab);color:var(--azul);text-align:left;font-size:var(--rot);font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:0 12px;height:34px;border-bottom:2px solid var(--azul);white-space:nowrap}
td{padding:0 12px;height:36px;border-bottom:1px solid var(--linha);white-space:nowrap}tbody tr:nth-child(even) td{background:var(--alterna)}tr:last-child td{border-bottom:0}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.err{color:var(--erro);font-weight:700}
.ac{text-align:right}.ac a{color:var(--azul);font-weight:600;margin-left:14px;text-decoration:none}.ac a.r{color:var(--erro)}
.kv{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px}.kv div{display:flex;flex-direction:column;gap:2px}.kv span{font-size:var(--rot);color:var(--mx-cor-rotulo-destaque);font-weight:600}.kv b{font-size:13px}
.barra{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pe{border-top:1px solid var(--linha);padding:10px 12px}
.rodape{position:sticky;bottom:0;flex-wrap:wrap;gap:8px;background:#fff;border-top:1px solid var(--borda);padding:8px 24px;display:flex;align-items:center}.rodape .d{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:767px){.g>*{grid-column:1/-1!important}.g .g>*{grid-column:1/-1!important}.cab h1{font-size:var(--mx-tamanho-medio)}.kv{grid-template-columns:repeat(2,1fr)}.card.t{overflow-x:auto}.rodape{padding:8px 16px}.topo{padding:0 16px;gap:10px}.topo .nome{display:none}.card.t td{white-space:normal;height:auto;padding:8px 10px}.card.t td.ac a{display:block;margin:2px 0}.card.t tr>*:nth-child(2),.card.t tr>*:nth-child(3),.card.t tr>*:nth-child(5){display:none}.rodape .d{margin-left:0;width:100%}.rodape .d .btn{flex:1 1 auto}.pg{padding:16px}.topo .marca,.topo .mn{display:none}}
.cortina{position:fixed;inset:0;background:var(--mx-cor-grafite);opacity:.55}.dlg{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,92vw);background:#fff;border-radius:var(--raio);padding:24px;display:grid;gap:12px}.dlg h2{margin:0;font-size:var(--mx-tamanho-grande);color:var(--azul)}.dlg .fx{background:var(--mx-cor-erro-fundo);color:var(--erro);padding:8px 12px;border-radius:6px}.btn.r.cheio{background:var(--erro);color:#fff;opacity:.5}
"""
def sec(span,titulo,corpo,dir_='',tabela=False,n=''):
    nn=f'<span class="n">{n}</span>' if n else ''
    return f'<section class="sec {span}"><h2 class="tit">{titulo}{nn}<span class="dir">{dir_}</span></h2><div class="card{" t" if tabela else ""}">{corpo}</div></section>'
def tabela(cols,linhas):
    th=''.join(f'<th class="{"n" if c.startswith("#") else ""}">{c.lstrip("#")}</th>' for c in cols)
    return f'<table><thead><tr>{th}</tr></thead><tbody>{"".join(linhas)}</tbody></table>'
def pagina(nome,selos,acoes,aba,corpo,rodape=True):
    abas=''.join(f'<a class="{"at" if a==aba else ""}" href="#">{a}</a>' for a in ['Empresa','Integrações'])
    h=f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Simulação</title><link rel="stylesheet" href="../../../packages/ui/src/tokens.css"><style>{CSS}</style></head><body>'
    h+='<div class="topo"><img src="../../marca/ativos/2026-11-22-v1/macuxi-erp-a-negativo-grafite.svg" alt="Macuxi ERP"><span class="plat">Plataforma</span><a href="#">Empresas</a><span class="marca">SIMULAÇÃO · dados fictícios</span><span style="margin-left:12px;font-size:var(--btn)"><span class="nome">Superadmin Fictício · </span><a href="#">Sair</a></span></div><div class="pg">'
    h+=f'<div class="cab"><h1>EMPRESA EXEMPLO COMÉRCIO LTDA</h1><span class="meta">AM0000 · criada em 22/11/2026 08:41</span><span class="selo">● Ativa</span>{selos}</div><div class="abas">{abas}</div>'
    h+=f'<div class="g">{corpo}</div></div>'
    sal='<button class="btn">Descartar</button><button class="btn p">Salvar</button>' if rodape else ''
    txt='Nenhuma alteração pendente' if rodape else ''
    esp='<span style="width:16px"></span>' if (acoes or sal) else ''
    h+=f'<div class="rodape"><span style="color:var(--sub);font-size:var(--btn)">{txt}</span><div class="d"><button class="btn r">Suspender empresa</button>{esp}{acoes}{sal}</div></div>'
    return h+'</body></html>'
F=lambda s,l,inp: f'<div class="f {s}"><label>{l}</label>{inp}</div>'
I=lambda v='',ph='': f'<input value="{v}" placeholder="{ph}">'
ident='<div class="g">'+F('s5','Razão social',I('EMPRESA EXEMPLO COMÉRCIO LTDA'))+F('s3','Nome fantasia',I(ph='—'))+F('s2','CNPJ','<div class="ro">00.000.000/0001-00 <a href="#" style="color:var(--azul);font-size:12px">trocar</a></div>')+F('s2','Inscrição estadual',I(ph='Números ou ISENTO'))+'</div>'
end='<div class="g">'+F('s1','CEP',I('69000-000'))+F('s4','Logradouro',I(ph='—'))+F('s1','Número',I())+F('s2','Complemento',I())+F('s2','Bairro',I('CENTRO'))+F('s2','Município · UF','<div class="ro">Manaus · AM <small style="color:var(--sub);font-weight:400">IBGE 1302603</small></div>')+'</div>'
cn=[('4781-4/00','Varejo de vestuário · principal'),('4751-2/01','Equip. de informática'),('7319-0/02','Promoção de vendas'),('8599-6/04','Treinamento profissional'),('8599-6/03','Treinamento em informática'),('8219-9/99','Apoio administrativo'),('4789-0/07','Equip. para escritório'),('8599-6/99','Outras atividades de ensino')]
cnae='<div class="chips">'+''.join(('<span class="chip" style="border-color:var(--azul)">' if i==0 else '<span class="chip">')+f'<b>{c}</b>{d}</span>' for i,(c,d) in enumerate(cn))+'</div>'
M=lambda v: f'<div class="ro" style="font-weight:400">{v} <a href="#" style="color:var(--azul);font-size:var(--rot)">mostrar</a></div>'
cont='<div class="g">'+F('s12','E-mail',M('co****@exemplo.com'))+F('s12','Telefone (DDD + número)',M('(92) ****-0000'))+'</div>'
mods='<div class="mods">'+''.join(f'<label><input type="checkbox" checked> {m}</label>' for m in ['Cadastros','Pedidos','Faturamento','Fiscal','Integração FDV'])+'</div>'
us=[('Ana Exemplo','an****@exemplo.com','Administrador BKO','Ativo','27/11 16:42'),('Bruno Exemplo','br****@exemplo.com','Faturista','Ativo','27/11 15:10'),('Carla Exemplo','ca****@exemplo.com','Fiscal','Ativo','26/11 18:03'),('Diego Exemplo','di****@exemplo.com','Vendas (leitura)','Convite enviado','—'),('Elisa Exemplo','el****@exemplo.com','Fiscal','Inativo','02/10 11:40')]
lin=[f'<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td><span class="selo {"" if d=="Ativo" else ("cz" if d=="Inativo" else "al")}">{d}</span></td><td>{e}</td><td class="ac"><a href="#">Editar</a><a href="#">Redefinir senha</a><a class="r" href="#">Excluir</a></td></tr>' for a,b,c,d,e in us]
busca='<input placeholder="Buscar nome ou e-mail" style="height:30px;border:1px solid var(--borda);border-radius:6px;padding:0 10px;width:220px;font:12.5px var(--mx-fonte-texto)">'
corpo=sec('s12','Identificação',ident)+sec('s12','Endereço',end)+sec('s6','Atividades (CNAE)',cnae)+sec('s3','Contato',cont)+sec('s3','Módulos',mods)+sec('s12','Usuários',tabela(['Nome','E-mail','Perfil','Situação','Último acesso',''],lin)+'<div class="barra pe"><button class="btn p">+ Adicionar usuário</button></div>',busca,True,'· 5')
EMP=('Empresa','<span class="selo">✓ Igual à Receita · consultada 27/11 10:10</span>','<button class="btn">Atualizar pela Receita</button>','Empresa',corpo)
open('empresa.html','w').write(pagina(*EMP))
def lado(tit,selo,kv,bot,cols,dados,pe):
    k='<div class="kv">'+''.join(f'<div><span>{x}</span><b>{y}</b></div>' for x,y in kv)+'</div>'
    trs=[f'<tr><td><b>{a}</b></td><td class="n">{b}</td><td class="n">{c}</td><td class="n {"err" if d!="0" else ""}">{d}</td><td>{e}</td></tr>' for a,b,c,d,e in dados]
    corpo=f'<div style="padding:16px">{k}</div>'+tabela(['Cadastro','#'+cols[0],'#'+cols[1],'#Com erro','Último lote'],trs)+f'<div class="barra pe">{bot}{pe}</div>'
    return sec('s6',tit,corpo,selo,True)
E=[('Filiais','2','2','0','27/11 17:00'),('Vendedores','7','7','0','27/11 17:00'),('Clientes','60','60','0','27/11 17:00'),('Endereços','59','59','0','27/11 17:00'),('Produtos','101','101','0','27/11 17:00'),('Preços','156','156','0','27/11 17:00'),('Estoque','133','133','0','27/11 17:00'),('Formas e prazos','1.141','1.141','0','27/11 17:00')]
S=[('Filiais','2','2','0','27/11 17:01'),('Vendedores','7','4','3','27/11 17:01'),('Clientes','60','32','28','27/11 17:02'),('Endereços','59','31','28','27/11 17:02'),('Produtos','101','101','0','27/11 17:02'),('Preços','156','110','46','27/11 17:03'),('Estoque','133','90','43','27/11 17:03'),('Formas e prazos','1.141','20','1.121','27/11 17:04')]
corpo=lado('Sistema do cliente → ERP','<span class="selo">● Ligada</span>',[('Código','ENT-0000'),('Ambiente','Produção'),('Último contato','27/11 17:58'),('Chave','•••• 7F2A')],'<button class="btn">Trocar chave</button><button class="btn">Importar</button>',('Recebidos','Gravados'),E,'<button class="btn">Baixar erros</button><span style="margin-left:auto"></span><button class="btn r">Substituir…</button><button class="btn r">Zerar cadastros…</button>')
corpo+=lado('ERP → Macuxi FDV','<span class="selo al">● Com recusas</span>',[('Destino','Macuxi FDV'),('Último envio','27/11 17:58'),('Registros por lote','500'),('Chave','•••• 91C0')],'<button class="btn">Testar conexão</button><button class="btn">Trocar chave</button>',('Enviados','Aceitos'),S,'<button class="btn">Erros por campo</button><span style="margin-left:auto"></span><button class="btn r">Zerar pedidos…</button>')
R=[('27/11 17:04','ERP → FDV','Formas e prazos','1.141','1.121','parcelas_dias com tipo inválido'),('27/11 17:03','ERP → FDV','Preços','156','46','produto ainda não recebido'),('27/11 17:00','Cliente → ERP','Carga completa','1.659','0','—')]
lr=[f'<tr><td>{a}</td><td>{b}</td><td>{c}</td><td class="n">{d}</td><td class="n {"err" if e!="0" else ""}">{e}</td><td>{f}</td><td class="ac"><a href="#">Detalhes</a></td></tr>' for a,b,c,d,e,f in R]
corpo+=sec('s12','Envios recentes',tabela(['Quando','Direção','Cadastro','#Registros','#Com erro','Principal motivo',''],lr)+'<div class="barra pe"><button class="btn">Ver todos os envios</button><button class="btn">Atualizar</button></div>','',True)
INT=('Integrações','<span class="selo al">● Envio ao FDV com recusas</span>','','Integrações',corpo,False)
open('integracoes.html','w').write(pagina(*INT))

def dialogo(base,html):
    b=pagina(*base)
    return b.replace('</body>','<div class="cortina"></div><div class="dlg" role="dialog">'+html+'</div></body>')
open('empresa-excluir-usuario.html','w').write(dialogo(EMP,'<h2>Excluir Ana Exemplo?</h2><div class="fx">Ana é a única administradora ativa. Antes, dê o perfil Administrador a outro usuário.</div><div class="barra"><button class="btn">Fechar</button></div>'))
open('integracoes-confirmacao-digitada.html','w').write(dialogo(INT,'<h2>Zerar pedidos não faturados?</h2><div class="fx">Apaga os 37 pedidos ainda não faturados de EMPRESA EXEMPLO COMÉRCIO LTDA. Não tem volta.</div><div class="f"><label>Digite o código da empresa (AM0000) para confirmar</label><input value="AM00"></div><div class="barra"><button class="btn">Cancelar</button><span style="margin-left:auto"></span><button class="btn r cheio" disabled>Zerar pedidos</button></div>'))
EM=[('EMPRESA EXEMPLO COMÉRCIO LTDA','AM0000','00.000.000/0001-00','Ativa','Cadastros · Pedidos · Faturamento · Fiscal · Integração FDV','<span class="selo al">Com recusas</span>','22/11/2026'),('DISTRIBUIDORA FICTÍCIA DO NORTE LTDA','AM0001','00.000.000/0002-80','Ativa','Cadastros · Pedidos · Integração FDV','<span class="selo">Ligada</span>','12/11/2026'),('ATACADO TESTE DO RIO LTDA','AM0002','00.000.000/0003-61','Ativa','Cadastros · Pedidos','—','21/10/2026'),('MERCANTIL EXEMPLO ME','AM0003','00.000.000/0004-42','Suspensa','Cadastros','—','30/09/2026')]
le=[f'<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td><span class="selo {"" if d=="Ativa" else "cz"}">{d}</span></td><td>{e}</td><td>{f}</td><td>{g}</td><td class="ac"><a href="#">Abrir</a></td></tr>' for a,b,c,d,e,f,g in EM]
bl='<input placeholder="Buscar por nome, código ou CNPJ" style="height:30px;border:1px solid var(--borda);border-radius:6px;padding:0 10px;width:260px;font:var(--btn) var(--mx-fonte-texto)">'
lista=pagina('','','','',sec('s12','Empresas',tabela(['Empresa','Código','CNPJ','Situação','Módulos','Macuxi FDV','Criada em',''],le)+'<div class="barra pe"><button class="btn p">+ Criar empresa</button></div>',bl,True,'· 4'),False)
import re
lista=re.sub(r'<div class="cab">.*?</div><div class="abas">.*?</div>','',lista,flags=re.S)
lista=re.sub(r'<div class="rodape">.*?</div></div>','',lista,flags=re.S)
open('lista.html','w').write(lista)
