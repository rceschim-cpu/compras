# 🛒 Assistente de Compras

App pessoal (PWA) que recebe comandos **por voz**, mantém sua **lista de compras**, **aprende seu padrão de consumo** e **cota preços online**, devolvendo **propostas de carrinho prontas** — com sugestões de alternativas mais baratas ou mais saudáveis.

Tudo roda localmente com Node.js, **sem nenhuma dependência externa** (`npm install` não é necessário). A inteligência vem da **sua chave do OpenRouter**.

## Como rodar

**Local:**

```bash
node server/server.js
# abre http://localhost:3000 no Chrome
```

**Deploy (Vercel):** o projeto já vem com `vercel.json` e a função `api/vtex.js`. Basta importar o repositório em [vercel.com/new](https://vercel.com/new) (ou rodar `npx vercel`) — sem build, sem variáveis de ambiente. O link gerado já serve o PWA com HTTPS, o que faz o microfone funcionar direto no celular.

**Onde ficam os dados:** tudo (lista, padrões, chave do OpenRouter) fica no **localStorage do seu navegador** — o servidor não guarda nada, então o mesmo deploy pode ser usado por outras pessoas sem ver seus dados. Para trocar de aparelho, use **Config → Exportar/Importar** backup.

No celular: abra o link e use "Adicionar à tela inicial" — o app instala como PWA.

## O que ele faz

| Você diz/faz | O app |
|---|---|
| "Acabou o arroz" | Registra o evento, adiciona arroz à lista (já com a marca/embalagem que você costuma comprar) |
| "Compra 2 sabão em pó OMO" | Adiciona com quantidade e marca |
| 📷 foto do produto | Modelo de visão extrai nome, marca, embalagem e ingredientes e cadastra no seu catálogo |
| 🧾 nota fiscal ou print de pedido (aba Padrões) | Lê a compra inteira de uma vez — foto do cupom ou print do pedido no site/app do mercado (ex.: histórico do Condor): registra os itens como comprados na data da compra, com o preço pago. O jeito mais rápido de ensinar seu padrão |
| "Monta o carrinho" / botão **Cotar preços** | Busca preços (scraper + web), monta até 3 propostas de carrinho por loja, com totais e links |
| "Marquei tudo como comprado" | Alimenta o histórico — é assim que o padrão é aprendido |

**Aprendizado de padrão**: a cada "acabou"/"comprei", o app calcula o intervalo médio de reposição de cada item. Na aba **Padrões** você vê a frequência estimada, e o assistente avisa o que deve estar acabando ("📌 Pelo seu padrão, deve estar acabando: leite, café...").

**Sugestões de troca**: na cotação, o modelo propõe alternativas — *"Você pediu arroz Tio João, não gostaria do Buriti por R$ 2 a menos no pacote de 2kg?"* (💸 mais barato) ou opções com composição mais saudável/orgânica (🌱), explicando o motivo.

## Como a busca de preços funciona (híbrida)

1. **Scrapers diretos (VTEX)** — mercados na plataforma VTEX expõem uma API pública de catálogo. Já configurados: Carrefour Mercado, Condor e Sonda Delivery. Para adicionar outro mercado VTEX da sua região, edite `server/scrapers/stores.js` (e o espelho em `public/quotes.js`):
   ```js
   { id: 'meumercado', name: 'Meu Mercado', base: 'https://www.meumercado.com.br', type: 'vtex' }
   ```
2. **Busca web via OpenRouter** — para as demais lojas (Atacadão, Assaí, Pão de Açúcar, Extra, iFood Mercado), o app usa um modelo com acesso à web (sufixo `:online` do OpenRouter) para pesquisar preços atuais.
3. Um modelo então **compõe as propostas**: até 3 carrinhos (um por loja, do mais barato ao mais caro), itens não encontrados e as sugestões de troca.

## Configuração (aba ⚙️)

- **Chave do OpenRouter** — obrigatória ([openrouter.ai/keys](https://openrouter.ai/keys)).
- **Modelos** — padrões: `openai/gpt-4o-mini` (texto e visão) e `perplexity/sonar` (busca de preços, especializado em pesquisa web). Troque por qualquer modelo do OpenRouter; para a busca, use um modelo de pesquisa ou o sufixo `:online`.
- **Cidade/CEP** — melhora a precisão regional dos preços.

## Dados e privacidade

Todos os dados — lista, catálogo aprendido, histórico e configurações, **incluindo sua chave do OpenRouter** — ficam no localStorage do navegador, só no seu aparelho. As chamadas de IA vão direto do navegador para o OpenRouter (que suporta CORS); o servidor é apenas um proxy para a API pública dos mercados VTEX. Não compartilhe o aparelho/perfil do navegador onde a chave está salva.

## Estrutura

```
public/              # o app inteiro roda aqui (navegador)
  app.js             # UI: chat, voz, lista, cotações, padrões, config
  store.js           # estado no localStorage + aprendizado de padrão
  assistant.js       # interpretação de voz/texto e foto de produtos
  quotes.js          # orquestração da cotação e propostas de carrinho
  llm.js             # cliente do OpenRouter (direto do navegador)
api/vtex.js          # função serverless (Vercel): proxy dos scrapers
server/
  server.js          # servidor local: estáticos + mesmo proxy /api/vtex
  scrapers/          # vtex.js (scraper genérico) + stores.js (lojas)
```

## Limitações conhecidas

- Os preços de busca web dependem do que o modelo encontra publicamente; confira antes de fechar a compra (cada item tem link quando disponível).
- O app monta a **proposta** de carrinho; a finalização da compra é feita no site/app da loja pelos links.
- Scrapers podem ser bloqueados por proteção anti-bot da loja (HTTP 403/503) — nesse caso a loja continua coberta pela busca web.
- Se **nenhuma** fonte ao vivo responder, o app gera uma cotação com **preços estimados** pelo modelo, claramente sinalizada com ⚠️ — use como ordem de grandeza, não como preço final.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| "Carrefour Mercado: HTTP 403/503" | A loja bloqueou a consulta automática naquele momento. É só um aviso — a cotação segue pela busca web. |
| Busca web não acha preços | Troque o "Modelo com busca web" na Config para `perplexity/sonar` e confira se sua conta OpenRouter tem créditos. |
| Cotação veio marcada como estimativa | Nenhuma fonte ao vivo respondeu; tente de novo mais tarde ou ajuste o modelo de busca. |
