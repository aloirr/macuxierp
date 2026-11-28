"""Simulação Plataforma > Empresas (lista do /config/empresas). Base: 445e459 (config-menos-e-mais).
Gera lista.html e lista-1~1366/390/1920.png (Chrome headless). Rodar nesta pasta: python3 gerar.py"""
import subprocess,sys
CSS="""
:root{--azul:var(--mx-cor-azul-noite);--fundo:var(--mx-cor-perola);--borda:var(--mx-cor-borda-tabela);--texto:var(--mx-cor-grafite);--sub:var(--mx-cor-texto-secundario);
--ok:var(--mx-cor-ativo-fundo);--okt:var(--mx-cor-ativo-texto);--al:var(--mx-cor-aviso-fundo);--alt:var(--mx-cor-aviso-texto);--linha:var(--mx-cor-nevoa);--cab:var(--mx-cor-nevoa);
--campo:var(--mx-medida-altura-campo);--raio:var(--mx-medida-canto-cartao);--f:var(--mx-tamanho-pequeno);--rot:var(--mx-tamanho-micro)}
*{box-sizing:border-box}body{margin:0;font:var(--f)/1.35 var(--mx-fonte-texto);color:var(--texto);background:var(--fundo)}
.topo{display:flex;align-items:center;gap:12px;background:var(--mx-cor-grafite);color:var(--mx-cor-branco);padding:0 24px;height:48px}.topo img{height:20px}.plat{border:1px solid var(--mx-cor-azul-claro);border-radius:10px;padding:1px 7px;font-size:var(--rot);font-weight:600}
.sim{margin-left:auto;background:var(--al);color:var(--alt);font-size:var(--rot);padding:2px 8px;border-radius:10px}.topo a{color:var(--mx-cor-branco)}.usr{margin-left:12px}
.pg{padding:16px 24px}
.tit{display:flex;align-items:center;gap:12px;min-height:var(--campo);margin:0 0 6px}.tit h1{margin:0;font-size:var(--mx-tamanho-h1);font-weight:var(--mx-peso-titulo);text-transform:none;letter-spacing:normal;color:var(--azul)}.tit .n{font-size:var(--mx-tamanho-texto);font-weight:var(--mx-peso-normal);color:var(--mx-cor-texto-secundario)}
.tit input{margin-left:auto;height:var(--campo);width:280px;max-width:100%;border:1px solid var(--mx-cor-borda-campo);border-radius:6px;padding:0 10px;font:var(--f) var(--mx-fonte-texto)}
.card{background:var(--mx-cor-branco);border:1px solid var(--borda);border-radius:var(--raio);overflow:hidden}
table{width:100%;border-collapse:collapse}
th{background:var(--cab);color:var(--azul);text-align:left;font-size:var(--mx-tamanho-rotulo-dado);font-weight:var(--mx-peso-cabecalho-tabela);text-transform:uppercase;letter-spacing:var(--mx-letras-caixa-alta);padding:0 12px;height:var(--campo);border-bottom:2px solid var(--azul);white-space:nowrap}
td{padding:0 12px;height:var(--mx-medida-altura-linha-tabela);border-bottom:1px solid var(--linha);white-space:nowrap}tbody tr:nth-child(even) td{background:var(--mx-cor-linha-alternada)}tr:last-child td{border-bottom:0}
.vazio{padding:12px;color:var(--sub);display:none}
.selo{display:inline-flex;padding:3px 10px;border-radius:999px;font-size:var(--mx-tamanho-selo);font-weight:var(--mx-peso-rotulo-dado);background:var(--ok);color:var(--okt);white-space:nowrap}.selo.al{background:var(--al);color:var(--alt)}.selo.cz{background:var(--mx-cor-nevoa);color:var(--sub)}
.btn{height:var(--campo);padding:0 14px;border:1px solid var(--mx-cor-borda-campo);background:var(--mx-cor-branco);border-radius:6px;font:var(--mx-peso-botao-principal) var(--f) var(--mx-fonte-texto);color:var(--texto)}.btn.p{background:var(--azul);color:var(--mx-cor-branco);border-color:var(--azul)}.btn.menu{height:var(--campo);padding:0 10px;font-weight:var(--mx-peso-medio)}
.ac{text-align:right;white-space:nowrap!important}.btn{white-space:nowrap}
.rodape{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
@media (max-width:767px){.pg{padding:16px}.topo{padding:0 16px}.sim,.nome{display:none}.tit input{width:100%;margin-left:0}.tit{flex-wrap:wrap}.card{overflow-x:auto}td{white-space:normal;height:auto;padding:8px 10px}tr>*:nth-child(n+3):not(:last-child):not(:nth-child(4)){display:none}.card{overflow:hidden}td.ac,th:last-child{width:44px;padding:0 6px}.btn.menu{padding:0 8px;font-size:0}.btn.menu::before{content:"▾";font-size:var(--f)}.rodape .btn{flex:1}}
"""
EM=[('EMPRESA EXEMPLO COMÉRCIO LTDA','AM0000','00.000.000/0001-00','Ativa','Cadastros · Pedidos · Faturamento · Fiscal · Integração FDV','<span class="selo al">Com recusas</span>','22/11/2026'),
('DISTRIBUIDORA FICTÍCIA DO NORTE LTDA','AM0001','00.000.000/0002-80','Ativa','Cadastros · Pedidos · Integração FDV','<span class="selo">Ligada</span>','12/11/2026'),
('ATACADO TESTE DO RIO LTDA','AM0002','00.000.000/0003-61','Ativa','Cadastros · Pedidos','—','21/10/2026'),
('MERCANTIL EXEMPLO ME','AM0003','00.000.000/0004-42','Suspensa','Cadastros','—','30/09/2026')]
def pagina(em):
    tr=''.join(f'<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td><span class="selo {"" if d=="Ativa" else "cz"}">{d}</span></td><td>{e}</td><td>{f}</td><td>{g}</td><td class="ac"><button class="btn menu">Ações ▾</button></td></tr>' for a,b,c,d,e,f,g in em)
    th=''.join(f'<th>{c}</th>' for c in ['Empresa','Código','CNPJ','Situação','Módulos','Macuxi FDV','Criada em',''])
    js="document.querySelector('#q').addEventListener('input',e=>{const q=e.target.value.toLowerCase();let v=0;document.querySelectorAll('tbody tr').forEach(r=>{const t=(r.cells[0].textContent+' '+r.cells[1].textContent).toLowerCase();const s=t.includes(q);r.style.display=s?'':'none';if(s)v++});document.querySelector('.n').textContent='· '+v;document.querySelector('.vazio').style.display=v?'none':'block'})"
    return f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Simulação</title><link rel="stylesheet" href="../../../packages/ui/src/tokens.css"><style>{CSS}</style></head><body>
<div class="topo"><img src="../../marca/ativos/2026-11-22-v1/macuxi-erp-a-negativo-grafite.svg" alt="Macuxi ERP"><span class="plat">Plataforma</span><span class="sim">SIMULAÇÃO · dados fictícios</span><span class="usr"><span class="nome">Superadmin Fictício · </span><a href="#">Sair</a></span></div>
<div class="pg"><h1 hidden></h1><div class="tit"><h1>Empresas <span class="n">· {len(em)}</span></h1><input id="q" type="search" placeholder="Buscar por código ou nome" aria-label="Buscar por código ou nome"></div>
<div class="card"><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table><div class="vazio">Nenhuma empresa encontrada.</div></div>
<div class="rodape"><button class="btn p">Nova empresa</button></div></div><script>{js}</script></body></html>'''.replace('<h1 hidden></h1>','')
open('lista.html','w').write(pagina(EM))
open('lista-1-linha.html','w').write(pagina(EM[:1]))
for nome,arq in [('lista','lista.html'),('lista-1-linha','lista-1-linha.html')]:
    for w,h in [(1366,520),(1920,520),(390,720)]:
        if nome!='lista' and w==1920: continue
        subprocess.run(['google-chrome','--headless','--no-sandbox','--disable-gpu','--hide-scrollbars',f'--window-size={w},{h}',f'--screenshot={nome}-{w}.png',f'file://{__import__("os").getcwd()}/{arq}'],check=True,capture_output=True)
