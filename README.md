# scm-api

Backend API de DIREGO SCM.

## Estado

Repositorio creado para HU-25 del Sprint 3. La arquitectura aprobada define un monolito modular con NestJS y Fastify, API REST bajo `/api/v1`, PostgreSQL mediante Drizzle y despliegue controlado en Dokploy.

Este commit es fundacional. Todavia no incluye:

- codigo de NestJS
- dependencias de Node.js
- conexion funcional a PostgreSQL
- autenticacion o sesiones
- endpoints de importacion
- procesamiento asincrono

## Alcance inicial de HU-25

El siguiente bloque implementara el bootstrap tecnico del repositorio:

- Node.js, TypeScript y pnpm
- NestJS con adaptador Fastify
- configuracion validada
- API versionada bajo `/api/v1`
- manejo base de errores
- OpenAPI
- CORS explicito
- health y readiness checks
- estructura modular preparada para seguridad y multi-tenancy

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

