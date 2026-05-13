---
title: Guide Fastify 5
tags: [fastify, nodejs, api]
---

# Guide Fastify 5

## Présentation

Fastify est un framework web Node.js axé sur les performances. Il est jusqu'à 30% plus rapide qu'Express grâce à sa sérialisation JSON optimisée et son architecture de plugins.

## Création d'une application

```js
import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/", async () => {
  return { hello: "world" };
});

await app.listen({ port: 3000 });
```

## Validation avec JSON Schema

Fastify valide automatiquement les entrées et sérialise les sorties via JSON Schema :

```js
app.post(
  "/user",
  {
    schema: {
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
        },
      },
    },
  },
  async (request) => {
    return { created: request.body.name };
  },
);
```

## Système de plugins

Les plugins permettent d'encapsuler de la logique et des routes :

```js
import fp from "fastify-plugin";

const myPlugin = fp(async (app) => {
  app.decorate("myHelper", () => "hello");
});

app.register(myPlugin);
```

## Hooks disponibles

- `onRequest` : avant le parsing
- `preHandler` : avant le handler
- `onSend` : avant l'envoi de la réponse
- `onClose` : à l'arrêt du serveur
- `onReady` : quand le serveur est prêt
