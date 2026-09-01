# 🚀 PromoBot Pro - Bot de Promoções Autônomo 24/7 (Shopee & Mercado Livre -> Telegram)

Sistema inteligente e 100% autônomo para caçar as melhores ofertas e promoções com alto desconto na **Shopee** e **Mercado Livre**, gerar banners promocionais profissionais em alta definição, converter links de afiliados e publicar automaticamente no seu canal ou grupo do **Telegram**.

---

## ✨ Principais Recursos

1. **🤖 Piloto Automático 24/7 (Zero Ação Manual)**:
   - Monitora em segundo plano as ofertas relâmpago e ofertas do dia a cada intervalo configurado (ex: a cada 20 minutos).
   - Filtro de desconto mínimo (ex: apenas produtos com > 25% OFF).
   - Sistema de deduplicação com banco SQLite: **nunca repete a mesma promoção** dentro do intervalo de proteção (ex: 48 horas).

2. **🎨 Gerador Automático de Banners Promocionais (1080x1080)**:
   - Renderiza artes visuais prontas para publicação com a foto do produto, selo de desconto (ex: `-45% OFF`), preços (*De / Por*), logo da loja e selo de frete grátis.

3. **📱 Publicador Telegram com Botões Interativos**:
   - Posta a imagem promocional em alta qualidade + copy persuasiva com formatação HTML + botão Inline interativo: `🔥 COMPRAR COM DESCONTO`.

4. **⚡ Painel de Controle Web Completo (Dark Mode com Glassmorphism)**:
   - **Postagem Rápida**: Cole qualquer link da Shopee ou Mercado Livre e gere a arte + copy com 1 clique.
   - **Radar de Ofertas ao Vivo**: Visualize as ofertas quentes encontradas pelo robô em tempo real.
   - **Histórico de Envios**: Tabela com todas as postagens realizadas, miniaturas e métricas.
   - **Central de Configurações**: Alterne o Piloto Automático, ajuste intervalos, descontos e teste a conexão do Telegram com feedback instantâneo.
   - **Logs do Sistema**: Terminal de logs em tempo real para acompanhar todas as varreduras.

---

## 🛠️ Como Iniciar o Projeto

### 1. Iniciar o Servidor e Painel Web
No terminal, execute:

```bash
npm run dev
```

Acesse o painel no navegador:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## ⚙️ Configuração do Telegram (Passo a Passo)

1. **Criar o Bot**:
   - Abra o Telegram e pesquise por `@BotFather`.
   - Envie o comando `/newbot` e siga as instruções para escolher o nome e o username do seu bot.
   - Copie o **Token HTTP API** gerado (ex: `7123456789:AAHxyz...`).

2. **Adicionar o Bot ao seu Canal ou Grupo**:
   - Vá no seu Canal ou Grupo do Telegram -> Gerenciar Canal -> Administradores -> **Adicionar Administrador**.
   - Procure pelo username do seu bot e dê permissão para enviar mensagens.

3. **Obter o Chat ID**:
   - Para canais públicos: use o username do canal (ex: `@meucanalpromocoes`).
   - Para grupos/canais privados: use o ID numérico (ex: `-1001234567890`).

4. **Salvar no Painel**:
   - Abra a aba **⚙️ Configurações** no Painel Web (`http://localhost:3000`), cole o Token e o Chat ID e clique no botão **🧪 Testar Conexão**. O bot enviará uma mensagem de confirmação para o seu canal!

---

## 📦 Scripts Disponíveis

- `npm run dev`: Inicia o servidor em modo de desenvolvimento com hot-reload.
- `npm run build`: Compila o código TypeScript para JavaScript na pasta `dist/`.
- `npm start`: Inicia o servidor em modo de produção.
- `npm run test:hunter`: Executa um teste rápido de caça de ofertas no Mercado Livre e Shopee.
- `npm run test:banner`: Gera um banner de teste de alta resolução na pasta `data/`.

---

## 🔮 Próximos Passos (Fase 2)
A arquitetura do projeto é totalmente modular e está pronta para expansão dos publicadores:
- `src/publishers/whatsapp.ts`: Integração com WhatsApp (Baileys / Evolution API).
- `src/publishers/instagram.ts`: Publicação automática de Posts e Stories no Instagram.
