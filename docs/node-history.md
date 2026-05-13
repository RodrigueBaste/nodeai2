---
title: Histoire de Node.js
tags: [nodejs, javascript, backend]
---

# Histoire de Node.js

## Création et origines

Node.js a été créé par Ryan Dahl en 2009. Il voulait résoudre un problème fondamental des serveurs web de l'époque : la gestion des connexions simultanées.

Les serveurs traditionnels comme Apache utilisaient un thread par connexion, ce qui posait des problèmes de performance et de scalabilité à grande échelle.

## Architecture event loop

Node.js utilise une architecture basée sur l'event loop (boucle d'événements). Ce modèle permet de gérer des milliers de connexions simultanées avec un seul thread, en utilisant des opérations non-bloquantes.

Le moteur V8 de Google Chrome est au cœur de Node.js. V8 compile le JavaScript en code machine natif, ce qui le rend très rapide.

## npm et l'écosystème

npm (Node Package Manager) a été lancé en 2010 par Isaac Schlueter. Il est devenu le plus grand registre de packages logiciels au monde, avec plus de 2 millions de packages disponibles.

## Versions majeures

- Node.js 0.1 : 2009, première version publique
- Node.js 6 : 2016, support ES6 amélioré
- Node.js 12 : 2019, modules ESM en expérimental
- Node.js 18 : 2022, fetch API native, modules ESM stables
- Node.js 20 : 2023, support --env-file natif
- Node.js 22 : 2024, amélioration des performances
- Node.js 24 : 2025, version LTS actuelle
