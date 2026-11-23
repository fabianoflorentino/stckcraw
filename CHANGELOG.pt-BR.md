# Changelog

Todas as mudanças relevantes do stckcraw são documentadas aqui. O projeto é
publicado continuamente a partir da `main` e ainda não usa tags semânticas, então
as entradas são agrupadas pela data em que a mudança entrou.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## 2026-11-23

### Adicionado

- Linha de referência interativa nos gráficos diários: uma guia acompanha o
  cursor e mostra data, fechamento interpolado e variação acumulada no período
  na interseção.
- Estrela da carteira nos resultados de busca e no cabeçalho do gráfico, para
  favoritar ativos sem sair da busca ou do gráfico.
- Skill de projeto `stckcraw-dashboard-ui` com as convenções de UI, regras de
  i18n, validação e ritual de release do dashboard.

### Corrigido

- A publicação no GitHub Pages agora envia o artifact no job `update` e faz o
  deploy em um job `deploy` separado, evitando a falha intermitente
  `Found 0 artifact(s)` causada pela consistência eventual da API de artifacts.

## 2026-11-20

### Adicionado

- Seletor de idioma PT-BR/EN-US em todo o site, com PT-BR como padrão,
  preferência salva no `localStorage`, formatação de números/datas por locale,
  conteúdo dinâmico traduzido e uma camada de tradução via `data-i18n`.

## 2026-11-19

### Adicionado

- Carteira local com watchlist e posições: quantidade, preço médio, valor
  investido, valor atual, resultado, peso de cada ativo e totais.
- Autocomplete de ticker no formulário da carteira, usando a busca da brapi, com
  navegação por teclado e dropdown para adicionar com um clique.
- Export/import JSON da carteira, incluindo quantidades e preços médios, e links
  compartilháveis `?carteira=PETR4,VALE3` que importam os tickers como watchlist.
- Aviso visível explicando que a carteira fica no `localStorage` e que
  export/import devem ser usados para backup e restauração.
- Endpoint Worker `GET /quote?symbol=PETR4` com nome, preço, variação, horário e
  um mês de fechamentos diários da Yahoo Finance, com cache de cinco minutos.
- Tira de cotações compactas no hero para dólar, euro, ouro, Brent, Bitcoin e
  S&P 500, com cores de alta, baixa e estabilidade.
- Indicador deslizante no switch Altas/Baixas/Carteira, respeitando
  `prefers-reduced-motion`.
- Superfícies translúcidas, sombras em camadas e painel no toolbar em todo o site.

### Alterado

- Os cards de índices agora mostram Ibovespa, Nasdaq, Euro Stoxx 50 e Shanghai;
  o S&P 500 passou para a tira de cotações compactas.
- `make run` agora gera o snapshot do dashboard (mesmo caminho de
  `make dashboard`); o modo CSV legado do InfoMoney/XP continua em
  `make download`.
- O crawler passou a fazer dez requisições de cotação à Yahoo Finance (quatro
  índices grandes mais seis cotações compactas).

### Corrigido

- Falhas do modo legado InfoMoney/XP por HTTP 403 agora exibem uma dica apontando
  para o modo suportado `-dashboard`.
- Re-execuções do GitHub Pages não falham mais por artifacts `github-pages`
  duplicados; o nome do artifact inclui a tentativa do workflow.

## 2026-11-07

### Adicionado

- Cards de destaque interativos: maior alta, maior queda e maior volume abrem o
  gráfico do ativo; o card de cobertura expande ou recolhe todas as categorias.

## 2026-11-06

### Adicionado

- Marca com favicon no hero e no rodapé.
- Favicon de gráfico verde/vermelho, ícones do app e web manifest.

## 2026-11-03

### Adicionado

- Gráficos diários de um mês para índices e ativos, em SVG nativo.
- Busca de ativos em toda a B3, com histórico sob demanda para ativos fora do
  snapshot.
- Transições suaves de abertura/fechamento do modal de gráfico e estatísticas
  mais completas.
- Partículas de mercado no hero, efeitos de scroll reveal e backdrop de mercado
  em toda a página.

## 2026-11-02

### Adicionado

- Detecção de feriados da B3 a partir do horário do Ibovespa, usada para rotular
  o último pregão e alinhar o agendamento do workflow.

## 2026-10-30

### Corrigido

- O frontend agora verifica a cada cinco minutos se há um snapshot mais novo.

## 2026-10-29

### Adicionado

- Cards dos principais índices: Ibovespa, S&P 500, Euro Stoxx 50 e Shanghai.
- Fallback no navegador que consulta a brapi diretamente quando o snapshot
  publicado está ausente, velho ou indisponível.
- Dispatcher cron no Cloudflare com observabilidade estruturada e trigger
  manual opcional.
- Espelho estático no Cloudflare e proxy do snapshot do Pages para os dados
  gerados.
- Preservação da última cotação boa dos índices quando a Yahoo Finance aplica
  rate limit.

## 2026-10-28

### Adicionado

- Dashboard da B3 a cada 30 minutos para ações, FIIs, FIPs, ETFs, BDRs e units,
  com top 10 de altas e baixas e workflow de publicação no GitHub Pages.
- Visão de maiores baixas com switch Altas/Baixas.
- Aviso de que os dados não são recomendação de investimento no hero.
- Grupos de ativos colapsáveis, cabeçalho inteiro para recolher/expandir e botão
  de voltar ao topo.
- Stack Docker que atualiza o dashboard a cada 30 minutos.
- README e guia de arquitetura em Mermaid.

### Alterado

- Melhoria no layout do dashboard, feedback de atualização e animações de entrada.
- Agendamento do workflow restrito a dias úteis no horário da B3.

### Corrigido

- Configuração de cache do GitHub Actions, atualização das majors das actions e
  limpeza do heartbeat temporário do scheduler.
