# Mapa de Pastas — Fluxo Interativo

Um site estático para **mapear pastas e arquivos** em um **gráfico interativo** estilo *fluxograma* com itens flutuantes e visual limpo (cores claras). Clique em uma pasta para **expandir/colapsar** o conteúdo.

## Recursos
- Interface leve com **cores claras** (paleta inspirada em #045494, #d6e2ed, #4a83b6, #387db4, #7caccc).
- **Expansão por clique** de diretórios (lazy load).
- **Arrastar, pan e zoom** (D3 Force Layout).
- **Pesquisa instantânea** (Ctrl+K para focar).
- **Breadcrumbs** e painel de **detalhes** do nó.
- **Importar/Exportar JSON** da estrutura.
- **Salvar como SVG/PNG**.
- **Varredura real do sistema de arquivos** via File System Access API (Chrome/Edge).

## Como usar
1. Baixe e extraia este projeto.
2. Abra `index.html` no navegador.
3. Para ler uma pasta real, clique em **Escolher pasta** (requer Chrome/Edge em contexto seguro — `https://` ou `http://localhost`).
   - Dica rápida: sirva localmente com Python: `python -m http.server 8000` e acesse `http://localhost:8000`.
4. Também é possível **Importar JSON** com uma estrutura previamente exportada.

## Formato do JSON
```json
{
  "name": "Raiz",
  "type": "directory",
  "children": [
    { "name": "docs", "type": "directory", "children": [
      { "name": "README.md", "type": "file" }
    ]},
    { "name": "arquivo.txt", "type": "file" }
  ]
}
```

## Limitações & Notas
- O **Acesso ao Sistema de Arquivos** não funciona em todos os navegadores nem no esquema `file://`. Use Chrome/Edge e sirva via `localhost`.
- Tamanhos e datas de arquivos não são capturados por padrão para acelerar o carregamento (poderia ser habilitado via `getFile()` quando necessário).
- Exportar JSON não inclui os *handles* do sistema (não serializáveis).

## Licença
Uso livre para fins internos e educacionais. Sem garantias.
