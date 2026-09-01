export interface CategoryPreset {
  key: string;
  name: string;
  emoji: string;
  description: string;
  defaultKeywords: string[];
  mlCategoryId?: string;
}

export const CATEGORY_PRESETS: Record<string, CategoryPreset> = {
  esportes_suplementos: {
    key: 'esportes_suplementos',
    name: 'Esportes & Suplementação',
    emoji: '💪',
    description: 'Whey protein, creatina, pré-treino, tênis esportivos, roupas fitness, acessórios de treino e esportes',
    defaultKeywords: [
      'creatina monohidratada',
      'whey protein concentrado',
      'pre treino',
      'suplemento vitaminico',
      'tenis corrida',
      'smartband relogio fitness',
      'garrafa termica squeeze',
      'coqueteleira suplemento',
      'corda de pular crossfit',
      'kit elastico extensor treino'
    ],
    mlCategoryId: 'MLB1276' // Esportes e Fitness
  },
  eletronicos_tech: {
    key: 'eletronicos_tech',
    name: 'Eletrônicos & Tecnologia',
    emoji: '📱',
    description: 'Smartphones, fones sem fio, smartwatches, notebooks, caixas de som e periféricos',
    defaultKeywords: [
      'fone bluetooth sem fio',
      'smartwatch relogio inteligente',
      'carregador por inducao turbo',
      'power bank carregador portatil',
      'caixa de som bluetooth',
      'teclado mecanico sem fio',
      'mouse sem fio ergonomico',
      'cabo usb tipo c reforçado',
      'suporte celular articulado'
    ],
    mlCategoryId: 'MLB1051' // Celulares e Telefones
  },
  casa_cozinha: {
    key: 'casa_cozinha',
    name: 'Casa, Cozinha & Eletrodomésticos',
    emoji: '🍳',
    description: 'Air fryer, robô aspirador, panelas antiaderentes, cafeteiras, organizadores e utilidades',
    defaultKeywords: [
      'air fryer fritadeira sem oleo',
      'robo aspirador de po',
      'mop giratorio limpeza',
      'jogo de panelas inducao',
      'cafeteira expresso capsula',
      'liquidificador turbo potente',
      'kit potes hermeticos vidro',
      'torneira gourmet flexivel',
      'luminaria de mesa led'
    ],
    mlCategoryId: 'MLB1574' // Casa, Móveis e Decoração
  },
  moda_beleza: {
    key: 'moda_beleza',
    name: 'Beleza, Perfumaria & Moda',
    emoji: '💄',
    description: 'Perfumes importados, skincare, maquiagem, secadores, relógios e roupas',
    defaultKeywords: [
      'perfume importado original',
      'serum facial anti idade retinol',
      'protetor solar facial toque seco',
      'escova secadora modeladora',
      'kit maquiagem profissional',
      'hidratante corporal cheiroso',
      'relogio feminino masculino',
      'oculos de sol polarizado'
    ],
    mlCategoryId: 'MLB1246' // Beleza e Cuidado Pessoal
  },
  games_informatica: {
    key: 'games_informatica',
    name: 'Games & Computadores',
    emoji: '🎮',
    description: 'Jogos, controles de videogame, cadeiras gamer, headsets, SSDs e memórias',
    defaultKeywords: [
      'controle videogame sem fio',
      'headset gamer 7.1 surround',
      'ssd nvme 1tb alta velocidade',
      'cadeira gamer reclinavel',
      'mouse pad speed extra grande',
      'cooler fan rgb gabinete',
      'volante com pedal simulador',
      'suporte monitor articulado gas'
    ],
    mlCategoryId: 'MLB1144' // Games
  },
  geral: {
    key: 'geral',
    name: 'Geral (Melhores Ofertas de Todas as Categorias)',
    emoji: '🔥',
    description: 'Produtos com os maiores descontos absolutos do dia na Shopee e Mercado Livre',
    defaultKeywords: [
      'promocao relampago',
      'oferta do dia',
      'liquidacao queima de estoque',
      'menor preco historico'
    ]
  }
};
