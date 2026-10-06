/* GeoSniper — Ajuda por aba.
   Roteiro de UTILIZAÇÃO, na ordem em que as coisas acontecem: o que fazer, o que o app devolve, o que acontece se você pular uma etapa
   e o que fazer quando algo falha. O botão "Ajuda" fica na barra de abas e abre a ajuda da aba em que você está.
   Cada aba pode ter uma demonstração em vídeo (campo `clip`), com legenda e áudio que pode ser desligado. */
(function () {
  'use strict';

  // ordem de uso (usada também nos botões "Passo anterior / Próximo passo")
  const ORDER = ['tabInicio', 'tabEquipamento', 'tabBalistica', 'tabMedir', 'tabRaios', 'tabNormal', 'tabRelevo', 'tabEstrategia', 'tabCenaSimulacao', 'tabCenaPerfis'];
  const NAMES = { tabInicio: 'Início', tabEquipamento: 'Equipamento', tabBalistica: 'Balística', tabMedir: 'Medir', tabRaios: 'Raios', tabNormal: 'Marker', tabRelevo: 'Pontos', tabEstrategia: 'Estratégia', tabCenaSimulacao: 'Simulação', tabCenaPerfis: 'Perfis' };
  const ICONS = { tabInicio: '🏠', tabEquipamento: '🧰', tabBalistica: '🎯', tabMedir: '📏', tabRaios: '📡', tabNormal: '📍', tabRelevo: '📋', tabEstrategia: '🗺️', tabCenaSimulacao: '🎬', tabCenaPerfis: '📈' };

  const DEFAULTS = 'Se você não preencher nada, o app usa a <b>carga padrão</b> (175 gr, 2680 fps, BC 0,447 G1, torre 1/4 MOA, raia 1:10 à direita, luneta a 3,8 cm, zeragem em 100 m) e as <b>condições padrão</b> (15 °C, 1013 hPa, 50% de umidade, sem vento, tiro sem inclinação, azimute 90°). O resultado vale para essas condições, não para as suas.';
  const CAUTION = 'O GeoSniper é uma ferramenta de cálculo e referência. Os resultados são estimativas: confirme sempre em campo, com as condições reais do momento. Ele não substitui treinamento nem as normas de segurança e a legislação do seu país.';

  const HELP = {
    tabInicio: {
      title: 'Guia rápido de uso', lead: 'A ordem em que as coisas acontecem, do primeiro acesso até o tiro e o trabalho em equipe. Você pode pular etapas (o app usa valores padrão), mas o resultado só fica certo para o seu equipamento e para as condições do dia se você seguir a ordem.',
      passos: [
        '<b>Entre e libere a localização.</b> Sem a posição, o app não mede distância, não mostra o mapa nem busca o clima. Se o aviso "A localização está bloqueada" aparecer, siga os passos dele.',
        '<b>Equipamento</b> (uma vez por arma e munição): velocidade, BC e perfil de arraste, torre, altura da luneta, zeragem e luneta. Fica salvo neste aparelho.',
        '<b>Condições do dia</b> (a cada saída): clima (botão "Sincronizar clima via GPS"), vento (velocidade e direção em relógio), inclinação e azimute do tiro.',
        '<b>Balística</b>: digite a distância e toque em "Calcular solução". Leia elevação (UP/DOWN), deriva (R/L), tempo de voo e energia.',
        '<b>Medir</b>: toque no alvo no mapa; o app mede a distância e já mostra as correções. Registre o ponto e compartilhe.',
        '<b>Em equipe</b>: Marker, Estratégia e Pontos compartilham marcações em tempo real; Raios mostra os anéis de distância ao seu redor.',
        '<b>Planejamento e treino</b>: Simulação e Perfis mostram a trajetória, a deriva do vento e o risco de interceptação em alvos móveis de treinamento.',
        'À noite, use o botão <b>NVG RED</b> (vermelho escuro) para preservar a visão.'
      ],
      pular: DEFAULTS,
      dica: 'O botão <b>❔ Ajuda</b> da barra de abas abre a ajuda da aba em que você está, com os passos daquela etapa. ' + CAUTION,
      falha: 'Menu sem uma aba: ela não foi liberada para a sua conta. Peça ao administrador da sua unidade. Sem internet: o mapa, o clima e o cálculo não funcionam.',
      admin: 'Quem administra uma unidade (cadastros, convites, vagas e permissões) usa o painel em <b>api.geosniper.com.br/admin.html</b>, que tem a sua própria Ajuda (botão ❔ no topo).'
    },

    tabEquipamento: {
      title: 'Equipamento', lead: 'Aqui você cadastra o que usa em campo. Balística, Medir, Simulação e Perfis partem destes dados.',
      antes: 'Tenha em mãos a <b>velocidade de boca</b> medida no cronógrafo (ou a da caixa da munição), o <b>BC</b> e o tipo de arraste (G1, G7…) da ficha do projétil, o peso em grãos e a altura da luneta (do centro do cano ao centro da luneta).',
      passos: [
        '(Opcional) Escolha um <b>Preset de fuzil/arma</b>: ele preenche os campos com os valores do catálogo.',
        'Confira <b>Velocidade de boca (FPS)</b>, <b>BC</b>, <b>Peso do projétil</b> e <b>Perfil de arraste</b>. O BC só vale com o modelo de arraste em que foi medido: um BC G7 não deve ser usado como G1.',
        'Escolha o <b>Ajuste da torre</b> igual ao da sua luneta (1/4 MOA, 1/8 MOA, 1/2 MOA, 0,1 MRAD ou 0,05 MRAD). É ele que transforma o resultado em cliques.',
        'Informe <b>Passo de raia</b> e <b>Sentido do raiamento</b> (a bala deriva um pouco para o lado da raia) e, para maior precisão, o <b>calibre</b> e o <b>comprimento do projétil</b> (opcionais).',
        'Informe a <b>Altura da luneta</b> (cm) e a <b>Distância de zeragem</b> (m): a elevação é calculada a partir dela.',
        'Na <b>luneta</b>, escolha o modelo (preenche zoom e campo de visão) ou digite os dados, e escolha o <b>estilo de retículo</b>. Não achou a sua? Cadastre-a no catálogo compartilhado.',
        'Salve variações com <b>➕ Nova Carga</b> (por exemplo, duas munições). "Restaurar padrão" volta aos valores do catálogo.',
        '(Opcional) <b>Calibração de campo</b>: informe uma distância maior que a zeragem e a queda realmente observada; "Calibrar BC real" ajusta o BC para o seu conjunto arma e munição.',
        'Preencha também <b>Atmosfera e meteorologia</b> e <b>Telemetria e posição de disparo</b> (os mesmos campos aparecem na Balística): veja o passo seguinte, na ajuda da Balística.'
      ],
      ve: 'Os campos são salvos sozinhos neste aparelho. O selo "Perfil ativo" mostra a carga em uso, e a Balística repete o resumo (peso, fps, BC e perfil).',
      pular: DEFAULTS,
      dica: 'Calibre e comprimento do projétil são opcionais: sem eles o app estima a estabilidade e a deriva giroscópica. Medir a velocidade real e calibrar o BC melhora mais o resultado do que qualquer outro ajuste.',
      falha: 'A luneta não está na lista: preencha zoom mínimo/máximo e campo de visão (da ficha técnica) e cadastre. "Calibrar BC real" recusou: a distância precisa ser maior que a zeragem e a queda informada deve ser realista para essa distância e velocidade.'
    },

    tabBalistica: {
      title: 'Balística', lead: 'Calcula as correções (elevação e vento) para uma distância, com o seu equipamento e as condições do dia.',
      antes: 'Equipamento preenchido e, de preferência, condições do dia informadas (clima, vento, inclinação e azimute). Elas ficam nesta aba e na aba Equipamento: mudar em uma muda na outra.',
      passos: [
        '<b>Clima:</b> toque em "Sincronizar clima via GPS" (precisa de GPS e internet). Ele traz temperatura, pressão, umidade e vento da sua posição. O vento vem de uma previsão, não de uma medição no local: se tiver anemômetro, digite o valor real.',
        '<b>Vento:</b> velocidade em km/h e direção em <b>relógio relativo à sua linha de tiro</b>: 12h = de frente, 3h = da direita, 6h = de cauda, 9h = da esquerda. O vento do clima é convertido pelo azimute do tiro; se você mudar o azimute, ele se ajusta sozinho (até você editar o vento à mão).',
        '<b>Posição de disparo:</b> inclinação do tiro (ângulo de sítio, positivo para cima) e azimute (direção do tiro, 0 a 360°). "Ler sensores do celular" preenche os dois: aponte o celular na direção do tiro e aguarde cerca de 3 segundos. Se a bússola não bater, ajuste com ◀ 🧭 ▶ (passos de 45°).',
        'Confira o <b>Perfil ativo</b>, a <b>Torre/graduação</b> e o <b>Estilo de retículo</b>.',
        'Digite a <b>Distância do alvo</b> (metros) e toque em <b>⚡ Calcular solução &amp; retículo</b>.',
        'Leia o resultado: <b>Elevação</b> em cliques (<b>UP</b> sobe, <b>DOWN</b> desce), <b>Deriva do vento</b> em cliques (<b>R</b> gira para a direita, <b>L</b> para a esquerda), velocidade e tempo de voo, energia no alvo, queda real e o ângulo em MOA e MRAD. O retículo mostra o ponto de mira já corrigido; "⛶ Expandir" abre em tela cheia.',
        'Use a <b>torre simulada</b> (▲ ▼ ↺) para ensaiar o giro de cliques e ver o que ainda falta ajustar.',
        '<b>📊 Gerar card de tiro</b>: tabela de 50 a 1000 m (de 50 em 50) com velocidade, tempo, queda, energia, MOA, MRAD e cliques de elevação e de vento. Pode ser salva em CSV.'
      ],
      ve: 'O cálculo considera o <b>arraste</b> (G1, G2, G5, G6, G7, G8, GI, GS ou RA4), a <b>temperatura, a pressão e a umidade</b> (densidade do ar), o <b>vento com direção</b>, a <b>inclinação</b>, a <b>altura da luneta</b>, a <b>zeragem</b>, o <b>efeito Coriolis</b> (latitude e azimute) e a <b>deriva giroscópica</b> da raia (estimada se calibre e comprimento do projétil não forem informados).',
      pular: DEFAULTS,
      dica: CAUTION + ' Distâncias abaixo da zeragem pedem correção para baixo (DOWN).',
      falha: 'Em vez do resultado, um aviso vermelho: leia a mensagem. Exemplos: distância fora de 1 a 3000 m, algum campo fora da faixa, ou "o projétil não alcança essa distância" (velocidade muito baixa). "Sem conexão com o servidor de cálculo": confira a internet e se você entrou na sua conta.'
    },

    tabMedir: {
      title: 'Medir', lead: 'Mede a distância até um ponto no mapa de satélite e já mostra as correções balísticas para o seu equipamento.',
      antes: 'Localização liberada, GPS com boa precisão (veja o selo "GPS ±m" no canto) e o Equipamento e as condições preenchidos. As correções usam o mesmo cálculo da Balística.',
      passos: [
        'Veja a sua posição: ponto azul com um cone que mostra para onde o celular aponta.',
        '<b>Toque no alvo no mapa.</b> O app mede a distância em linha reta, abre o <b>balão de informação</b> e traça os caminhos até o alvo: <b>a pé</b> (linha branca tracejada) e <b>de carro</b> (linha âmbar), com distância e tempo de cada um numa legenda no canto. Toque numa linha da legenda para esconder ou mostrar aquele caminho.',
        'Leia no balão: distância, <b>cliques de elevação (UP/DOWN) e MOA</b>, o retículo com o ponto de mira corrigido e o vento. Use − e + para ampliar o retículo e ▲ ▼ ↺ para ensaiar a torre.',
        '<b>📌 Registrar ponto</b>: dê um rótulo, uma observação e, se quiser, uma foto. Ao salvar, o ponto é registrado e aparece para a sua equipe (aba Pontos).',
        '<b>Compartilhar alvo no WhatsApp</b>: quem receber e tiver a aba Medir liberada abre o balão com as correções calculadas para o <b>equipamento dele</b> e a distância <b>dele</b> até o alvo.',
        '<b>📷 Visada</b>: abre a câmera com o retículo para mirar no alvo marcado e registrar o ângulo e o azimute com foto de comprovação.',
        'Gire o mapa com ⟲ ⟳ e ajuste a bússola em "Calibrar" se o cone não bater com a direção real.',
        'Para recomeçar, limpe o ponto no balão (lixeira) e toque em outro lugar.'
      ],
      ve: 'A distância balística é em linha reta entre a sua posição (GPS) e o ponto tocado; os caminhos a pé e de carro são rotas reais, e o tempo e o comprimento delas são estimativas. A pé só até cerca de 43 km. Sem a chave do serviço de rotas ou sem internet, só aparece o caminho de carro, marcado como aproximado. A inclinação usada é a informada no Equipamento ou na Balística: o app não calcula o desnível pelo relevo.',
      pular: DEFAULTS,
      dica: 'Antes de tocar no alvo, espere o selo "GPS ±m" estabilizar: o erro de posição entra direto na distância. O mapa de satélite precisa de internet.',
      falha: 'O mapa não mostra a sua posição: a localização está bloqueada (o aviso explica como liberar). "Visada" avisou para marcar um alvo: toque antes em um ponto do mapa. Nada acontece ao tocar: aguarde o balão terminar de carregar ou veja se há internet.'
    },

    tabRaios: {
      title: 'Raios', lead: 'Mostra anéis de distância ao redor da sua posição, de 100 em 100 metros, sobre o satélite.',
      antes: 'Localização liberada. Não há nada para preencher.',
      passos: [
        'Abra a aba: o mapa centraliza em você e desenha os anéis (#1 a #9, de 100 m até 900 m).',
        'Use os anéis para estimar a distância de pontos do terreno (uma estrada, uma construção) em relação a você.',
        'Mova-se: os anéis acompanham a sua posição.',
        'Use o controle de camadas do mapa para trocar o tipo de mapa.'
      ],
      ve: 'Os anéis são distâncias em linha reta e dependem da precisão do GPS. Para medir um ponto específico com correções balísticas, use a aba Medir.',
      pular: 'Esta aba não depende de nada que você preencha.',
      falha: 'Sem anéis: o GPS ainda não obteve a posição ou a localização está bloqueada.'
    },

    tabNormal: {
      title: 'Marker', lead: 'Marcação do terreno em tempo real: pontos de interesse, pontos de risco, barricadas, seteiras e o marcador Alvo.',
      antes: 'Localização liberada. As operações Criar, Editar e Excluir dependem das permissões da sua conta.',
      passos: [
        'Escolha um marcador nas barras: <b>de baixo</b> (meios, como Patrulha, Desig, Alvo, Viatura) ou <b>da lateral</b> (riscos, como Ameaça, Seteira, Barricada, Bunker, Vala).',
        '<b>Arraste o ícone até o local no mapa e solte.</b> Um toque simples não marca.',
        'Na janela, informe rótulo, localidade e observação e, se quiser, tire uma <b>foto</b>. O <b>endereço (rua)</b> vem sugerido pelo OpenStreetMap; se não vier, ou se estiver errado, <b>digite ou corrija à mão</b>. Toque em <b>Salvar ponto</b>.',
        'O ponto aparece para toda a equipe em tempo real, com a etiqueta de quem marcou.',
        'Quando alguém compartilha um ponto, quem abre o link vê os caminhos <b>a pé</b> (branco tracejado) e <b>de carro</b> (âmbar) até ele, com distância e tempo.',
        'Toque no marcador para abrir o cartão do ponto: rótulo, endereço, observação, quem marcou, foto, <b>🧭 Caminho até aqui</b> (traça, a partir de <b>onde você está</b>, o caminho <b>a pé</b> em branco tracejado e <b>de carro</b> em âmbar, com distância e tempo; só você vê), <b>📲 Compartilhar no WhatsApp</b> (quem receber abre o ponto no mapa, com o caminho até ele) e <b>🗑️ Excluir</b> (precisa da permissão Excluir).',
        'O marcador <b>P. Encontro</b> (bóia, na barra de baixo) marca um ponto de encontro: qualquer operador com a permissão Criar pode colocar. Ele vale por <b>6 horas</b>: o cartão mostra quem criou, a hora de criação e a hora em que expira. Depois disso some dos mapas e fica na tabela da aba Pontos como <b>expirado</b>.',
        'O marcador <b>Alvo</b> é especial: quando alguém compartilha um Alvo, quem abre e tem a aba Medir recebe o balão com as correções para o equipamento dele; sem a aba Medir, vê um marcador comum.',
        'Use as ferramentas de desenho (lápis) para traçar áreas e caminhos sobre o mapa.'
      ],
      ve: 'Todos da unidade veem os mesmos pontos. Você só precisa estar com o app aberto e com internet para enviar e receber.',
      pular: 'Marcar sem informar rótulo usa o nome do tipo de marcador.',
      dica: 'Os pontos registrados também aparecem na aba Pontos, em tabela, com exportação para CSV e Excel.',
      falha: 'O ícone não marcou: você precisa arrastar e soltar sobre o mapa, fora das barras de marcadores. O endereço não apareceu: o OpenStreetMap pode não ter a rua desse ponto ou estar sem internet; digite o endereço no campo, que sempre aceita edição. "Operação não permitida": a sua conta não tem a permissão Criar, Editar ou Excluir. Peça ao administrador.'
    },

    tabRelevo: {
      title: 'Pontos', lead: 'Mapa e tabela de todos os pontos registrados pela unidade, com foto, operador e horário. Serve para consultar, compartilhar e exportar.',
      antes: 'Pontos registrados nas abas Medir, Marker ou Estratégia (na Estratégia, a peça só é registrada quando é travada).',
      passos: [
        'Abra a aba: o mapa mostra os pontos registrados. Toque num marcador para ver o rótulo, o endereço, a observação, quem marcou e a foto, e use <b>🧭 Caminho até aqui</b> para traçar as rotas a pé e de carro a partir de onde você está.',
        'Abra a tabela em <b>⛶ Tela cheia</b>. Ela lista cada ponto: tipo, rótulo, localidade, <b>endereço</b>, coordenadas, posição do atirador, observação, operador, data e foto (toque na foto para ampliar). Um P. Encontro vencido continua na lista, esmaecido e marcado <b>expirado</b>.',
        'Use <b>Filtrar por localidade ou rua</b> para reduzir a lista.',
        'Em cada linha: <b>📍</b> centraliza o ponto no mapa, o botão verde <b>compartilha no WhatsApp</b> e <b>🗑️</b> exclui (precisa da permissão Excluir).',
        '<b>Compartilhar filtrado</b> envia a lista filtrada pelo WhatsApp. <b>Salvar</b> grava a tabela filtrada em CSV neste aparelho. <b>Exportar tabela</b> gera uma planilha Excel (.xlsx) com links clicáveis.'
      ],
      ve: 'Os pontos são da unidade inteira e chegam em tempo real. Nesta aba os pontos são só para consulta: para criar ou mover, use Medir, Marker ou Estratégia.',
      pular: 'Nada a preencher: a aba só mostra o que foi registrado.',
      dica: 'A importação de pontos a partir de um arquivo ainda não existe: hoje só é possível exportar.',
      falha: 'Tabela vazia: ninguém registrou pontos ainda, ou o filtro de localidade está escondendo as linhas. "Operação não permitida" ao excluir: a sua conta não tem a permissão Excluir.'
    },

    tabEstrategia: {
      title: 'Estratégia', lead: 'Ambiente para montar missões sobre o terreno real: caminhos, objetivos, obstáculos e pontos de risco, compartilhados com a equipe em tempo real.',
      antes: 'Localização liberada. As permissões Criar, Editar e Excluir dependem da sua conta.',
      passos: [
        'No painel <b>Peças</b>, toque na peça (por exemplo Alvo, Barricada, Ameaça, Viatura) para <b>armá-la</b>. Depois <b>toque no mapa</b> para lançá-la.',
        'A peça nasce <b>livre</b> (selo verde): você pode arrastá-la e reposicioná-la. Ainda é só um rascunho, que só você vê.',
        'Toque no <b>selo</b> para <b>travar</b> (selo vermelho). Ao travar, a peça é registrada e sincronizada em tempo real com toda a equipe.',
        'Para mudar a posição, <b>destrave</b> pelo selo, arraste e trave de novo: a equipe vê a alteração na hora.',
        'Toque numa peça travada para abrir o cartão: <b>🧭 Caminho até aqui</b> traça as rotas a pé (branco tracejado) e de carro (âmbar) a partir de onde você está. A peça <b>P. Encontro</b> (bóia) vale 6 horas e depois some do mapa.',
        'No painel <b>Desenho</b>, use caminho, caneta, retângulo, círculo, seta, tracejada, curva e envolvimento para traçar rotas e áreas. "Medir" mede distâncias no mapa e "Apagar" remove desenhos. Escolha a cor.',
        'Os painéis flutuam: arraste pelo cabeçalho, redimensione pelas bordas e minimize com ▾.'
      ],
      ve: 'Todos veem, todos se localizam e todos compartilham: peças travadas aparecem para a unidade inteira. Quem coordena pode posicionar, mover e retirar peças à distância.',
      pular: 'Peças não travadas ficam só no seu aparelho e não são registradas.',
      dica: 'Peças travadas entram na tabela da aba Pontos. Uma peça travada não se move: destrave antes de arrastar.',
      falha: 'A peça não foi para o mapa: toque primeiro na peça do painel e depois no mapa. "Operação não permitida": a sua conta não tem a permissão para essa operação.'
    },

    tabCenaSimulacao: {
      title: 'Simulação', lead: 'Controle de risco e instrução: mostra a trajetória, a deriva do vento e o risco de a trajetória cruzar o caminho de alvos móveis de treinamento (esteira ou trilho, nunca pessoas).',
      antes: 'Equipamento e condições preenchidos: a Simulação começa com os valores da Balística, mas os campos dela são independentes (alterar aqui não muda as outras abas). "Resetar" puxa os valores atuais de novo.',
      passos: [
        'Escolha <b>Zeragem</b>, <b>Distância do alvo</b> e o <b>vento</b> (relógio e velocidade).',
        'No <b>Corredor</b> (visão de cima), cada alvo mostra a distância e o risco de interceptação. <b>Arraste um alvo</b> para mudar a distância (passos de 10 m) e o deslocamento lateral.',
        'Toque no <b>quadradinho</b> acima do alvo para escolher a velocidade: lento (1,4 m/s), andando rápido (2,5 m/s) ou correndo (3,8 m/s). Ou mude todos de uma vez nos botões de velocidade.',
        'Toque em <b>▶ Animar</b> para ver o projétil e os alvos em tempo real.',
        'Na <b>Compensação</b>, escolha uma distância nos botões abaixo do diagrama: o app mostra a compensação de deslocamento (MRAD e MOA), os cliques e o avanço do alvo, para a velocidade escolhida.',
        'Edite distância, velocidade e deslocamento de cada alvo também na <b>tabela do cenário</b>; desmarque "Ativo" para tirar um alvo.',
        'Em cada diagrama, <b>❔ Ajuda</b> explica como ler e <b>⤢ Janela</b> abre em tela grande.'
      ],
      ve: 'A cena considera o arraste do seu perfil, a atmosfera (temperatura, pressão e umidade), o vento com direção, a altura da luneta e a zeragem, em tiro plano. Deriva giroscópica, Coriolis e inclinação aparecem na Balística e na Medir.',
      pular: DEFAULTS,
      dica: 'Use a Simulação para planejar e instruir antes de ir a campo: ela mostra se um alvo em movimento seria cruzado pela trajetória.',
      falha: 'Os diagramas ficaram em branco: abra a aba de novo ou use "Resetar". Um alvo foi para uma distância ocupada: o app o move para a distância livre mais próxima.'
    },

    tabCenaPerfis: {
      title: 'Perfis', lead: 'Gráficos animados da trajetória: altura por distância, perfil compensado e câmeras lentas (lateral e traseira).',
      antes: 'Perfis usa os mesmos campos da aba Simulação (zeragem, distância, vento): mude lá para ver o efeito aqui.',
      passos: [
        'Ajuste zeragem, distância e vento na Simulação.',
        'Em <b>Perfil de trajetória</b>, veja a subida (da boca até a zeragem) e a queda (da zeragem até o alvo, ou até o solo, se a trajetória não chegar). "Expandir" mostra a cena inteira.',
        'Em <b>Perfil compensado</b>, veja o arco já com a elevação aplicada: o projétil sobe acima da linha de mira e desce exatamente no alvo.',
        'Nas <b>câmeras lentas</b> (lateral e traseira), toque em <b>▶ Reproduzir</b> para animar. Toque num checkpoint (as distâncias embaixo do gráfico) para pausar naquele ponto; "Reproduzir" continua dali e "Reiniciar" volta ao começo.',
        'Em cada gráfico, <b>❔ Ajuda</b> explica como ler e <b>⤢ Janela</b> abre em tela grande.'
      ],
      ve: 'Os números são os mesmos do cálculo: o que muda é só a apresentação. O gráfico de trajetória mostra o impacto no solo quando, sem compensação, o projétil não alcança o alvo.',
      pular: DEFAULTS,
      falha: 'Gráfico vazio: abra a aba de novo. A câmera traseira mostra aviso de projétil fora do quadro: a distância está fora do alcance visível dessa referência.'
    }
  };

  // ---------------- janela ----------------
  let overlay = null, lastFocus = null, currentTab = null;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const allowed = () => { try { const a = typeof getPermissions === 'function' ? getPermissions() : null; return (a && a.length) ? ['tabInicio'].concat(a) : ORDER; } catch (e) { return ORDER; } };
  const activeTab = () => { const b = document.querySelector('.tab-btn.active'); return (b && b.getAttribute('data-tab')) || 'tabInicio'; };

  function injectCss() {
    if ($('ajudaCss')) return;
    const s = el('style'); s.id = 'ajudaCss';
    s.textContent = [
      '#tabHelpBtn{flex:0 0 auto;margin:0 4px;padding:0 14px;height:34px;border-radius:999px;border:1px solid var(--line);background:var(--surface-2,#20241a);color:var(--accent,#c39a4f);font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap}',
      '#tabHelpBtn:hover{border-color:var(--accent,#c39a4f)}',
      '#tabHelpOverlay{position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.66);display:none;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}',
      '#tabHelpOverlay.open{display:flex}',
      '#tabHelpBox{background:#171a11;color:#fff;border:1px solid #6a6f55;border-radius:12px;max-width:720px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;-webkit-text-size-adjust:100%;text-size-adjust:100%;box-shadow:0 10px 40px rgba(0,0,0,.6)}',
      '#tabHelpBox .th-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #5a5f48}',
      '#tabHelpBox .th-title{flex:1;font-weight:800;font-size:16px;color:#f2c96a}',
      '#tabHelpBox .th-close{background:#7a2b26;border:1px solid #a5433c;color:#fff;border-radius:8px;min-width:38px;height:32px;font-size:16px;font-weight:800;cursor:pointer}',
      '#tabHelpBox .th-nav{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px;border-bottom:1px solid #3b3f2f;background:#14170f}',
      '#tabHelpBox .th-chip{background:#262b1e;color:#e8e6d2;border:1px solid #5a5f48;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer}',
      '#tabHelpBox .th-chip.on{background:#3a3220;border-color:#f2c96a;color:#f2c96a}',
      '#tabHelpBox .th-body{overflow:auto;padding:6px 18px 18px;font-size:14.5px;line-height:1.55;color:#e8e6d2}',
      '#tabHelpBox h3{margin:16px 0 6px;font-size:14px;color:#f2c96a;text-transform:uppercase;letter-spacing:.4px}',
      '#tabHelpBox .th-lead{font-size:15px;margin:10px 0 4px}',
      '#tabHelpBox ol,#tabHelpBox ul{padding-left:22px;margin:6px 0}',
      '#tabHelpBox li{margin:5px 0}',
      '#tabHelpBox p{margin:6px 0}',
      '#tabHelpBox b{color:#fff}',
      '#tabHelpBox .th-box{border:1px solid #5a5f48;border-radius:10px;padding:8px 12px;margin:8px 0;background:rgba(255,255,255,.03)}',
      '#tabHelpBox .th-warn{border-color:#a5433c;background:rgba(193,72,61,.10)}',
      '#tabHelpBox .th-foot{display:flex;justify-content:space-between;gap:8px;margin-top:18px;flex-wrap:wrap}',
      '#tabHelpBox .th-step{background:#262b1e;color:#fff;border:1px solid #5a5f48;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer}',
      '#tabHelpBox .th-video{margin:10px 0;border:1px solid #5a5f48;border-radius:10px;overflow:hidden;background:#000}',
      '#tabHelpBox .th-video video{display:block;width:100%;max-height:46vh;background:#000}',
      '#tabHelpBox .th-vwrap{position:relative}',
      '#tabHelpBox .th-cap{position:absolute;left:8px;right:8px;bottom:44px;text-align:center;color:#fff;background:rgba(0,0,0,.72);border-radius:6px;padding:4px 8px;font-size:14px;line-height:1.35;pointer-events:none;display:none}',
      '#tabHelpBox .th-vbar{display:flex;gap:8px;align-items:center;padding:6px 8px;background:#14170f}',
      '#tabHelpBox .th-vbtn{background:#262b1e;color:#fff;border:1px solid #5a5f48;border-radius:8px;padding:5px 10px;font-weight:700;font-size:12px;cursor:pointer}',
      'body.nvg-red-mode #tabHelpBtn{color:#ff6a5a;border-color:#660000;background:#1a0000}',
      '@media (max-width:600px){#tabHelpOverlay{padding:0}#tabHelpBox{max-height:100vh;border-radius:0;max-width:none}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function build() {
    injectCss();
    overlay = el('div'); overlay.id = 'tabHelpOverlay';
    overlay.innerHTML = '<div id="tabHelpBox" role="dialog" aria-modal="true" aria-labelledby="thTitle"><div class="th-head"><div class="th-title" id="thTitle"></div><button type="button" class="th-close" aria-label="Fechar">✕</button></div><div class="th-nav" id="thNav"></div><div class="th-body" id="thBody"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.th-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) { e.stopPropagation(); close(); } }, true);
  }

  function videoHtml(tab, clip) {
    return '<div class="th-video" id="thVideoBox"><div class="th-vwrap"><video id="thVideo" preload="none" playsinline controls ' + (clip.poster ? 'poster="' + clip.poster + '" ' : '') + 'src="' + clip.src + '"></video><div class="th-cap" id="thCap" aria-live="off"></div></div>' +
      '<div class="th-vbar"><button type="button" class="th-vbtn" id="thAudio">🔊 Som ligado</button><button type="button" class="th-vbtn" id="thCc">CC Legenda</button><span style="font-size:11.5px;color:#b9b7a0">Demonstração com dados fictícios.</span></div></div>';
  }
  function wireVideo(clip) {
    const v = $('thVideo'); if (!v) return;
    let audioOn = true; try { audioOn = localStorage.getItem('geosniper_help_audio') !== 'off'; } catch (e) {}
    let ccOn = true; try { ccOn = localStorage.getItem('geosniper_help_cc') !== 'off'; } catch (e) {}
    const cap = $('thCap'), cues = (clip && clip.cues) || [];
    const paint = () => {
      if (!ccOn || !cues.length) { cap.style.display = 'none'; return; }
      const t = v.currentTime; let txt = '';
      for (let i = 0; i < cues.length; i++) if (t >= cues[i][0] && t <= cues[i][1] + 0.2) { txt = cues[i][2]; break; }
      cap.textContent = txt; cap.style.display = txt ? 'block' : 'none';
    };
    const apply = () => {
      v.muted = !audioOn; $('thAudio').textContent = audioOn ? '🔊 Som ligado' : '🔇 Som desligado';
      $('thCc').style.opacity = ccOn ? '1' : '.55'; paint();
    };
    $('thAudio').addEventListener('click', () => { audioOn = !audioOn; try { localStorage.setItem('geosniper_help_audio', audioOn ? 'on' : 'off'); } catch (e) {} apply(); });
    $('thCc').addEventListener('click', () => { ccOn = !ccOn; try { localStorage.setItem('geosniper_help_cc', ccOn ? 'on' : 'off'); } catch (e) {} apply(); });
    v.addEventListener('timeupdate', paint); v.addEventListener('seeked', paint); v.addEventListener('loadedmetadata', apply); v.addEventListener('play', apply); apply();
  }

  function render(tab) {
    const h = HELP[tab]; if (!h) return;
    currentTab = tab;
    $('thTitle').textContent = (ICONS[tab] || '❔') + ' Ajuda — ' + h.title;
    const nav = $('thNav'); nav.replaceChildren();
    const ok = allowed();
    for (const t of ORDER) {
      if (t !== 'tabInicio' && !ok.includes(t)) continue;
      const c = el('button', 'th-chip' + (t === tab ? ' on' : ''), (t === 'tabInicio' ? 'Guia' : NAMES[t])); c.type = 'button';
      c.addEventListener('click', () => render(t)); nav.append(c);
    }
    let html = '<p class="th-lead">' + h.lead + '</p>';
    if (h.clip) html += videoHtml(tab, h.clip);
    if (h.antes) html += '<h3>Antes de usar</h3><p>' + h.antes + '</p>';
    if (h.passos) html += '<h3>Passo a passo</h3><ol>' + h.passos.map(p => '<li>' + p + '</li>').join('') + '</ol>';
    if (h.ve) html += '<h3>O que você vê</h3><p>' + h.ve + '</p>';
    if (h.pular) html += '<h3>Se você pular esta etapa</h3><div class="th-box">' + h.pular + '</div>';
    if (h.dica) html += '<h3>Dicas e cuidados</h3><p>' + h.dica + '</p>';
    if (h.falha) html += '<h3>Se algo falhar</h3><div class="th-box th-warn">' + h.falha + '</div>';
    if (h.admin) html += '<h3>Para administradores</h3><p>' + h.admin + '</p>';
    const i = ORDER.indexOf(tab);
    const prev = i > 0 ? ORDER[i - 1] : null, next = i < ORDER.length - 1 ? ORDER[i + 1] : null;
    html += '<div class="th-foot">' + (prev ? '<button type="button" class="th-step" data-go="' + prev + '">◀ Antes: ' + NAMES[prev] + '</button>' : '<span></span>') + (next ? '<button type="button" class="th-step" data-go="' + next + '">Depois: ' + NAMES[next] + ' ▶</button>' : '') + '</div>';
    const body = $('thBody'); body.innerHTML = html; body.scrollTop = 0;
    body.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => render(b.getAttribute('data-go'))));
    wireVideo(h.clip);
  }

  function open(tab) {
    if (!overlay) build();
    lastFocus = document.activeElement;
    const t = (tab && HELP[tab]) ? tab : (HELP[activeTab()] ? activeTab() : 'tabInicio');
    render(t);
    overlay.classList.add('open');
    overlay.querySelector('.th-close').focus({ preventScroll: true });
  }
  function close() {
    if (!overlay) return;
    const v = $('thVideo'); if (v) { try { v.pause(); } catch (e) {} }
    overlay.classList.remove('open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function install() {
    injectCss();
    if (!$('tabHelpBtn')) {
      const nvg = $('nvgBtn');
      if (nvg && nvg.parentNode) {
        const b = el('button', '', '❔ Ajuda'); b.type = 'button'; b.id = 'tabHelpBtn'; b.title = 'Ajuda da aba atual';
        b.addEventListener('click', () => open());
        nvg.parentNode.insertBefore(b, nvg);
      }
    }
  }
  window.openTabHelp = open;
  window.closeTabHelp = close;
  window.GeoHelp = { HELP, ORDER, setClip: (tab, clip) => { if (HELP[tab]) HELP[tab].clip = clip; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
