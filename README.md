# scm-api

Backend API de DIREGO SCM.

## Estado

Repositorio en desarrollo para el Sprint 3. La arquitectura aprobada define un monolito modular con NestJS y Fastify, API REST bajo `/api/v1`, PostgreSQL mediante Drizzle y despliegue controlado en Dokploy.

El bootstrap inicial ya incluye:

- NestJS sobre Fastify
- TypeScript y pnpm
- configuracion validada con Zod
- OpenAPI bajo `/api/v1/docs`
- endpoints de liveness y readiness
- pool PostgreSQL con cierre controlado y readiness real
- pruebas unitarias y de integracion con Vitest

Todavia no incluye:

- autenticacion o sesiones; corresponden a HU-27 y HU-28
- endpoints de importacion
- procesamiento asincrono

## PostgreSQL local de pruebas

La instancia local usa PostgreSQL 16.4, publica solamente en `127.0.0.1:15433` y mantiene un volumen separado de cualquier entorno de Dokploy.

```powershell
pnpm.cmd db:test:up
$env:TEST_DATABASE_URL='postgresql://scm_test:scm_test_password@127.0.0.1:15433/scm_test'
pnpm.cmd test:integration
```

La migracion y los seeds pertenecen a `scm-database`. Para preparar una instancia nueva, se aplica la migracion desde ese repositorio usando la URL local y luego los seeds aprobados en orden. Nunca se debe usar `DATABASE_URL` de Dokploy para pruebas.

Comandos operativos:

```powershell
pnpm.cmd db:test:logs
pnpm.cmd db:test:down
```

`db:test:down` conserva el volumen. La eliminacion del volumen debe ser una accion manual y deliberada.

## Reglas de repositorio

- `main` es la rama protegida de integracion.
- Los cambios funcionales deben llegar mediante Pull Request.
- No se versionan secretos ni archivos `.env` reales.
- Las migraciones pertenecen exclusivamente a `scm-database`.
- Las pruebas nunca deben utilizar la base PostgreSQL de Dokploy.

## Repositorios relacionados

- `scm-docs`: documentacion, backlog y decisiones.
- `scm-database`: schema Drizzle, migraciones y seeds.
- `scm-api`: backend y API de negocio.
