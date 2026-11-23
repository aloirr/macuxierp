-- Passo 1 do banco.sh (T-0024): conexão TLS como o admin do DBaaS e os privilégios dele. SÓ LEITURA.
-- O banco.sh manda este arquivo pelo stdin ao psql do contêiner (psql -At -F '|' -f -); o contêiner não vê o disco do host.
-- Saída (uma linha): versão|ssl|versão do TLS|rolsuper|rolbypassrls|rolcreatedb|rolcreaterole
-- Os booleanos saem como BOOLEAN (o psql -At imprime t/f). NUNCA converta para texto: true::text é 'true', não 't', e
-- o banco.sh compara com t (o publicar da v0.1.0 recusou uma conexão TLS por isso). Teste:
-- packages/config/deploy-banco.test.ts.
select current_setting('server_version'), coalesce(s.ssl, false), coalesce(s.version, '-'),
       r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole
  from pg_roles r left join pg_stat_ssl s on s.pid = pg_backend_pid()
 where r.rolname = current_user;
