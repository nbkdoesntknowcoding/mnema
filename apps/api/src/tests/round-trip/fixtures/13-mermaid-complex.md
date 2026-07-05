# Mermaid (complex)

System architecture:

```mermaid
graph TD
  Browser --> Astro
  Astro --> Fastify
  Fastify --> Postgres
  Fastify --> Redis
  Browser --> Hocuspocus
  Hocuspocus --> Postgres
```

State diagram:

```mermaid
stateDiagram-v2
  [*] --> Connecting
  Connecting --> Synced
  Synced --> Disconnected
  Disconnected --> Connecting
```
