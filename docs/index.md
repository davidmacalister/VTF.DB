---
title: "Início"
---

# Bem-vindas a Valve Assets Wiki

"QUE DIABO É ISSO JV?!"

Isso é um automatizador de sites que pega as estruturas das pastas e markdown e gera automaticamente todo conteúdo do site para você, e melhor... VIA GITHUB! Então só o cara dar um commit que atualiza o site em si. E olha ali no topo ó, o logozinho do Git que leva pro repositório, maneiro né?

Diferente do que uso, Elementy é focado em sites em gerais, já o MkDocs é focado em documentação e funciona igualmente, mas é automatizado para esse intuito, por isso que é mais simples de se mexer, pois todo sistema foi pensado para isso.

Nisso, escute mais seu amigu.

![bleh!](jvlingua.png)

For full documentation visit [mkdocs.org](https://www.mkdocs.org).

Não esqueça de por os créditos do pessoal após finalizar.

## Project layout

    mkdocs.yml               # O arquivo de configurações do site.
    docs/
        index.md             # Página inicial, você está aqui.
        games/
            (nome do jogo)/  # Crie uma pasta correspondente ao jogo.
                index.md     # Página principal do jogo da pasta
                (+pastas)/   # Pasta para conteúdo do disco relacionado ao jogo.
                ...
                
Use isso de referência para fazer com resto do site, pode até dar olhada nos arquivos mesmo.