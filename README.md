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
- Argon2id, `PasswordService` y nucleo transaccional del bootstrap inicial
- login con email y password, bloqueo temporal y auditoria de eventos
- login con sesion, access token RS256 y refresh token en cookie segura
- rotacion estricta, deteccion de reuso y logout transaccional

Todavia no incluye:

- listado y administracion de sesiones; corresponden al siguiente bloque de HU-28
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

## Bootstrap administrativo inicial

El comando se ejecuta exclusivamente en una terminal interactiva y no inicia el servidor HTTP:

```powershell
pnpm.cmd bootstrap:admin
```

Solicita organizacion, email, nombre y password con confirmacion oculta. Antes de escribir exige teclear `CREAR`. No acepta argumentos, redireccion de entrada, password mediante variables ni ejecucion automatica. Debe apuntar deliberadamente a la base objetivo mediante `DATABASE_URL`; las pruebas automatizadas nunca deben usar Dokploy.

La segunda ejecucion se rechaza si ya existe una asignacion global activa de `SuperAdmin`. No existe opcion `--force`.

## Autenticacion y sesiones

`POST /api/v1/auth/login` valida email, password y, cuando aplica, `organizationCode`. El exito crea una sesion, devuelve el access token en JSON y entrega el refresh token exclusivamente mediante cookie. La respuesta nunca contiene el refresh token.

`POST /api/v1/auth/refresh` rota el refresh token y `POST /api/v1/auth/logout` revoca la sesion completa. Login, refresh y logout exigen un encabezado `Origin` incluido exactamente en `CORS_ORIGINS`; refresh y logout reciben la cookie, nunca el token mediante body o URL.

La cookie usa `HttpOnly`, `SameSite=Lax`, `Path=/`, no define `Domain` y agrega `Secure` en produccion. El frontend debe enviar credenciales y serializar las renovaciones para cumplir la politica estricta de reuso.

La base criptografica de HU-28 utiliza `jose`, claves RSA 3072, `kid`, issuer, audience y access tokens de 10 minutos. Las claves se reciben como Base64 mediante secretos de entorno; no existen claves por defecto ni material criptografico versionado.

Para generar o rotar exclusivamente las claves del entorno local:

```powershell
pnpm.cmd security:jwt:generate-local
```

El comando actualiza `.env` sin imprimir claves, se niega a operar si detecta `NODE_ENV=production` y no crea respaldos con secretos.

El nucleo de sesiones soporta creacion, rotacion, expiracion, deteccion de reuso, revocacion compensatoria y logout auditado. El siguiente bloque incorporara listado y revocacion administrativa de sesiones propias.

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
