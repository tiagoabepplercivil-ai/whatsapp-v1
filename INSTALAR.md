# WhatsApp v1 — como publicar e instalar

## 0. Computador (Windows) — recomendado
1. Baixe `windows/WhatsApp-v1-Instalador.exe` e execute.
2. O Windows vai mostrar "O Windows protegeu o computador" (o app não tem assinatura digital paga). Clique em **Mais informações → Executar assim mesmo**.
3. Escolha a pasta e conclua. Fica o atalho "WhatsApp v1" na Área de Trabalho e no Menu Iniciar.
- Sem instalar: `WhatsApp-v1-Portatil.exe` abre direto (bom para pendrive). Mesmo aviso do SmartScreen.
- Fechar no X não encerra: o app vai para a bandeja (perto do relógio) e continua avisando os lembretes. Para sair de verdade: ícone na bandeja → Sair.
- Ícone na bandeja → "Iniciar com o Windows" para ele abrir sozinho, escondido, ao ligar o PC.
- Os dados do app de PC ficam no PC (separados do celular). Para levar de um para o outro: ⋮ → Configurações → Backup/Restaurar (as fotos não vão no backup).

## 1. Publicar (uma vez, ~1 min, pelo computador)
1. Abra https://app.netlify.com/projects/wv1-chat-agenda-tb/deploys (projeto já criado na sua conta Netlify).
2. Arraste o arquivo `whatsapp-v1.zip` (descompactado: a pasta com index.html, app.js, sw.js, manifest e icons) para a área "Drag and drop".
3. O app fica em https://wv1-chat-agenda-tb.netlify.app

Para atualizar depois: arraste a pasta nova no mesmo lugar.

## 2. Instalar no celular
- **Android (Chrome):** abra o link → menu ⋮ → "Instalar app" (ou "Adicionar à tela inicial").
- **iPhone (Safari):** abra o link → Compartilhar → "Adicionar à Tela de Início".

## 3. Ligar o Claude
- No app: ⋮ → Configurações → cole a chave da API (console.anthropic.com → API Keys). Uso cobrado por token na sua conta Anthropic.
- Sem chave, o Claude funciona em "modo básico": entende "reunião com Alex amanhã 14h", "vistoria sexta 9h30", "tarefa: enviar laudo dia 05/11".

## Atualização automática (computador)
A partir da 1.8.0 o app verifica sozinho ao abrir e a cada 4 h. Melhoria só na interface: aplica em segundos. Versão nova do instalador: baixa em segundo plano (confere o sha256) e instala em silêncio quando você está há 5 min sem usar o app (ou com a janela escondida); se estiver em uso, aparece "Reiniciar para atualizar" de um clique. O instalador fica publicado no ramo `installer` deste repositório.

## Planos de execução ("ok" e ela faz)
Em cada atividade pendente do painel há "⚡ preparar execução": a assistente monta um plano (mensagem pronta para a pessoa certa no WhatsApp, compromisso, lembrete, nota, baixa na atividade) e mostra o cartão. Você responde **ok** (ou clica em "Ok, pode fazer") e o app executa: digita e envia a mensagem na conversa pelo WhatsApp que está dentro do app, cria o compromisso (vai para a Google Agenda se conectada), anota e dá baixa. Nada é enviado sem o seu ok. Quando você diz "Sim" num cartão "fulano te perguntou", a resposta já vem pronta para o ok. O manual (pendentes com seus planos, planos executados, concluídas) fica em `WhatsApp v1/Atividades.md` no Drive.

## Google Agenda (computador) — cadastro único, uns 8 cliques
O Google só deixa um programa mexer na sua agenda se ele estiver cadastrado na sua conta. É de graça e você faz uma vez:
1. Abra https://console.cloud.google.com e entre com a conta Google da sua agenda.
2. No topo, "Selecionar projeto" → "Novo projeto" → nome "WhatsApp v1" → Criar (e selecione-o).
3. Menu ☰ → "APIs e serviços" → "Biblioteca" → procure "Google Calendar API" → Ativar.
4. "APIs e serviços" → "Tela de permissão OAuth" (ou "Branding"/"Público-alvo" nas contas novas): tipo **Externo**, nome do app "WhatsApp v1", seu e-mail nos dois campos de contato → Salvar. Em "Usuários de teste" (ou "Público-alvo") adicione o seu e-mail. Não precisa publicar nem verificar.
5. "APIs e serviços" → "Credenciais" → "Criar credenciais" → "ID do cliente OAuth" → tipo **App para computador** → Criar.
6. Copie o **ID do cliente** (termina com .apps.googleusercontent.com) e o **Segredo do cliente** (GOCSPX-…).
7. No app: ⋮ → Configurações → Google Agenda → cole os dois → "Conectar Google Agenda". Abre o navegador: escolha a conta, clique em "Continuar" na tela "O Google não verificou este app" (é o seu próprio app) e permita o acesso à agenda. Volta sozinho para o app.

Depois disso: compromissos criados no app (por você ou pela assistente) aparecem na Google Agenda, e o que você marca pelo celular/Google aparece na aba Agenda e no briefing. Sincroniza a cada 10 min (ou "Sincronizar agora" em Configurações). O acesso fica só no seu PC (pasta do app); "Desconectar" apaga.

## Assistente (novo)
- Crie grupos/conversas (+ → 👥 Grupo) e mande texto e fotos (📷 na caixa de mensagem).
- A assistente lê cada mensagem e foto (👁 aparece na mensagem lida), transcreve documentos e cria lembretes 🔔, compromissos e atividades. Ela avisa no chat "Assistente" o que anotou.
- No chat Assistente: "📖 Ler todas as conversas", "Meus lembretes", ou perguntas como "qual a data da minha crisma?" (ela busca nas conversas e fotos).
- Na hora do lembrete: cartão vermelho no chat + aviso no celular (ative em ⋮ → Configurações → Ativar avisos). Todo dia, ao abrir o app, ela manda o resumo do dia.
- Por conversa (⋮): ligar/desligar a leitura, ou mandar reler tudo.
- No computador ela lê o WhatsApp Web que está dentro do app: a conversa aberta, as prévias das não lidas e, quando você não está usando (90 s parado) ou está em outra aba do app, abre cada conversa não lida para ler (e todas, a cada 2 h). Abrir marca a conversa como lida no WhatsApp (visto azul, se ativo). Desligue em ⋮ → Configurações → "Ler tudo". "📖 Ler todo o WhatsApp" no chat da assistente força a leitura agora.
- O painel dela mostra no alto só as **Atividades** pendentes (uma linha cada; ☐ dá baixa, ⚡ prepara a execução).
- Coisa nova nas conversas chega como cartão no chat dela, com **Sim, colocar** / **Não**. Ela faz triagem: só vira cartão o que alguém **pediu ou perguntou a você**, o que **você prometeu** e **compromisso com data** que te envolve. Aviso geral de grupo, informação e pedido a outra pessoa vão só para o resumo do dia. Com 2 ou mais esperando aparece "Sim para todas".
- **📝 Notas importantes** abrem pelo botão de folha no cabeçalho da assistente: você escreve o que não pode esquecer e ela também anota ali o que encontra nas conversas (endereço, nº de contrato, valor combinado, código). O ponto verde no botão avisa nota nova. Cópia em `WhatsApp v1/Notas.md` no Drive.
- Documentos que você baixa no WhatsApp (e o backup/.ics do app) vão direto para a pasta **`C:\Users\tiago\Desktop\Dowload whas app`** (Área de Trabalho), sem perguntar onde salvar; o app guarda uma cópia em `WhatsApp v1/<conversa>/` no Drive. Para trocar a pasta: ⚙️ Configurações → **⬇️ Pasta dos downloads** (digite o caminho ou "Escolher pasta"; "Voltar ao padrão" desfaz). Fotos das conversas abertas vão só para o Drive.
- Tudo que ela lê fica no Drive: `WhatsApp v1/Conversas/<conversa>.md` (texto por dia) e `WhatsApp v1/Resumos/AAAA-MM-DD.md` (resumos dela). Ela busca nesses arquivos ao responder, e os resumos dos últimos 3 dias já ficam no contexto dela.
- Sem chave da API: ela só cria lembretes quando a mensagem tem data e hora simples ("levar documento sexta 10h"). Fotos só são lidas com a chave.

## O que tem
- Conversas no visual WhatsApp (claro/escuro automático), conversa fixa com o Claude.
- Calendário lateral com os compromissos: fixo ao lado no tablet/PC; no celular, botão 📅 no topo abre a gaveta.
- Agenda e Atividades; atividades vinculadas a compromissos.
- Tocar numa mensagem: virar atividade, criar compromisso, ou mandar o Claude agendar.
- Cada compromisso: botão "Google Agenda" (abre o evento preenchido) e ".ics" (lembrete de 30 min).
- Backup/restauração em Configurações.

## Limites da v1
- Dados ficam no aparelho (texto em localStorage, fotos em IndexedDB; o backup não inclui as fotos). Não sincroniza entre celular e PC — use Backup/Restaurar.
- Não troca mensagens com outras pessoas (precisaria de servidor). Grupos e conversas são seus, para organizar por assunto.
- Aviso com o app totalmente fechado: o celular pode atrasar ou segurar. Para o que é crítico, mande também pro Google Agenda.
- Custo: cada leitura de mensagem/foto é uma chamada à API (fotos custam mais).
- Envio ao Google Agenda é por link (você confirma "Salvar"); sincronização automática exigiria login Google (OAuth) — fica para a v2.
- Nome/visual "WhatsApp" é marca da Meta: ok para uso pessoal, não publicar em loja.
