# GNSS Campo

App Android nativo para levantamento geoespacial de campo: coleta de pontos, linhas e polígonos
via GNSS (GPS interno do celular **ou** receptor externo por Bluetooth/NMEA 0183), com mapa
offline (satélite/ruas) e exportação para **GeoJSON, KML, KMZ, Shapefile, CSV e GPX**.

Construído com Capacitor (HTML/JS embutido em app nativo) + GitHub Actions, compilando o `.apk`
na nuvem — sem precisar instalar Android Studio.

---

## Como publicar (compilar o APK sem Android Studio)

1. Crie um repositório novo no GitHub (pode ser privado).
2. Faça o upload de **todo o conteúdo desta pasta** para o repositório (mantendo a estrutura,
   incluindo a pasta `.github/workflows` e `android/`).
   - Pelo site do GitHub: "Add file" → "Upload files" → arraste todos os arquivos/pastas.
   - Ou via linha de comando:
     ```
     git init
     git add .
     git commit -m "GNSS Campo - primeira versão"
     git branch -M main
     git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
     git push -u origin main
     ```
3. Assim que o push terminar, vá na aba **Actions** do repositório. O workflow "Build APK" começa
   automaticamente (leva de 3 a 6 minutos).
4. Quando terminar (ícone verde ✔), clique no build → em **Artifacts**, baixe
   `gnss-campo-debug-apk`. Dentro do zip está o `app-debug.apk`.
5. Transfira o `.apk` para o celular Android (Google Drive, cabo USB, etc.) e instale
   (pode ser necessário permitir "instalar apps de fontes desconhecidas" nas configurações).

Toda vez que você (ou eu) alterar algo no código e enviar (`git push`), um novo APK é gerado
automaticamente — não precisa mexer em nada manualmente.

---

## Funcionalidades

### Coleta em campo
- **Ponto** — marca a posição atual com nome, categoria e observações.
- **Linha** — adiciona vértices caminhando pelo trajeto; mostra o comprimento em tempo real.
- **Polígono** — adiciona vértices pelo perímetro; calcula área (m²/ha) e perímetro em tempo real,
  usando projeção UTM (fórmula de Gauss/Shoelace) — sem depender de internet.

### Fonte de GNSS (aba Config)
- **GPS interno** — usa o sensor de localização do próprio celular.
- **Receptor externo via Bluetooth** — conecta a qualquer receptor GNSS/RTK que emita sentenças
  NMEA 0183 (GGA/RMC) por Bluetooth clássico (SPP). Basta parear o receptor nas configurações
  Bluetooth do Android primeiro, depois em **Config → Receptor externo → Buscar dispositivos
  pareados → Conectar**. O app lê automaticamente latitude, longitude, altitude, número de
  satélites, HDOP e o tipo de fixação (GPS simples, DGPS, RTK fixo/flutuante).

### Mapa offline
- Camadas de **satélite** (Esri) e **ruas** (OpenStreetMap).
- Cada tile visualizado é salvo automaticamente no dispositivo (IndexedDB). Ao voltar à mesma
  área sem internet, o mapa aparece a partir do cache. É possível limpar o cache em
  **Config → Mapa offline**.

### Exportação (aba Exportar)
| Formato | Uso recomendado |
|---|---|
| GeoJSON | QGIS, ArcGIS, Mapbox, Google Earth Engine |
| KML | Google Earth |
| KMZ | Google Earth (compactado, com estilos) |
| Shapefile (.zip com .shp/.shx/.dbf/.prj) | QGIS, ArcGIS, AutoCAD Map 3D |
| CSV | Excel, LibreOffice, R, Python |
| GPX | Receptores GPS, Garmin BaseCamp, apps de trilha |

Todos os formatos são gerados localmente no aparelho e compartilhados via o menu nativo do
Android (salvar no Drive, enviar por e-mail/WhatsApp, etc.).

---

## Estrutura do projeto

```
gnss-campo/
├── www/                    → código-fonte do app (HTML/CSS/JS)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js          → interface e fluxo de coleta
│   │   ├── gnss.js         → GPS interno + Bluetooth/NMEA
│   │   ├── map.js          → mapa Leaflet + cache offline
│   │   ├── geometry.js     → distância, área, conversão UTM
│   │   ├── exporters.js    → geração dos arquivos de exportação
│   │   └── storage.js      → persistência local (localStorage)
│   └── libs/                → Leaflet, JSZip, shp-write (embutidos, funcionam offline)
├── android/                 → projeto nativo Android gerado pelo Capacitor
├── .github/workflows/       → pipeline de build automático do APK
├── package.json
└── capacitor.config.json
```

## Observações técnicas

- O app funciona **sem internet** para coleta, cálculo de área/distância e exportação — todos os
  formatos são gerados localmente. Internet só é necessária para baixar novos tiles de mapa
  (áreas já visitadas ficam em cache) e, opcionalmente, para compartilhar os arquivos exportados
  na nuvem.
- Precisão exibida: para GPS interno, vem diretamente do sensor Android; para receptores
  Bluetooth/NMEA, é uma estimativa a partir do HDOP (não substitui o dado de precisão nativo do
  seu receptor, se ele fornecer via outro protocolo).
- O projeto é independente do "Coletor de Campo GNSS" feito anteriormente — nenhum arquivo é
  compartilhado entre os dois, para não haver risco de conflito.
