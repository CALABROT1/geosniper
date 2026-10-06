# GeoSniper — Precisão em campo

Ferramenta de **cálculo e referência** para tiro de precisão e caça: balística, medição de distância no mapa, marcação tática em equipe e planejamento.

- Site e aplicativo web: <https://geosniper.com.br/>
- Apresentação: <https://geosniper.com.br/sobre/>
- Contato: contato@geosniper.com.br

> O GeoSniper **não vende armas, munição ou acessórios**. Os resultados são estimativas e não substituem treinamento, as normas de segurança nem a legislação aplicável.

## O que há neste repositório

Este repositório contém o **front-end** (site e app web). O servidor (contas, permissões, pontos em tempo real e cálculo balístico) não é público.

| Caminho | Conteúdo |
|---|---|
| `index.html` | Aplicativo web (interface, estilos e lógica) |
| `ballistics-engine.js` | Motor balístico usado no navegador (arrasto G1 a G8, atmosfera, vento, Coriolis) |
| `home-hud.js` | Painel orbital da aba Início (somente web) |
| `ajuda.js`, `ajuda-clips.js`, `ajuda/` | Ajuda por aba, legendas e vídeos |
| `mapas-config.js` | Configuração pública dos mapas (chave com restrição de domínio) |
| `sw.js`, `manifest.webmanifest` | PWA (instalação no celular e abertura rápida) |
| `sobre/` | Página de apresentação, privacidade, termos e exclusão de conta |
| `icons/`, `fonts/` | Ícones táticos e fontes (licença OFL) |
| `.well-known/assetlinks.json` | Verificação dos links de app (Android) |

O aplicativo Android é um empacotamento do mesmo `index.html` (Capacitor).

## Privacidade

Política em <https://geosniper.com.br/sobre/privacidade.html>. Exclusão de conta e dados em <https://geosniper.com.br/sobre/exclusao.html>.

## Licença

© Fábio Calabrot. **Todos os direitos reservados.** O código está público para consulta. Cópia, redistribuição ou uso comercial dependem de autorização por escrito.

Fontes Chakra Petch e Share Tech Mono: SIL Open Font License 1.1 (ver `fonts/LEIA-ME.txt`).
